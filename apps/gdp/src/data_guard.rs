//! Keeping GitHub Desktop's repository database safe across version changes.
//!
//! An older GitHub Desktop that opens data a newer one already migrated
//! deletes it and starts with an empty repository list. Launching therefore:
//!
//! 1. waits for an in-flight Squirrel update to finish unpacking,
//! 2. refuses to start a version below the highest one known to have run,
//! 3. snapshots the database before any version change GDP is about to cause,
//! 4. snapshots it again after a session when an update is staged or the last
//!    copy is old, which covers updates that restart GitHub Desktop without GDP.
//!
//! `gdp backup` lists, takes and restores those snapshots.

use std::path::Path;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use gdp_core::desktop_data::{
    LaunchRecord, SESSION_INTERVAL, Snapshot, backups_dir, create_snapshot, data_modified,
    desktop_data_dir, list_snapshots, prune_snapshots, restore_snapshot,
};
use gdp_core::detector::{
    Version, VersionEvidence, highest_logged_version, newest_launchable, registry_version,
};

use crate::cli::BackupAction;
use crate::proc::{github_desktop_running, squirrel_update_running};

/// Longest wait for Squirrel to finish an update before launching anyway.
const SQUIRREL_WAIT: Duration = Duration::from_secs(120);

/// Show an error the user will actually see: a dialog when GDP runs without a
/// console (the usual Start-menu launch, and always for the daemon).
pub fn show_error(message: &str) {
    eprintln!("{message}");

    #[cfg(windows)]
    if crate::launch::running_as_gui() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{MB_ICONERROR, MB_OK, MessageBoxW};
        let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
        let title = wide("GitHub Desktop Plus");
        let text = wide(message);
        unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                text.as_ptr(),
                title.as_ptr(),
                MB_OK | MB_ICONERROR,
            );
        }
    }

    #[cfg(target_os = "macos")]
    if crate::launch::running_as_gui() {
        let quoted = message.replace('\\', "\\\\").replace('"', "\\\"");
        let _ = std::process::Command::new("/usr/bin/osascript")
            .args([
                "-e",
                &format!(
                    "display dialog \"{quoted}\" with title \"GitHub Desktop Plus\" buttons {{\"好\"}} default button \"好\" with icon stop"
                ),
            ])
            .output();
    }
}

/// Let a running Squirrel `Update.exe` finish unpacking before choosing which
/// `app-X.Y.Z` to start; a half-extracted folder must neither be launched
/// nor make GDP settle for the previous version.
pub fn wait_for_squirrel(root: &Path) {
    if !squirrel_update_running(root) {
        return;
    }
    eprintln!("info: GitHub Desktop is installing an update — waiting for it to finish …");
    let deadline = Instant::now() + SQUIRREL_WAIT;
    while Instant::now() < deadline && squirrel_update_running(root) {
        std::thread::sleep(Duration::from_millis(500));
    }
    if squirrel_update_running(root) {
        eprintln!(
            "warning: the update is still running after {}s; continuing.",
            SQUIRREL_WAIT.as_secs()
        );
    }
}

/// Which versions are known to have touched the data. The registry entry is
/// only consulted for Squirrel installs, the kind it describes.
pub fn gather_evidence(squirrel_install: bool, record: &LaunchRecord) -> VersionEvidence {
    VersionEvidence {
        registry: if squirrel_install {
            registry_version()
        } else {
            None
        },
        logged: desktop_data_dir()
            .as_deref()
            .and_then(highest_logged_version),
        recorded: record.highest(),
    }
}

