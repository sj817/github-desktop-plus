//! Locale package endpoints. Runtime storage is one aggregate JSON file per
//! locale: `<data_dir>/locales/<locale>.json`.
//!
//! The source tree can stay split for maintenance, but the core runtime only
//! reads and writes aggregate packages whose top-level keys are category names.

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

pub fn locale_file_path(data_dir: &Path, locale: &str) -> Option<PathBuf> {
    if !valid(locale) {
        return None;
    }
    Some(data_dir.join("locales").join(format!("{locale}.json")))
}

/// Touch `<data_dir>/.gdp-locale-reload` with the current unix timestamp so the
/// hook side can re-read translations.
pub fn reload_signal(data_dir: &Path) {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let _ = std::fs::write(data_dir.join(".gdp-locale-reload"), ts.to_string());
}

fn read_bundle(path: &Path) -> Option<serde_json::Map<String, serde_json::Value>> {
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&content).ok()
}

fn write_bundle(
    path: &Path,
    bundle: &serde_json::Map<String, serde_json::Value>,
) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let s = serde_json::to_string_pretty(bundle).map_err(std::io::Error::other)?;
    std::fs::write(path, format!("{s}\n"))
}

fn category_map(
    bundle: &serde_json::Map<String, serde_json::Value>,
    category: &str,
) -> Option<serde_json::Map<String, serde_json::Value>> {
    bundle.get(category)?.as_object().cloned()
}

fn summarize(locale: String, bundle: serde_json::Map<String, serde_json::Value>) -> LocaleSummary {
    let mut categories = Vec::new();
    let mut total_keys = 0usize;

    for (category, value) in bundle {
        let Some(map) = value.as_object() else {
            continue;
        };
        categories.push(category);
        total_keys += map.iter().filter(|(k, _)| !k.starts_with('_')).count();
    }
    categories.sort();

    LocaleSummary {
        locale,
        categories,
        total_keys,
    }
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
        if !ft.is_file() {
            continue;
        }
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let Some(locale) = path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(str::to_string)
        else {
            continue;
        };
        let Some(bundle) = read_bundle(&path) else {
            continue;
        };
        summaries.push(summarize(locale, bundle));
    }

    summaries.sort_by(|a, b| a.locale.cmp(&b.locale));
    json_ok(&summaries)
}

