use crate::platform;
use std::path::PathBuf;

/// Search the filesystem for a GitHub Desktop executable.
///
/// Walks the platform-specific candidate list and returns the first path
/// that exists. Returns `None` if no installation is found.
pub fn find_github_desktop() -> Option<PathBuf> {
    platform::github_desktop_candidates()
        .into_iter()
        .find(|p| p.exists())
}
