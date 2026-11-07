//! Where GitHub Desktop is installed, and which version of it may run.
//!
//! Launching an OLDER GitHub Desktop than the one that last opened the user's
//! data is destructive: a newer Chromium rewrites `IndexedDB` in a format the
//! older one cannot read, and the older one silently deletes and recreates it —
//! the repository list comes back empty. So "which version" is answered with
//! real numeric version comparison, from several independent sources:
//!
//! 1. the `app-X.Y.Z` folders Squirrel installs side by side (what can run),
//! 2. Squirrel's uninstall registry entry (what Windows thinks is installed),
//! 3. GitHub Desktop's own log, `[ui] launching: X.Y.Z` (what actually ran,
//!    including launches that never went through GDP),
//! 4. GDP's own launch record (what GDP last started).
//!
//! The first picks the launch target; the other three set the floor it must
//! not go below.

use crate::platform;
use std::cmp::Ordering;
use std::fmt;
use std::path::{Path, PathBuf};

/// Search the filesystem for a GitHub Desktop executable.
///
/// Walks the platform-specific candidate list and returns the first path
/// that exists. Returns `None` if no installation is found.
pub fn find_github_desktop() -> Option<PathBuf> {
    platform::github_desktop_candidates()
        .into_iter()
        .find(|p| p.exists())
}

// ── Versions ────────────────────────────────────────────────────────────────

/// A GitHub Desktop version. Compared numerically, so 3.6.10 > 3.6.7 — the
/// folder names sort the other way round as strings, which is exactly how an
/// old build used to get picked.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Version {
    pub major: u64,
    pub minor: u64,
    pub patch: u64,
    /// Pre-release suffix (`beta1` in `3.6.10-beta1`); sorts before the release.
    pub pre: Option<String>,
}

impl Version {
    /// Parse `3.6.10`, `v3.6.10`, `3.6` or `3.6.10-beta1`.
    pub fn parse(text: &str) -> Option<Self> {
        let text = text.trim();
        let text = text.strip_prefix(['v', 'V']).unwrap_or(text);
        let (core, pre) = match text.split_once(['-', '+']) {
            Some((core, rest)) => (core, Some(rest)),
            None => (text, None),
        };
        let mut parts = core.split('.');
        let major = parts.next()?.parse().ok()?;
        let minor = parts.next().map_or(Some(0), |p| p.parse().ok())?;
        let patch = parts.next().map_or(Some(0), |p| p.parse().ok())?;
        if parts.next().is_some() {
            // Four-part numbers are not something GitHub Desktop ships; refuse
            // rather than silently compare only the first three.
            return None;
        }
        Some(Self {
            major,
            minor,
            patch,
            pre: pre.filter(|p| !p.is_empty()).map(str::to_string),
        })
    }
}

impl Ord for Version {
    fn cmp(&self, other: &Self) -> Ordering {
        (self.major, self.minor, self.patch)
            .cmp(&(other.major, other.minor, other.patch))
            .then_with(|| match (&self.pre, &other.pre) {
                (None, None) => Ordering::Equal,
                (None, Some(_)) => Ordering::Greater,
                (Some(_), None) => Ordering::Less,
                (Some(a), Some(b)) => a.cmp(b),
            })
    }
}

impl PartialOrd for Version {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl fmt::Display for Version {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}.{}", self.major, self.minor, self.patch)?;
        if let Some(pre) = &self.pre {
            write!(f, "-{pre}")?;
        }
        Ok(())
    }
}

// ── Squirrel installs (Windows) ─────────────────────────────────────────────

#[cfg(windows)]
const DESKTOP_EXE: &str = "GitHubDesktop.exe";
#[cfg(not(windows))]
const DESKTOP_EXE: &str = "github-desktop";

/// One `app-X.Y.Z` folder of a Squirrel install.
#[derive(Debug, Clone)]
pub struct AppDir {
    pub version: Version,
    pub dir: PathBuf,
    /// Squirrel drops a `.dead` file into versions it failed to delete.
    pub dead: bool,
    /// Both the Electron binary and `resources/app/main.js` are present.
    pub complete: bool,
}

