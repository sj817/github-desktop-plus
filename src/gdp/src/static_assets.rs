//! Embedded WebUI bundle. Built into the binary via `include_dir!` from
//! `generated/webui-bundle/`, which is populated by `build.rs` (either copied
//! from `webui/dist/` or filled with a placeholder stub).

use bytes::Bytes;
use hyper::StatusCode;
use include_dir::{Dir, include_dir};

use crate::http_helpers::{Body, make_response};

pub static WEBUI: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../../generated/webui-bundle");

fn mime_for(path: &str) -> &'static str {
    let lower = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match lower.as_str() {
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "css" => "text/css",
        "html" | "htm" => "text/html; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "map" => "application/json",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// Serve a static asset from the embedded WebUI bundle.
/// Returns 404 if not found and the path doesn't qualify for SPA fallback.
pub fn serve(request_path: &str) -> hyper::Response<Body> {
    // Strip leading "/"; treat empty path as index.html.
    let trimmed = request_path.trim_start_matches('/');
    let lookup = if trimmed.is_empty() {
        "index.html"
    } else {
        trimmed
    };

    if let Some(file) = WEBUI.get_file(lookup) {
        let mime = mime_for(lookup);
        return make_response(
            StatusCode::OK,
            mime,
            Bytes::copy_from_slice(file.contents()),
        );
    }

    // SPA fallback: anything that does not look like an asset (no file extension
    // in the last segment) returns index.html so client-side routing works.
    let last = lookup.rsplit('/').next().unwrap_or(lookup);
    if !last.contains('.') {
        if let Some(idx) = WEBUI.get_file("index.html") {
            return make_response(
                StatusCode::OK,
                "text/html; charset=utf-8",
                Bytes::copy_from_slice(idx.contents()),
            );
        }
    }

    make_response(
        StatusCode::NOT_FOUND,
        "text/plain; charset=utf-8",
        "not found",
    )
}
