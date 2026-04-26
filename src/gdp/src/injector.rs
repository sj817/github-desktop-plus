//! V8 Inspector Protocol (CDP) based hook injection for Electron.
//!
//! Connects to a process started with `--inspect-brk`, sets a breakpoint
//! on `main.js` line 0, injects hook code before the app runs, then resumes.
//!
//! Protocol sequence:
//!   1. Poll `GET /json` → extract `webSocketDebuggerUrl`
//!   2. WebSocket connect
//!   3. `Debugger.enable` + `Runtime.enable`
//!   4. `Debugger.setBreakpointByUrl(lineNumber=0, urlRegex="main\\.js$")`
//!   5. `Runtime.runIfWaitingForDebugger`
//!   6. Wait for `Debugger.paused` event (main.js line 0 hit)
//!   7. `Runtime.evaluate(hookCode, includeCommandLineAPI=true)`
//!   8. `Debugger.removeBreakpoint` + `Debugger.resume` + `Debugger.disable`
//!   9. Close WebSocket

use std::net::TcpStream;
use std::time::{Duration, Instant};

use tungstenite::{Message, WebSocket};

// ── Error types ──────────────────────────────────────────────────────────────

#[derive(Debug)]
pub enum InjectError {
    /// Invalid or unexpected WS URL or inspector response.
    InvalidResponse(String),
    /// WebSocket connection or protocol error.
    WebSocket(String),
    /// Timeout waiting for a CDP response or event.
    Timeout(String),
    /// Hook code evaluation threw an exception.
    Evaluation(String),
    /// Low-level I/O error.
    Io(std::io::Error),
}

impl std::fmt::Display for InjectError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidResponse(s) => write!(f, "invalid inspector response: {s}"),
            Self::WebSocket(s) => write!(f, "WebSocket error: {s}"),
            Self::Timeout(s) => write!(f, "timeout: {s}"),
            Self::Evaluation(s) => write!(f, "hook evaluation error: {s}"),
            Self::Io(e) => write!(f, "IO error: {e}"),
        }
    }
}

impl From<std::io::Error> for InjectError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

// ── Public API ───────────────────────────────────────────────────────────────

/// Bind to port 0 on localhost and return the OS-assigned port number.
/// Kept for debugging; production code uses `--inspect-brk=0` directly.
#[allow(dead_code)]
pub fn find_free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .expect("bind to port 0")
        .local_addr()
        .expect("local_addr")
        .port()
}

