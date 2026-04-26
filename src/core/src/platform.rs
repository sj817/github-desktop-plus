use std::path::PathBuf;

/// Returns the user's home directory using well-known environment variables.
fn home_dir() -> Option<PathBuf> {
    // USERPROFILE is canonical on Windows; HOME on macOS/Linux.
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

/// Returns the platform-specific configuration directory for GitHub Desktop Plus.
pub fn config_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("APPDATA").map(|p| PathBuf::from(p).join("github-desktop-plus"))
    }
    #[cfg(target_os = "macos")]
    {
        home_dir().map(|h| h.join("Library/Application Support/github-desktop-plus"))
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(|p| PathBuf::from(p).join("github-desktop-plus"))
            .or_else(|| home_dir().map(|h| h.join(".config/github-desktop-plus")))
    }
}

/// Returns the directory where GDP hook scripts are expected,
/// as a `hooks/` sibling of the running executable.
pub fn hook_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("hooks")))
}

/// Returns a prioritised list of candidate paths for the GitHub Desktop executable.
pub fn github_desktop_candidates() -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    #[cfg(windows)]
    {
        // Primary install location (Squirrel installer)
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            candidates.push(
                PathBuf::from(&local)
                    .join("GitHubDesktop")
                    .join("GitHubDesktop.exe"),
            );
        }
        // Scoop package manager
        if let Some(home) = home_dir() {
            candidates.push(
                home.join("scoop")
                    .join("apps")
                    .join("github")
                    .join("current")
                    .join("GitHubDesktop.exe"),
            );
        }
    }

    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from(
            "/Applications/GitHub Desktop.app/Contents/MacOS/GitHub Desktop",
        ));
        if let Some(home) = home_dir() {
            candidates
                .push(home.join("Applications/GitHub Desktop.app/Contents/MacOS/GitHub Desktop"));
        }
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    {
        candidates.push(PathBuf::from("/usr/bin/github-desktop"));
        candidates.push(PathBuf::from("/opt/github-desktop/github-desktop"));
        // Flatpak
        if let Some(home) = home_dir() {
            candidates
                .push(home.join(".local/share/flatpak/exports/bin/io.github.shiftey.Desktop"));
        }
    }

    candidates
}
