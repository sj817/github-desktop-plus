//! `gdp launch` (and the legacy `gdp dev`) implementation.

use std::ffi::{OsStr, OsString};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use gdp_core::{
    config::Config,
    detector::find_github_desktop,
    platform::{config_dir, github_desktop_candidates},
};

use crate::hook_assets::{HOOK_JS, extract_hook_to_disk};
use crate::injector;
use crate::proc::{
    daemonize_and_exit, find_main_js, find_real_electron_exe, is_process_alive,
    kill_github_desktop_if_running, kill_process, read_inspect_ws_url_sync,
};

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

/// Check PID file for an existing daemon; prompt to kill if still alive.
fn ensure_single_instance(cfg_dir: Option<&PathBuf>) {
    let daemon_pid = cfg_dir
        .and_then(|d| std::fs::read_to_string(d.join("gdp-daemon.pid")).ok())
        .and_then(|s| s.trim().parse::<u32>().ok());

    if let Some(pid) = daemon_pid {
        if is_process_alive(pid) {
            if !ask_kill_existing(Some(pid)) {
                eprintln!("Aborted by user.");
                std::process::exit(0);
            }
            kill_process(pid);
            std::thread::sleep(Duration::from_secs(2));
        }
    }
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

fn announce_and_maybe_daemonize(target: &DesktopTarget, foreground: bool) {
    println!(
        "GitHub Desktop Plus  |  desktop: {}",
        target.real_exe.display(),
    );

    if !foreground {
        daemonize_and_exit();
    }
}

fn build_hook_config(config: &Config, hooks_dir: &Path) -> String {
    let runtime_data_dir = hooks_dir
        .parent()
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    let runtime_config_dir = config_dir()
        .map(|p| p.display().to_string())
        .unwrap_or_default();

    serde_json::json!({
        "blockUpdates": config.updates.disabled,
        "blockManualUpdateCheck": config.updates.block_manual_check,
        "blockTelemetry": config.telemetry.disabled,
        "logLevel": config.logging.level,
        "enableI18n": config.i18n.enabled,
        "locale": config.i18n.locale,
        "dataDir": runtime_data_dir,
        "configDir": runtime_config_dir,
        "recentReposLimit": config.ui.recent_repos_limit,
        "ai": {
            "enabled": config.ai.enabled,
            "baseUrl": config.ai.base_url,
            "model": config.ai.model,
            "systemPrompt": config.ai.system_prompt,
            "timeoutSecs": config.ai.timeout_secs,
            "fallbackToCopilot": config.ai.fallback_to_copilot,
        },
    })
    .to_string()
}

const ALWAYS_PRIVATE_ENVIRONMENT: &[&str] = &["GDP_DAEMON", "NO_COLOR"];

const CODEX_PRIVATE_ENVIRONMENT: &[&str] = &[
    "CARGO_NET_OFFLINE",
    "DISABLE_AUTO_UPDATE",
    "GH_PAGER",
    "GIT_ALLOW_PROTOCOLS",
    "GIT_PAGER",
    "GIT_SSH_COMMAND",
    "LESS",
    "LOG_FORMAT",
    "NODE_REPL_TRUSTED_BROWSER_CLIENT_SHA256S",
    "NPM_CONFIG_OFFLINE",
    "PAGER",
    "PIP_NO_INDEX",
    "RUST_LOG",
    "SBX_NONET_ACTIVE",
    "ZSH_TMUX_AUTOSTART",
    "ZSH_TMUX_AUTOSTARTED",
];

#[cfg(windows)]
const PLATFORM_PRIVATE_ENVIRONMENT: &[&str] =
    &["COLORTERM", "LANG", "LC_ALL", "LC_CTYPE", "SHELL", "TERM"];

#[cfg(not(windows))]
const PLATFORM_PRIVATE_ENVIRONMENT: &[&str] = &[];

fn same_environment_key(left: &OsStr, right: &str) -> bool {
    left.to_string_lossy().eq_ignore_ascii_case(right)
}

/// GitHub Desktop becomes the parent of user-facing terminals. Preserve the
/// normal OS/user environment, but do not leak GDP daemon state or transient
/// Codex automation controls into those terminals.
fn sanitize_desktop_environment(
    command: &mut Command,
    inherited: impl IntoIterator<Item = (OsString, OsString)>,
) {
    let inherited: Vec<_> = inherited.into_iter().collect();
    let launched_from_codex = inherited
        .iter()
        .any(|(key, _)| same_environment_key(key, "CODEX_SESSION_ID"));

    for key in ALWAYS_PRIVATE_ENVIRONMENT {
        command.env_remove(key);
    }

    if !launched_from_codex {
        return;
    }

    for (key, _) in inherited {
        let private = key
            .to_string_lossy()
            .to_ascii_uppercase()
            .starts_with("CODEX_")
            || CODEX_PRIVATE_ENVIRONMENT
                .iter()
                .any(|candidate| same_environment_key(&key, candidate))
            || PLATFORM_PRIVATE_ENVIRONMENT
                .iter()
                .any(|candidate| same_environment_key(&key, candidate));
        if private {
            command.env_remove(key);
        }
    }
}

fn spawn_desktop(target: &DesktopTarget, hooks_dir: &Path, config_json: &str) -> Child {
    let mut command = Command::new(&target.real_exe);
    command.arg("--inspect-brk=0");
    sanitize_desktop_environment(&mut command, std::env::vars_os());

    // Opt-in renderer DevTools endpoint, for debugging hooks that patch the
    // page (the main-process inspector above cannot reach the renderer).
    if let Ok(port) = std::env::var("GDP_REMOTE_DEBUG_PORT") {
        command.arg(format!("--remote-debugging-port={port}"));
    }

    command
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

#[cfg(test)]
mod tests {
    use super::*;

    fn command_env<'a>(command: &'a Command, key: &str) -> Option<Option<&'a OsStr>> {
        command
            .get_envs()
            .find(|(candidate, _)| candidate == &OsStr::new(key))
            .map(|(_, value)| value)
    }

    #[test]
    fn desktop_process_does_not_inherit_codex_automation_environment() {
        let mut command = Command::new("unused");
        let inherited = [
            ("CODEX_SESSION_ID", "session"),
            ("CODEX_APP_TOOLS_PIPE_PATH", "private-pipe"),
            ("NO_COLOR", "1"),
            ("TERM", "dumb"),
            ("GH_PAGER", "cat"),
            ("GIT_SSH_COMMAND", "cmd /c exit 1"),
            ("HTTP_PROXY", "http://user-proxy.example"),
            ("PATH", "C:\\Windows"),
        ];
        for (key, value) in inherited {
            command.env(key, value);
        }

        sanitize_desktop_environment(
            &mut command,
            inherited.map(|(key, value)| (OsString::from(key), OsString::from(value))),
        );

        assert_eq!(command_env(&command, "NO_COLOR"), Some(None));
        #[cfg(windows)]
        assert_eq!(command_env(&command, "TERM"), Some(None));
        #[cfg(not(windows))]
        assert_eq!(
            command_env(&command, "TERM"),
            Some(Some(OsStr::new("dumb")))
        );
        assert_eq!(command_env(&command, "CODEX_SESSION_ID"), Some(None));
        assert_eq!(
            command_env(&command, "CODEX_APP_TOOLS_PIPE_PATH"),
            Some(None)
        );
        assert_eq!(command_env(&command, "GH_PAGER"), Some(None));
        assert_eq!(command_env(&command, "GIT_SSH_COMMAND"), Some(None));
        assert_eq!(
            command_env(&command, "HTTP_PROXY"),
            Some(Some(OsStr::new("http://user-proxy.example")))
        );
        assert_eq!(
            command_env(&command, "PATH"),
            Some(Some(OsStr::new("C:\\Windows")))
        );
    }

    #[test]
    fn desktop_process_always_drops_gdp_daemon_state_and_no_color() {
        let mut command = Command::new("unused");
        command.env("GDP_DAEMON", "1").env("NO_COLOR", "1");

        sanitize_desktop_environment(&mut command, []);

        assert_eq!(command_env(&command, "GDP_DAEMON"), Some(None));
        assert_eq!(command_env(&command, "NO_COLOR"), Some(None));
    }
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
        Some(ref url) => {
            if std::env::var_os("GDP_VERBOSE").is_some() {
                eprintln!("[gdp] Inspector ready: {url}");
            }
            match injector::inject(url, hook_code, Duration::from_secs(30)) {
                Ok(()) => {}
                Err(e) => {
                    eprintln!("warning: hook injection failed: {e}");
                    eprintln!("         GitHub Desktop will run without GDP hooks.");
                }
            }
        }
        None => {
            eprintln!("warning: could not detect inspector WS URL in time.");
            eprintln!("         GitHub Desktop will run without GDP hooks.");
        }
    }
}

/// Block until the given PID exits, then terminate this process.
fn watch_pid_until_exit(pid: u32) {
    loop {
        std::thread::sleep(Duration::from_secs(2));
        if !is_process_alive(pid) {
            eprintln!("[gdp] GitHub Desktop process {pid} exited — shutting down daemon.");
            std::process::exit(0);
        }
    }
}

/// Implementation of `gdp launch`.
pub fn run(force: bool, desktop_path: Option<PathBuf>, foreground: bool) {
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
        announce_and_maybe_daemonize(&target, foreground);
    }

    kill_github_desktop_if_running();

    let config_json = build_hook_config(&config, &hooks_dir);
    let mut child = spawn_desktop(&target, &hooks_dir, &config_json);
    let pid = child.id();
    write_pid_files(cfg_dir.as_ref(), pid);
    inject_hooks(&mut child);

    std::mem::forget(child);

    watch_pid_until_exit(pid);
}
