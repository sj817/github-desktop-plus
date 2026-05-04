//! Embedded HTTP server: routes /api/*, serves the embedded control panel, and
//! enforces token-cookie authentication on all `/api/*` endpoints except a few
//! safe-listed ones.

use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use bytes::Bytes;
use gdp_core::{config::Config, detector::find_github_desktop, platform::config_dir};
use http_body_util::{BodyExt, Either, Empty};
use hyper::body::Incoming;
use hyper::header::{HeaderValue, SET_COOKIE};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde::Serialize;
use tokio::net::TcpListener;

use crate::auth::{
    self, build_session_cookie, create_session, spawn_session_reaper, status_for,
    validate_and_touch_session,
};
use crate::http_helpers::{Body, add_cors, json_err, json_ok, make_response, parse_query};
use crate::sse::{self, SseBody};
use crate::state::AppState;
use crate::{locale, static_assets};

/// Either a buffered body (`Full<Bytes>`) or a streaming SSE body.
type AnyBody = Either<Body, SseBody>;

#[derive(Debug, Serialize)]
struct TreeResponse {
    tree: &'static str,
}

#[derive(Debug, Serialize)]
struct DetectResponse {
    found: bool,
    path: Option<String>,
}

fn make_any(b: Response<Body>) -> Response<AnyBody> {
    let (parts, body) = b.into_parts();
    Response::from_parts(parts, Either::Left(body))
}

fn make_sse(b: Response<SseBody>) -> Response<AnyBody> {
    let (parts, body) = b.into_parts();
    Response::from_parts(parts, Either::Right(body))
}

/// Endpoints exempt from the auth-cookie check.
fn is_public_path(path: &str) -> bool {
    matches!(path, "/" | "/api/auth/exchange" | "/api/auth/status")
        || path.starts_with("/assets/")
        || (std::env::var_os("GDP_DEV").is_some() && path.starts_with("/api/dev/"))
        || !path.starts_with("/api/")
}

