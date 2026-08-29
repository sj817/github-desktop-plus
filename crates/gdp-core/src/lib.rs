pub mod config;
pub mod detector;
pub mod platform;

use serde::Serialize;

/// Tiny logging helper used across the crates.
///
/// Usage: `gdp_log!("info", "starting up: {}", path.display());`
/// Levels are free-form strings; output goes to stderr unless `level == "info"`,
/// which is suppressed unless `GDP_VERBOSE=1` is set in the environment.
#[macro_export]
macro_rules! gdp_log {
    ($level:expr, $($arg:tt)*) => {{
        let __lvl: &str = $level;
        let __msg = format!($($arg)*);
        if __lvl == "info" || __lvl == "debug" {
            if std::env::var_os("GDP_VERBOSE").is_some() {
                eprintln!("[gdp:{}] {}", __lvl, __msg);
            }
        } else {
            eprintln!("[gdp:{}] {}", __lvl, __msg);
        }
    }};
}

// --- Architecture metadata (read-only, static) ---
//
// Consumed by `gdp status`. Keep it to facts that are cheap to keep true; a
// hand-maintained copy of the directory tree used to live here and went stale
// within one refactor, so it is deliberately gone.

#[derive(Debug, Clone, Copy, Serialize)]
pub struct RuntimePlan {
    pub memory_target_mb: u8,
    pub runtime: &'static str,
    pub cli_boundary: &'static str,
    pub web_boundary: &'static str,
    pub ui_strategy: &'static str,
    pub startup_priority: &'static str,
    pub notes: &'static [&'static str],
}

const NOTES: &[&str] = &[
    "Rust core only; Node.js remains optional build tooling",
    "Hook bundles and locale packages are embedded at build time",
    "Settings UI ships as a prebuilt IIFE, injected on demand",
    "Settings dialog is opened from GitHub Desktop's GDP menu",
];

pub fn runtime_plan() -> RuntimePlan {
    RuntimePlan {
        memory_target_mb: 10,
        runtime: "tungstenite (CDP injection only)",
        cli_boundary: "in-process function calls + stdout/stderr",
        web_boundary: "Electron IPC (ipcMain/ipcRenderer), no HTTP server",
        ui_strategy: "React settings dialog injected into GitHub Desktop renderer",
        startup_priority: "single-process, no Tokio, no HTTP server",
        notes: NOTES,
    }
}
