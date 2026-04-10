// Embedded web server for `gdp serve`.
// Serves config read/write API + static UI on http://127.0.0.1:7788.

use bytes::Bytes;
use gdp_core::{config::Config, detector::find_github_desktop, platform::config_dir};
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::header::{HeaderValue, CONTENT_TYPE};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::net::TcpListener;

type Body = Full<Bytes>;

// ── Shared state ─────────────────────────────────────────────────────────────

#[derive(Clone)]
struct AppState {
    config_dir: Option<PathBuf>,
    /// GDP data dir: <exe_dir>/gdp-data — used for locale file read/write.
    data_dir: Option<PathBuf>,
    config: Arc<Mutex<Config>>,
    index_html: &'static str,
    app_js: &'static str,
    styles_css: &'static str,
}

// ── Locale types ──────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
struct LocaleEntry {
    key: String,
    value: String,
}

// ── Response helpers ─────────────────────────────────────────────────────────

fn make_response(
    status: StatusCode,
    content_type: &'static str,
    body: impl Into<Bytes>,
) -> Response<Body> {
    let mut resp = Response::new(Full::new(body.into()));
    *resp.status_mut() = status;
    resp.headers_mut()
        .insert(CONTENT_TYPE, HeaderValue::from_static(content_type));
    resp
}

fn json_ok<T: Serialize>(value: &T) -> Response<Body> {
    match serde_json::to_vec(value) {
        Ok(body) => make_response(StatusCode::OK, "application/json; charset=utf-8", body),
        Err(_) => make_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "application/json; charset=utf-8",
            br#"{"error":"serialization_failed"}"#.to_vec(),
        ),
    }
}

fn json_err(status: StatusCode, msg: &'static str) -> Response<Body> {
    let body = format!("{{\"error\":\"{msg}\"}}").into_bytes();
    make_response(status, "application/json; charset=utf-8", body)
}

fn add_cors(resp: &mut Response<Body>) {
    resp.headers_mut()
        .insert("Access-Control-Allow-Origin", HeaderValue::from_static("*"));
    resp.headers_mut().insert(
        "Access-Control-Allow-Methods",
        HeaderValue::from_static("GET, POST, OPTIONS"),
    );
    resp.headers_mut().insert(
        "Access-Control-Allow-Headers",
        HeaderValue::from_static("Content-Type"),
    );
}

// ── Query-string helpers ──────────────────────────────────────────────────────

/// Parse `key=value&key2=value2` into a HashMap (no URL-decoding needed for our params).
fn parse_query(uri: &hyper::Uri) -> std::collections::HashMap<String, String> {
    uri.query()
        .unwrap_or("")
        .split('&')
        .filter_map(|pair| {
            let mut it = pair.splitn(2, '=');
            let k = it.next()?.to_owned();
            let v = it.next().unwrap_or("").to_owned();
            if k.is_empty() { None } else { Some((k, v)) }
        })
        .collect()
}

/// Resolve and validate a locale file path from data_dir.
/// Returns None on invalid locale/category (prevents path traversal).
fn locale_file_path(data_dir: &std::path::Path, locale: &str, category: &str) -> Option<PathBuf> {
    let valid = |s: &str| s.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_');
    if !valid(locale) || !valid(category) || locale.is_empty() || category.is_empty() {
        return None;
    }
    Some(data_dir.join("locales").join(locale).join(format!("{category}.json")))
}

// ── Route handler ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
struct TreeResponse {
    tree: &'static str,
}

#[derive(Debug, Serialize)]
struct DetectResponse {
    found: bool,
    path: Option<String>,
}