async fn handle(
    request: Request<Incoming>,
    state: AppState,
) -> Result<Response<AnyBody>, Infallible> {
    let method = request.method().clone();
    let path = request.uri().path().to_owned();
    let query_str = request.uri().query().unwrap_or("").to_owned();
    let cookie_header = request
        .headers()
        .get(hyper::header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    // ── Auth gate: protected /api/* paths ────────────────────────────────────
    if path.starts_with("/api/") && !is_public_path(&path) {
        if !validate_and_touch_session(&state, cookie_header.as_deref()) {
            let mut r = json_err(StatusCode::UNAUTHORIZED, "unauthorized");
            add_cors(&mut r);
            return Ok(make_any(r));
        }
    }

    // CORS preflight short-circuit.
    if method == Method::OPTIONS {
        let mut r = make_response(StatusCode::NO_CONTENT, "text/plain", "");
        add_cors(&mut r);
        return Ok(make_any(r));
    }

    // SSE log stream — bypass body collection.
    if method == Method::GET && path == "/api/logs/stream" {
        let query_uri: hyper::Uri = format!("/?{query_str}").parse().unwrap_or_default();
        let q = parse_query(&query_uri);
        let filter = sse::parse_filter(&q);
        let mut r = sse::build_stream_response(filter);
        // Add CORS to SSE — needs separate path because Body type differs.
        let h = r.headers_mut();
        h.insert("Access-Control-Allow-Origin", HeaderValue::from_static("*"));
        h.insert(
            "Access-Control-Allow-Credentials",
            HeaderValue::from_static("true"),
        );
        return Ok(make_sse(r));
    }

    // For everything else, collect body (small payloads only).
    let post_body: Option<Bytes> =
        if method == Method::POST || method == Method::PUT || method == Method::DELETE {
            match request.into_body().collect().await {
                Ok(c) => Some(c.to_bytes()),
                Err(_) => {
                    let mut r = json_err(StatusCode::BAD_REQUEST, "body_read_error");
                    add_cors(&mut r);
                    return Ok(make_any(r));
                }
            }
        } else {
            None
        };

    let query_uri: hyper::Uri = format!("/?{query_str}").parse().unwrap_or_default();
    let query = parse_query(&query_uri);

    let mut resp = route(method, &path, &query, post_body, &cookie_header, &state);
    add_cors(&mut resp);
    Ok(make_any(resp))
}

fn route(
    method: Method,
    path: &str,
    query: &std::collections::HashMap<String, String>,
    post_body: Option<Bytes>,
    cookie_header: &Option<String>,
    state: &AppState,
) -> Response<Body> {
    if let Some(resp) = route_auth(&method, path, query, cookie_header, state) {
        return resp;
    }

    if let Some(resp) = route_dev(&method, path, state) {
        return resp;
    }

    if let Some(resp) = route_locale(&method, path, post_body.as_ref(), state) {
        return resp;
    }

    route_misc(method, path, query, post_body, state)
}

fn route_auth(
    method: &Method,
    path: &str,
    query: &std::collections::HashMap<String, String>,
    cookie_header: &Option<String>,
    state: &AppState,
) -> Option<Response<Body>> {
    if method == Method::POST && path == "/api/auth/exchange" {
        let supplied = query.get("t").cloned().unwrap_or_default();
        if supplied.is_empty() || supplied != *state.auth_token {
            return Some(json_err(StatusCode::UNAUTHORIZED, "invalid_token"));
        }
        let sid = create_session(state);
        let mut resp = json_ok(&serde_json::json!({ "ok": true }));
        resp.headers_mut().insert(
            SET_COOKIE,
            HeaderValue::from_str(&build_session_cookie(&sid))
                .unwrap_or_else(|_| HeaderValue::from_static("")),
        );
        return Some(resp);
    }

    if method == Method::GET && path == "/api/auth/status" {
        let (authed, expires_in) = status_for(state, cookie_header.as_deref());
        return Some(json_ok(&serde_json::json!({
            "authed": authed,
            "expires_in_secs": expires_in,
        })));
    }

    None
}

fn route_dev(method: &Method, path: &str, state: &AppState) -> Option<Response<Body>> {
    if method != Method::POST || path != "/api/dev/locales/reload" {
        return None;
    }

    if std::env::var_os("GDP_DEV").is_none() {
        return Some(json_err(StatusCode::NOT_FOUND, "unknown_route"));
    }
    if let Some(ref dir) = state.data_dir {
        locale::reload_signal(dir);
    }
    Some(json_ok(&serde_json::json!({ "ok": true })))
}

fn route_misc(
    method: Method,
    path: &str,
    query: &std::collections::HashMap<String, String>,
    post_body: Option<Bytes>,
    state: &AppState,
) -> Response<Body> {
    match (method, path) {
        // Legacy compat: /api/locale?locale=&category=
        (Method::GET, "/api/locale") => {
            let locale = query.get("locale").map(String::as_str).unwrap_or("zh-CN");
            let category = query.get("category").map(String::as_str).unwrap_or("ui");
            match &state.data_dir {
                None => json_err(StatusCode::SERVICE_UNAVAILABLE, "data_dir_unavailable"),
                Some(dir) => crate::locale::read_category(dir, locale, category),
            }
        }
        (Method::POST, "/api/locale") => {
            let locale = query.get("locale").map(String::as_str).unwrap_or("zh-CN");
            let category = query.get("category").map(String::as_str).unwrap_or("ui");
            let bytes = post_body.unwrap_or_default();
            match &state.data_dir {
                None => json_err(StatusCode::SERVICE_UNAVAILABLE, "data_dir_unavailable"),
                Some(dir) => crate::locale::write_category(dir, locale, category, &bytes),
            }
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
        (m, p) if !p.starts_with("/api/") && m == Method::GET => static_assets::serve(p),
        _ => make_response(
            StatusCode::NOT_FOUND,
            "text/plain; charset=utf-8",
            "not found",
        ),
    }
}

fn route_locale(
    method: &Method,
    path: &str,
    body: Option<&Bytes>,
    state: &AppState,
) -> Option<Response<Body>> {
    let data_dir = match &state.data_dir {
        Some(d) => d,
        None => {
            // Locale endpoints all require data_dir; if unavailable bail with 503.
            if path == "/api/locales" || path.starts_with("/api/locale") {
                return Some(json_err(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "data_dir_unavailable",
                ));
            }
            return None;
        }
    };

    // GET /api/locales
    if method == Method::GET && path == "/api/locales" {
        return Some(locale::list_locales(data_dir));
    }

    // Legacy compat: GET/POST /api/locale?locale=&category=
    if path == "/api/locale" {
        // Defer to old query-string form via state.config — handled by the old
        // generic path. To keep behaviour, we read locale/category from query.
        // Pull query off the request again by re-parsing path-less URI.
        // Actually we have no query here; fall through.
        return None;
    }

    // /api/locale/:locale → POST creates, DELETE removes
    if let Some(rest) = path.strip_prefix("/api/locale/") {
        let mut parts = rest.split('/');
        let locale = match parts.next() {
            Some(s) if !s.is_empty() => s,
            _ => return Some(json_err(StatusCode::BAD_REQUEST, "missing_locale")),
        };
        match (method.clone(), parts.next(), parts.next(), parts.next()) {
            (Method::POST, None, _, _) => {
                return Some(crate::locale::create_locale(data_dir, locale));
            }
            (Method::DELETE, None, _, _) => {
                return Some(crate::locale::delete_locale(data_dir, locale));
            }
            (Method::POST, Some("import"), None, _) => {
                let b = body.cloned().unwrap_or_default();
                return Some(crate::locale::import_locale(data_dir, locale, &b));
            }
            (Method::GET, Some("export"), None, _) => {
                return Some(crate::locale::export_locale(data_dir, locale));
            }
            // /api/locale/:locale/:category and key sub-routes
            (m, Some(category), key_part, key_val) => {
                if key_part == Some("key") {
                    if let Some(key) = key_val {
                        if m == Method::DELETE {
                            return Some(crate::locale::delete_key(
                                data_dir, locale, category, key,
                            ));
                        }
                    } else if m == Method::POST {
                        let b = body.cloned().unwrap_or_default();
                        return Some(crate::locale::upsert_key(data_dir, locale, category, &b));
                    }
                    return Some(json_err(StatusCode::METHOD_NOT_ALLOWED, "bad_method"));
                }
                if key_part.is_some() {
                    return Some(json_err(StatusCode::NOT_FOUND, "unknown_route"));
                }
                if m == Method::GET {
                    return Some(crate::locale::read_category(data_dir, locale, category));
                }
                if m == Method::PUT {
                    let b = body.cloned().unwrap_or_default();
                    return Some(crate::locale::write_category(
                        data_dir, locale, category, &b,
                    ));
                }
                return Some(json_err(StatusCode::METHOD_NOT_ALLOWED, "bad_method"));
            }
            _ => return Some(json_err(StatusCode::NOT_FOUND, "unknown_route")),
        }
    }

    None
}

// Allow the unused `Empty` import quietly (kept for future BodyExt mappings).
#[allow(dead_code)]
fn _empty_body_ref() -> Empty<Bytes> {
    Empty::new()
}

// ── Public entry point ────────────────────────────────────────────────────────

/// Build initial AppState: load config, derive data_dir, generate auth token,
/// write the token file, print `gdp open` hint, spawn session reaper.
pub fn build_state(auth_token: Option<String>) -> AppState {
    let cfg_dir = config_dir();
    let initial = cfg_dir
        .as_deref()
        .and_then(|d| Config::load(d).ok())
        .unwrap_or_default();

    let data_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .map(|exe_dir| exe_dir.join("gdp-data"));

    let token = auth_token.unwrap_or_else(auth::generate_token);
    if let Some(ref dir) = cfg_dir {
        match auth::write_token_file(dir, &token) {
            Ok(p) => {
                eprintln!("gdp: auth token written to {}", p.display());
                eprintln!("gdp: open the GDP menu inside GitHub Desktop");
            }
            Err(e) => eprintln!("warning: cannot write token file: {e}"),
        }
    }

    if let Some(ref dir) = data_dir {
        if let Err(e) = std::fs::create_dir_all(dir) {
            eprintln!("warning: cannot create data dir {}: {e}", dir.display());
        }
        crate::locale_seed::seed_if_missing(dir);
    }

    let state = AppState {
        config_dir: cfg_dir,
        data_dir,
        config: Arc::new(Mutex::new(initial)),
        auth_token: Arc::new(token),
        sessions: Arc::new(Mutex::new(Default::default())),
    };

    spawn_session_reaper(state.clone());
    state
}

pub async fn serve_async_with_token(auth_token: Option<String>) {
    let state = build_state(auth_token);
    let addr = SocketAddr::from(([127, 0, 0, 1], 7788));
    let listener = match TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("warning: cannot bind port 7788: {e}");
            eprintln!("         GDP control panel will not be available this session.");
            return;
        }
    };

    eprintln!("gdp serve  →  http://{addr}");

    loop {
        let (stream, _) = listener.accept().await.expect("accept");
        let state = state.clone();
        tokio::spawn(async move {
            let io = TokioIo::new(stream);
            if let Err(e) = http1::Builder::new()
                .serve_connection(io, service_fn(move |req| handle(req, state.clone())))
                .await
            {
                if std::env::var_os("GDP_VERBOSE").is_some() {
                    eprintln!("gdp serve connection error: {e}");
                }
            }
        });
    }
}

pub async fn serve_async() {
    serve_async_with_token(None).await;
}

/// Blocking entry point — creates its own Tokio runtime.
pub fn run() {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("build tokio runtime");
    rt.block_on(serve_async());
}
