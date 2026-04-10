use bytes::Bytes;
use gdp_core::{
    config::Config,
    detector::find_github_desktop,
    platform::config_dir,
};
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::header::{HeaderValue, CONTENT_TYPE};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use serde::Serialize;
use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use tokio::net::TcpListener;

type Body = Full<Bytes>;

// Static UI assets embedded at compile time
const INDEX_HTML: &str = include_str!("../../../ui/index.html");
const APP_JS: &str = include_str!("../../../ui/app.js");
const STYLES_CSS: &str = include_str!("../../../ui/styles.css");

// ---- State -----------------------------------------------------------------

#[derive(Clone)]
struct AppState {
    config_dir: Option<std::path::PathBuf>,
    config: Arc<Mutex<Config>>,
}

// ---- Response helpers ------------------------------------------------------

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

// ---- Route handler ---------------------------------------------------------

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
    // Extract method + path; collect body on POST before routing.
    let method = request.method().clone();
    let path = request.uri().path().to_owned();

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

    let mut resp = match (method, path.as_str()) {
        // ---- Static UI assets -------------------------------------------
        (Method::GET, "/") => {
            make_response(StatusCode::OK, "text/html; charset=utf-8", INDEX_HTML)
        }
        (Method::GET, "/app.js") => {
            make_response(
                StatusCode::OK,
                "application/javascript; charset=utf-8",
                APP_JS,
            )
        }
        (Method::GET, "/styles.css") => {
            make_response(StatusCode::OK, "text/css; charset=utf-8", STYLES_CSS)
        }

        // ---- Read-only metadata -----------------------------------------
        (Method::GET, "/api/status") => json_ok(&gdp_core::runtime_plan()),
        (Method::GET, "/api/modules") => json_ok(&gdp_core::modules()),
        (Method::GET, "/api/tree") => json_ok(&TreeResponse {
            tree: gdp_core::project_tree(),
        }),

        // ---- GitHub Desktop detection -----------------------------------
        (Method::GET, "/api/detect") => {
            let path = find_github_desktop();
            json_ok(&DetectResponse {
                found: path.is_some(),
                path: path.map(|p| p.display().to_string()),
            })
        }

        // ---- Config read ------------------------------------------------
        (Method::GET, "/api/config") => {
            let guard = state.config.lock().unwrap();
            json_ok(&*guard)
        }

        // ---- Config write -----------------------------------------------
        (Method::POST, "/api/config") => {
            let bytes = post_body.unwrap_or_default();
            match serde_json::from_slice::<Config>(&bytes) {
                Ok(new_cfg) => {
                    // Persist to disk (best-effort)
                    if let Some(dir) = &state.config_dir {
                        if let Err(e) = new_cfg.save(dir) {
                            eprintln!("gdp-web: config save failed: {e}");
                        }
                    }
                    // Update in-memory state
                    *state.config.lock().unwrap() = new_cfg.clone();
                    json_ok(&new_cfg)
                }
                Err(_) => json_err(StatusCode::BAD_REQUEST, "invalid_config_json"),
            }
        }

        // ---- CORS preflight ---------------------------------------------
        (Method::OPTIONS, _) => {
            make_response(StatusCode::NO_CONTENT, "text/plain", "")
        }

        _ => make_response(
            StatusCode::NOT_FOUND,
            "text/plain; charset=utf-8",
            "not found",
        ),
    };

    add_cors(&mut resp);
    Ok(resp)
}

// ---- Entry point -----------------------------------------------------------

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cfg_dir = config_dir();
    let initial = cfg_dir
        .as_deref()
        .and_then(|d| Config::load(d).ok())
        .unwrap_or_default();

    let state = AppState {
        config_dir: cfg_dir,
        config: Arc::new(Mutex::new(initial)),
    };

    let addr = SocketAddr::from(([127, 0, 0, 1], 7788));
    let listener = TcpListener::bind(addr).await?;

    println!("gdp-web listening on http://{addr}");
    println!("  GET  /              -> static UI");
    println!("  GET  /api/status    -> runtime plan");
    println!("  GET  /api/modules   -> module list");
    println!("  GET  /api/tree      -> project tree");
    println!("  GET  /api/config    -> current config");
    println!("  POST /api/config    -> update+save config (JSON body)");
    println!("  GET  /api/detect    -> find GitHub Desktop");

    loop {
        let (stream, _) = listener.accept().await?;
        let state = state.clone();

        tokio::spawn(async move {
            let io = TokioIo::new(stream);
            if let Err(e) = http1::Builder::new()
                .serve_connection(io, service_fn(move |req| handle(req, state.clone())))
                .await
            {
                eprintln!("gdp-web connection error: {e}");
            }
        });
    }
}
