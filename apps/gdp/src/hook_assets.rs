//! Embedded hook bundle, preload scripts, and shipped locale files.
//!
//! Hook bundles and aggregate locale packages are produced at build time by
//! `build.rs`. At runtime they are extracted to `<exe_dir>/gdp-data/` so
//! Electron can `require()` them from disk.

use std::path::{Path, PathBuf};

pub const HOOK_JS: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/hook_bundle.js"));
pub const PRELOAD_EARLY_JS: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/preload_early.js"));
pub const PRELOAD_RENDERER_JS: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/preload_renderer.js"));
pub const PRELOAD_GDP_SETTINGS_UI_JS: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/preload_gdp_settings_ui.js"));
pub const LOCALE_ZH_CN: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/locale_zh_cn.json"));
pub const WSL_AGENT_X86_64: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/wsl_agent_x86_64"));
pub const WSL_AGENT_AARCH64: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/wsl_agent_aarch64"));

/// Write `content` to `dest` only if the existing file differs (or is missing).
pub fn write_if_changed(dest: &Path, content: &[u8]) {
    let needs_write = std::fs::read(dest)
        .map(|existing| existing != content)
        .unwrap_or(true);
    if needs_write {
        std::fs::write(dest, content).unwrap_or_else(|e| panic!("write {}: {e}", dest.display()));
    }
}

/// Extract all embedded hook + locale resources to `<exe_dir>/gdp-data/` and
/// return the path to the `hooks/` subdirectory.
pub fn extract_hook_to_disk() -> PathBuf {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(std::env::temp_dir);

    let data_dir = exe_dir.join("gdp-data");
    let hooks_dir = data_dir.join("hooks");
    let preload_dir = hooks_dir.join("preload");
    let locales_dir = data_dir.join("locales");
    let agents_dir = data_dir.join("agents");

    std::fs::create_dir_all(&preload_dir).expect("create hooks/preload dir");
    std::fs::create_dir_all(&locales_dir).expect("create locales dir");
    std::fs::create_dir_all(&agents_dir).expect("create agents dir");

    write_if_changed(&hooks_dir.join("index.js"), HOOK_JS);
    write_if_changed(&preload_dir.join("early.js"), PRELOAD_EARLY_JS);
    write_if_changed(&preload_dir.join("renderer.js"), PRELOAD_RENDERER_JS);
    write_if_changed(
        &preload_dir.join("gdp-settings-ui.js"),
        PRELOAD_GDP_SETTINGS_UI_JS,
    );
    write_if_changed(&locales_dir.join("zh-CN.json"), LOCALE_ZH_CN);
    if !WSL_AGENT_X86_64.is_empty() {
        let directory = agents_dir.join("x86_64-unknown-linux-gnu");
        std::fs::create_dir_all(&directory).expect("create x86_64 WSL agent dir");
        write_if_changed(&directory.join("gdp-wsl-agent"), WSL_AGENT_X86_64);
    }
    if !WSL_AGENT_AARCH64.is_empty() {
        let directory = agents_dir.join("aarch64-unknown-linux-gnu");
        std::fs::create_dir_all(&directory).expect("create aarch64 WSL agent dir");
        write_if_changed(&directory.join("gdp-wsl-agent"), WSL_AGENT_AARCH64);
    }

    // Ensure hooks load as CommonJS even if a parent package.json sets type:module.
    write_if_changed(&data_dir.join("package.json"), b"{\"type\":\"commonjs\"}\n");

    hooks_dir
}
