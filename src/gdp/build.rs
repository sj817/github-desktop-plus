use std::path::Path;

fn embed_file(out_dir: &Path, repo_root: &Path, relative: &str, out_name: &str) {
    let src = repo_root.join(relative);
    let dest = out_dir.join(out_name);
    if src.exists() {
        std::fs::copy(&src, &dest).unwrap_or_else(|e| panic!("copy {relative}: {e}"));
        println!("cargo:rerun-if-changed={}", src.display());
        println!("cargo:warning=Embedded {relative} → {out_name}");
    } else {
        std::fs::write(&dest, format!("// {relative} not found at build time\n"))
            .unwrap_or_else(|e| panic!("write stub {out_name}: {e}"));
        println!("cargo:warning={relative} not found — embedding stub for {out_name}");
    }
}

/// Recursively copy `src` directory contents to `dest`. Wipes `dest` first.
fn copy_dir_recursive(src: &Path, dest: &Path) {
    if dest.exists() {
        let _ = std::fs::remove_dir_all(dest);
    }
    std::fs::create_dir_all(dest).unwrap_or_else(|e| panic!("mkdir {}: {e}", dest.display()));
    for entry in std::fs::read_dir(src).unwrap_or_else(|e| panic!("read {}: {e}", src.display())) {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let from = entry.path();
        let to = dest.join(entry.file_name());
        let ft = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if ft.is_dir() {
            copy_dir_recursive(&from, &to);
        } else {
            std::fs::copy(&from, &to).unwrap_or_else(|e| panic!("copy {}: {e}", from.display()));
        }
    }
}

fn sync_webui_bundle(webui_dist: &Path, bundle: &Path) {
    if webui_dist.join("index.html").exists() {
        copy_dir_recursive(webui_dist, bundle);
    } else {
        // Fallback stub so include_dir!() always has *something* to embed.
        if !bundle.join(".gdp-stub").exists() {
            let _ = std::fs::remove_dir_all(bundle);
            std::fs::create_dir_all(bundle)
                .unwrap_or_else(|e| panic!("mkdir {}: {e}", bundle.display()));
        }
        let stub_html = "<!doctype html>\n<html><head><meta charset=\"utf-8\"><title>GDP WebUI</title></head>\n<body style=\"font-family:system-ui;padding:40px\">\n<h1>WebUI not built yet.</h1>\n<p>Run <code>pnpm build</code> in <code>webui/</code> to produce the React bundle.</p>\n</body></html>\n";
        std::fs::write(bundle.join("index.html"), stub_html).expect("write stub index.html");
        std::fs::write(bundle.join(".gdp-stub"), b"stub\n").expect("write stub marker");
    }
}

fn main() {
    let out_dir_str = std::env::var("OUT_DIR").unwrap();
    let out_dir = Path::new(&out_dir_str);

    // Repo root is ../../ from crate manifest dir (src/gdp → repo root)
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let repo_root = Path::new(&manifest_dir).join("../..");

    // ── WebUI: produce a single canonical "generated/webui-bundle/" directory
    //    that include_dir!() can point to unconditionally. Sync from
    //    webui/dist if it exists, otherwise drop a tiny stub index.html.
    let webui_dist = repo_root.join("webui").join("dist");
    let bundle = repo_root.join("generated").join("webui-bundle");
    sync_webui_bundle(&webui_dist, &bundle);
    println!("cargo:rerun-if-changed={}", webui_dist.display());
    println!("cargo:rerun-if-changed={}", bundle.display());

    // Hook bundle (main process injector)
    embed_file(
        out_dir,
        &repo_root,
        "generated/hooks/index.js",
        "hook_bundle.js",
    );

    // Preload script (renderer i18n)
    embed_file(
        out_dir,
        &repo_root,
        "generated/hooks/preload/index.js",
        "preload_index.js",
    );
    embed_file(
        out_dir,
        &repo_root,
        "generated/hooks/preload/navbar.js",
        "preload_navbar.js",
    );
    embed_file(
        out_dir,
        &repo_root,
        "generated/hooks/preload/update-interceptor.js",
        "preload_update_interceptor.js",
    );

    // Locale files
    embed_file(
        out_dir,
        &repo_root,
        "locales/zh-CN/menu.json",
        "locale_zh_CN_menu.json",
    );
    embed_file(
        out_dir,
        &repo_root,
        "locales/zh-CN/ui.json",
        "locale_zh_CN_ui.json",
    );
    embed_file(
        out_dir,
        &repo_root,
        "locales/zh-CN/ui-about.json",
        "locale_zh_CN_ui_about.json",
    );
    embed_file(
        out_dir,
        &repo_root,
        "locales/zh-CN/ui-diff.json",
        "locale_zh_CN_ui_diff.json",
    );
    embed_file(
        out_dir,
        &repo_root,
        "locales/zh-CN/ui-navbar.json",
        "locale_zh_CN_ui_navbar.json",
    );
    embed_file(
        out_dir,
        &repo_root,
        "locales/zh-CN/ui-repository-settings.json",
        "locale_zh_CN_ui_repository_settings.json",
    );
    embed_file(
        out_dir,
        &repo_root,
        "locales/zh-CN/ui-settings.json",
        "locale_zh_CN_ui_settings.json",
    );
    embed_file(
        out_dir,
        &repo_root,
        "locales/zh-CN/ui-sidebar.json",
        "locale_zh_CN_ui_sidebar.json",
    );
    embed_file(
        out_dir,
        &repo_root,
        "locales/zh-CN/ui-toolbar.json",
        "locale_zh_CN_ui_toolbar.json",
    );
    embed_file(
        out_dir,
        &repo_root,
        "locales/zh-CN/ui-branches.json",
        "locale_zh_CN_ui_branches.json",
    );
    embed_file(
        out_dir,
        &repo_root,
        "locales/zh-CN/ui-changes.json",
        "locale_zh_CN_ui_changes.json",
    );
    embed_file(
        out_dir,
        &repo_root,
        "locales/zh-CN/ui-check-runs.json",
        "locale_zh_CN_ui_check_runs.json",
    );
    embed_file(
        out_dir,
        &repo_root,
        "locales/zh-CN/ui-clone-add.json",
        "locale_zh_CN_ui_clone_add.json",
    );
    embed_file(
        out_dir,
        &repo_root,
        "locales/zh-CN/ui-dialogs.json",
        "locale_zh_CN_ui_dialogs.json",
    );
    embed_file(
        out_dir,
        &repo_root,
        "locales/zh-CN/ui-history.json",
        "locale_zh_CN_ui_history.json",
    );
    embed_file(
        out_dir,
        &repo_root,
        "locales/zh-CN/ui-lib.json",
        "locale_zh_CN_ui_lib.json",
    );
    embed_file(
        out_dir,
        &repo_root,
        "locales/zh-CN/ui-welcome-tutorial.json",
        "locale_zh_CN_ui_welcome_tutorial.json",
    );
    embed_file(
        out_dir,
        &repo_root,
        "locales/zh-CN/ui-context-menus.json",
        "locale_zh_CN_ui_context_menus.json",
    );

    println!("cargo:rerun-if-changed=build.rs");
}
