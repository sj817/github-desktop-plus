//! GDP — single binary: CLI launcher + V8 Inspector hook injection.

mod cli;
mod data_guard;
mod hook_assets;
mod injector;
mod launch;
mod proc;

use clap::Parser;
use gdp_core::{
    config::Config, desktop_data::LaunchRecord, detector::find_github_desktop, platform::config_dir,
};

use crate::cli::{Cli, Command, ConfigAction};
use crate::launch::{installed_desktop_version, load_config};
use crate::proc::{CLOSE_GRACE, kill_process, stop_process};

fn main() {
    // Velopack uses short-lived invocations of the main executable for install,
    // update, and uninstall hooks. Handle those before clap sees the arguments.
    #[cfg(windows)]
    velopack::VelopackApp::build().run();

    let cli = Cli::parse();

    let cmd = cli.command.unwrap_or(Command::Launch {
        force: false,
        desktop_path: None,
        allow_downgrade: false,
    });

    match cmd {
        Command::Launch {
            force,
            desktop_path,
            allow_downgrade,
        } => {
            launch::run(force, desktop_path, false, allow_downgrade);
        }
        Command::Stop => stop(),
        Command::Status { json } => status(json),
        Command::Detect => detect(),
        Command::Config { action } => config(action),
        Command::Dev {
            desktop_path,
            allow_downgrade,
        } => {
            unsafe {
                std::env::set_var("GDP_VERBOSE", "1");
            }
            launch::run(false, desktop_path, true, allow_downgrade);
        }
        Command::Backup { action } => data_guard::run_backup(action, installed_desktop_version()),
    }
}

fn stop() {
    let cfg_dir = config_dir();
    let mut killed_any = false;
    if let Some(ref dir) = cfg_dir {
        // GitHub Desktop is asked to close and given time to finish whatever
        // git is doing (see proc::stop_process); the daemon is our own idle
        // watcher, so a plain kill is fine there.
        for (label, file, graceful) in [
            ("GitHub Desktop", "gdp.pid", true),
            ("GDP daemon", "gdp-daemon.pid", false),
        ] {
            let pid_path = dir.join(file);
            if let Ok(s) = std::fs::read_to_string(&pid_path) {
                if let Ok(pid) = s.trim().parse::<u32>() {
                    let stopped = if graceful {
                        stop_process(pid, CLOSE_GRACE)
                    } else {
                        kill_process(pid)
                    };
                    if stopped {
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
    // Every source the downgrade guard weighs, for diagnosing a refused launch.
    let show = |v: Option<gdp_core::detector::Version>| v.map_or("-".into(), |v| v.to_string());
    let record = config_dir()
        .as_deref()
        .map(LaunchRecord::load)
        .unwrap_or_default();
    let evidence = data_guard::gather_evidence(true, &record);
    println!("launch target  : {}", show(installed_desktop_version()));
    println!("registry       : {}", show(evidence.registry));
    println!("desktop logs   : {}", show(evidence.logged));
    println!("gdp record     : {}", show(evidence.recorded));
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
                println!("ai.enabled                 : {}", config.ai.enabled);
                println!("ai.base_url                : {}", config.ai.base_url);
                println!("ai.model                   : {}", config.ai.model);
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
