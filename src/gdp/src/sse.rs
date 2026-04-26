//! Server-Sent Events stream of hook log entries (`gdp-hooks-stream.jsonl`).
//!
//! Endpoint: `GET /api/logs/stream?level=...&category=...&since=<unix_ms>`
//! - Initial flush: last 500 lines from the JSONL file (filtered).
//! - Tail: poll every 200ms for new bytes; emit `data: <json>\n\n` per line.
//! - Heartbeat: `:ping\n\n` every 15 seconds.
//! - Custom hyper `Body` implementation that pulls from a tokio mpsc channel.

use std::collections::HashSet;
use std::convert::Infallible;
use std::path::PathBuf;
use std::pin::Pin;
use std::task::{Context, Poll};

use bytes::Bytes;
use hyper::body::{Body, Frame, SizeHint};
use hyper::header::{CACHE_CONTROL, CONTENT_TYPE, HeaderValue};
use hyper::{Response, StatusCode};
use tokio::sync::mpsc;

/// Body that streams `Bytes` chunks from a tokio mpsc channel.
pub struct SseBody {
    rx: mpsc::Receiver<Bytes>,
}

impl Body for SseBody {
    type Data = Bytes;
    type Error = Infallible;

    fn poll_frame(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Self::Data>, Self::Error>>> {
        match self.rx.poll_recv(cx) {
            Poll::Ready(Some(b)) => Poll::Ready(Some(Ok(Frame::data(b)))),
            Poll::Ready(None) => Poll::Ready(None),
            Poll::Pending => Poll::Pending,
        }
    }

    fn is_end_stream(&self) -> bool {
        false
    }

    fn size_hint(&self) -> SizeHint {
        SizeHint::default()
    }
}

#[derive(Debug, Default, Clone)]
pub struct LogFilter {
    pub levels: Option<HashSet<String>>,
    pub categories: Option<HashSet<String>>,
    pub since_ms: Option<i64>,
}

fn parse_csv_set(s: &str) -> HashSet<String> {
    s.split(',')
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect()
}

pub fn parse_filter(query: &std::collections::HashMap<String, String>) -> LogFilter {
    LogFilter {
        levels: query.get("level").map(|s| parse_csv_set(s)),
        categories: query.get("category").map(|s| parse_csv_set(s)),
        since_ms: query.get("since").and_then(|s| s.parse::<i64>().ok()),
    }
}

fn line_matches(line: &str, filter: &LogFilter) -> bool {
    let parsed: serde_json::Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return filter.levels.is_none() && filter.categories.is_none(),
    };

    if let Some(levels) = &filter.levels {
        let lvl = parsed.get("level").and_then(|v| v.as_str()).unwrap_or("");
        if !levels.contains(lvl) {
            return false;
        }
    }
    if let Some(cats) = &filter.categories {
        let cat = parsed
            .get("category")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if !cats.contains(cat) {
            return false;
        }
    }
    if let Some(since) = filter.since_ms {
        let ts_str = parsed.get("ts").and_then(|v| v.as_str()).unwrap_or("");
        // Best-effort: accept ISO8601 — only filter if our parsed value is >=.
        // We parse millis since epoch out of an RFC3339 string by trusting the
        // year/month/day/hour/min/sec layout. Keep it simple & permissive.
        if let Some(ms) = iso8601_to_unix_ms(ts_str) {
            if ms < since {
                return false;
            }
        }
    }
    true
}

/// Parse a subset of ISO-8601 / RFC3339 timestamps into unix milliseconds.
/// Returns None if the format isn't recognized.
fn iso8601_to_unix_ms(s: &str) -> Option<i64> {
    // Expect format: YYYY-MM-DDTHH:MM:SS(.sss)?Z
    if s.len() < 20 {
        return None;
    }
    let bytes = s.as_bytes();
    if bytes[4] != b'-' || bytes[7] != b'-' || bytes[10] != b'T' {
        return None;
    }
    let year: i64 = s[0..4].parse().ok()?;
    let month: u32 = s[5..7].parse().ok()?;
    let day: u32 = s[8..10].parse().ok()?;
    let hour: u32 = s[11..13].parse().ok()?;
    let minute: u32 = s[14..16].parse().ok()?;
    let second: u32 = s[17..19].parse().ok()?;
    let ms_part: u32 = if s.len() > 20 && bytes[19] == b'.' {
        let end = s[20..]
            .find(|c: char| !c.is_ascii_digit())
            .map(|i| 20 + i)
            .unwrap_or(s.len());
        s[20..end].parse().unwrap_or(0)
    } else {
        0
    };
    Some(civil_to_unix_ms(
        year, month, day, hour, minute, second, ms_part,
    ))
}

/// Convert a civil date/time (UTC) into unix milliseconds. Howard Hinnant algorithm.
fn civil_to_unix_ms(y: i64, m: u32, d: u32, h: u32, mi: u32, s: u32, ms: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = (y - era * 400) as u64;
    let m = m as u64;
    let d = d as u64;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe as i64 - 719468;
    let secs = days * 86400 + (h as i64) * 3600 + (mi as i64) * 60 + s as i64;
    secs * 1000 + ms as i64
}

/// Build the streaming SSE response for `GET /api/logs/stream`.
pub fn build_stream_response(filter: LogFilter) -> Response<SseBody> {
    let log_file: PathBuf = std::env::temp_dir().join("gdp-hooks-stream.jsonl");
    let (tx, rx) = mpsc::channel::<Bytes>(64);

    tokio::spawn(async move {
        // 1. Initial flush: last 500 matching lines.
        let mut start_pos: u64 = 0;
        if let Ok(content) = tokio::fs::read_to_string(&log_file).await {
            start_pos = content.len() as u64;
            let mut tail: Vec<&str> = content.lines().collect();
            if tail.len() > 500 {
                let off = tail.len() - 500;
                tail = tail.split_off(off);
            }
            for line in tail {
                if line.is_empty() || !line_matches(line, &filter) {
                    continue;
                }
                let chunk = format!("data: {line}\n\n");
                if tx.send(Bytes::from(chunk)).await.is_err() {
                    return;
                }
            }
        }

        // 2. Tail loop + 15s heartbeat.
        let mut pos = start_pos;
        let mut last_heartbeat = std::time::Instant::now();
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;

            if last_heartbeat.elapsed() >= std::time::Duration::from_secs(15) {
                if tx.send(Bytes::from_static(b":ping\n\n")).await.is_err() {
                    return;
                }
                last_heartbeat = std::time::Instant::now();
            }

            let bytes = match tokio::fs::read(&log_file).await {
                Ok(b) => b,
                Err(_) => continue,
            };
            if (bytes.len() as u64) <= pos {
                continue;
            }
            let slice = &bytes[pos as usize..];
            pos = bytes.len() as u64;

            let s = match std::str::from_utf8(slice) {
                Ok(s) => s,
                Err(_) => continue,
            };
            for line in s.lines() {
                if line.is_empty() || !line_matches(line, &filter) {
                    continue;
                }
                let chunk = format!("data: {line}\n\n");
                if tx.send(Bytes::from(chunk)).await.is_err() {
                    return;
                }
                last_heartbeat = std::time::Instant::now();
            }
        }
    });

    let mut resp = Response::new(SseBody { rx });
    *resp.status_mut() = StatusCode::OK;
    let h = resp.headers_mut();
    h.insert(CONTENT_TYPE, HeaderValue::from_static("text/event-stream"));
    h.insert(CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    h.insert("X-Accel-Buffering", HeaderValue::from_static("no"));
    resp
}