/// Inject `hook_code` into an Electron process using the WebSocket debugger URL
/// obtained from the process's stderr (`Debugger listening on ws://...` line).
///
/// Blocks until injection is complete or `timeout` elapses.
/// The process resumes normal execution after the hook is installed.
pub fn inject(ws_url: &str, hook_code: &str, timeout: Duration) -> Result<(), InjectError> {
    // Extract TCP address (host:port) from the ws:// URL
    // e.g. "ws://127.0.0.1:61339/UUID" → "127.0.0.1:61339"
    let tcp_addr = ws_url
        .strip_prefix("ws://")
        .and_then(|s| s.split('/').next())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| InjectError::InvalidResponse(format!("cannot parse addr from: {ws_url}")))?
        .to_string();

    // Connect TCP and perform WebSocket handshake
    let tcp = TcpStream::connect(&tcp_addr)?;
    tcp.set_read_timeout(Some(Duration::from_secs(10)))?;
    tcp.set_write_timeout(Some(Duration::from_secs(5)))?;

    let (mut ws, _) = tungstenite::client(ws_url, tcp)
        .map_err(|e| InjectError::WebSocket(format!("handshake: {e}")))?;

    let mut seq: u64 = 0;
    let mut next_id = || {
        seq += 1;
        seq
    };

    // 3. Enable Debugger + Runtime domains
    let id = next_id();
    send(&mut ws, id, "Debugger.enable", serde_json::json!({}))?;
    wait_for_id(&mut ws, id, timeout)?;

    let id = next_id();
    send(&mut ws, id, "Runtime.enable", serde_json::json!({}))?;
    wait_for_id(&mut ws, id, timeout)?;

    // 4. Set breakpoint on main.js line 0
    let id = next_id();
    send(
        &mut ws,
        id,
        "Debugger.setBreakpointByUrl",
        serde_json::json!({
            "lineNumber": 0,
            "urlRegex": "main\\.js$"
        }),
    )?;
    let bp_resp = wait_for_id(&mut ws, id, timeout)?;
    let breakpoint_id = bp_resp
        .pointer("/result/breakpointId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // 5. Resume V8 bootstrap (it was paused at --inspect-brk)
    let id = next_id();
    send(
        &mut ws,
        id,
        "Runtime.runIfWaitingForDebugger",
        serde_json::json!({}),
    )?;
    // Response may arrive interleaved with events; we just need the paused event.

    // 6. Wait for Debugger.paused — main.js line 0 breakpoint hit
    wait_for_event(&mut ws, "Debugger.paused", timeout)?;

    // 7. Evaluate hook code (wrapped in IIFE for scope isolation)
    let wrapped = format!("(function() {{\n{hook_code}\n}})();");
    let id = next_id();
    send(
        &mut ws,
        id,
        "Runtime.evaluate",
        serde_json::json!({
            "expression": wrapped,
            "includeCommandLineAPI": true,
        }),
    )?;
    let eval_resp = wait_for_id(&mut ws, id, timeout)?;

    // Check for evaluation exceptions
    if let Some(exc) = eval_resp.pointer("/result/exceptionDetails") {
        let text = exc
            .pointer("/exception/description")
            .or_else(|| exc.get("text"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        return Err(InjectError::Evaluation(text.to_string()));
    }

    // 8. Remove breakpoint
    if !breakpoint_id.is_empty() {
        let id = next_id();
        send(
            &mut ws,
            id,
            "Debugger.removeBreakpoint",
            serde_json::json!({ "breakpointId": breakpoint_id }),
        )?;
        let _ = wait_for_id(&mut ws, id, Duration::from_secs(5));
    }

    // 9. Resume execution
    let id = next_id();
    send(&mut ws, id, "Debugger.resume", serde_json::json!({}))?;
    let _ = wait_for_id(&mut ws, id, Duration::from_secs(5));

    // 10. Disable debugger domain
    let id = next_id();
    send(&mut ws, id, "Debugger.disable", serde_json::json!({}))?;
    let _ = wait_for_id(&mut ws, id, Duration::from_secs(5));

    // 11. Close WebSocket gracefully
    let _ = ws.close(None);
    // Drain remaining messages until the close handshake completes
    loop {
        match ws.read() {
            Ok(Message::Close(_)) | Err(_) => break,
            _ => {}
        }
    }

    Ok(())
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/// Send a CDP JSON-RPC message over the WebSocket.
fn send(
    ws: &mut WebSocket<TcpStream>,
    id: u64,
    method: &str,
    params: serde_json::Value,
) -> Result<(), InjectError> {
    let msg = serde_json::json!({ "id": id, "method": method, "params": params });
    ws.send(Message::Text(msg.to_string().into()))
        .map_err(|e| InjectError::WebSocket(format!("send {method}: {e}")))
}

/// Read WebSocket messages until one satisfies `predicate`, with timeout.
fn read_until<F>(
    ws: &mut WebSocket<TcpStream>,
    timeout: Duration,
    desc: &str,
    predicate: F,
) -> Result<serde_json::Value, InjectError>
where
    F: Fn(&serde_json::Value) -> bool,
{
    let deadline = Instant::now() + timeout;
    loop {
        if Instant::now() > deadline {
            return Err(InjectError::Timeout(desc.to_string()));
        }
        match ws.read() {
            Ok(Message::Text(text)) => {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                    if predicate(&v) {
                        return Ok(v);
                    }
                }
            }
            Ok(Message::Close(_)) => {
                return Err(InjectError::WebSocket(
                    "connection closed unexpectedly".into(),
                ));
            }
            Err(tungstenite::Error::Io(ref e))
                if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut =>
            {
                // Read timeout fired — check deadline and retry
                continue;
            }
            Err(e) => {
                return Err(InjectError::WebSocket(format!("read: {e}")));
            }
            _ => {} // Ping, Pong, Binary — ignore
        }
    }
}

/// Wait for a CDP response with the given message `id`.
fn wait_for_id(
    ws: &mut WebSocket<TcpStream>,
    id: u64,
    timeout: Duration,
) -> Result<serde_json::Value, InjectError> {
    read_until(ws, timeout, &format!("response id={id}"), |v| {
        v["id"].as_u64() == Some(id)
    })
}

/// Wait for a CDP event with the given `method` name.
fn wait_for_event(
    ws: &mut WebSocket<TcpStream>,
    method: &str,
    timeout: Duration,
) -> Result<serde_json::Value, InjectError> {
    let m = method.to_string();
    read_until(ws, timeout, &format!("event {method}"), move |v| {
        v["method"].as_str() == Some(&m)
    })
}
