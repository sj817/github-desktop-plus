//! Cross-platform process helpers used by the launcher and daemon.
//!
//! Includes: process kill, daemonization, finding GitHub Desktop's `main.js`
//! and the real Electron binary, and parsing inspector WebSocket URLs.

use std::path::{Path, PathBuf};
use std::time::Duration;

/// Extract the full WebSocket debugger URL from a `Debugger listening on ws://...` line.
pub fn parse_debugger_ws_url(line: &str) -> Option<String> {
    let start = line.find("ws://")?;
    let rest = &line[start..];
    let end = rest
        .find(|c: char| c.is_ascii_whitespace())
        .unwrap_or(rest.len());
    let url = &rest[..end];
    if url.len() > "ws://".len() {
        Some(url.to_string())
    } else {
        None
    }
}

/// Synchronously read stderr of a child process, returning the first inspector
/// WS URL found, or `None` on timeout. The reader continues to drain in a
/// background thread so the pipe doesn't backpressure the child.
pub fn read_inspect_ws_url_sync(
    reader: impl std::io::Read + Send + 'static,
    timeout: Duration,
) -> Option<String> {
    use std::io::BufRead as _;
    let (tx, rx) = std::sync::mpsc::channel();
    let mut reader = std::io::BufReader::new(reader);

    std::thread::spawn(move || {
        let mut line = String::new();
        while let Ok(n) = reader.read_line(&mut line) {
            if n == 0 {
                break;
            }
            if let Some(url) = parse_debugger_ws_url(&line) {
                let _ = tx.send(url);
            }
            line.clear();
        }
    });

    rx.recv_timeout(timeout).ok()
}

/// Find the `resources/app/main.js` for a GitHub Desktop installation.
pub fn find_main_js(exe: &Path) -> Option<PathBuf> {
    let parent = exe.parent()?;

    let direct = parent.join("resources").join("app").join("main.js");
    if direct.exists() {
        return Some(direct);
    }

    if let Ok(entries) = std::fs::read_dir(parent) {
        let mut app_dirs: Vec<PathBuf> = entries
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_type().map(|t| t.is_dir()).unwrap_or(false)
                    && e.file_name()
                        .to_str()
                        .is_some_and(|n| n.starts_with("app-"))
            })
            .map(|e| e.path())
            .collect();
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

/// Given main.js path, find the real Electron binary inside the same `app-X.Y.Z` directory.
pub fn find_real_electron_exe(main_js: &Path) -> Option<PathBuf> {
    let mut p = main_js.parent()?;
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

/// Kill a process by PID. Returns true if the process was terminated.
#[cfg(windows)]
pub fn kill_process(pid: u32) -> bool {
    std::process::Command::new("taskkill")
        .args(["/F", "/T", "/PID", &pid.to_string()])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[cfg(unix)]
pub fn kill_process(pid: u32) -> bool {
    unsafe { libc::kill(pid as i32, libc::SIGTERM) == 0 }
}

#[cfg(not(any(windows, unix)))]
pub fn kill_process(_pid: u32) -> bool {
    false
}

/// Returns true if the process with the given PID is still alive.
#[cfg(windows)]
pub fn is_process_alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return false;
        }
        let mut code: u32 = 0;
        let ok = GetExitCodeProcess(h, &mut code as *mut u32);
        CloseHandle(h);
        ok != 0 && code as i32 == STILL_ACTIVE
    }
}

#[cfg(unix)]
pub fn is_process_alive(pid: u32) -> bool {
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

#[cfg(not(any(windows, unix)))]
pub fn is_process_alive(_pid: u32) -> bool {
    false
}

#[cfg(windows)]
pub fn daemonize_and_exit(no_serve: bool) {
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
pub fn daemonize_and_exit(_no_serve: bool) {
    unsafe {
        let pid = libc::fork();
        if pid < 0 {
            eprintln!("fork failed");
            std::process::exit(1);
        }
        if pid > 0 {
            std::process::exit(0);
        }
        libc::setsid();
        let pid2 = libc::fork();
        if pid2 < 0 {
            std::process::exit(1);
        }
        if pid2 > 0 {
            std::process::exit(0);
        }
    }
}

#[cfg(not(any(windows, unix)))]
pub fn daemonize_and_exit(_no_serve: bool) {}

/// Kill any running instances of GitHub Desktop before launching a new one.
/// Prevents port conflicts when `--inspect-brk=0` is used.
pub fn kill_github_desktop_if_running() {
    #[cfg(windows)]
    {
        let check = std::process::Command::new("tasklist")
            .args(["/FI", "IMAGENAME eq GitHubDesktop.exe", "/NH", "/FO", "CSV"])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output();

        let is_running = check
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.contains("GitHubDesktop.exe"))
            .unwrap_or(false);

        if is_running {
            eprintln!("info: GitHub Desktop is already running — terminating before launch …");
            let killed = std::process::Command::new("taskkill")
                .args(["/F", "/IM", "GitHubDesktop.exe"])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false);

            if killed {
                std::thread::sleep(std::time::Duration::from_millis(800));
                eprintln!("info: existing GitHub Desktop processes terminated.");
            } else {
                eprintln!("warning: could not terminate existing GitHub Desktop processes.");
            }
        }
    }

    #[cfg(unix)]
    {
        let _ = std::process::Command::new("pkill")
            .args(["-f", "GitHubDesktop"])
            .status();
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
}
