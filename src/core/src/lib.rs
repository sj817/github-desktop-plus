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

#[derive(Debug, Clone, Copy, Serialize)]
pub struct ModuleInfo {
    pub name: &'static str,
    pub responsibility: &'static str,
}

const NOTES: &[&str] = &[
    "Rust core only; Node.js remains optional build tooling",
    "HTTP/1 loopback only to reduce runtime overhead",
    "Tokio current-thread runtime keeps scheduler state minimal",
    "Control UI is opened from GitHub Desktop's GDP menu",
];

const MODULES: &[ModuleInfo] = &[
    ModuleInfo {
        name: "gdp-core",
        responsibility: "Platform detection, config model and runtime metadata.",
    },
    ModuleInfo {
        name: "gdp",
        responsibility: "CLI entrypoint, inspector injection, process management and control API server.",
    },
    ModuleInfo {
        name: "src/hooks",
        responsibility: "TypeScript hook and preload sources compiled into injected JavaScript bundles.",
    },
    ModuleInfo {
        name: "src/hooks/preload/gdp-dialog",
        responsibility: "Native DOM settings dialog injected into GitHub Desktop renderer, replaces the former WebUI.",
    },
];

const PROJECT_TREE: &str = "github-desktop-plus/\n\
    +-- docs/\n\
    |   +-- phase5-rust-architecture.md\n\
    +-- .cargo/config.toml\n\
    +-- Cargo.toml\n\
    +-- src/\n\
    |   +-- core/           # platform, config, detector, runtime metadata\n\
    |   +-- gdp/            # CLI, inspector injection, process management\n\
    |   +-- hooks/          # Electron hook/preload TypeScript sources\n\
    +-- locales/\n\
    +-- scripts/\n\
    +-- package.json        # Node.js build tooling only";

const DEMO_PSEUDOCODE: &str = "// gdp-core\n\
    pub fn runtime_plan() -> RuntimePlan { ... }\n\
    \n\
    // gdp (cargo run -p gdp -- launch)\n\
    let plan = gdp_core::runtime_plan();\n\
    \n\
    // settings dialog (IPC)\n\
    ipcRenderer.invoke('gdp:get-config').then(cfg => { ... })";

pub fn runtime_plan() -> RuntimePlan {
    RuntimePlan {
        memory_target_mb: 10,
        runtime: "tungstenite (CDP injection only)",
        cli_boundary: "in-process function calls + stdout/stderr",
        web_boundary: "Electron IPC (ipcMain/ipcRenderer), no HTTP server",
        ui_strategy: "Native DOM dialog injected into GitHub Desktop renderer",
        startup_priority: "single-process, no Tokio, no HTTP server",
        notes: NOTES,
    }
}

pub fn modules() -> &'static [ModuleInfo] {
    MODULES
}

pub fn project_tree() -> &'static str {
    PROJECT_TREE
}

pub fn demo_pseudocode() -> &'static str {
    DEMO_PSEUDOCODE
}
