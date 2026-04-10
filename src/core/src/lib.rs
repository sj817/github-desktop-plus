pub mod config;
pub mod detector;
pub mod platform;

use serde::Serialize;

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
    "Static HTML/CSS/JS avoids framework hydration and VDOM memory",
];

const MODULES: &[ModuleInfo] = &[
    ModuleInfo {
        name: "gdp-core",
        responsibility: "Platform detection, config model and runtime metadata.",
    },
    ModuleInfo {
        name: "gdp",
        responsibility: "CLI entrypoint, inspector injection, process management and embedded WebUI server.",
    },
    ModuleInfo {
        name: "src/hooks",
        responsibility: "TypeScript hook and preload sources compiled into injected JavaScript bundles.",
    },
    ModuleInfo {
        name: "src/ui",
        responsibility: "Static, framework-free dashboard -- reads /api/* and renders to DOM.",
    },
];

const PROJECT_TREE: &str = "github-desktop-plus/\n\
    +-- docs/\n\
    |   +-- phase5-rust-architecture.md\n\
    +-- .cargo/config.toml\n\
    +-- Cargo.toml\n\
    +-- src/\n\
    |   +-- core/           # platform, config, detector, runtime metadata\n\
    |   +-- gdp/            # CLI, inspector injection, embedded WebUI server\n\
    |   +-- hooks/          # Electron hook/preload TypeScript sources\n\
    |   +-- ui/             # no-framework dashboard\n\
    +-- locales/\n\
    +-- scripts/\n\
    +-- package.json        # Node.js build tooling only";

const DEMO_PSEUDOCODE: &str = "// gdp-core\n\
    pub fn runtime_plan() -> RuntimePlan { ... }\n\
    \n\
    // gdp (cargo run -p gdp -- launch)\n\
    let plan = gdp_core::runtime_plan();\n\
    \n\
    // embedded WebUI\n\
    cargo run -p gdp -- serve\n\
    \n\
    // src/ui\n\
    const s = await fetch('/api/status').then(r => r.json())";

pub fn runtime_plan() -> RuntimePlan {
    RuntimePlan {
        memory_target_mb: 10,
        runtime: "hyper + tokio(current_thread)",
        cli_boundary: "in-process function calls + stdout/stderr",
        web_boundary: "HTTP/JSON on 127.0.0.1:7788",
        ui_strategy: "Static HTML/CSS/Vanilla JS",
        startup_priority: "single-process, low-init, no hydration",
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
