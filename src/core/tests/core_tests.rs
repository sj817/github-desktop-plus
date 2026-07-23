//! Integration tests for the public surface of `gdp-core`.

use gdp_core::{
    config::{Config, ConfigError, UpdatesConfig},
    runtime_plan, modules, project_tree, demo_pseudocode,
};

#[test]
fn runtime_plan_metadata_is_sane() {
    let p = runtime_plan();
    assert!(p.memory_target_mb > 0 && p.memory_target_mb <= 64);
    assert!(p.runtime.contains("tungstenite"));
    assert!(p.web_boundary.contains("IPC"));
    assert!(!p.notes.is_empty());
    // Notes are non-trivial human-readable strings.
    for n in p.notes {
        assert!(n.len() > 5, "note too short: {n}");
    }
}

#[test]
fn modules_inventory_lists_all_crates() {
    let m = modules();
    let names: Vec<&str> = m.iter().map(|x| x.name).collect();
    assert!(names.contains(&"gdp-core"));
    assert!(names.contains(&"gdp"));
    assert!(names.contains(&"src/hooks/preload/gdp-dialog"));
    assert!(names.contains(&"src/hooks"));
}

#[test]
fn project_tree_and_pseudocode_non_empty() {
    assert!(project_tree().contains("github-desktop-plus"));
    assert!(demo_pseudocode().contains("runtime_plan"));
}

#[test]
fn config_default_round_trip_via_json() {
    let c = Config::default();
    let s = serde_json::to_string(&c).expect("serialize");
    let back: Config = serde_json::from_str(&s).expect("deserialize");
    assert_eq!(back.i18n.locale, c.i18n.locale);
    assert_eq!(back.ui.recent_repos_limit, c.ui.recent_repos_limit);
}

#[test]
fn config_load_partial_json_uses_defaults() {
    // Only specify one nested field; others should fall back to serde(default).
    let s = r#"{"i18n":{"enabled":false,"locale":"en-US"}}"#;
    let c: Config = serde_json::from_str(s).expect("parse partial");
    assert_eq!(c.i18n.locale, "en-US");
    assert!(!c.i18n.enabled);
    // Defaults preserved
    assert!(c.updates.disabled);
    assert_eq!(c.ui.recent_repos_limit, 3);
}

#[test]
fn updates_block_manual_check_default_true() {
    // Bare-minimum object should still get block_manual_check=true via #[serde(default = "default_true")].
    let s = r#"{"disabled":false}"#;
    let u: UpdatesConfig = serde_json::from_str(s).expect("parse partial updates");
    assert!(!u.disabled);
    assert!(u.block_manual_check);
}

#[test]
fn config_load_save_roundtrip_to_disk() {
    let dir = std::env::temp_dir().join(format!(
        "gdp-core-it-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let _ = std::fs::remove_dir_all(&dir);

    // Missing file -> default
    let c = Config::load(&dir).expect("load missing");
    assert!(c.updates.disabled);

    // Save -> load -> equal-ish
    let mut c2 = Config::default();
    c2.logging.level = "debug".into();
    c2.save(&dir).expect("save");
    let c3 = Config::load(&dir).expect("reload");
    assert_eq!(c3.logging.level, "debug");

    // Corrupt file -> Json error
    std::fs::write(dir.join("config.json"), b"{not valid json").unwrap();
    let err = Config::load(&dir).unwrap_err();
    assert!(matches!(err, ConfigError::Json(_)));

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn detector_returns_optional_path() {
    // We can't assume Desktop is installed in CI; just ensure the call doesn't panic
    // and returns either Some(existing path) or None.
    if let Some(p) = gdp_core::detector::find_github_desktop() {
        assert!(p.exists());
    }
}

#[test]
fn platform_paths_have_app_namespace() {
    if let Some(d) = gdp_core::platform::config_dir() {
        assert!(
            d.to_string_lossy().contains("github-desktop-plus"),
            "config_dir should be namespaced: {}",
            d.display()
        );
    }
    // hook_dir is None only if current_exe() fails — extremely unlikely in tests.
    if let Some(h) = gdp_core::platform::hook_dir() {
        assert!(h.ends_with("hooks"));
    }
    // candidate list is platform-specific but never empty on Win/macOS/Linux.
    let cands = gdp_core::platform::github_desktop_candidates();
    assert!(!cands.is_empty(), "no candidates for current platform");
}
