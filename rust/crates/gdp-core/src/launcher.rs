use crate::{config::Config, detector::find_github_desktop};
use std::path::{Path, PathBuf};

/// Outcome of a successful launch.
#[derive(Debug)]
pub struct LaunchResult {
    /// OS process ID of the spawned GitHub Desktop process.
    pub pid: u32,
    /// The executable path that was used.
    pub executable: PathBuf,
}

/// Errors that can occur during launch.
#[derive(Debug)]
pub enum LaunchError {
    /// No GitHub Desktop installation could be located automatically or via config.
    DesktopNotFound,
    /// The GDP hook script (`index.js`) was not found at the expected location.
    HookNotFound(PathBuf),
    /// The OS refused to spawn the process.
    Spawn(std::io::Error),
}

impl std::fmt::Display for LaunchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LaunchError::DesktopNotFound => {
                write!(f, "GitHub Desktop executable not found on this system")
            }
            LaunchError::HookNotFound(p) => {
                write!(f, "hook script not found at: {}", p.display())
            }
            LaunchError::Spawn(e) => {
                write!(f, "failed to spawn process: {e}")
            }
        }
    }
}

impl std::error::Error for LaunchError {}

/// Spawn GitHub Desktop with the GDP hook injected via `NODE_OPTIONS`.
///
/// The `hook_dir` must contain `index.js` — the compiled CommonJS hook bundle.
/// The spawned process is immediately detached; the caller receives only the PID.
pub fn launch(config: &Config, hook_dir: &Path) -> Result<LaunchResult, LaunchError> {
    let executable = config
        .desktop
        .path
        .as_ref()
        .filter(|p| p.exists())
        .cloned()
        .or_else(find_github_desktop)
        .ok_or(LaunchError::DesktopNotFound)?;

    let hook_script = hook_dir.join("index.js");
    if !hook_script.exists() {
        return Err(LaunchError::HookNotFound(hook_script));
    }

    let node_options = format!("--require={}", hook_script.display());
    // Serialise config as JSON so the hook can read it at startup.
    let config_json = serde_json::to_string(config).unwrap_or_default();

    let child = std::process::Command::new(&executable)
        .env("NODE_OPTIONS", &node_options)
        .env("GDP_CONFIG", &config_json)
        .spawn()
        .map_err(LaunchError::Spawn)?;

    let pid = child.id();
    // Detach: dropping `Child` without waiting lets GitHub Desktop run independently.
    drop(child);

    Ok(LaunchResult { pid, executable })
}
