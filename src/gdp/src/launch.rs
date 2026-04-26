//! `gdp launch` (and the legacy `gdp dev`) implementation.
//!
//! Responsibilities:
//!   - Resolve the GitHub Desktop binary (interactive picker on first run).
//!   - Acquire a single-instance lock on `127.0.0.1:7788`.
//!   - Daemonize on Windows; keep PID files in the config dir.
//!   - Spawn GitHub Desktop with `--inspect-brk=0`, capture its WS URL,
//!     inject the GDP hook bundle, then watch its PID and exit when it dies.

use std::io::{self, Write};
use std::path::PathBuf;
use std::time::Duration;

use gdp_core::{
    config::Config,
    detector::find_github_desktop,
    platform::{config_dir, github_desktop_candidates},
};

use crate::hook_assets::{HOOK_JS, extract_hook_to_disk};
use crate::proc::{
    daemonize_and_exit, find_main_js, find_real_electron_exe, is_process_alive,
    kill_github_desktop_if_running, kill_process, read_inspect_ws_url_sync,
};
use crate::{injector, serve};

const SINGLE_INSTANCE_PORT: u16 = 7788;

pub fn load_config() -> (Config, Option<PathBuf>) {
    let dir = config_dir();
    let cfg = dir
        .as_deref()
        .and_then(|d| Config::load(d).ok())
        .unwrap_or_default();
    (cfg, dir)
}

pub fn config_has_desktop(cfg: &Config) -> bool {
    cfg.desktop
        .path
        .as_ref()
        .map(|p| p.exists())
        .unwrap_or(false)
}

/// Interactive multi-choice prompt: present numbered candidates, read a line.
pub fn interactive_select_desktop() -> PathBuf {
    let candidates: Vec<PathBuf> = github_desktop_candidates()
        .into_iter()
        .filter(|p| p.exists())
        .collect();

    if candidates.is_empty() {
        match find_github_desktop() {
            Some(p) => return p,
            None => {
                eprintln!("error: GitHub Desktop was not found on this system.");
                eprintln!("       Install GitHub Desktop first, then re-run `gdp launch`.");
                std::process::exit(1);
            }
        }
    }

    if candidates.len() == 1 {
        let p = candidates.into_iter().next().unwrap();
        println!("Found GitHub Desktop: {}", p.display());
        return p;
    }

    println!("Multiple GitHub Desktop installations found:");
    for (i, p) in candidates.iter().enumerate() {
        println!("  [{}] {}", i + 1, p.display());
    }
    print!("Select [1-{}] (default: 1): ", candidates.len());
    io::stdout().flush().ok();

    let mut line = String::new();
    io::stdin().read_line(&mut line).ok();
    let trimmed = line.trim();
    let idx: usize = if trimmed.is_empty() {
        1
    } else {
        trimmed.parse().unwrap_or(1)
    };
    let idx = idx.clamp(1, candidates.len()) - 1;
    candidates.into_iter().nth(idx).unwrap()
}

/// Returns true if we currently appear to be running attached to a GUI shell
/// (no console window) on Windows; false on every other platform.
#[cfg(windows)]
fn running_as_gui() -> bool {
    use windows_sys::Win32::System::Console::GetConsoleWindow;
    use windows_sys::Win32::UI::WindowsAndMessaging::IsWindowVisible;
    unsafe {
        let hwnd = GetConsoleWindow();
        if hwnd.is_null() {
            return true;
        }
        IsWindowVisible(hwnd) == 0
    }
}

#[cfg(not(windows))]
fn running_as_gui() -> bool {
    false
}

/// Ask the user (GUI or CLI) whether to terminate the existing daemon.
fn ask_kill_existing(daemon_pid: Option<u32>) -> bool {
    let pid_str = daemon_pid
        .map(|p| format!(" (PID {p})"))
        .unwrap_or_default();

    #[cfg(windows)]
    {
        if running_as_gui() {
            use windows_sys::Win32::UI::WindowsAndMessaging::{
                IDYES, MB_DEFBUTTON2, MB_ICONWARNING, MB_YESNO, MessageBoxW,
            };
            let title: Vec<u16> = "GitHub Desktop Plus\0".encode_utf16().collect();
            let msg_str =
                format!("GitHub Desktop Plus 已在运行{pid_str}，是否结束旧实例并重新启动？\0");
            let msg: Vec<u16> = msg_str.encode_utf16().collect();
            let r = unsafe {
                MessageBoxW(
                    std::ptr::null_mut(),
                    msg.as_ptr(),
                    title.as_ptr(),
                    MB_YESNO | MB_ICONWARNING | MB_DEFBUTTON2,
                )
            };
            return r == IDYES as i32;
        }
    }

    eprintln!("GitHub Desktop Plus 已在运行{pid_str}.");
    eprint!("结束旧实例并重新启动？[y/N]: ");
    let _ = io::stderr().flush();
    let mut line = String::new();
    if io::stdin().read_line(&mut line).is_err() {
        return false;
    }
    matches!(line.trim().to_ascii_lowercase().as_str(), "y" | "yes")
}

