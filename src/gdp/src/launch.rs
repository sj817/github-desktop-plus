//! `gdp launch` (and the legacy `gdp dev`) implementation.
//!
//! Responsibilities:
//!   - Resolve the GitHub Desktop binary (interactive picker on first run).
//!   - Acquire a single-instance lock on `127.0.0.1:7788`.
//!   - Daemonize on Windows; keep PID files in the config dir.
//!   - Spawn GitHub Desktop with `--inspect-brk=0`, capture its WS URL,
//!     inject the GDP hook bundle, then watch its PID and exit when it dies.

use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Stdio};
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
use crate::{auth, injector, serve};

const SINGLE_INSTANCE_PORT: u16 = 7788;

struct DesktopTarget {
    real_exe: PathBuf,
}

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

fn apply_desktop_override(config: &mut Config, desktop_path: Option<PathBuf>) {
    if let Some(path) = desktop_path {
        config.desktop.path = Some(path);
    }
}

fn maybe_prompt_desktop(config: &mut Config, cfg_dir: Option<&PathBuf>, force: bool) {
    if !(force || !config_has_desktop(config)) {
        return;
    }

    let chosen = interactive_select_desktop();
    config.desktop.path = Some(chosen);
    if let Some(dir) = cfg_dir {
        match config.save(dir) {
            Ok(()) => println!("✓ Config saved to {}", dir.join("config.json").display()),
            Err(e) => eprintln!("warning: could not save config: {e}"),
        }
    }
    println!();
}

fn resolve_desktop_target(config: &Config) -> DesktopTarget {
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

    DesktopTarget { real_exe }
}

fn announce_and_maybe_daemonize(target: &DesktopTarget, no_serve: bool, foreground: bool) {
    println!(
        "GitHub Desktop Plus  |  desktop: {}  |  control: {}",
        target.real_exe.display(),
        if no_serve {
            "(disabled)"
        } else {
            "GDP menu popup"
        }
    );

    if !foreground {
        daemonize_and_exit(no_serve);
    }
}

fn write_auth_token(cfg_dir: Option<&PathBuf>) -> String {
    let auth_token = auth::generate_token();
    if let Some(dir) = cfg_dir {
        if let Err(e) = auth::write_token_file(dir, &auth_token) {
            eprintln!("warning: cannot write token file: {e}");
        }
    }
    auth_token
}

fn build_hook_config(config: &Config, hooks_dir: &Path, auth_token: &str) -> String {
    let runtime_data_dir = hooks_dir
        .parent()
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    let runtime_config_dir = config_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    let control_origin =
        std::env::var("GDP_CONTROL_ORIGIN").unwrap_or_else(|_| "http://127.0.0.1:7788".to_string());

    serde_json::json!({
        "blockUpdates": config.updates.disabled,
        "blockManualUpdateCheck": config.updates.block_manual_check,
        "blockTelemetry": config.telemetry.disabled,
        "logLevel": config.logging.level,
        "enableI18n": config.i18n.enabled,
        "locale": config.i18n.locale,
        "dataDir": runtime_data_dir,
        "configDir": runtime_config_dir,
        "authToken": auth_token,
        "controlOrigin": control_origin,
        "recentReposLimit": config.ui.recent_repos_limit,
    })
    .to_string()
}

fn spawn_desktop(target: &DesktopTarget, hooks_dir: &Path, config_json: &str) -> Child {
    std::process::Command::new(&target.real_exe)
        .arg("--inspect-brk=0")
        .env("GDP_CONFIG", config_json)
        .env("GDP_HOOK_DIR", hooks_dir.to_str().unwrap_or_default())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap_or_else(|e| {
            eprintln!("error: failed to launch GitHub Desktop: {e}");
            std::process::exit(1);
        })
}

fn write_pid_files(cfg_dir: Option<&PathBuf>, desktop_pid: u32) {
    if let Some(dir) = cfg_dir {
        let _ = std::fs::write(dir.join("gdp.pid"), desktop_pid.to_string());
        let _ = std::fs::write(dir.join("gdp-daemon.pid"), std::process::id().to_string());
    }
}

fn inject_hooks(child: &mut Child) {
    let ws_url = child
        .stderr
        .take()
        .and_then(|stderr| read_inspect_ws_url_sync(stderr, Duration::from_secs(20)));
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
}

fn run_daemon_loop(pid: u32, no_serve: bool, auth_token: String) {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("build tokio runtime");

    rt.block_on(async move {
        watch_pid_and_exit(pid);
        if !no_serve {
            serve::serve_async_with_token(Some(auth_token)).await;
        } else {
            loop {
                tokio::time::sleep(Duration::from_secs(3600)).await;
            }
        }
    });
}

/// Implementation of `gdp launch`.
pub fn run(force: bool, desktop_path: Option<PathBuf>, no_serve: bool, foreground: bool) {
    let already_daemon = std::env::var("GDP_DAEMON").is_ok();
    let (mut config, cfg_dir) = load_config();

    apply_desktop_override(&mut config, desktop_path);

    if !already_daemon {
        maybe_prompt_desktop(&mut config, cfg_dir.as_ref(), force);
        ensure_single_instance(cfg_dir.as_ref());
    }

    let hooks_dir = extract_hook_to_disk();
    let target = resolve_desktop_target(&config);

    if !already_daemon {
        announce_and_maybe_daemonize(&target, no_serve, foreground);
    }

    kill_github_desktop_if_running();

    let auth_token = write_auth_token(cfg_dir.as_ref());
    let config_json = build_hook_config(&config, &hooks_dir, &auth_token);
    let mut child = spawn_desktop(&target, &hooks_dir, &config_json);
    let pid = child.id();
    write_pid_files(cfg_dir.as_ref(), pid);
    inject_hooks(&mut child);

    // Keep `child` alive (so the OS handle stays open), but we no longer need direct stdio.
    // We track the PID instead of the Child handle from here on.
    std::mem::forget(child);

    run_daemon_loop(pid, no_serve, auth_token);
}