async fn handle(request: Request<Incoming>, state: AppState) -> Result<Response<Body>, Infallible> {
    let method = request.method().clone();
    let path = request.uri().path().to_owned();
    let query_str = request.uri().query().unwrap_or("").to_owned();

    let post_body: Option<Bytes> = if method == Method::POST {
        match request.into_body().collect().await {
            Ok(c) => Some(c.to_bytes()),
            Err(_) => {
                let mut r = json_err(StatusCode::BAD_REQUEST, "body_read_error");
                add_cors(&mut r);
                return Ok(r);
            }
        }
    } else {
        None
    };

    // Build a fake uri for query parsing
    let query_uri: hyper::Uri = format!("/?{query_str}").parse().unwrap_or_default();
    let query = parse_query(&query_uri);

    let mut resp = match (method, path.as_str()) {
        (Method::GET, "/") => make_response(
            StatusCode::OK,
            "text/html; charset=utf-8",
            state.index_html,
        ),
        (Method::GET, "/app.js") => make_response(
            StatusCode::OK,
            "application/javascript; charset=utf-8",
            state.app_js,
        ),
        (Method::GET, "/styles.css") => {
            make_response(StatusCode::OK, "text/css; charset=utf-8", state.styles_css)
        }

        (Method::GET, "/api/status") => json_ok(&gdp_core::runtime_plan()),
        (Method::GET, "/api/modules") => json_ok(&gdp_core::modules()),
        (Method::GET, "/api/tree") => json_ok(&TreeResponse {
            tree: gdp_core::project_tree(),
        }),

        (Method::GET, "/api/detect") => {
            let p = find_github_desktop();
            json_ok(&DetectResponse {
                found: p.is_some(),
                path: p.map(|x| x.display().to_string()),
            })
        }

        (Method::GET, "/api/config") => {
            let guard = state.config.lock().unwrap();
            json_ok(&*guard)
        }

        (Method::POST, "/api/config") => {
            let bytes = post_body.unwrap_or_default();
            match serde_json::from_slice::<Config>(&bytes) {
                Ok(new_cfg) => {
                    if let Some(ref dir) = state.config_dir {
                        if let Err(e) = new_cfg.save(dir) {
                            eprintln!("gdp serve: config save failed: {e}");
                        }
                    }
                    *state.config.lock().unwrap() = new_cfg.clone();
                    json_ok(&new_cfg)
                }
                Err(_) => json_err(StatusCode::BAD_REQUEST, "invalid_config_json"),
            }
        }

        // ── Locale API ────────────────────────────────────────────────────────

        // List all available locales (subdirectories under gdp-data/locales/)
        (Method::GET, "/api/locales") => {
            match &state.data_dir {
                None => json_ok(&Vec::<String>::new()),
                Some(data_dir) => {
                    let locales_dir = data_dir.join("locales");
                    let locales: Vec<String> = std::fs::read_dir(&locales_dir)
                        .ok()
                        .map(|rd| {
                            rd.filter_map(|e| e.ok())
                                .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
                                .filter_map(|e| e.file_name().into_string().ok())
                                .collect()
                        })
                        .unwrap_or_default();
                    json_ok(&locales)
                }
            }
        }

        // GET /api/locale?locale=zh-CN&category=menu → [{key,value},…]
        (Method::GET, "/api/locale") => {
            let locale = query.get("locale").map(String::as_str).unwrap_or("zh-CN");
            let category = query.get("category").map(String::as_str).unwrap_or("ui");
            match &state.data_dir {
                None => json_err(StatusCode::SERVICE_UNAVAILABLE, "data_dir_unavailable"),
                Some(data_dir) => match locale_file_path(data_dir, locale, category) {
                    None => json_err(StatusCode::BAD_REQUEST, "invalid_locale_params"),
                    Some(path) => match std::fs::read_to_string(&path) {
                        Err(_) => json_err(StatusCode::NOT_FOUND, "locale_file_not_found"),
                        Ok(content) => {
                            match serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(
                                &content,
                            ) {
                                Err(_) => {
                                    json_err(StatusCode::INTERNAL_SERVER_ERROR, "invalid_locale_json")
                                }
                                Ok(map) => {
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
                            }
                        }
                    },
                },
            }
        }

        // POST /api/locale?locale=zh-CN&category=menu  body: [{key,value},…]
        (Method::POST, "/api/locale") => {
            let locale = query.get("locale").map(String::as_str).unwrap_or("zh-CN");
            let category = query.get("category").map(String::as_str).unwrap_or("ui");
            match &state.data_dir {
                None => json_err(StatusCode::SERVICE_UNAVAILABLE, "data_dir_unavailable"),
                Some(data_dir) => match locale_file_path(data_dir, locale, category) {
                    None => json_err(StatusCode::BAD_REQUEST, "invalid_locale_params"),
                    Some(path) => {
                        let bytes = post_body.unwrap_or_default();
                        match serde_json::from_slice::<Vec<LocaleEntry>>(&bytes) {
                            Err(_) => json_err(StatusCode::BAD_REQUEST, "invalid_locale_entries"),
                            Ok(entries) => {
                                let map: serde_json::Map<String, serde_json::Value> = entries
                                    .iter()
                                    .map(|e| {
                                        (e.key.clone(), serde_json::Value::String(e.value.clone()))
                                    })
                                    .collect();
                                let count = map.len();
                                match serde_json::to_string_pretty(&map) {
                                    Err(_) => json_err(
                                        StatusCode::INTERNAL_SERVER_ERROR,
                                        "serialization_failed",
                                    ),
                                    Ok(content) => match std::fs::write(&path, &content) {
                                        Err(_) => json_err(
                                            StatusCode::INTERNAL_SERVER_ERROR,
                                            "write_failed",
                                        ),
                                        Ok(()) => json_ok(&serde_json::json!({
                                            "ok": true,
                                            "locale": locale,
                                            "category": category,
                                            "count": count,
                                        })),
                                    },
                                }
                            }
                        }
                    }
                },
            }
        }

        (Method::OPTIONS, _) => make_response(StatusCode::NO_CONTENT, "text/plain", ""),

        _ => make_response(StatusCode::NOT_FOUND, "text/plain; charset=utf-8", "not found"),
    };

    add_cors(&mut resp);
    Ok(resp)
}

// ── Public entry point ────────────────────────────────────────────────────────

/// Async core that can be spawned inside an existing Tokio runtime (e.g. `gdp dev`).
pub async fn serve_async(
    index_html: &'static str,
    app_js: &'static str,
    styles_css: &'static str,
) {
    let cfg_dir = config_dir();
    let initial = cfg_dir
        .as_deref()
        .and_then(|d| Config::load(d).ok())
        .unwrap_or_default();

    // Compute data_dir relative to the running executable
    let data_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .map(|exe_dir| exe_dir.join("gdp-data"));

    let state = AppState {
        config_dir: cfg_dir,
        data_dir,
        config: Arc::new(Mutex::new(initial)),
        index_html,
        app_js,
        styles_css,
    };

    let addr = SocketAddr::from(([127, 0, 0, 1], 7788));
    let listener = match TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("warning: cannot bind port 7788: {e}");
            eprintln!("         WebUI will not be available this session.");
            return;
        }
    };

    println!("gdp serve  →  http://{addr}");

    loop {
        let (stream, _) = listener.accept().await.expect("accept");
        let state = state.clone();
        tokio::spawn(async move {
            let io = TokioIo::new(stream);
            if let Err(e) = http1::Builder::new()
                .serve_connection(io, service_fn(move |req| handle(req, state.clone())))
                .await
            {
                eprintln!("gdp serve connection error: {e}");
            }
        });
    }
}

/// Blocking entry point — creates its own Tokio runtime. Used by `gdp serve` and daemon mode.
pub fn run(index_html: &'static str, app_js: &'static str, styles_css: &'static str) {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("build tokio runtime");
    rt.block_on(serve_async(index_html, app_js, styles_css));
}
