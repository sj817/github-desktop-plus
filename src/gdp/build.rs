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

fn bundle_locale(repo_root: &Path, locale: &str) {
    let locale_dir = repo_root.join("locales").join(locale);
    let out_dir = repo_root.join("generated").join("locales");
    let out_file = out_dir.join(format!("{locale}.json"));

    let mut bundle = serde_json::Map::new();
    if locale_dir.exists() {
        let mut files: Vec<_> = std::fs::read_dir(&locale_dir)
            .unwrap_or_else(|e| panic!("read {}: {e}", locale_dir.display()))
            .flatten()
            .filter(|entry| entry.file_type().map(|ft| ft.is_file()).unwrap_or(false))
            .filter(|entry| entry.path().extension().and_then(|s| s.to_str()) == Some("json"))
            .collect();
        files.sort_by_key(|entry| entry.file_name());

        for entry in files {
            let path = entry.path();
            let Some(category) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            let content = std::fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
            let value = serde_json::from_str::<serde_json::Value>(&content)
                .unwrap_or_else(|e| panic!("parse {}: {e}", path.display()));
            bundle.insert(category.to_string(), value);
            println!("cargo:rerun-if-changed={}", path.display());
        }
    }

    std::fs::create_dir_all(&out_dir)
        .unwrap_or_else(|e| panic!("mkdir {}: {e}", out_dir.display()));
    let content = serde_json::to_string_pretty(&serde_json::Value::Object(bundle))
        .expect("serialize locale bundle");
    std::fs::write(&out_file, format!("{content}\n"))
        .unwrap_or_else(|e| panic!("write {}: {e}", out_file.display()));
    println!("cargo:warning=Bundled locales/{locale} → generated/locales/{locale}.json");
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

    bundle_locale(&repo_root, "zh-CN");

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
        "generated/hooks/preload/recent-repositories.js",
        "preload_recent_repositories.js",
    );
    embed_file(
        out_dir,
        &repo_root,
        "generated/hooks/preload/update-interceptor.js",
        "preload_update_interceptor.js",
    );

    println!(
        "cargo:rerun-if-changed={}",
        repo_root.join("locales").display()
    );
    println!("cargo:rerun-if-changed=build.rs");
}
