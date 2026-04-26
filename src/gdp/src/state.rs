//! Shared application state for the embedded HTTP server.
//!
//! Cloned cheaply per-connection by hyper; mutable fields are wrapped in
//! `Arc<Mutex<_>>`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use gdp_core::config::Config;

/// One authenticated session, indexed by its random ID.
#[derive(Debug, Clone, Copy)]
pub struct SessionInfo {
    pub last_seen: Instant,
}

#[derive(Clone)]
pub struct AppState {
    pub config_dir: Option<PathBuf>,
    /// `<exe_dir>/gdp-data` — used for locale file read/write.
    pub data_dir: Option<PathBuf>,
    pub config: Arc<Mutex<Config>>,
    /// One-shot bearer token issued at startup; clients exchange it for a session cookie.
    pub auth_token: Arc<String>,
    /// Active sessions: cookie value → metadata.
    pub sessions: Arc<Mutex<HashMap<String, SessionInfo>>>,
}

/// Session lifetime in seconds.
pub const SESSION_TTL_SECS: u64 = 1200;
