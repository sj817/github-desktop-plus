//! GitHub Desktop's own user data: where it lives, GDP's record of what it
//! launched, and snapshots of the repository database.
//!
//! The repository list, accounts' repository metadata and the rest of
//! GitHub Desktop's state live in Chromium `IndexedDB` under the user data
//! folder. An older build that meets a database written by a newer one
//! deletes it and starts empty, so GDP copies it aside before every version
//! change it is about to cause, and after sessions in which it changed.

use crate::detector::Version;
use serde::{Deserialize, Serialize};
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// What a snapshot copies. `IndexedDB` holds the repository list; `Local
/// Storage` holds the selected repository and similar small preferences.
pub const SNAPSHOT_ITEMS: &[&str] = &["IndexedDB", "Local Storage"];

/// Keep this many most recent snapshots…
pub const KEEP_RECENT: usize = 5;
/// …plus the newest snapshot of each of this many most recent versions, so a
/// pre-update copy survives a burst of ordinary sessions after the update.
pub const KEEP_VERSIONS: usize = 3;
/// Ordinary sessions are snapshotted at most this often.
pub const SESSION_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

const META_FILE: &str = "gdp-backup.json";
const RECORD_FILE: &str = "desktop-state.json";

/// GitHub Desktop's Electron `userData` folder.
pub fn desktop_data_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("APPDATA").map(|p| PathBuf::from(p).join("GitHub Desktop"))
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME")
            .map(|h| PathBuf::from(h).join("Library/Application Support/GitHub Desktop"))
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
            .map(|p| p.join("GitHub Desktop"))
    }
}

/// Where snapshots are kept, inside GDP's own config folder so that neither a
/// GitHub Desktop reinstall nor a reset of its data folder touches them.
pub fn backups_dir(config_dir: &Path) -> PathBuf {
    config_dir.join("desktop-backups")
}

// ── Launch record ───────────────────────────────────────────────────────────

/// What GDP last launched. Kept apart from `config.json`, which is the user's
/// settings and is rewritten by the settings dialog.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LaunchRecord {
    /// Version of the most recent GDP launch.
    #[serde(default)]
    pub last_version: Option<String>,
    /// Highest version GDP has ever launched against this data.
    #[serde(default)]
    pub highest_version: Option<String>,
    #[serde(default)]
    pub last_exe: Option<PathBuf>,
    #[serde(default)]
    pub updated_unix: u64,
}

impl LaunchRecord {
    pub fn load(config_dir: &Path) -> Self {
        std::fs::read_to_string(config_dir.join(RECORD_FILE))
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, config_dir: &Path) -> io::Result<()> {
        std::fs::create_dir_all(config_dir)?;
        let json = serde_json::to_string_pretty(self).map_err(io::Error::other)?;
        let path = config_dir.join(RECORD_FILE);
        let partial = path.with_extension("json.partial");
        std::fs::write(&partial, json)?;
        std::fs::rename(partial, path)
    }

    pub fn last(&self) -> Option<Version> {
        self.last_version.as_deref().and_then(Version::parse)
    }

    pub fn highest(&self) -> Option<Version> {
        self.highest_version.as_deref().and_then(Version::parse)
    }

    /// Note a successful launch. `reset_highest` is for a deliberate
    /// downgrade, after which the old high-water mark no longer applies.
    pub fn note_launch(&mut self, version: Option<&Version>, exe: &Path, reset_highest: bool) {
        if let Some(version) = version {
            let highest = self.highest().filter(|_| !reset_highest);
            if highest.as_ref().is_none_or(|h| version > h) {
                self.highest_version = Some(version.to_string());
            }
            self.last_version = Some(version.to_string());
        }
        self.last_exe = Some(exe.to_path_buf());
        self.updated_unix = unix_now();
    }
}

// ── Snapshots ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapshotMeta {
    pub created_unix: u64,
    /// The newest version known to have written the data when it was copied.
    #[serde(default)]
    pub version: Option<String>,
    /// Why it was taken, e.g. `before 3.6.10` or `session`.
    #[serde(default)]
    pub reason: String,
    #[serde(default)]
    pub bytes: u64,
}

