// GDP — single binary: CLI + embedded web server + interactive launcher
// Build-time embedded assets produced by build.rs and ui/ directory.

mod injector;
mod serve;

use clap::{Parser, Subcommand};
use gdp_core::{
    config::Config,
    detector::find_github_desktop,
    platform::{config_dir, github_desktop_candidates},
};
use std::io::{self, Write};
use std::path::PathBuf;

// ── Build-time embedded resources ────────────────────────────────────────────
// Hook & locale assets produced by build.rs from the repo's build/ and locales/ dirs.
pub const HOOK_JS: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/hook_bundle.js"));
pub const PRELOAD_INDEX_JS: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/preload_index.js"));
pub const PRELOAD_NAVBAR_JS: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/preload_navbar.js"));
pub const PRELOAD_UPDATE_INTERCEPTOR_JS: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/preload_update_interceptor.js"));
pub const LOCALE_ZH_CN: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/locale_zh_CN.json"));
pub const LOCALE_ZH_CN_MENU: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/locale_zh_CN_menu.json"));
pub const LOCALE_ZH_CN_UI: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/locale_zh_CN_ui.json"));

// ── Static UI assets (for `gdp serve`) ───────────────────────────────────────
const INDEX_HTML: &str = include_str!("../../../ui/index.html");
const APP_JS: &str = include_str!("../../../ui/app.js");
const STYLES_CSS: &str = include_str!("../../../ui/styles.css");

// ── CLI structure ─────────────────────────────────────────────────────────────

#[derive(Debug, Parser)]
#[command(
    name = "gdp",
    about = "GitHub Desktop Plus — Rust-first control plane",
    version
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Launch GitHub Desktop with GDP enhancements (default command)
    Launch {
        /// Force interactive path selection even when config already exists
        #[arg(short = 'f', long)]
        force: bool,
        /// Override the GitHub Desktop executable path
        #[arg(long)]
        desktop_path: Option<PathBuf>,
        /// Do not start the background web config server
        #[arg(long)]
        no_serve: bool,
    },
    /// Start the local config/status web UI on http://127.0.0.1:7788
    Serve,
    /// Stop a running GDP-launched GitHub Desktop instance
    Stop,
    /// Show the current runtime plan and architecture overview
    Status {
        #[arg(long)]
        json: bool,
    },
    /// Detect the GitHub Desktop installation path
    Detect,
    /// Configuration management
    Config {
        #[command(subcommand)]
        action: ConfigAction,
    },
    /// Debug mode: run in foreground with live log streaming (Ctrl+C to stop)
    Dev {
        /// Override the GitHub Desktop executable path
        #[arg(long)]
        desktop_path: Option<PathBuf>,
    },
}

