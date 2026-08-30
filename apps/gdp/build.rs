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

fn embed_wsl_agent(
    out_dir: &Path,
    repo_root: &Path,
    target: &str,
    environment_variable: &str,
    out_name: &str,
) -> bool {
    let conventional = repo_root
        .join("target/wsl-agent")
        .join(target)
        .join("release/gdp-wsl-agent");
    let source = std::env::var_os(environment_variable)
        .map(std::path::PathBuf::from)
        .unwrap_or(conventional);
    let destination = out_dir.join(out_name);
    println!("cargo:rerun-if-env-changed={environment_variable}");

    if source.is_file() {
        std::fs::copy(&source, &destination)
            .unwrap_or_else(|error| panic!("copy {}: {error}", source.display()));
        println!("cargo:rerun-if-changed={}", source.display());
        println!(
            "cargo:warning=Embedded WSL agent {} → {out_name}",
            source.display()
        );
        true
    } else {
        std::fs::write(&destination, [])
            .unwrap_or_else(|error| panic!("write empty {out_name}: {error}"));
        println!(
            "cargo:warning=WSL agent for {target} not found at {}",
            source.display()
        );
        false
    }
}

fn bundle_locale(out_dir: &Path, resources_dir: &Path, locale: &str, out_name: &str) {
    let locale_dir = resources_dir.join("locales").join(locale);
    let out_file = out_dir.join(out_name);

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

    let content = serde_json::to_string_pretty(&serde_json::Value::Object(bundle))
        .expect("serialize locale bundle");
    std::fs::write(&out_file, format!("{content}\n"))
        .unwrap_or_else(|e| panic!("write {}: {e}", out_file.display()));
    println!("cargo:warning=Bundled resources/locales/{locale} → {out_name}");
}

fn main() {
    let out_dir_str = std::env::var("OUT_DIR").unwrap();
    let out_dir = Path::new(&out_dir_str);

    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let manifest_dir = Path::new(&manifest_dir);
    let repo_root = manifest_dir.join("../..");

    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target_os == "windows" {
        let icon = manifest_dir.join("assets/gdp.ico");
        winresource::WindowsResource::new()
            .set_icon(icon.to_str().expect("Windows icon path must be UTF-8"))
            .compile()
            .expect("compile Windows executable resources");
        println!("cargo:rerun-if-changed={}", icon.display());
    }

    bundle_locale(
        out_dir,
        &manifest_dir.join("resources"),
        "zh-CN",
        "locale_zh_cn.json",
    );

    // Hook bundle (main process injector)
    embed_file(
        out_dir,
        &repo_root,
        "packages/hooks/dist/main/index.cjs",
        "hook_bundle.js",
    );

    // Preload scripts (renderer process): one early boot patch and one late UI bundle.
    embed_file(
        out_dir,
        &repo_root,
        "packages/hooks/dist/preload/early.js",
        "preload_early.js",
    );
    embed_file(
        out_dir,
        &repo_root,
        "packages/hooks/dist/preload/renderer.js",
        "preload_renderer.js",
    );
    // Built and owned by the settings UI package's Vite pipeline.
    embed_file(
        out_dir,
        &repo_root,
        "apps/settings-ui/dist/gdp-settings-ui.js",
        "preload_gdp_settings_ui.js",
    );

    let has_x86_64_agent = embed_wsl_agent(
        out_dir,
        &repo_root,
        "x86_64-unknown-linux-gnu",
        "GDP_WSL_AGENT_X86_64",
        "wsl_agent_x86_64",
    );
    let has_aarch64_agent = embed_wsl_agent(
        out_dir,
        &repo_root,
        "aarch64-unknown-linux-gnu",
        "GDP_WSL_AGENT_AARCH64",
        "wsl_agent_aarch64",
    );

    let profile = std::env::var("PROFILE").unwrap_or_default();
    let target_arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    let required_agent_is_present = match target_arch.as_str() {
        "x86_64" => has_x86_64_agent,
        "aarch64" => has_aarch64_agent,
        _ => true,
    };
    if profile == "release" && target_os == "windows" && !required_agent_is_present {
        panic!(
            "release build requires a WSL agent for the Windows target architecture ({target_arch})"
        );
    }

    println!(
        "cargo:rerun-if-changed={}",
        manifest_dir.join("resources/locales").display()
    );
    println!("cargo:rerun-if-changed=build.rs");
}
