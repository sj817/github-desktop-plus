//! Tiny shared helpers for building hyper `Response` bodies.

use bytes::Bytes;
use http_body_util::Full;
use hyper::header::{CONTENT_TYPE, HeaderValue};
use hyper::{Response, StatusCode};
use serde::Serialize;

pub type Body = Full<Bytes>;

pub fn make_response(
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

pub fn json_ok<T: Serialize>(value: &T) -> Response<Body> {
    match serde_json::to_vec(value) {
        Ok(body) => make_response(StatusCode::OK, "application/json; charset=utf-8", body),
        Err(_) => make_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "application/json; charset=utf-8",
            br#"{"error":"serialization_failed"}"#.to_vec(),
        ),
    }
}

pub fn json_err(status: StatusCode, msg: &'static str) -> Response<Body> {
    let body = format!("{{\"error\":\"{msg}\"}}").into_bytes();
    make_response(status, "application/json; charset=utf-8", body)
}

pub fn add_cors(resp: &mut Response<Body>) {
    let h = resp.headers_mut();
    h.insert("Access-Control-Allow-Origin", HeaderValue::from_static("*"));
    h.insert(
        "Access-Control-Allow-Methods",
        HeaderValue::from_static("GET, POST, PUT, DELETE, OPTIONS"),
    );
    h.insert(
        "Access-Control-Allow-Headers",
        HeaderValue::from_static("Content-Type, Cookie"),
    );
    h.insert(
        "Access-Control-Allow-Credentials",
        HeaderValue::from_static("true"),
    );
}

/// Parse `key=value&key2=value2` into a HashMap.
pub fn parse_query(uri: &hyper::Uri) -> std::collections::HashMap<String, String> {
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
