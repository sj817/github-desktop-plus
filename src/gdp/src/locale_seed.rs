//! Seed the writable `<data_dir>/locales/` tree with aggregate locale packages.
//! Existing files are never overwritten because imported language packs win.

use std::path::Path;

use include_dir::{Dir, include_dir};

static BUNDLED_LOCALES: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../../generated/locales");

/// Copy any missing locale JSON file from the embedded bundle into
/// `<data_dir>/locales/`. Idempotent and silent on success.
pub fn seed_if_missing(data_dir: &Path) {
    let target_root = data_dir.join("locales");
    if let Err(e) = std::fs::create_dir_all(&target_root) {
        eprintln!("warning: cannot create locales dir: {e}");
        return;
    }
    extract_dir(&BUNDLED_LOCALES, &target_root);
}

fn extract_dir(dir: &Dir<'_>, base: &Path) {
    for sub in dir.dirs() {
        let name = sub
            .path()
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        if name.is_empty() {
            continue;
        }
        let out = base.join(name);
        let _ = std::fs::create_dir_all(&out);
        extract_dir(sub, &out);
    }
    for f in dir.files() {
        let name = f.path().file_name().and_then(|s| s.to_str()).unwrap_or("");
        if name.is_empty() {
            continue;
        }
        let out = base.join(name);
        if out.exists() {
            continue;
        }
        if let Err(e) = std::fs::write(&out, f.contents()) {
            eprintln!("warning: cannot seed locale {}: {e}", out.display());
        }
    }
}