#[derive(Debug, Clone)]
pub struct Snapshot {
    pub name: String,
    pub path: PathBuf,
    pub meta: SnapshotMeta,
}

impl Snapshot {
    pub fn version(&self) -> Option<Version> {
        self.meta.version.as_deref().and_then(Version::parse)
    }
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

/// `20261107-153012` in UTC, for folder names that sort chronologically.
pub fn utc_stamp(unix: u64) -> String {
    let days = (unix / 86_400) as i64;
    let secs = unix % 86_400;
    // Howard Hinnant's days-to-civil.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}{month:02}{day:02}-{:02}{:02}{:02}",
        secs / 3600,
        secs % 3600 / 60,
        secs % 60
    )
}

/// Copy a directory tree. LevelDB's `LOCK` is skipped: it holds no data, and
/// it is the one file a running GitHub Desktop keeps exclusively open.
fn copy_tree(from: &Path, to: &Path) -> io::Result<u64> {
    std::fs::create_dir_all(to)?;
    let mut bytes = 0;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        let kind = entry.file_type()?;
        if kind.is_dir() {
            bytes += copy_tree(&entry.path(), &target)?;
        } else if kind.is_file() && entry.file_name() != "LOCK" {
            bytes += std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(bytes)
}

/// Newest modification time of anything a snapshot would copy.
pub fn data_modified(data_dir: &Path) -> Option<SystemTime> {
    fn newest(path: &Path) -> Option<SystemTime> {
        let meta = std::fs::metadata(path).ok()?;
        let own = meta.modified().ok();
        if !meta.is_dir() {
            return own;
        }
        std::fs::read_dir(path)
            .ok()?
            .filter_map(|e| e.ok())
            .filter_map(|e| newest(&e.path()))
            .chain(own)
            .max()
    }
    SNAPSHOT_ITEMS
        .iter()
        .filter_map(|item| newest(&data_dir.join(item)))
        .max()
}

/// Copy GitHub Desktop's databases into a new snapshot. The copy is built
/// under a hidden name and renamed into place only once complete, so an
/// interrupted copy never looks like a usable backup.
pub fn create_snapshot(
    data_dir: &Path,
    backups: &Path,
    version: Option<&Version>,
    reason: &str,
) -> io::Result<Snapshot> {
    if !data_dir.join("IndexedDB").is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("{} has no IndexedDB folder", data_dir.display()),
        ));
    }
    let created_unix = unix_now();
    let label = version.map_or_else(|| "unknown".to_string(), Version::to_string);
    let mut name = format!("{}-{label}", utc_stamp(created_unix));
    let mut n = 2;
    while backups.join(&name).exists() {
        name = format!("{}-{label}-{n}", utc_stamp(created_unix));
        n += 1;
    }
    let partial = backups.join(format!(".partial-{name}"));
    let _ = std::fs::remove_dir_all(&partial);

    let result = (|| {
        let mut bytes = 0;
        for item in SNAPSHOT_ITEMS {
            let source = data_dir.join(item);
            if source.is_dir() {
                bytes += copy_tree(&source, &partial.join(item))?;
            }
        }
        let meta = SnapshotMeta {
            created_unix,
            version: version.map(Version::to_string),
            reason: reason.to_string(),
            bytes,
        };
        let json = serde_json::to_string_pretty(&meta).map_err(io::Error::other)?;
        std::fs::write(partial.join(META_FILE), json)?;
        let path = backups.join(&name);
        std::fs::rename(&partial, &path)?;
        Ok(Snapshot { name, path, meta })
    })();
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&partial);
    }
    result
}

