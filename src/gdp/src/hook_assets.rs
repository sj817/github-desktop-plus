//! Embedded hook bundle, preload scripts, and shipped locale files.
//!
//! These constants are produced at build time by `build.rs` (see
//! `embed_file` calls). At runtime they are extracted to
//! `<exe_dir>/gdp-data/` so Electron can `require()` them from disk.

use std::path::{Path, PathBuf};

pub const HOOK_JS: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/hook_bundle.js"));
pub const PRELOAD_INDEX_JS: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/preload_index.js"));
pub const PRELOAD_NAVBAR_JS: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/preload_navbar.js"));
pub const PRELOAD_UPDATE_INTERCEPTOR_JS: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/preload_update_interceptor.js"));

pub const LOCALE_ZH_CN_MENU: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/locale_zh_CN_menu.json"));
pub const LOCALE_ZH_CN_UI: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/locale_zh_CN_ui.json"));
pub const LOCALE_ZH_CN_UI_ABOUT: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/locale_zh_CN_ui_about.json"));
pub const LOCALE_ZH_CN_UI_DIFF: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/locale_zh_CN_ui_diff.json"));
pub const LOCALE_ZH_CN_UI_NAVBAR: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/locale_zh_CN_ui_navbar.json"));
pub const LOCALE_ZH_CN_UI_REPOSITORY_SETTINGS: &[u8] = include_bytes!(concat!(
    env!("OUT_DIR"),
    "/locale_zh_CN_ui_repository_settings.json"
));
pub const LOCALE_ZH_CN_UI_SETTINGS: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/locale_zh_CN_ui_settings.json"));
pub const LOCALE_ZH_CN_UI_SIDEBAR: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/locale_zh_CN_ui_sidebar.json"));
pub const LOCALE_ZH_CN_UI_TOOLBAR: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/locale_zh_CN_ui_toolbar.json"));
pub const LOCALE_ZH_CN_UI_BRANCHES: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/locale_zh_CN_ui_branches.json"));
pub const LOCALE_ZH_CN_UI_CHANGES: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/locale_zh_CN_ui_changes.json"));
pub const LOCALE_ZH_CN_UI_CHECK_RUNS: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/locale_zh_CN_ui_check_runs.json"));
pub const LOCALE_ZH_CN_UI_CLONE_ADD: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/locale_zh_CN_ui_clone_add.json"));
pub const LOCALE_ZH_CN_UI_DIALOGS: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/locale_zh_CN_ui_dialogs.json"));
pub const LOCALE_ZH_CN_UI_HISTORY: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/locale_zh_CN_ui_history.json"));
pub const LOCALE_ZH_CN_UI_LIB: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/locale_zh_CN_ui_lib.json"));
pub const LOCALE_ZH_CN_UI_WELCOME_TUTORIAL: &[u8] = include_bytes!(concat!(
    env!("OUT_DIR"),
    "/locale_zh_CN_ui_welcome_tutorial.json"
));
pub const LOCALE_ZH_CN_UI_CONTEXT_MENUS: &[u8] = include_bytes!(concat!(
    env!("OUT_DIR"),
    "/locale_zh_CN_ui_context_menus.json"
));

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
    let locale_sub = locales_dir.join("zh-CN");

    std::fs::create_dir_all(&preload_dir).expect("create hooks/preload dir");
    std::fs::create_dir_all(&locale_sub).expect("create locales/zh-CN dir");

    write_if_changed(&hooks_dir.join("index.js"), HOOK_JS);
    write_if_changed(&preload_dir.join("index.js"), PRELOAD_INDEX_JS);
    write_if_changed(&preload_dir.join("navbar.js"), PRELOAD_NAVBAR_JS);
    write_if_changed(
        &preload_dir.join("update-interceptor.js"),
        PRELOAD_UPDATE_INTERCEPTOR_JS,
    );

    write_if_changed(&locale_sub.join("menu.json"), LOCALE_ZH_CN_MENU);
    write_if_changed(&locale_sub.join("ui.json"), LOCALE_ZH_CN_UI);
    write_if_changed(&locale_sub.join("ui-about.json"), LOCALE_ZH_CN_UI_ABOUT);
    write_if_changed(&locale_sub.join("ui-diff.json"), LOCALE_ZH_CN_UI_DIFF);
    write_if_changed(&locale_sub.join("ui-navbar.json"), LOCALE_ZH_CN_UI_NAVBAR);
    write_if_changed(
        &locale_sub.join("ui-repository-settings.json"),
        LOCALE_ZH_CN_UI_REPOSITORY_SETTINGS,
    );
    write_if_changed(
        &locale_sub.join("ui-settings.json"),
        LOCALE_ZH_CN_UI_SETTINGS,
    );
    write_if_changed(&locale_sub.join("ui-sidebar.json"), LOCALE_ZH_CN_UI_SIDEBAR);
    write_if_changed(&locale_sub.join("ui-toolbar.json"), LOCALE_ZH_CN_UI_TOOLBAR);
    write_if_changed(
        &locale_sub.join("ui-branches.json"),
        LOCALE_ZH_CN_UI_BRANCHES,
    );
    write_if_changed(&locale_sub.join("ui-changes.json"), LOCALE_ZH_CN_UI_CHANGES);
    write_if_changed(
        &locale_sub.join("ui-check-runs.json"),
        LOCALE_ZH_CN_UI_CHECK_RUNS,
    );
    write_if_changed(
        &locale_sub.join("ui-clone-add.json"),
        LOCALE_ZH_CN_UI_CLONE_ADD,
    );
    write_if_changed(
        &locale_sub.join("ui-context-menus.json"),
        LOCALE_ZH_CN_UI_CONTEXT_MENUS,
    );
    write_if_changed(&locale_sub.join("ui-dialogs.json"), LOCALE_ZH_CN_UI_DIALOGS);
    write_if_changed(&locale_sub.join("ui-history.json"), LOCALE_ZH_CN_UI_HISTORY);
    write_if_changed(&locale_sub.join("ui-lib.json"), LOCALE_ZH_CN_UI_LIB);
    write_if_changed(
        &locale_sub.join("ui-welcome-tutorial.json"),
        LOCALE_ZH_CN_UI_WELCOME_TUTORIAL,
    );

    // Ensure hooks load as CommonJS even if a parent package.json sets type:module.
    write_if_changed(&data_dir.join("package.json"), b"{\"type\":\"commonjs\"}\n");

    hooks_dir
}