impl AppDir {
    pub fn main_js(&self) -> PathBuf {
        self.dir.join("resources").join("app").join("main.js")
    }

    pub fn exe(&self) -> PathBuf {
        self.dir.join(DESKTOP_EXE)
    }

    pub fn launchable(&self) -> bool {
        self.complete && !self.dead
    }
}

/// The Squirrel root (the folder holding `Update.exe` and the `app-*`
/// folders) for a configured executable. Accepts the root stub
/// `GitHubDesktop.exe` and also an exe inside one specific `app-X.Y.Z` — a
/// path pinned to one version must not keep launching it after an update.
pub fn squirrel_root_for(exe: &Path) -> Option<PathBuf> {
    let parent = exe.parent()?;
    let is_root = |dir: &Path| dir.join("Update.exe").is_file() || !app_dirs(dir).is_empty();
    if parent
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.starts_with("app-"))
    {
        let root = parent.parent()?;
        return root
            .join("Update.exe")
            .is_file()
            .then(|| root.to_path_buf());
    }
    is_root(parent).then(|| parent.to_path_buf())
}

/// Every `app-*` folder with a parseable version, newest first.
pub fn app_dirs(root: &Path) -> Vec<AppDir> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut dirs: Vec<AppDir> = entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_ok_and(|t| t.is_dir()))
        .filter_map(|entry| {
            let name = entry.file_name();
            let version = Version::parse(name.to_str()?.strip_prefix("app-")?)?;
            let dir = entry.path();
            let mut app = AppDir {
                version,
                dead: dir.join(".dead").exists(),
                complete: false,
                dir,
            };
            app.complete = app.main_js().is_file() && app.exe().is_file();
            Some(app)
        })
        .collect();
    dirs.sort_by(|a, b| b.version.cmp(&a.version));
    dirs
}

/// The newest version that can actually be started — what Squirrel's own
/// `GitHubDesktop.exe` stub would pick, minus half-extracted or dead folders.
pub fn newest_launchable(root: &Path) -> Option<AppDir> {
    app_dirs(root).into_iter().find(AppDir::launchable)
}

/// The version a resolved `main.js` belongs to: its `app-X.Y.Z` ancestor on
/// Windows/Linux, the bundle's `Info.plist` on macOS.
pub fn version_of_main_js(main_js: &Path) -> Option<Version> {
    for dir in main_js.ancestors() {
        let name = dir.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if let Some(version) = name.strip_prefix("app-").and_then(Version::parse) {
            return Some(version);
        }
        if name == "Contents" {
            return bundle_version(&dir.join("Info.plist"));
        }
    }
    None
}

/// `CFBundleShortVersionString` from a macOS `Info.plist` (XML form).
fn bundle_version(plist: &Path) -> Option<Version> {
    let text = std::fs::read_to_string(plist).ok()?;
    let after = &text[text.find("<key>CFBundleShortVersionString</key>")?..];
    let start = after.find("<string>")? + "<string>".len();
    let end = after[start..].find("</string>")? + start;
    Version::parse(&after[start..end])
}

// ── Evidence of what already ran ────────────────────────────────────────────

/// Squirrel's uninstall entry: `HKCU\…\Uninstall\GitHubDesktop\DisplayVersion`.
/// Rewritten by every successful update, so it names the newest version
/// Squirrel finished installing.
#[cfg(windows)]
pub fn registry_version() -> Option<Version> {
    use windows_sys::Win32::System::Registry::{HKEY_CURRENT_USER, RRF_RT_REG_SZ, RegGetValueW};

    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let key = wide(r"Software\Microsoft\Windows\CurrentVersion\Uninstall\GitHubDesktop");
    let value = wide("DisplayVersion");
    let mut buffer = [0u16; 64];
    let mut size = std::mem::size_of_val(&buffer) as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            value.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            buffer.as_mut_ptr().cast(),
            &mut size,
        )
    };
    if status != 0 {
        return None;
    }
    let len = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
    Version::parse(&String::from_utf16_lossy(&buffer[..len]))
}