/// Every complete snapshot, newest first.
pub fn list_snapshots(backups: &Path) -> Vec<Snapshot> {
    let Ok(entries) = std::fs::read_dir(backups) else {
        return Vec::new();
    };
    let mut snapshots: Vec<Snapshot> = entries
        .filter_map(|e| e.ok())
        .filter_map(|entry| {
            let name = entry.file_name().to_str()?.to_string();
            if name.starts_with('.') {
                return None;
            }
            let text = std::fs::read_to_string(entry.path().join(META_FILE)).ok()?;
            let meta: SnapshotMeta = serde_json::from_str(&text).ok()?;
            Some(Snapshot {
                name,
                path: entry.path(),
                meta,
            })
        })
        .collect();
    snapshots.sort_by(|a, b| {
        b.meta
            .created_unix
            .cmp(&a.meta.created_unix)
            .then_with(|| b.name.cmp(&a.name))
    });
    snapshots
}

/// Which snapshots survive pruning: the newest few overall, plus the newest
/// one of each recent version.
pub fn snapshots_to_keep(snapshots: &[Snapshot]) -> Vec<bool> {
    let mut keep: Vec<bool> = (0..snapshots.len()).map(|i| i < KEEP_RECENT).collect();
    let mut versions: Vec<Option<String>> = Vec::new();
    for (i, snapshot) in snapshots.iter().enumerate() {
        let version = snapshot.meta.version.clone();
        if versions.contains(&version) {
            continue;
        }
        if versions.len() >= KEEP_VERSIONS {
            break;
        }
        versions.push(version);
        keep[i] = true;
    }
    keep
}

/// Delete snapshots beyond the retention policy and any abandoned partial copy.
pub fn prune_snapshots(backups: &Path) {
    let snapshots = list_snapshots(backups);
    for (snapshot, keep) in snapshots.iter().zip(snapshots_to_keep(&snapshots)) {
        if !keep {
            let _ = std::fs::remove_dir_all(&snapshot.path);
        }
    }
    if let Ok(entries) = std::fs::read_dir(backups) {
        for entry in entries.filter_map(|e| e.ok()) {
            let is_partial = entry
                .file_name()
                .to_str()
                .is_some_and(|n| n.starts_with(".partial-"));
            if is_partial {
                let _ = std::fs::remove_dir_all(entry.path());
            }
        }
    }
}

