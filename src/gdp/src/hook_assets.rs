//! Embedded hook bundle, preload scripts, and shipped locale files.
//!
//! Hook bundles and aggregate locale packages are produced at build time by
//! `build.rs`. At runtime they are extracted to `<exe_dir>/gdp-data/` so
//! Electron can `require()` them from disk.

use std::path::{Path, PathBuf};

use include_dir::{Dir, include_dir};

pub const HOOK_JS: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/hook_bundle.js"));
pub const PRELOAD_INDEX_JS: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/preload_index.js"));
pub const PRELOAD_NAVBAR_JS: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/preload_navbar.js"));
pub const PRELOAD_RECENT_REPOSITORIES_JS: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/preload_recent_repositories.js"));
pub const PRELOAD_UPDATE_INTERCEPTOR_JS: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/preload_update_interceptor.js"));
pub const PRELOAD_COPILOT_HIJACK_JS: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/preload_copilot_hijack.js"));
pub const PRELOAD_GDP_DIALOG_JS: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/preload_gdp_dialog.js"));

pub static LOCALES: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../../generated/locales");

/// Write `content` to `dest` only if the existing file differs (or is missing).
pub fn write_if_changed(dest: &Path, content: &[u8]) {
    let needs_write = std::fs::read(dest)
        .map(|existing| existing != content)
        .unwrap_or(true);
    if needs_write {
        std::fs::write(dest, content).unwrap_or_else(|e| panic!("write {}: {e}", dest.display()));
    }
}

fn extract_dir(src: &Dir<'_>, dest: &Path) {
    std::fs::create_dir_all(dest).unwrap_or_else(|e| panic!("create {}: {e}", dest.display()));

    for file in src.files() {
        if let Some(name) = file.path().file_name() {
            write_if_changed(&dest.join(name), file.contents());
        }
    }

    for dir in src.dirs() {
        if let Some(name) = dir.path().file_name() {
            extract_dir(dir, &dest.join(name));
        }
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

    std::fs::create_dir_all(&preload_dir).expect("create hooks/preload dir");
    std::fs::create_dir_all(&locales_dir).expect("create locales dir");

    write_if_changed(&hooks_dir.join("index.js"), HOOK_JS);
    write_if_changed(&preload_dir.join("index.js"), PRELOAD_INDEX_JS);
    write_if_changed(&preload_dir.join("navbar.js"), PRELOAD_NAVBAR_JS);
    write_if_changed(
        &preload_dir.join("recent-repositories.js"),
        PRELOAD_RECENT_REPOSITORIES_JS,
    );
    write_if_changed(
        &preload_dir.join("update-interceptor.js"),
        PRELOAD_UPDATE_INTERCEPTOR_JS,
    );
    write_if_changed(
        &preload_dir.join("copilot-hijack.js"),
        PRELOAD_COPILOT_HIJACK_JS,
    );
    write_if_changed(
        &preload_dir.join("gdp-dialog.js"),
        PRELOAD_GDP_DIALOG_JS,
    );

    extract_dir(&LOCALES, &locales_dir);

    // Ensure hooks load as CommonJS even if a parent package.json sets type:module.
    write_if_changed(&data_dir.join("package.json"), b"{\"type\":\"commonjs\"}\n");

    hooks_dir
}
