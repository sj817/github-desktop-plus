//! Locale CRUD endpoints. All routes operate under `<data_dir>/locales/<locale>/<category>.json`.
//!
//! Path components are validated to prevent traversal; `zh-CN` is a built-in
//! locale that cannot be deleted.

use std::path::{Path, PathBuf};

use bytes::Bytes;
use hyper::StatusCode;
use serde::{Deserialize, Serialize};

use crate::http_helpers::{Body, json_err, json_ok, make_response};

pub const PROTECTED_LOCALE: &str = "zh-CN";

#[derive(Debug, Serialize, Deserialize)]
pub struct LocaleEntry {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize)]
pub struct LocaleSummary {
    pub locale: String,
    pub categories: Vec<String>,
    pub total_keys: usize,
}

/// Validate a single path component (locale or category name).
fn valid(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
}

/// Resolve and validate a locale file path. Returns `None` on invalid input.
pub fn locale_file_path(data_dir: &Path, locale: &str, category: &str) -> Option<PathBuf> {
    if !valid(locale) || !valid(category) {
        return None;
    }
    Some(
        data_dir
            .join("locales")
            .join(locale)
            .join(format!("{category}.json")),
    )
}

fn locale_dir(data_dir: &Path, locale: &str) -> Option<PathBuf> {
    if !valid(locale) {
        return None;
    }
    Some(data_dir.join("locales").join(locale))
}

/// Touch `<data_dir>/.gdp-locale-reload` with the current unix timestamp so the
/// hook side can re-read translations.
fn reload_signal(data_dir: &Path) {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let _ = std::fs::write(data_dir.join(".gdp-locale-reload"), ts.to_string());
}

fn read_json_map(path: &Path) -> Option<serde_json::Map<String, serde_json::Value>> {
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&content).ok()
}

fn write_json_map(
    path: &Path,
    map: &serde_json::Map<String, serde_json::Value>,
) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let s = serde_json::to_string_pretty(map).map_err(std::io::Error::other)?;
    std::fs::write(path, s)
}

// ── Handlers ─────────────────────────────────────────────────────────────────

pub fn list_locales(data_dir: &Path) -> hyper::Response<Body> {
    let locales_dir = data_dir.join("locales");
    let mut summaries: Vec<LocaleSummary> = Vec::new();
    let entries = match std::fs::read_dir(&locales_dir) {
        Ok(rd) => rd,
        Err(_) => return json_ok(&summaries),
    };
    for entry in entries.flatten() {
        let ft = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if !ft.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let mut categories = Vec::new();
        let mut total_keys = 0usize;
        if let Ok(rd) = std::fs::read_dir(entry.path()) {
            for f in rd.flatten() {
                let fname = f.file_name().to_string_lossy().to_string();
                if let Some(cat) = fname.strip_suffix(".json") {
                    categories.push(cat.to_string());
                    if let Some(map) = read_json_map(&f.path()) {
                        total_keys += map.iter().filter(|(k, _)| !k.starts_with('_')).count();
                    }
                }
            }
        }
        categories.sort();
        summaries.push(LocaleSummary {
            locale: name,
            categories,
            total_keys,
        });
    }
    summaries.sort_by(|a, b| a.locale.cmp(&b.locale));
    json_ok(&summaries)
}

pub fn read_category(data_dir: &Path, locale: &str, category: &str) -> hyper::Response<Body> {
    let Some(path) = locale_file_path(data_dir, locale, category) else {
        return json_err(StatusCode::BAD_REQUEST, "invalid_locale_params");
    };
    let Some(map) = read_json_map(&path) else {
        return json_err(StatusCode::NOT_FOUND, "locale_file_not_found");
    };
    let mut entries: Vec<LocaleEntry> = map
        .into_iter()
        .filter(|(k, _)| !k.starts_with('_'))
        .map(|(k, v)| LocaleEntry {
            key: k,
            value: v.as_str().unwrap_or("").to_string(),
        })
        .collect();
    entries.sort_by(|a, b| a.key.cmp(&b.key));
    json_ok(&entries)
}