#[derive(Debug, Subcommand)]
enum ConfigAction {
    /// Show current config
    Show {
        #[arg(long)]
        json: bool,
    },
    /// Reset config to defaults
    Reset,
    /// Print the config file path
    Path,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Extract the full WebSocket debugger URL from a `Debugger listening on ws://...` line.
///
/// Returns the `ws://...` URL as-is; it can be used directly with tungstenite.
fn parse_debugger_ws_url(line: &str) -> Option<String> {
    // The line looks like: "Debugger listening on ws://127.0.0.1:PORT/UUID"
    let start = line.find("ws://")?;
    // Take everything from "ws://" to the first whitespace (or end of string)
    let rest = &line[start..];
    let end = rest.find(|c: char| c.is_ascii_whitespace()).unwrap_or(rest.len());
    let url = &rest[..end];
    if url.len() > "ws://".len() { Some(url.to_string()) } else { None }
}

/// Blocking read of a process stderr stream: returns the first inspector WS URL
/// found in a `Debugger listening on ws://...` line, or `None` on timeout/error.
fn read_inspect_ws_url_sync(
    reader: impl std::io::Read,
    timeout: std::time::Duration,
) -> Option<String> {
    use std::io::BufRead as _;
    let deadline = std::time::Instant::now() + timeout;
    for line in std::io::BufReader::new(reader).lines() {
        if std::time::Instant::now() > deadline {
            break;
        }
        match line {
            Ok(text) => {
                if let Some(url) = parse_debugger_ws_url(&text) {
                    return Some(url);
                }
            }
            Err(_) => break,
        }
    }
    None
}

fn load_config() -> (Config, Option<PathBuf>) {
    let dir = config_dir();
    let cfg = dir
        .as_deref()
        .and_then(|d| Config::load(d).ok())
        .unwrap_or_default();
    (cfg, dir)
}

/// Returns true iff the config already has a resolvable desktop path set.
fn config_has_desktop(cfg: &Config) -> bool {
    cfg.desktop
        .path
        .as_ref()
        .map(|p| p.exists())
        .unwrap_or(false)
}

/// Interactive multi-choice prompt: present numbered candidates, read a line.
/// Returns the chosen PathBuf or exits 1 if nothing is found / user aborts.
fn interactive_select_desktop() -> PathBuf {
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

/// Write the hook JS bundle to a temp path and return it.
/// The file lives alongside the running executable as `gdp-hooks.js`.
fn extract_hook_to_disk() -> PathBuf {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| std::env::temp_dir());

    // Create the hook directory structure:
    //   <exe_dir>/gdp-data/
    //     hooks/
    //       index.js          (main hook bundle)
    //       preload/
    //         index.js        (renderer i18n preload)
    //     locales/
    //       zh-CN.json
    //       zh-CN/
    //         menu.json
    //         ui.json
    let data_dir = exe_dir.join("gdp-data");
    let hooks_dir = data_dir.join("hooks");
    let preload_dir = hooks_dir.join("preload");
    let locales_dir = data_dir.join("locales");
    let locale_sub = locales_dir.join("zh-CN");

    std::fs::create_dir_all(&preload_dir).expect("create hooks/preload dir");
    std::fs::create_dir_all(&locale_sub).expect("create locales/zh-CN dir");

    // Hook scripts — always keep up-to-date (user doesn't edit these)
    write_if_changed(&hooks_dir.join("index.js"), HOOK_JS);
    write_if_changed(&preload_dir.join("index.js"), PRELOAD_INDEX_JS);
    write_if_changed(&preload_dir.join("navbar.js"), PRELOAD_NAVBAR_JS);
    write_if_changed(
        &preload_dir.join("update-interceptor.js"),
        PRELOAD_UPDATE_INTERCEPTOR_JS,
    );

    // Locale files — only write on first run; preserve user edits made via WebUI
    write_if_missing(&locales_dir.join("zh-CN.json"), LOCALE_ZH_CN);
    write_if_missing(&locale_sub.join("menu.json"), LOCALE_ZH_CN_MENU);
    write_if_missing(&locale_sub.join("ui.json"), LOCALE_ZH_CN_UI);

    // Ensure hooks are loaded as CommonJS (prevents "type":"module" from parent package.json)
    write_if_changed(
        &data_dir.join("package.json"),
        b"{\"type\":\"commonjs\"}\n",
    );

    hooks_dir
}

fn write_if_changed(dest: &std::path::Path, content: &[u8]) {
    let needs_write = std::fs::read(dest)
        .map(|existing| existing != content)
        .unwrap_or(true);
    if needs_write {
        std::fs::write(dest, content).unwrap_or_else(|e| {
            panic!("write {}: {e}", dest.display())
        });
    }
}

/// Write only if the file does not yet exist — preserves user edits on subsequent runs.
fn write_if_missing(dest: &std::path::Path, content: &[u8]) {
    if !dest.exists() {
        std::fs::write(dest, content).unwrap_or_else(|e| {
            panic!("write {}: {e}", dest.display())
        });
    }
}

/// Given main.js path, find the real Electron binary (skips the Squirrel stub).
/// main.js lives at `.../app-X.Y.Z/resources/app/main.js`;
/// the Electron binary is `.../app-X.Y.Z/GitHubDesktop.exe`.
fn find_real_electron_exe(main_js: &std::path::Path) -> Option<PathBuf> {
    let mut p = main_js.parent()?; // …/resources/app → …/resources → …/app-X.Y.Z
    loop {
        if p.file_name()
            .and_then(|n| n.to_str())
            .map_or(false, |n| n.starts_with("app-"))
        {
            #[cfg(windows)]
            let exe_name = "GitHubDesktop.exe";
            #[cfg(not(windows))]
            let exe_name = "github-desktop";
            let candidate = p.join(exe_name);
            if candidate.exists() {
                return Some(candidate);
            }
        }
        p = p.parent()?;
    }
}

/// Format and print a single hook log line (JSONL) to stdout with ANSI colour.
fn format_hook_log(line: &str) {
    if let Ok(entry) = serde_json::from_str::<serde_json::Value>(line) {
        let level = entry.get("level").and_then(|v| v.as_str()).unwrap_or("info");
        let msg = entry
            .get("msg")
            .or_else(|| entry.get("message"))
            .and_then(|v| v.as_str())
            .unwrap_or(line);
        let module = entry
            .get("module")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let color = match level {
            "error" => "\x1b[31m",
            "warn" | "warning" => "\x1b[33m",
            "debug" => "\x1b[36m",
            _ => "\x1b[32m",
        };
        let mod_str = if module.is_empty() {
            String::new()
        } else {
            format!("({module}) ")
        };
        println!("{color}[{level}]\x1b[0m {mod_str}{msg}");
    } else {
        println!("\x1b[32m[hook]\x1b[0m {line}");
    }
}

/// Find the `resources/app/main.js` inside a GitHub Desktop installation.
/// Handles both Squirrel layout (exe + app-X.Y.Z/) and direct layout.
fn find_main_js(exe: &std::path::Path) -> Option<PathBuf> {
    let parent = exe.parent()?;

    // Direct check: <exe_dir>/resources/app/main.js
    let direct = parent.join("resources").join("app").join("main.js");
    if direct.exists() {
        return Some(direct);
    }

    // Squirrel layout: <exe_dir>/app-X.Y.Z/resources/app/main.js
    // Find the latest app-* directory by version sort
    if let Ok(entries) = std::fs::read_dir(parent) {
        let mut app_dirs: Vec<PathBuf> = entries
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_type().map(|t| t.is_dir()).unwrap_or(false)
                    && e.file_name().to_str().is_some_and(|n| n.starts_with("app-"))
            })
            .map(|e| e.path())
            .collect();
        // Sort descending to get the latest version first
        app_dirs.sort_by(|a, b| b.cmp(a));