pub fn read_category(data_dir: &Path, locale: &str, category: &str) -> hyper::Response<Body> {
    if !valid(category) {
        return json_err(StatusCode::BAD_REQUEST, "invalid_locale_params");
    }
    let Some(path) = locale_file_path(data_dir, locale) else {
        return json_err(StatusCode::BAD_REQUEST, "invalid_locale_params");
    };
    let Some(bundle) = read_bundle(&path) else {
        return json_err(StatusCode::NOT_FOUND, "locale_file_not_found");
    };
    let Some(map) = category_map(&bundle, category) else {
        return json_err(StatusCode::NOT_FOUND, "locale_category_not_found");
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
    if !valid(category) {
        return json_err(StatusCode::BAD_REQUEST, "invalid_locale_params");
    }
    let Some(path) = locale_file_path(data_dir, locale) else {
        return json_err(StatusCode::BAD_REQUEST, "invalid_locale_params");
    };
    let entries: Vec<LocaleEntry> = match serde_json::from_slice(body) {
        Ok(v) => v,
        Err(_) => return json_err(StatusCode::BAD_REQUEST, "invalid_locale_entries"),
    };
    let category_obj: serde_json::Map<String, serde_json::Value> = entries
        .iter()
        .map(|e| (e.key.clone(), serde_json::Value::String(e.value.clone())))
        .collect();

    let mut bundle = read_bundle(&path).unwrap_or_default();
    bundle.insert(
        category.to_string(),
        serde_json::Value::Object(category_obj),
    );
    if write_bundle(&path, &bundle).is_err() {
        return json_err(StatusCode::INTERNAL_SERVER_ERROR, "write_failed");
    }
    reload_signal(data_dir);
    json_ok(&serde_json::json!({
        "ok": true,
        "locale": locale,
        "category": category,
        "count": entries.len(),
    }))
}

pub fn upsert_key(
    data_dir: &Path,
    locale: &str,
    category: &str,
    body: &Bytes,
) -> hyper::Response<Body> {
    if !valid(category) {
        return json_err(StatusCode::BAD_REQUEST, "invalid_locale_params");
    }
    let Some(path) = locale_file_path(data_dir, locale) else {
        return json_err(StatusCode::BAD_REQUEST, "invalid_locale_params");
    };
    let entry: LocaleEntry = match serde_json::from_slice(body) {
        Ok(v) => v,
        Err(_) => return json_err(StatusCode::BAD_REQUEST, "invalid_entry"),
    };

    let mut bundle = read_bundle(&path).unwrap_or_default();
    let mut map = category_map(&bundle, category).unwrap_or_default();
    map.insert(
        entry.key.clone(),
        serde_json::Value::String(entry.value.clone()),
    );
    bundle.insert(category.to_string(), serde_json::Value::Object(map));

    if write_bundle(&path, &bundle).is_err() {
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
    if !valid(category) {
        return json_err(StatusCode::BAD_REQUEST, "invalid_locale_params");
    }
    let Some(path) = locale_file_path(data_dir, locale) else {
        return json_err(StatusCode::BAD_REQUEST, "invalid_locale_params");
    };
    let mut bundle = match read_bundle(&path) {
        Some(m) => m,
        None => return json_err(StatusCode::NOT_FOUND, "locale_file_not_found"),
    };
    let mut map = match category_map(&bundle, category) {
        Some(m) => m,
        None => return json_err(StatusCode::NOT_FOUND, "locale_category_not_found"),
    };
    if map.remove(key).is_none() {
        return json_err(StatusCode::NOT_FOUND, "key_not_found");
    }
    bundle.insert(category.to_string(), serde_json::Value::Object(map));
    if write_bundle(&path, &bundle).is_err() {
        return json_err(StatusCode::INTERNAL_SERVER_ERROR, "write_failed");
    }
    reload_signal(data_dir);
    json_ok(&serde_json::json!({ "ok": true, "key": key }))
}

pub fn create_locale(data_dir: &Path, locale: &str) -> hyper::Response<Body> {
    let Some(path) = locale_file_path(data_dir, locale) else {
        return json_err(StatusCode::BAD_REQUEST, "invalid_locale");
    };
    if path.exists() {
        return json_err(StatusCode::CONFLICT, "locale_exists");
    }
    if write_bundle(&path, &serde_json::Map::new()).is_err() {
        return json_err(StatusCode::INTERNAL_SERVER_ERROR, "create_failed");
    }
    reload_signal(data_dir);
    json_ok(&serde_json::json!({ "ok": true, "locale": locale }))
}

pub fn delete_locale(data_dir: &Path, locale: &str) -> hyper::Response<Body> {
    if locale == PROTECTED_LOCALE {
        return json_err(StatusCode::CONFLICT, "cannot_delete_protected_locale");
    }
    let Some(path) = locale_file_path(data_dir, locale) else {
        return json_err(StatusCode::BAD_REQUEST, "invalid_locale");
    };
    if !path.exists() {
        return json_err(StatusCode::NOT_FOUND, "locale_not_found");
    }
    if std::fs::remove_file(&path).is_err() {
        return json_err(StatusCode::INTERNAL_SERVER_ERROR, "delete_failed");
    }
    reload_signal(data_dir);
    json_ok(&serde_json::json!({ "ok": true, "locale": locale }))
}

pub fn import_locale(data_dir: &Path, locale: &str, body: &Bytes) -> hyper::Response<Body> {
    let Some(path) = locale_file_path(data_dir, locale) else {
        return json_err(StatusCode::BAD_REQUEST, "invalid_locale");
    };
    let parsed: serde_json::Map<String, serde_json::Value> = match serde_json::from_slice(body) {
        Ok(v) => v,
        Err(_) => return json_err(StatusCode::BAD_REQUEST, "invalid_import_payload"),
    };

    let mut bundle = serde_json::Map::new();
    for (category, value) in parsed {
        if valid(&category) && value.is_object() {
            bundle.insert(category, value);
        }
    }
    let written = bundle.len();
    if write_bundle(&path, &bundle).is_err() {
        return json_err(StatusCode::INTERNAL_SERVER_ERROR, "write_failed");
    }
    reload_signal(data_dir);
    json_ok(&serde_json::json!({ "ok": true, "locale": locale, "categories_written": written }))
}

pub fn export_locale(data_dir: &Path, locale: &str) -> hyper::Response<Body> {
    let Some(path) = locale_file_path(data_dir, locale) else {
        return json_err(StatusCode::BAD_REQUEST, "invalid_locale");
    };
    if !path.exists() {
        return json_err(StatusCode::NOT_FOUND, "locale_not_found");
    }
    let body = std::fs::read(&path).unwrap_or_default();
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
        assert!(locale_file_path(root, "../etc").is_none());
        assert!(locale_file_path(root, "").is_none());
    }

    #[test]
    fn locale_file_path_constructs_expected() {
        let root = std::path::Path::new("/data");
        let p = locale_file_path(root, "zh-CN").unwrap();
        assert!(p.ends_with("locales/zh-CN.json") || p.ends_with("locales\\zh-CN.json"));
    }

    #[test]
    fn protected_locale_constant() {
        assert_eq!(PROTECTED_LOCALE, "zh-CN");
    }
}