/// Explain why GDP will not start an older GitHub Desktop, then exit.
pub fn refuse_downgrade(
    target: &Version,
    exe: &Path,
    floor: &Version,
    source: &str,
    config_dir: Option<&Path>,
) -> ! {
    let backups = config_dir
        .map(|d| format!("\n\n数据库备份位于：{}", backups_dir(d).display()))
        .unwrap_or_default();
    show_error(&format!(
        "这台电脑上已经运行过 GitHub Desktop {floor}（依据：{source}），\
         但 GDP 只找到了更旧的 {target}：\n{}\n\n\
         旧版本打开新版本迁移过的数据库时会把它清空，仓库列表会变成 0，所以这次没有启动。\n\n\
         请重新安装最新版 GitHub Desktop 后再打开 GitHub Desktop Plus。{backups}\n\n\
         如果确定要用旧版本，可在终端运行：gdp launch --allow-downgrade\n\
         （仍会先备份数据库，但旧版本会以空仓库列表启动）",
        exe.display()
    ));
    std::process::exit(1);
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

fn take_snapshot(config_dir: &Path, data_version: Option<&Version>, reason: &str) {
    let Some(data_dir) = desktop_data_dir() else {
        return;
    };
    let backups = backups_dir(config_dir);
    match create_snapshot(&data_dir, &backups, data_version, reason) {
        Ok(snapshot) => eprintln!(
            "info: backed up GitHub Desktop data ({reason}) → {}",
            snapshot.path.display()
        ),
        // A fresh install has no database yet; nothing to protect.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => eprintln!("warning: could not back up GitHub Desktop data: {e}"),
    }
    prune_snapshots(&backups);
}

/// Before GDP starts a version other than the one it started last time —
/// including the very first time — copy the database while nothing has it
/// open. Must run after GitHub Desktop has been closed.
pub fn snapshot_before_launch(
    config_dir: &Path,
    record: &LaunchRecord,
    target: Option<&Version>,
    data_version: Option<&Version>,
) {
    let changed = target.is_some() && record.last().as_ref() != target;
    let none_yet = list_snapshots(&backups_dir(config_dir)).is_empty();
    if !changed && !none_yet {
        return;
    }
    let reason = match (record.last(), target) {
        (Some(last), Some(target)) => format!("{last} → {target} 之前"),
        (None, Some(target)) => format!("首次以 {target} 启动之前"),
        _ => "首次备份".to_string(),
    };
    take_snapshot(config_dir, data_version, &reason);
}

/// After the session GDP launched has ended. Squirrel may already have staged
/// a newer version, which it starts by itself — without GDP — right after
/// this exit; copy the data before that happens. Otherwise refresh the copy
/// at most once per `SESSION_INTERVAL`, and only if the data changed.
pub fn snapshot_after_session(
    config_dir: &Path,
    launched: Option<&Version>,
    squirrel_root: Option<&Path>,
    data_version: Option<&Version>,
) {
    let staged = squirrel_root
        .and_then(newest_launchable)
        .map(|app| app.version)
        .filter(|newest| launched.is_some_and(|launched| newest > launched));
    if let Some(staged) = staged {
        take_snapshot(config_dir, data_version, &format!("更新到 {staged} 之前"));
        return;
    }

    let latest = list_snapshots(&backups_dir(config_dir)).into_iter().next();
    let latest_at = latest.as_ref().map_or(0, |s| s.meta.created_unix);
    if now().saturating_sub(latest_at) < SESSION_INTERVAL.as_secs() {
        return;
    }
    let changed_since = desktop_data_dir()
        .as_deref()
        .and_then(data_modified)
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .is_some_and(|t| t.as_secs() > latest_at);
    if changed_since {
        take_snapshot(config_dir, data_version, "日常备份");
    }
}

// ── `gdp backup` ────────────────────────────────────────────────────────────

fn human_size(bytes: u64) -> String {
    const MB: f64 = 1024.0 * 1024.0;
    format!("{:.1} MB", bytes as f64 / MB)
}

fn describe(snapshot: &Snapshot) -> String {
    format!(
        "{:<28} {:>9}  {:>10}  {}",
        snapshot.name,
        snapshot.meta.version.as_deref().unwrap_or("?"),
        human_size(snapshot.meta.bytes),
        snapshot.meta.reason
    )
}

fn fail(message: &str) -> ! {
    eprintln!("error: {message}");
    std::process::exit(1);
}

fn refuse_while_running() {
    if github_desktop_running() {
        fail(
            "GitHub Desktop 正在运行。请先关闭它（或运行 `gdp stop`），数据库在使用中时无法安全复制。",
        );
    }
}

pub fn run_backup(action: BackupAction, installed: Option<Version>) {
    let config_dir = gdp_core::platform::config_dir()
        .unwrap_or_else(|| fail("cannot determine the GDP config directory"));
    let backups = backups_dir(&config_dir);
    let data_dir = desktop_data_dir()
        .unwrap_or_else(|| fail("cannot determine GitHub Desktop's data directory"));

    match action {
        BackupAction::List => {
            let snapshots = list_snapshots(&backups);
            if snapshots.is_empty() {
                println!("No backups yet in {}", backups.display());
                return;
            }
            println!("{}", backups.display());
            println!("{:<28} {:>9}  {:>10}  reason", "name", "version", "size");
            for snapshot in &snapshots {
                println!("{}", describe(snapshot));
            }
        }
        BackupAction::Create => {
            refuse_while_running();
            let record = LaunchRecord::load(&config_dir);
            let version = data_version(&gather_evidence(false, &record), installed.as_ref());
            match create_snapshot(&data_dir, &backups, version.as_ref(), "手动备份") {
                Ok(snapshot) => println!("✓ {}", describe(&snapshot)),
                Err(e) => fail(&format!("backup failed: {e}")),
            }
            prune_snapshots(&backups);
        }
        BackupAction::Restore { name, force } => {
            refuse_while_running();
            let snapshots = list_snapshots(&backups);
            let snapshot = match &name {
                Some(name) => snapshots.iter().find(|s| &s.name == name),
                None => snapshots.first(),
            }
            .unwrap_or_else(|| fail("no such backup — see `gdp backup list`"));

            if let (Some(saved), Some(installed)) = (snapshot.version(), installed.as_ref())
                && &saved > installed
                && !force
            {
                fail(&format!(
                    "这份备份由 GitHub Desktop {saved} 写入，而当前安装的是 {installed}。\n       旧版本打开它会再次清空仓库列表。请先安装 {saved} 或更新版本，或加 --force。"
                ));
            }
            match restore_snapshot(snapshot, &data_dir, &backups) {
                Ok(aside) => {
                    println!("✓ Restored {} into {}", snapshot.name, data_dir.display());
                    println!("  The data it replaced was moved to {}", aside.display());
                }
                Err(e) => fail(&format!("restore failed: {e}")),
            }
        }
    }
}

/// The newest version known to have written the data, for snapshot labels.
/// The registry is left out: Squirrel updates it as soon as an update is
/// staged, before that version has opened anything.
pub fn data_version(evidence: &VersionEvidence, launched: Option<&Version>) -> Option<Version> {
    [
        evidence.logged.as_ref(),
        evidence.recorded.as_ref(),
        launched,
    ]
    .into_iter()
    .flatten()
    .max()
    .cloned()
}