/// Try to acquire the single-instance lock by binding 127.0.0.1:7788.
/// On conflict, prompt the user; on Yes kill the previous daemon and retry.
/// Returns when the port is free for the daemon to take over.
fn ensure_single_instance(cfg_dir: Option<&PathBuf>) {
    use std::net::TcpListener;

    let addr = format!("127.0.0.1:{SINGLE_INSTANCE_PORT}");
    if let Ok(l) = TcpListener::bind(&addr) {
        drop(l);
        return;
    }

    // Read existing daemon PID, if any.
    let daemon_pid = cfg_dir
        .and_then(|d| std::fs::read_to_string(d.join("gdp-daemon.pid")).ok())
        .and_then(|s| s.trim().parse::<u32>().ok());

    if !ask_kill_existing(daemon_pid) {
        eprintln!("Aborted by user.");
        std::process::exit(0);
    }

    if let Some(pid) = daemon_pid {
        kill_process(pid);
    }
    std::thread::sleep(Duration::from_secs(2));

    if let Err(e) = TcpListener::bind(&addr) {
        eprintln!("error: port {SINGLE_INSTANCE_PORT} still in use after kill: {e}");
        std::process::exit(1);
    }
}

/// Spawn a tokio task that polls every 2s and exits the process when `pid` dies.
fn watch_pid_and_exit(pid: u32) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            if !is_process_alive(pid) {
                eprintln!("[gdp] GitHub Desktop process {pid} exited — shutting down daemon.");
                std::process::exit(0);
            }
        }
    });
}

/// Implementation of `gdp launch`.
pub fn run(force: bool, desktop_path: Option<PathBuf>, no_serve: bool) {
    let already_daemon = std::env::var("GDP_DAEMON").is_ok();
    let (mut config, cfg_dir) = load_config();

    if let Some(p) = desktop_path {
        config.desktop.path = Some(p);
    }

    let needs_interactive = force || !config_has_desktop(&config);

    if needs_interactive && !already_daemon {
        let chosen = interactive_select_desktop();
        config.desktop.path = Some(chosen);
        if let Some(ref dir) = cfg_dir {
            match config.save(dir) {
                Ok(()) => println!("✓ Config saved to {}", dir.join("config.json").display()),
                Err(e) => eprintln!("warning: could not save config: {e}"),
            }
        }
        println!();
    }

    // Single-instance check (foreground only — the daemon child will rebind).
    if !already_daemon {
        ensure_single_instance(cfg_dir.as_ref());
    }

    let hooks_dir = extract_hook_to_disk();

    let exe = config
        .desktop
        .path
        .as_ref()
        .filter(|p| p.exists())
        .cloned()
        .or_else(find_github_desktop)
        .unwrap_or_else(|| {
            eprintln!("error: GitHub Desktop executable not found");
            eprintln!("       Run `gdp launch -f` to select manually.");
            std::process::exit(1);
        });

    let main_js = find_main_js(&exe).unwrap_or_else(|| {
        eprintln!("error: main.js not found in GitHub Desktop installation");
        eprintln!("       Searched near: {}", exe.display());
        std::process::exit(1);
    });
    let real_exe = find_real_electron_exe(&main_js).unwrap_or_else(|| exe.clone());

    if !already_daemon {
        println!(
            "GitHub Desktop Plus  |  desktop: {}  |  webui: {}",
            real_exe.display(),
            if no_serve {
                "(disabled)"
            } else {
                "http://127.0.0.1:7788"
            }
        );
        daemonize_and_exit(no_serve);
        // Windows: parent exits here. Unix: daemon child falls through.
    }

    // ── Daemon process ───────────────────────────────────────────────────────
    kill_github_desktop_if_running();

    let hook_config = serde_json::json!({
        "blockUpdates": config.updates.disabled,
        "blockManualUpdateCheck": config.updates.block_manual_check,
        "blockTelemetry": config.telemetry.disabled,
        "logLevel": config.logging.level,
        "enableI18n": config.i18n.enabled,
        "locale": config.i18n.locale,
        "dataDir": cfg_dir.as_ref().map(|d| d.display().to_string()).unwrap_or_default(),
        "recentReposLimit": config.ui.recent_repos_limit,
    });
    let config_json = hook_config.to_string();

    let child = std::process::Command::new(&real_exe)
        .arg("--inspect-brk=0")
        .env("GDP_CONFIG", &config_json)
        .env("GDP_HOOK_DIR", hooks_dir.to_str().unwrap_or_default())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn();

    let mut c = match child {
        Ok(c) => c,
        Err(e) => {
            eprintln!("error: failed to launch GitHub Desktop: {e}");
            std::process::exit(1);
        }
    };

    let pid = c.id();
    let daemon_pid = std::process::id();
    if let Some(ref dir) = cfg_dir {
        let _ = std::fs::write(dir.join("gdp.pid"), pid.to_string());
        let _ = std::fs::write(dir.join("gdp-daemon.pid"), daemon_pid.to_string());
    }

    let ws_url = c
        .stderr
        .take()
        .and_then(|stderr| read_inspect_ws_url_sync(stderr, Duration::from_secs(20)));
    // Keep `c` alive (so the OS handle stays open), but we no longer need direct stdio.
    // We track the PID instead of the Child handle from here on.
    std::mem::forget(c);

    let hook_code = std::str::from_utf8(HOOK_JS).unwrap_or("");
    match ws_url {
        Some(ref url) => match injector::inject(url, hook_code, Duration::from_secs(30)) {
            Ok(()) => {}
            Err(e) => {
                eprintln!("warning: hook injection failed: {e}");
                eprintln!("         GitHub Desktop will run without GDP hooks.");
            }
        },
        None => {
            eprintln!("warning: could not detect inspector WS URL in time.");
            eprintln!("         GitHub Desktop will run without GDP hooks.");
        }
    }

    // Build runtime, register PID watcher, then run server (or block on watcher).
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("build tokio runtime");

    rt.block_on(async move {
        watch_pid_and_exit(pid);
        if !no_serve {
            serve::serve_async().await;
        } else {
            // Without serve, just sleep forever — the watcher will exit() when GD dies.
            loop {
                tokio::time::sleep(Duration::from_secs(3600)).await;
            }
        }
    });
}
