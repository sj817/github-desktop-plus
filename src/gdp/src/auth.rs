//! Token + session-cookie authentication for the embedded HTTP server.
//!
//! Workflow:
//!   1. At startup `generate_token()` produces a 32-byte random value, base64url
//!      encoded, written to `<config_dir>/gdp-token` (mode 0600 on unix).
//!   2. Clients call `POST /api/auth/exchange?t=<token>` to swap the token for
//!      a `gdp_session=<id>` cookie (HttpOnly, SameSite=Lax, 1200s TTL).
//!   3. Subsequent `/api/*` requests must present the cookie; idle sessions are
//!      reaped every 60 seconds.

use std::path::Path;
use std::time::{Duration, Instant};

use crate::state::{AppState, SESSION_TTL_SECS, SessionInfo};

const BASE64URL: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

fn base64url_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    let mut i = 0;
    while i + 3 <= bytes.len() {
        let n = ((bytes[i] as u32) << 16) | ((bytes[i + 1] as u32) << 8) | (bytes[i + 2] as u32);
        out.push(BASE64URL[((n >> 18) & 0x3f) as usize] as char);
        out.push(BASE64URL[((n >> 12) & 0x3f) as usize] as char);
        out.push(BASE64URL[((n >> 6) & 0x3f) as usize] as char);
        out.push(BASE64URL[(n & 0x3f) as usize] as char);
        i += 3;
    }
    let rem = bytes.len() - i;
    if rem == 1 {
        let n = (bytes[i] as u32) << 16;
        out.push(BASE64URL[((n >> 18) & 0x3f) as usize] as char);
        out.push(BASE64URL[((n >> 12) & 0x3f) as usize] as char);
    } else if rem == 2 {
        let n = ((bytes[i] as u32) << 16) | ((bytes[i + 1] as u32) << 8);
        out.push(BASE64URL[((n >> 18) & 0x3f) as usize] as char);
        out.push(BASE64URL[((n >> 12) & 0x3f) as usize] as char);
        out.push(BASE64URL[((n >> 6) & 0x3f) as usize] as char);
    }
    out
}

/// Generate a fresh 32-byte random token, base64url encoded (43 chars, no padding).
pub fn generate_token() -> String {
    let mut buf = [0u8; 32];
    if getrandom::getrandom(&mut buf).is_err() {
        // Fallback: time-based — never as good as OS RNG but lets us boot.
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let bytes = now.to_le_bytes();
        for (i, b) in buf.iter_mut().enumerate() {
            *b = bytes[i % bytes.len()] ^ (i as u8).wrapping_mul(31);
        }
    }
    base64url_encode(&buf)
}

/// Persist the token to `<config_dir>/gdp-token` and return the path.
/// On unix the file is chmod'd to 0600.
pub fn write_token_file(config_dir: &Path, token: &str) -> std::io::Result<std::path::PathBuf> {
    std::fs::create_dir_all(config_dir)?;
    let path = config_dir.join("gdp-token");
    std::fs::write(&path, token.as_bytes())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }

    Ok(path)
}

/// Extract the `gdp_session=...` cookie value from a `Cookie:` header, if present.
pub fn parse_session_cookie(cookie_header: &str) -> Option<String> {
    for part in cookie_header.split(';') {
        let p = part.trim();
        if let Some(rest) = p.strip_prefix("gdp_session=") {
            return Some(rest.to_string());
        }
    }
    None
}

/// Returns true iff the request currently holds a valid (and non-expired) session cookie.
/// Side-effect: bumps the session's `last_seen` to enable sliding renewal.
pub fn validate_and_touch_session(state: &AppState, cookie_header: Option<&str>) -> bool {
    let Some(header) = cookie_header else {
        return false;
    };
    let Some(sid) = parse_session_cookie(header) else {
        return false;
    };

    let mut sessions = match state.sessions.lock() {
        Ok(g) => g,
        Err(_) => return false,
    };
    let Some(info) = sessions.get(&sid).copied() else {
        return false;
    };
    if info.last_seen.elapsed() > Duration::from_secs(SESSION_TTL_SECS) {
        sessions.remove(&sid);
        return false;
    }
    sessions.insert(
        sid,
        SessionInfo {
            last_seen: Instant::now(),
        },
    );
    true
}

/// Returns `(authed, expires_in_secs)` for the current request.
pub fn status_for(state: &AppState, cookie_header: Option<&str>) -> (bool, u64) {
    let Some(header) = cookie_header else {
        return (false, 0);
    };
    let Some(sid) = parse_session_cookie(header) else {
        return (false, 0);
    };
    let Ok(sessions) = state.sessions.lock() else {
        return (false, 0);
    };
    let Some(info) = sessions.get(&sid) else {
        return (false, 0);
    };
    let elapsed = info.last_seen.elapsed().as_secs();
    let remaining = SESSION_TTL_SECS.saturating_sub(elapsed);
    (remaining > 0, remaining)
}

/// Create a fresh session id, register it, and return the cookie value.
pub fn create_session(state: &AppState) -> String {
    let sid = generate_token();
    if let Ok(mut sessions) = state.sessions.lock() {
        sessions.insert(
            sid.clone(),
            SessionInfo {
                last_seen: Instant::now(),
            },
        );
    }
    sid
}

/// Spawn a background task that purges expired sessions every 60 seconds.
pub fn spawn_session_reaper(state: AppState) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            if let Ok(mut sessions) = state.sessions.lock() {
                let ttl = Duration::from_secs(SESSION_TTL_SECS);
                sessions.retain(|_, info| info.last_seen.elapsed() < ttl);
            }
        }
    });
}

/// Build the `Set-Cookie` header value for a freshly-created session.
pub fn build_session_cookie(sid: &str) -> String {
    format!(
        "gdp_session={}; HttpOnly; SameSite=Lax; Path=/; Max-Age={}",
        sid, SESSION_TTL_SECS
    )
}