pub fn write_category(
    data_dir: &Path,
    locale: &str,
    category: &str,
    body: &Bytes,
) -> hyper::Response<Body> {
    let Some(path) = locale_file_path(data_dir, locale, category) else {
        return json_err(StatusCode::BAD_REQUEST, "invalid_locale_params");
    };
    let entries: Vec<LocaleEntry> = match serde_json::from_slice(body) {
        Ok(v) => v,
        Err(_) => return json_err(StatusCode::BAD_REQUEST, "invalid_locale_entries"),
    };
    let map: serde_json::Map<String, serde_json::Value> = entries
        .iter()
        .map(|e| (e.key.clone(), serde_json::Value::String(e.value.clone())))
        .collect();
    let count = map.len();
    if write_json_map(&path, &map).is_err() {
        return json_err(StatusCode::INTERNAL_SERVER_ERROR, "write_failed");
    }
    reload_signal(data_dir);
    json_ok(&serde_json::json!({
        "ok": true,
        "locale": locale,
        "category": category,
        "count": count,
    }))
}

pub fn upsert_key(
    data_dir: &Path,
    locale: &str,
    category: &str,
    body: &Bytes,
) -> hyper::Response<Body> {
    let Some(path) = locale_file_path(data_dir, locale, category) else {
        return json_err(StatusCode::BAD_REQUEST, "invalid_locale_params");
    };
    let entry: LocaleEntry = match serde_json::from_slice(body) {
        Ok(v) => v,
        Err(_) => return json_err(StatusCode::BAD_REQUEST, "invalid_entry"),
    };
    let mut map = read_json_map(&path).unwrap_or_default();
    map.insert(
        entry.key.clone(),
        serde_json::Value::String(entry.value.clone()),
    );
    if write_json_map(&path, &map).is_err() {
        return json_err(StatusCode::INTERNAL_SERVER_ERROR, "write_failed");
    }
    reload_signal(data_dir);
    json_ok(&serde_json::json!({ "ok": true, "key": entry.key }))
}

pub fn delete_key(
    data_dir: &Path,
    locale: &str,
    category: &str,
    key: &str,
) -> hyper::Response<Body> {
    let Some(path) = locale_file_path(data_dir, locale, category) else {
        return json_err(StatusCode::BAD_REQUEST, "invalid_locale_params");
    };
    let mut map = match read_json_map(&path) {
        Some(m) => m,
        None => return json_err(StatusCode::NOT_FOUND, "locale_file_not_found"),
    };
    if map.remove(key).is_none() {
        return json_err(StatusCode::NOT_FOUND, "key_not_found");
    }
    if write_json_map(&path, &map).is_err() {
        return json_err(StatusCode::INTERNAL_SERVER_ERROR, "write_failed");
    }
    reload_signal(data_dir);
    json_ok(&serde_json::json!({ "ok": true, "key": key }))
}

pub fn create_locale(data_dir: &Path, locale: &str) -> hyper::Response<Body> {
    let Some(dir) = locale_dir(data_dir, locale) else {
        return json_err(StatusCode::BAD_REQUEST, "invalid_locale");
    };
    if dir.exists() {
        return json_err(StatusCode::CONFLICT, "locale_exists");
    }
    if std::fs::create_dir_all(&dir).is_err() {
        return json_err(StatusCode::INTERNAL_SERVER_ERROR, "create_failed");
    }
    reload_signal(data_dir);
    json_ok(&serde_json::json!({ "ok": true, "locale": locale }))
}

pub fn delete_locale(data_dir: &Path, locale: &str) -> hyper::Response<Body> {
    if locale == PROTECTED_LOCALE {
        return json_err(StatusCode::CONFLICT, "cannot_delete_protected_locale");
    }
    let Some(dir) = locale_dir(data_dir, locale) else {
        return json_err(StatusCode::BAD_REQUEST, "invalid_locale");
    };
    if !dir.exists() {
        return json_err(StatusCode::NOT_FOUND, "locale_not_found");
    }
    if std::fs::remove_dir_all(&dir).is_err() {
        return json_err(StatusCode::INTERNAL_SERVER_ERROR, "delete_failed");
    }
    reload_signal(data_dir);
    json_ok(&serde_json::json!({ "ok": true, "locale": locale }))
}