/// Put a snapshot back. The data being replaced is first moved, not deleted,
/// into `<backups>/replaced-<stamp>`; its path is returned so the restore can
/// itself be undone. GitHub Desktop must not be running.
pub fn restore_snapshot(
    snapshot: &Snapshot,
    data_dir: &Path,
    backups: &Path,
) -> io::Result<PathBuf> {
    let aside = backups.join(format!("replaced-{}", utc_stamp(unix_now())));
    std::fs::create_dir_all(&aside)?;
    for item in SNAPSHOT_ITEMS {
        let current = data_dir.join(item);
        if current.exists() {
            // A rename stays on one volume only when both folders do; fall
            // back to copy-then-delete across drives.
            if std::fs::rename(&current, aside.join(item)).is_err() {
                copy_tree(&current, &aside.join(item))?;
                std::fs::remove_dir_all(&current)?;
            }
        }
    }
    for item in SNAPSHOT_ITEMS {
        let saved = snapshot.path.join(item);
        if saved.is_dir() {
            copy_tree(&saved, &data_dir.join(item))?;
        }
    }
    Ok(aside)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "gdp-data-{tag}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn fake_desktop_data(dir: &Path, marker: &str) {
        let leveldb = dir.join("IndexedDB/file__0.indexeddb.leveldb");
        std::fs::create_dir_all(&leveldb).unwrap();
        std::fs::write(leveldb.join("000003.log"), marker).unwrap();
        std::fs::write(leveldb.join("LOCK"), "").unwrap();
        std::fs::create_dir_all(dir.join("Local Storage/leveldb")).unwrap();
        std::fs::write(dir.join("Local Storage/leveldb/CURRENT"), marker).unwrap();
    }

    fn snapshot(name: &str, created: u64, version: Option<&str>) -> Snapshot {
        Snapshot {
            name: name.into(),
            path: PathBuf::from(name),
            meta: SnapshotMeta {
                created_unix: created,
                version: version.map(str::to_string),
                reason: String::new(),
                bytes: 0,
            },
        }
    }

    #[test]
    fn stamps_are_utc_and_sortable() {
        assert_eq!(utc_stamp(0), "19700101-000000");
        // 2026-11-07T15:30:12Z
        assert_eq!(utc_stamp(1_794_065_412), "20261107-153012");
        assert_eq!(utc_stamp(951_782_400), "20000229-000000");
    }

    #[test]
    fn snapshot_then_restore_round_trips_and_keeps_the_replaced_data() {
        let root = temp_dir("roundtrip");
        let data = root.join("GitHub Desktop");
        let backups = root.join("backups");
        fake_desktop_data(&data, "66 repositories");

        let version = Version::parse("3.6.10").unwrap();
        let snap = create_snapshot(&data, &backups, Some(&version), "before 3.6.10").unwrap();
        assert!(snap.name.ends_with("-3.6.10"));
        assert!(snap.meta.bytes > 0);
        assert!(
            !snap
                .path
                .join("IndexedDB/file__0.indexeddb.leveldb/LOCK")
                .exists()
        );

        // An old build wipes the database…
        std::fs::remove_dir_all(data.join("IndexedDB")).unwrap();
        fake_desktop_data(&data, "0 repositories");

        let listed = list_snapshots(&backups);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].version(), Some(version));
        let aside = restore_snapshot(&listed[0], &data, &backups).unwrap();
        let read = |p: PathBuf| std::fs::read_to_string(p).unwrap();
        assert_eq!(
            read(data.join("IndexedDB/file__0.indexeddb.leveldb/000003.log")),
            "66 repositories"
        );
        assert_eq!(
            read(aside.join("IndexedDB/file__0.indexeddb.leveldb/000003.log")),
            "0 repositories"
        );
        // The set-aside copy is not mistaken for a snapshot.
        assert_eq!(list_snapshots(&backups).len(), 1);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_missing_database_is_an_error_not_an_empty_backup() {
        let root = temp_dir("missing");
        assert!(create_snapshot(&root, &root.join("backups"), None, "x").is_err());
        assert!(list_snapshots(&root.join("backups")).is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn retention_keeps_recent_ones_and_the_newest_per_version() {
        let mut snapshots: Vec<Snapshot> = (0..8)
            .map(|i| snapshot(&format!("s{i}"), 100 - i, Some("3.6.10")))
            .collect();
        snapshots.push(snapshot("old-367", 50, Some("3.6.7")));
        snapshots.push(snapshot("older-367", 40, Some("3.6.7")));
        snapshots.push(snapshot("ancient-365", 30, Some("3.6.5")));
        snapshots.push(snapshot("too-many-versions", 20, Some("3.5.12")));
        let kept: Vec<&str> = snapshots
            .iter()
            .zip(snapshots_to_keep(&snapshots))
            .filter(|(_, keep)| *keep)
            .map(|(s, _)| s.name.as_str())
            .collect();
        assert_eq!(
            kept,
            ["s0", "s1", "s2", "s3", "s4", "old-367", "ancient-365"]
        );
    }

    #[test]
    fn launch_record_tracks_the_high_water_mark() {
        let root = temp_dir("record");
        let exe = Path::new("GitHubDesktop.exe");
        let mut record = LaunchRecord::load(&root);
        assert!(record.highest().is_none());

        record.note_launch(Version::parse("3.6.10").as_ref(), exe, false);
        record.note_launch(Version::parse("3.6.7").as_ref(), exe, false);
        assert_eq!(record.highest().unwrap().to_string(), "3.6.10");
        assert_eq!(record.last().unwrap().to_string(), "3.6.7");

        record.note_launch(Version::parse("3.6.7").as_ref(), exe, true);
        record.save(&root).unwrap();
        let loaded = LaunchRecord::load(&root);
        assert_eq!(loaded.highest().unwrap().to_string(), "3.6.7");
        std::fs::remove_dir_all(root).unwrap();
    }
}
