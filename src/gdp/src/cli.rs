//! Command-line interface definitions for the `gdp` binary.
//!
//! The `Cli` struct is the top-level clap parser; subcommands are dispatched
//! from `main.rs` to handler functions in the relevant modules.

use std::path::PathBuf;

use clap::{Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(
    name = "gdp",
    about = "GitHub Desktop Plus — Rust-first control plane",
    version
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Command>,
}

#[derive(Debug, Subcommand)]
pub enum Command {
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
    /// Open the local WebUI in the default browser
    Open,
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
pub enum ConfigAction {
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