pub fn import_locale(data_dir: &Path, locale: &str, body: &Bytes) -> hyper::Response<Body> {
    let Some(dir) = locale_dir(data_dir, locale) else {
        return json_err(StatusCode::BAD_REQUEST, "invalid_locale");
    };
    let parsed: serde_json::Map<String, serde_json::Value> = match serde_json::from_slice(body) {
        Ok(v) => v,
        Err(_) => return json_err(StatusCode::BAD_REQUEST, "invalid_import_payload"),
    };
    if std::fs::create_dir_all(&dir).is_err() {
        return json_err(StatusCode::INTERNAL_SERVER_ERROR, "create_failed");
    }
    let mut written = 0usize;
    for (cat, value) in parsed {
        if !valid(&cat) {
            continue;
        }
        let map = match value {
            serde_json::Value::Object(m) => m,
            _ => continue,
        };
        let path = dir.join(format!("{cat}.json"));
        if write_json_map(&path, &map).is_ok() {
            written += 1;
        }
    }
    reload_signal(data_dir);
    json_ok(&serde_json::json!({ "ok": true, "locale": locale, "categories_written": written }))
}

pub fn export_locale(data_dir: &Path, locale: &str) -> hyper::Response<Body> {
    let Some(dir) = locale_dir(data_dir, locale) else {
        return json_err(StatusCode::BAD_REQUEST, "invalid_locale");
    };
    if !dir.exists() {
        return json_err(StatusCode::NOT_FOUND, "locale_not_found");
    }
    let mut bundle = serde_json::Map::new();
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for f in rd.flatten() {
            let fname = f.file_name().to_string_lossy().to_string();
            if let Some(cat) = fname.strip_suffix(".json") {
                if let Some(map) = read_json_map(&f.path()) {
                    bundle.insert(cat.to_string(), serde_json::Value::Object(map));
                }
            }
        }
    }
    let body = serde_json::to_vec_pretty(&bundle).unwrap_or_default();
    let mut resp = make_response(StatusCode::OK, "application/json; charset=utf-8", body);
    resp.headers_mut().insert(
        hyper::header::CONTENT_DISPOSITION,
        hyper::header::HeaderValue::from_str(&format!("attachment; filename=\"{locale}.json\""))
            .unwrap_or_else(|_| hyper::header::HeaderValue::from_static("attachment")),
    );
    resp
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_path_components() {
        assert!(valid("zh-CN"));
        assert!(valid("en_US"));
        assert!(valid("ui-dialogs"));
        assert!(valid("a1"));
        assert!(!valid(""));
        assert!(!valid(".."));
        assert!(!valid("foo/bar"));
        assert!(!valid("foo bar"));
        assert!(!valid("foo.bar"));
    }

    #[test]
    fn locale_file_path_rejects_traversal() {
        let root = std::path::Path::new("/data");
        assert!(locale_file_path(root, "../etc", "ui").is_none());
        assert!(locale_file_path(root, "zh-CN", "../etc/passwd").is_none());
        assert!(locale_file_path(root, "", "ui").is_none());
        assert!(locale_file_path(root, "zh-CN", "").is_none());
    }

    #[test]
    fn locale_file_path_constructs_expected() {
        let root = std::path::Path::new("/data");
        let p = locale_file_path(root, "zh-CN", "ui-dialogs").unwrap();
        assert!(p.ends_with("locales/zh-CN/ui-dialogs.json") || p.ends_with("locales\\zh-CN\\ui-dialogs.json"));
    }

    #[test]
    fn protected_locale_constant() {
        assert_eq!(PROTECTED_LOCALE, "zh-CN");
    }
}
