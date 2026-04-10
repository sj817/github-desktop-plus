pub mod config;
pub mod detector;
pub mod launcher;
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
        responsibility: "Platform detection, config model, GitHub Desktop finder and launch logic.",
    },
    ModuleInfo {
        name: "gdp-cli",
        responsibility: "One-shot CLI entrypoint -- status, detect, launch, config subcommands.",
    },
    ModuleInfo {
        name: "gdp-web",
        responsibility: "Loopback HTTP adapter: JSON APIs for status/config/detect + static UI.",
    },
    ModuleInfo {
        name: "rust/ui",
        responsibility: "Static, framework-free dashboard -- reads /api/* and renders to DOM.",
    },
];

const PROJECT_TREE: &str = "github-desktop-plus/\n\
    +-- docs/\n\
    |   +-- phase5-rust-architecture.md\n\
    +-- rust/\n\
    |   +-- Cargo.toml\n\
    |   +-- .cargo/config.toml\n\
    |   +-- crates/\n\
    |   |   +-- gdp-core/   # platform, config, detector, launcher\n\
    |   |   +-- gdp-cli/    # clap CLI: status/tree/demo/detect/launch/config\n\
    |   |   +-- gdp-web/    # hyper HTTP/1: /api/status|modules|tree|config|detect\n\
    |   +-- ui/\n\
    |       +-- index.html  # no-framework dashboard\n\
    |       +-- app.js\n\
    |       +-- styles.css\n\
    +-- src/                # existing Bun/Electrobun prototype (legacy)\n\
    +-- locales/\n\
    +-- package.json        # Node.js build tooling only";

const DEMO_PSEUDOCODE: &str = "// gdp-core\n\
    pub fn runtime_plan() -> RuntimePlan { ... }\n\
    \n\
    // gdp-cli (cargo run -p gdp-cli -- launch)\n\
    let result = gdp_core::launcher::launch(&config, &hook_dir)?;\n\
    \n\
    // gdp-web (cargo run -p gdp-web)\n\
    #[tokio::main(flavor = \"current_thread\")]\n\
    async fn main() { serve(\"127.0.0.1:7788\").await; }\n\
    \n\
    // rust/ui\n\
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
