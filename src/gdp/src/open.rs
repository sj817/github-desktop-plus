//! `gdp open` — print the authenticated local control URL.

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

    eprintln!("Open this URL only for debugging. Normal use is through the GDP menu popup.");
}