#[cfg(not(windows))]
pub fn registry_version() -> Option<Version> {
    None
}

/// How many of the newest daily log files to read. GitHub Desktop rotates its
/// logs daily and prunes old ones itself.
const LOG_FILES_SCANNED: usize = 14;
const LAUNCH_MARKER: &str = "[ui] launching: ";

/// The highest version GitHub Desktop has logged starting up, whoever started
/// it — this is what catches an update that ran without GDP.
pub fn highest_logged_version(data_dir: &Path) -> Option<Version> {
    let mut logs: Vec<PathBuf> = std::fs::read_dir(data_dir.join("logs"))
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.ends_with(".log"))
        })
        .collect();
    // `YYYY-MM-DD.desktop.production.log` sorts chronologically as text.
    logs.sort();
    logs.iter()
        .rev()
        .take(LOG_FILES_SCANNED)
        .filter_map(|log| highest_launch_in(&std::fs::read(log).ok()?))
        .max()
}

fn highest_launch_in(log: &[u8]) -> Option<Version> {
    String::from_utf8_lossy(log)
        .lines()
        .filter_map(|line| {
            let rest = &line[line.find(LAUNCH_MARKER)? + LAUNCH_MARKER.len()..];
            Version::parse(rest.split_whitespace().next()?)
        })
        .max()
}

/// Everything known about which versions have already touched the data.
#[derive(Debug, Clone, Default)]
pub struct VersionEvidence {
    pub registry: Option<Version>,
    pub logged: Option<Version>,
    pub recorded: Option<Version>,
}

impl VersionEvidence {
    /// The highest known version and the source that reported it.
    pub fn floor(&self) -> Option<(&Version, &'static str)> {
        [
            (self.registry.as_ref(), "Windows 注册表"),
            (self.logged.as_ref(), "GitHub Desktop 日志"),
            (self.recorded.as_ref(), "GDP 启动记录"),
        ]
        .into_iter()
        .filter_map(|(version, source)| version.map(|v| (v, source)))
        .max_by(|a, b| a.0.cmp(b.0))
    }

