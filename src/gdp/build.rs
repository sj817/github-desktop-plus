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

fn main() {
    let out_dir_str = std::env::var("OUT_DIR").unwrap();
    let out_dir = Path::new(&out_dir_str);

    // Repo root is ../../ from crate manifest dir (src/gdp → repo root)
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let repo_root = Path::new(&manifest_dir).join("../..");

    // Hook bundle (main process injector)
    embed_file(out_dir, &repo_root, "generated/hooks/index.js", "hook_bundle.js");

    // Preload script (renderer i18n)
    embed_file(out_dir, &repo_root, "generated/hooks/preload/index.js", "preload_index.js");
    embed_file(out_dir, &repo_root, "generated/hooks/preload/navbar.js", "preload_navbar.js");
    embed_file(
        out_dir,
        &repo_root,
        "generated/hooks/preload/update-interceptor.js",
        "preload_update_interceptor.js",
    );

    // Locale files
    embed_file(out_dir, &repo_root, "locales/zh-CN/menu.json", "locale_zh_CN_menu.json");
    embed_file(out_dir, &repo_root, "locales/zh-CN/ui.json", "locale_zh_CN_ui.json");

    println!("cargo:rerun-if-changed=build.rs");
}
