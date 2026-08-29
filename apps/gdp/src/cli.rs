//! Command-line interface definitions for the `gdp` binary.

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
    },
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

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[test]
    fn no_subcommand_parses_to_none() {
        let cli = Cli::parse_from(["gdp"]);
        assert!(cli.command.is_none());
    }

    #[test]
    fn launch_flags_round_trip() {
        let cli = Cli::parse_from(["gdp", "launch", "-f"]);
        match cli.command {
            Some(Command::Launch {
                force,
                desktop_path,
            }) => {
                assert!(force);
                assert!(desktop_path.is_none());
            }
            _ => panic!("expected Launch"),
        }
    }

    #[test]
    fn config_show_subcommand() {
        let cli = Cli::parse_from(["gdp", "config", "show", "--json"]);
        match cli.command {
            Some(Command::Config {
                action: ConfigAction::Show { json },
            }) => assert!(json),
            _ => panic!("expected config show --json"),
        }
    }

    #[test]
    fn config_path_and_reset_subcommands() {
        let p = Cli::parse_from(["gdp", "config", "path"]);
        assert!(matches!(
            p.command,
            Some(Command::Config {
                action: ConfigAction::Path
            })
        ));
        let r = Cli::parse_from(["gdp", "config", "reset"]);
        assert!(matches!(
            r.command,
            Some(Command::Config {
                action: ConfigAction::Reset
            })
        ));
    }

    #[test]
    fn detect_stop_dev_parse() {
        for sub in ["detect", "stop"] {
            let cli = Cli::parse_from(["gdp", sub]);
            assert!(cli.command.is_some(), "{sub} should parse");
        }
        let dev = Cli::parse_from(["gdp", "dev"]);
        assert!(matches!(dev.command, Some(Command::Dev { .. })));
    }

    #[test]
    fn unknown_subcommand_is_error() {
        let res = Cli::try_parse_from(["gdp", "definitely-not-a-command"]);
        assert!(res.is_err());
    }
}