    /// `Some((floor, source))` when launching `target` would be a downgrade.
    pub fn downgrade_from(&self, target: &Version) -> Option<(&Version, &'static str)> {
        self.floor().filter(|(floor, _)| target < *floor)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(text: &str) -> Version {
        Version::parse(text).unwrap()
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "gdp-detector-{tag}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn fake_app(root: &Path, version: &str, complete: bool, dead: bool) {
        let dir = root.join(format!("app-{version}"));
        std::fs::create_dir_all(dir.join("resources/app")).unwrap();
        if complete {
            std::fs::write(dir.join("resources/app/main.js"), "").unwrap();
            std::fs::write(dir.join(DESKTOP_EXE), "").unwrap();
        }
        if dead {
            std::fs::write(dir.join(".dead"), "").unwrap();
        }
    }

    #[test]
    fn versions_compare_numerically_not_as_text() {
        assert!(v("3.6.10") > v("3.6.7"));
        assert!("app-3.6.10" < "app-3.6.7", "the bug this guards against");
        assert!(v("3.10.0") > v("3.9.99"));
        assert!(v("3.6.10-beta1") < v("3.6.10"));
        assert!(v("3.6.10-beta2") > v("3.6.10-beta1"));
        assert_eq!(v("v3.6"), v("3.6.0"));
        assert_eq!(v("3.6.10").to_string(), "3.6.10");
        assert!(Version::parse("3.6.x").is_none());
        assert!(Version::parse("1.2.3.4").is_none());
        assert!(Version::parse("").is_none());
    }

    #[test]
    fn newest_launchable_skips_dead_and_half_extracted_versions() {
        let root = temp_dir("squirrel");
        std::fs::write(root.join("Update.exe"), "").unwrap();
        fake_app(&root, "3.5.12", true, true);
        fake_app(&root, "3.6.7", true, false);
        fake_app(&root, "3.6.10", true, false);
        assert_eq!(newest_launchable(&root).unwrap().version, v("3.6.10"));

        fake_app(&root, "3.6.11", false, false);
        assert_eq!(newest_launchable(&root).unwrap().version, v("3.6.10"));
        fake_app(&root, "3.7.0", true, true);
        assert_eq!(newest_launchable(&root).unwrap().version, v("3.6.10"));

        let order: Vec<String> = app_dirs(&root)
            .iter()
            .map(|a| a.version.to_string())
            .collect();
        assert_eq!(order, ["3.7.0", "3.6.11", "3.6.10", "3.6.7", "3.5.12"]);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_path_pinned_inside_one_version_resolves_to_the_squirrel_root() {
        let root = temp_dir("pinned");
        std::fs::write(root.join("Update.exe"), "").unwrap();
        fake_app(&root, "3.6.7", true, false);
        let pinned = root.join("app-3.6.7").join(DESKTOP_EXE);
        assert_eq!(squirrel_root_for(&pinned), Some(root.clone()));
        assert_eq!(
            squirrel_root_for(&root.join(DESKTOP_EXE)),
            Some(root.clone())
        );
        assert_eq!(
            version_of_main_js(&root.join("app-3.6.7/resources/app/main.js")),
            Some(v("3.6.7"))
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reads_the_bundle_version_on_macos_layouts() {
        let root = temp_dir("bundle");
        let contents = root.join("GitHub Desktop.app/Contents");
        std::fs::create_dir_all(contents.join("Resources/app")).unwrap();
        std::fs::write(
            contents.join("Info.plist"),
            "<dict>\n\t<key>CFBundleShortVersionString</key>\n\t<string>3.6.10</string>\n</dict>",
        )
        .unwrap();
        assert_eq!(
            version_of_main_js(&contents.join("Resources/app/main.js")),
            Some(v("3.6.10"))
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn finds_the_highest_launch_across_desktop_logs() {
        let data = temp_dir("logs");
        let logs = data.join("logs");
        std::fs::create_dir_all(&logs).unwrap();
        std::fs::write(
            logs.join("2026-11-06.desktop.production.log"),
            "2026-11-06T09:41:34.035Z - info: [ui] launching: 3.6.7 (Windows 10.0.26300)\n",
        )
        .unwrap();
        std::fs::write(
            logs.join("2026-11-07.desktop.production.log"),
            "x - info: [ui] launching: 3.6.10 (Windows 10.0.26300)\n\
             x - info: [ui] launching: 3.6.7 (Windows 10.0.26300)\n\
             x - info: [ui] execPath: 'C:\\app-3.6.7\\GitHubDesktop.exe'\n",
        )
        .unwrap();
        assert_eq!(highest_logged_version(&data), Some(v("3.6.10")));
        assert_eq!(highest_logged_version(&data.join("missing")), None);
        std::fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn the_floor_is_the_highest_source_and_flags_downgrades() {
        let evidence = VersionEvidence {
            registry: Some(v("3.6.7")),
            logged: Some(v("3.6.10")),
            recorded: None,
        };
        assert_eq!(
            evidence.floor().map(|(v, s)| (v.to_string(), s)),
            Some(("3.6.10".into(), "GitHub Desktop 日志"))
        );
        assert!(evidence.downgrade_from(&v("3.6.7")).is_some());
        assert!(evidence.downgrade_from(&v("3.6.10")).is_none());
        assert!(evidence.downgrade_from(&v("3.6.11")).is_none());
        assert!(
            VersionEvidence::default()
                .downgrade_from(&v("1.0.0"))
                .is_none()
        );
    }
}
