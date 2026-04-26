//! `gdp open` — read the auth token written at startup and open the WebUI.

use gdp_core::platform::config_dir;

pub fn run() {
    let dir = match config_dir() {
        Some(d) => d,
        None => {
            eprintln!("error: cannot determine config directory");
            std::process::exit(1);
        }
    };
    let token_path = dir.join("gdp-token");
    let token = match std::fs::read_to_string(&token_path) {
        Ok(s) => s.trim().to_string(),
        Err(_) => {
            eprintln!(
                "error: GDP not running (no token file at {})",
                token_path.display()
            );
            eprintln!("       Start it with `gdp launch` first.");
            std::process::exit(1);
        }
    };

    let url = format!("http://127.0.0.1:7788/?t={token}");
    println!("{url}");

    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("cmd")
        .args(["/c", "start", "", &url])
        .spawn();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(&url).spawn();
    #[cfg(not(any(target_os = "windows", target_os = "macos", unix)))]
    let result: std::io::Result<std::process::Child> =
        Err(std::io::Error::other("unsupported platform"));

    if let Err(e) = result {
        eprintln!("warning: could not launch browser: {e}");
        eprintln!("         Open the URL manually: {url}");
    }
}