        for dir in app_dirs {
            let candidate = dir.join("resources").join("app").join("main.js");
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }

    None
}

#[cfg(windows)]
fn daemonize_and_exit(no_serve: bool) {
    use std::os::windows::process::CommandExt;
    const DETACHED_PROCESS: u32 = 0x00000008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let exe = std::env::current_exe().expect("current_exe");
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    if no_serve && !args.iter().any(|a| a == "--no-serve") {
        args.push("--no-serve".to_string());
    }

    std::process::Command::new(&exe)
        .args(&args)
        .env("GDP_DAEMON", "1")
        .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW)
        .spawn()
        .expect("re-spawn as daemon");

    std::process::exit(0);
}

#[cfg(unix)]
fn daemonize_and_exit(_no_serve: bool) {
    unsafe {
        let pid = libc::fork();
        if pid < 0 { eprintln!("fork failed"); std::process::exit(1); }
        if pid > 0 { std::process::exit(0); }
        libc::setsid();
        let pid2 = libc::fork();
        if pid2 < 0 { std::process::exit(1); }
        if pid2 > 0 { std::process::exit(0); }
    }
}

#[cfg(not(any(windows, unix)))]
fn daemonize_and_exit(_no_serve: bool) {}

/// Kill a process by PID. Returns true if the process was terminated.
#[cfg(windows)]
fn kill_process(pid: u32) -> bool {
    // Use taskkill on Windows
    std::process::Command::new("taskkill")
        .args(["/F", "/T", "/PID", &pid.to_string()])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[cfg(unix)]
fn kill_process(pid: u32) -> bool {
    unsafe { libc::kill(pid as i32, libc::SIGTERM) == 0 }
}

#[cfg(not(any(windows, unix)))]
fn kill_process(_pid: u32) -> bool { false }

// ── Main ──────────────────────────────────────────────────────────────────────

fn main() {
    let cli = Cli::parse();

    match cli.command.unwrap_or(Command::Launch { force: false, desktop_path: None, no_serve: false }) {
        Command::Launch { force, desktop_path, no_serve } => {
            let already_daemon = std::env::var("GDP_DAEMON").is_ok();

            let (mut config, cfg_dir) = load_config();

            if let Some(p) = desktop_path {
                config.desktop.path = Some(p);
            }

            let needs_interactive = force || !config_has_desktop(&config);

            // Interactive selection — only in the foreground process (not daemon)
            if needs_interactive && !already_daemon {
                let chosen = interactive_select_desktop();
                config.desktop.path = Some(chosen.clone());

                if let Some(ref dir) = cfg_dir {
                    match config.save(dir) {
                        Ok(()) => println!(
                            "✓ Config saved to {}",
                            dir.join("config.json").display()
                        ),
                        Err(e) => eprintln!("warning: could not save config: {e}"),
                    }
                }
                println!();
            }

            // Extract all embedded resources (hooks, locales, preload) to disk
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

            // Locate main.js to find the real Electron binary (bypasses Squirrel stub).
            let main_js = find_main_js(&exe).unwrap_or_else(|| {
                eprintln!("error: main.js not found in GitHub Desktop installation");
                eprintln!("       Searched near: {}", exe.display());
                std::process::exit(1);
            });
            let real_exe = find_real_electron_exe(&main_js).unwrap_or_else(|| exe.clone());

            if !already_daemon {
                println!("┌─────────────────────────────────────────────┐");
                println!("│  GitHub Desktop Plus                        │");
                println!("├─────────────────────────────────────────────┤");
                println!("│  Desktop : {}",  real_exe.display());
                println!("│  Hooks   : 0-path (inspect-brk injection)");
                if !no_serve {
                    println!("│  WebUI   : http://127.0.0.1:7788");
                }
                println!("│  Config  : {}",
                    cfg_dir.as_ref()
                        .map(|d| d.join("config.json").display().to_string())
                        .unwrap_or_else(|| "(none)".into())
                );
                println!("└─────────────────────────────────────────────┘");
                println!();
                println!("Launching GitHub Desktop …");

                daemonize_and_exit(no_serve);
                // On Windows: parent exits here, child re-runs with GDP_DAEMON=1
                // On Unix:    daemon child falls through
            }

            // ── Daemon process: spawn GitHub Desktop with --inspect-brk ──
            let hook_config = serde_json::json!({
                "blockUpdates": config.updates.disabled,
                "blockManualUpdateCheck": config.updates.block_manual_check,
                "blockTelemetry": config.telemetry.disabled,
                "logLevel": config.logging.level,
                "enableI18n": config.i18n.enabled,
                "locale": config.i18n.locale,
                "dataDir": cfg_dir
                    .as_ref()
                    .map(|d| d.display().to_string())
                    .unwrap_or_default(),
            });
            let config_json = hook_config.to_string();

            let child = std::process::Command::new(&real_exe)
                // Use port 0 — OS assigns a free port; Electron prints it to stderr
                .arg("--inspect-brk=0")
                .env("GDP_CONFIG", &config_json)
                .env("GDP_HOOK_DIR", hooks_dir.to_str().unwrap_or_default())
                .stderr(std::process::Stdio::piped())
                .spawn();

            match child {
                Ok(mut c) => {
                    let pid = c.id();
                    let daemon_pid = std::process::id();
                    if let Some(ref dir) = cfg_dir {
                        let _ = std::fs::write(dir.join("gdp.pid"), pid.to_string());
                        let _ = std::fs::write(dir.join("gdp-daemon.pid"), daemon_pid.to_string());
                    }

                    // Read the full WS debugger URL from stderr before detaching
                    let ws_url = c.stderr.take().and_then(|stderr| {
                        read_inspect_ws_url_sync(stderr, std::time::Duration::from_secs(20))
                    });
                    drop(c);

                    // Inject hooks via V8 Inspector before the app runs
                    let hook_code = std::str::from_utf8(HOOK_JS).unwrap_or("");
                    match ws_url {
                        Some(ref url) => match injector::inject(
                            url,
                            hook_code,
                            std::time::Duration::from_secs(30),
                        ) {
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

                    // Start web server in daemon process
                    if !no_serve {
                        serve::run(INDEX_HTML, APP_JS, STYLES_CSS);
                    }
                }
                Err(e) => {
                    eprintln!("error: failed to launch GitHub Desktop: {e}");
                    std::process::exit(1);
                }
            }
        }

        Command::Serve => {
            serve::run(INDEX_HTML, APP_JS, STYLES_CSS);
        }

        Command::Stop => {
            let cfg_dir = config_dir();

            // Kill GitHub Desktop process
            let mut killed_any = false;
            if let Some(ref dir) = cfg_dir {
                let pid_path = dir.join("gdp.pid");
                if let Ok(s) = std::fs::read_to_string(&pid_path) {
                    if let Ok(pid) = s.trim().parse::<u32>() {
                        if kill_process(pid) {
                            println!("✓ Stopped GitHub Desktop (PID: {pid})");
                            killed_any = true;
                        } else {
                            println!("  GitHub Desktop (PID: {pid}) already exited");
                        }
                    }
                    let _ = std::fs::remove_file(&pid_path);
                }

                // Kill daemon (web server) process
                let daemon_path = dir.join("gdp-daemon.pid");
                if let Ok(s) = std::fs::read_to_string(&daemon_path) {
                    if let Ok(pid) = s.trim().parse::<u32>() {
                        if kill_process(pid) {
                            println!("✓ Stopped GDP daemon (PID: {pid})");
                            killed_any = true;
                        }
                    }
                    let _ = std::fs::remove_file(&daemon_path);
                }
            }

            if !killed_any {
                println!("No running GDP instance found.");
            }
        }

        Command::Status { json } => {
            let plan = gdp_core::runtime_plan();
            if json {
                println!("{}", serde_json::to_string_pretty(&plan).unwrap());
            } else {
                println!("memory target : < {}MB", plan.memory_target_mb);
                println!("runtime       : {}", plan.runtime);
                println!("cli boundary  : {}", plan.cli_boundary);
                println!("web boundary  : {}", plan.web_boundary);
                println!("ui strategy   : {}", plan.ui_strategy);
                println!("startup       : {}", plan.startup_priority);
                println!();
                for note in plan.notes {
                    println!("  - {note}");
                }
            }
        }

        Command::Detect => {
            match find_github_desktop() {
                Some(path) => println!("found: {}", path.display()),
                None => {
                    eprintln!("error: GitHub Desktop not found");
                    std::process::exit(1);
                }
            }
        }

        Command::Config { action } => match action {
            ConfigAction::Show { json } => {
                let (config, _) = load_config();
                if json {
                    println!("{}", serde_json::to_string_pretty(&config).unwrap());
                } else {
                    println!("updates.disabled           : {}", config.updates.disabled);
                    println!("updates.block_manual_check : {}", config.updates.block_manual_check);
                    println!("telemetry.disabled         : {}", config.telemetry.disabled);
                    println!("logging.level              : {}", config.logging.level);
                    println!("i18n.enabled               : {}", config.i18n.enabled);
                    println!("i18n.locale                : {}", config.i18n.locale);
                    println!(
                        "desktop.path               : {}",
                        config
                            .desktop
                            .path
                            .as_deref()
                            .map_or_else(|| "auto".to_string(), |p| p.display().to_string())
                    );
                }
            }
            ConfigAction::Reset => {
                let (_, dir) = load_config();
                match dir {
                    Some(d) => match Config::default().save(&d) {
                        Ok(()) => println!("config reset to {}", d.join("config.json").display()),
                        Err(e) => {
                            eprintln!("error: {e}");
                            std::process::exit(1);
                        }
                    },
                    None => {
                        eprintln!("error: cannot determine config directory");
                        std::process::exit(1);
                    }
                }
            }
            ConfigAction::Path => match config_dir() {
                Some(d) => println!("{}", d.join("config.json").display()),
                None => {
                    eprintln!("error: cannot determine config directory");
                    std::process::exit(1);
                }
            },
        },

        // ── Dev mode: foreground launch with live log streaming ───────────────
        Command::Dev { desktop_path } => {
            let (mut config, cfg_dir) = load_config();
            if let Some(p) = desktop_path {
                config.desktop.path = Some(p);
            }

            if !config_has_desktop(&config) {
                let chosen = interactive_select_desktop();
                config.desktop.path = Some(chosen);
                if let Some(ref dir) = cfg_dir {
                    let _ = config.save(dir);
                }
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
                    std::process::exit(1);
                });

            let main_js = find_main_js(&exe).unwrap_or_else(|| {
                eprintln!("error: main.js not found in GitHub Desktop installation");
                std::process::exit(1);
            });

            // In dev mode launch the real Electron binary directly so we can
            // pipe its stdout/stderr and wait() for the actual process exit.
            let real_exe = find_real_electron_exe(&main_js).unwrap_or_else(|| exe.clone());

            let hook_config = serde_json::json!({
                "blockUpdates": config.updates.disabled,
                "blockManualUpdateCheck": config.updates.block_manual_check,
                "blockTelemetry": config.telemetry.disabled,
                "logLevel": "debug",          // always verbose in dev mode
                "enableI18n": config.i18n.enabled,
                "locale": config.i18n.locale,
                "dataDir": cfg_dir
                    .as_ref()
                    .map(|d| d.display().to_string())
                    .unwrap_or_default(),
            });
            let config_json = hook_config.to_string();

            // Clear old hook log so we start fresh
            let log_file = std::env::temp_dir().join("gdp-hooks-stream.jsonl");
            let _ = std::fs::write(&log_file, b"");

            println!("┌─────────────────────────────────────────────┐");
            println!("│  GitHub Desktop Plus  —  DEV MODE           │");
            println!("├─────────────────────────────────────────────┤");
            println!("│  Electron : {}", real_exe.display());
            println!("│  Hooks    : 0-path (inspect-brk injection)");
            println!("│  WebUI    : http://127.0.0.1:7788           │");
            println!("│  Hook log : {}",  log_file.display());
            println!("│  Press Ctrl+C to stop                       │");
            println!("└─────────────────────────────────────────────┘");
            println!();

            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("build tokio runtime");

            rt.block_on(async move {

                let mut gd = tokio::process::Command::new(&real_exe)
                    // Use port 0 — OS assigns a free port; parse actual port from stderr
                    .arg("--inspect-brk=0")
                    .env("GDP_CONFIG", &config_json)
                    .env("GDP_HOOK_DIR", hooks_dir.to_str().unwrap_or_default())
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped())
                    .kill_on_drop(true)
                    .spawn()
                    .unwrap_or_else(|e| {
                        eprintln!("error: failed to spawn GitHub Desktop: {e}");
                        std::process::exit(1);
                    });

                // ── Relay stderr + extract inspector port via oneshot ─────────
                let stderr = gd.stderr.take().expect("piped stderr");
                let (url_tx, url_rx) = tokio::sync::oneshot::channel::<String>();
                tokio::spawn(async move {
                    use tokio::io::AsyncBufReadExt as _;
                    let mut lines = tokio::io::BufReader::new(stderr).lines();
                    let mut url_tx_opt = Some(url_tx); // wrap in Option so we can .take() once
                    while let Ok(Some(line)) = lines.next_line().await {
                        if let Some(url) = parse_debugger_ws_url(&line) {
                            if let Some(tx) = url_tx_opt.take() {
                                let _ = tx.send(url);
                            }
                        }
                        if !line.trim().is_empty() {
                            eprintln!("\x1b[33m[gd:err]\x1b[0m {line}");
                        }
                    }
                });

                // Wait for the WS URL before injecting (timeout = 20 s)
                let inspect_ws_url = match tokio::time::timeout(
                    std::time::Duration::from_secs(20),
                    url_rx,
                ).await {
                    Ok(Ok(url)) => Some(url),
                    _ => {
                        eprintln!("\x1b[31m[GDP]\x1b[0m Inspector WS URL not found — hooks not injected");
                        None
                    }
                };

                // Inject hooks via V8 Inspector (blocking, done in spawn_blocking)
                if let Some(ws_url) = inspect_ws_url {
                    let hook_code = std::str::from_utf8(HOOK_JS).unwrap_or("").to_string();
                    let inject_result = tokio::task::spawn_blocking(move || {
                        injector::inject(
                            &ws_url,
                            &hook_code,
                            std::time::Duration::from_secs(30),
                        )
                    }).await;

                    match inject_result {
                        Ok(Ok(())) => println!("\x1b[36m[GDP]\x1b[0m Hooks injected successfully"),
                        Ok(Err(e)) => eprintln!("\x1b[31m[GDP]\x1b[0m Hook injection failed: {e}"),
                        Err(e) => eprintln!("\x1b[31m[GDP]\x1b[0m Hook injection task panicked: {e}"),
                    }
                }

                // Save real GD PID for emergency `gdp stop`
                if let Some(pid) = gd.id() {
                    if let Some(ref dir) = cfg_dir {
                        let _ = std::fs::write(dir.join("gdp.pid"), pid.to_string());
                    }
                }

                // ── Relay GD stdout ───────────────────────────────────────────
                if let Some(stdout) = gd.stdout.take() {
                    tokio::spawn(async move {
                        use tokio::io::AsyncBufReadExt as _;
                        let mut lines = tokio::io::BufReader::new(stdout).lines();
                        while let Ok(Some(line)) = lines.next_line().await {
                            if !line.trim().is_empty() {
                                println!("\x1b[90m[gd:out]\x1b[0m {line}");
                            }
                        }
                    });
                }

                // NOTE: stderr is already being relayed by the port-discovery task above.

                // ── Tail hook JSONL log ───────────────────────────────────────
                let log_file_clone = log_file.clone();
                tokio::spawn(async move {
                    let mut pos: u64 = 0;
                    loop {
                        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
                        match tokio::fs::read(&log_file_clone).await {
                            Ok(bytes) if bytes.len() as u64 > pos => {
                                if let Ok(s) = std::str::from_utf8(&bytes[pos as usize..]) {
                                    for line in s.lines() {
                                        if !line.is_empty() {
                                            format_hook_log(line);
                                        }
                                    }
                                }
                                pos = bytes.len() as u64;
                            }
                            _ => {}
                        }
                    }
                });

                // ── Web UI server (background task in same runtime) ───────────
                tokio::spawn(serve::serve_async(INDEX_HTML, APP_JS, STYLES_CSS));

                // ── Wait for GD exit OR Ctrl+C ────────────────────────────────
                tokio::select! {
                    result = gd.wait() => {
                        match result {
                            Ok(s) => println!("\x1b[36m[GDP]\x1b[0m GitHub Desktop exited: {s}"),
                            Err(e) => eprintln!("[GDP] wait error: {e}"),
                        }
                    }
                    _ = tokio::signal::ctrl_c() => {
                        println!("\n\x1b[36m[GDP]\x1b[0m Ctrl+C — stopping GitHub Desktop…");
                        let _ = gd.kill().await;
                        let _ = gd.wait().await;
                    }
                }

                // ── Cleanup ───────────────────────────────────────────────────
                if let Some(ref dir) = cfg_dir {
                    let _ = std::fs::remove_file(dir.join("gdp.pid"));
                }
                println!("\x1b[36m[GDP]\x1b[0m Done.");
            });
        }
    }
}