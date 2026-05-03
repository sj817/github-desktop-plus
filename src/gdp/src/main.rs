//! GDP — single binary: CLI + embedded web server + interactive launcher.
//!
//! See `cli.rs` for the command surface; each subcommand has its own module.

mod auth;
mod cli;
mod hook_assets;
mod http_helpers;
mod injector;
mod launch;
mod locale;
mod locale_seed;
mod open;
mod proc;
mod serve;
mod sse;
mod state;
mod static_assets;

use clap::Parser;
use gdp_core::{config::Config, detector::find_github_desktop, platform::config_dir};

use crate::cli::{Cli, Command, ConfigAction};
use crate::launch::load_config;
use crate::proc::kill_process;

fn main() {
    let cli = Cli::parse();

    let cmd = cli.command.unwrap_or(Command::Launch {
        force: false,
        desktop_path: None,
        no_serve: false,
    });

    match cmd {
        Command::Launch {
            force,
            desktop_path,
            no_serve,
        } => {
            launch::run(force, desktop_path, no_serve, false);
        }
        Command::Serve => {
            serve::run();
        }
        Command::Open => {
            open::run();
        }
        Command::Stop => stop(),
        Command::Status { json } => status(json),
        Command::Detect => detect(),
        Command::Config { action } => config(action),
        Command::Dev { desktop_path } => {
            // Backwards-compatible alias for `launch` that runs in the foreground.
            unsafe {
                std::env::set_var("GDP_VERBOSE", "1");
            }
            launch::run(false, desktop_path, false, true);
        }
    }
}

fn stop() {
    let cfg_dir = config_dir();
    let mut killed_any = false;
    if let Some(ref dir) = cfg_dir {
        for (label, file) in [
            ("GitHub Desktop", "gdp.pid"),
            ("GDP daemon", "gdp-daemon.pid"),
        ] {
            let pid_path = dir.join(file);
            if let Ok(s) = std::fs::read_to_string(&pid_path) {
                if let Ok(pid) = s.trim().parse::<u32>() {
                    if kill_process(pid) {
                        println!("✓ Stopped {label} (PID: {pid})");
                        killed_any = true;
                    } else {
                        println!("  {label} (PID: {pid}) already exited");
                    }
                }
                let _ = std::fs::remove_file(&pid_path);
            }
        }
    }
    if !killed_any {
        println!("No running GDP instance found.");
    }
}

fn status(json: bool) {
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

fn detect() {
    match find_github_desktop() {
        Some(path) => println!("found: {}", path.display()),
        None => {
            eprintln!("error: GitHub Desktop not found");
            std::process::exit(1);
        }
    }
}

fn config(action: ConfigAction) {
    match action {
        ConfigAction::Show { json } => {
            let (config, _) = load_config();
            if json {
                println!("{}", serde_json::to_string_pretty(&config).unwrap());
            } else {
                println!("updates.disabled           : {}", config.updates.disabled);
                println!(
                    "updates.block_manual_check : {}",
                    config.updates.block_manual_check
                );
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
    }
}
