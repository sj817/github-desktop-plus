use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Root configuration for GitHub Desktop Plus.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub updates: UpdatesConfig,
    #[serde(default)]
    pub telemetry: TelemetryConfig,
    #[serde(default)]
    pub logging: LoggingConfig,
    #[serde(default)]
    pub i18n: I18nConfig,
    #[serde(default)]
    pub desktop: DesktopConfig,
    #[serde(default)]
    pub ui: UiConfig,
    #[serde(default)]
    pub ai: AiConfig,
    #[serde(default)]
    pub open_with: OpenWithConfig,
    #[serde(default)]
    pub copilot: CopilotConfig,
}

/// GitHub Desktop 3.6 can drive any OpenAI-compatible endpoint through its own
/// "bring your own key" providers, but keeps the commit-message UI behind a
/// Copilot entitlement check. Unlocking rewrites that client-side check so the
/// native BYOK path becomes reachable; it does not grant access to GitHub's
/// hosted models, which stay authorised server-side.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CopilotConfig {
    #[serde(default = "default_true")]
    pub unlock: bool,
}

impl Default for CopilotConfig {
    fn default() -> Self {
        Self { unlock: true }
    }
}

/// AI commit-message generation.
///
/// Note: `temperature` and `max_tokens` are intentionally NOT configurable — for
/// commit messages you want consistency, not creativity, and a short output;
/// they are fixed internally in the hook that builds the request. `timeout_secs`
/// is kept as a file-only escape hatch (not surfaced in the settings UI).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_ai_base_url")]
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_ai_model")]
    pub model: String,
    #[serde(default = "default_ai_system_prompt")]
    pub system_prompt: String,
    #[serde(default = "default_ai_timeout_secs")]
    pub timeout_secs: u32,
    #[serde(default = "default_true")]
    pub fallback_to_copilot: bool,
}

fn default_ai_base_url() -> String {
    "https://api.openai.com/v1".to_string()
}
fn default_ai_model() -> String {
    "gpt-4o-mini".to_string()
}
fn default_ai_system_prompt() -> String {
    "请用 `<type>: <中文描述>` 格式生成单行提交信息，type 取自 feat/fix/docs/refactor/test/chore/style/perf/build/ci。只输出提交信息本身，不要有任何解释。".to_string()
}
fn default_ai_timeout_secs() -> u32 {
    30
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            base_url: default_ai_base_url(),
            api_key: String::new(),
            model: default_ai_model(),
            system_prompt: default_ai_system_prompt(),
            timeout_secs: default_ai_timeout_secs(),
            fallback_to_copilot: true,
        }
    }
}

/// User-defined "open with" targets injected into GitHub Desktop's repository
/// context menu. GitHub Desktop only ever shows ONE editor and ONE shell (the
/// ones picked in its own settings); these entries add as many as the user
/// wants, listed alongside the native ones.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenWithConfig {
    /// Collapse every entry into a single "打开方式 ▸" submenu instead of
    /// listing them inline.
    #[serde(default)]
    pub submenu: bool,
    #[serde(default)]
    pub items: Vec<OpenWithItem>,
}

impl Default for OpenWithConfig {
    fn default() -> Self {
        Self {
            submenu: false,
            items: Vec::new(),
        }
    }
}

/// One launchable target. `args` is a command line whose `%TARGET_PATH%`
/// placeholders are replaced with the repository path (same convention as
/// GitHub Desktop's own custom-integration setting).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenWithItem {
    pub id: String,
    pub label: String,
    pub path: String,
    #[serde(default)]
    pub args: String,
    /// "editor" or "shell" — decides which native entry it sits next to.
    #[serde(default = "default_open_with_group")]
    pub group: String,
    /// Launch through the shell's `start` so console programs get a window.
    #[serde(default)]
    pub console: bool,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_open_with_group() -> String {
    "editor".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdatesConfig {
    pub disabled: bool,
    #[serde(default = "default_true")]
    pub block_manual_check: bool,
}

fn default_true() -> bool {
    true
}

impl Default for UpdatesConfig {
    fn default() -> Self {
        Self {
            disabled: true,
            block_manual_check: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryConfig {
    pub disabled: bool,
}

impl Default for TelemetryConfig {
    fn default() -> Self {
        Self { disabled: true }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoggingConfig {
    pub level: String,
}

impl Default for LoggingConfig {
    fn default() -> Self {
        Self {
            level: "warn".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct I18nConfig {
    pub enabled: bool,
    pub locale: String,
}

impl Default for I18nConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            locale: "zh-CN".to_string(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DesktopConfig {
    pub path: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiConfig {
    /// How many repositories appear in the "Recent" group of the repo list.
    /// Mirrors GitHub Desktop's `RecentRepositoriesLength` (default: 3).
    #[serde(default = "default_recent_repos_limit")]
    pub recent_repos_limit: u32,
}

fn default_recent_repos_limit() -> u32 {
    3
}

impl Default for UiConfig {
    fn default() -> Self {
        Self {
            recent_repos_limit: default_recent_repos_limit(),
        }
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            updates: UpdatesConfig::default(),
            telemetry: TelemetryConfig::default(),
            logging: LoggingConfig::default(),
            i18n: I18nConfig::default(),
            desktop: DesktopConfig::default(),
            ui: UiConfig::default(),
            ai: AiConfig::default(),
            open_with: OpenWithConfig::default(),
            copilot: CopilotConfig::default(),
        }
    }
}

/// Errors arising from config I/O or parsing.
#[derive(Debug)]
pub enum ConfigError {
    Io(std::io::Error),
    Json(serde_json::Error),
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConfigError::Io(e) => write!(f, "IO error: {e}"),
            ConfigError::Json(e) => write!(f, "JSON error: {e}"),
        }
    }
}

impl std::error::Error for ConfigError {}

impl From<std::io::Error> for ConfigError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

impl From<serde_json::Error> for ConfigError {
    fn from(e: serde_json::Error) -> Self {
        Self::Json(e)
    }
}

impl Config {
    /// Load config from `<dir>/config.json`.
    /// Returns `Default` if the file does not exist yet.
    pub fn load(dir: &Path) -> Result<Self, ConfigError> {
        let path = dir.join("config.json");
        if !path.exists() {
            return Ok(Self::default());
        }
        let content = std::fs::read_to_string(&path)?;
        let config: Self = serde_json::from_str(&content)?;
        Ok(config)
    }

    /// Persist config to `<dir>/config.json`, creating the directory if needed.
    pub fn save(&self, dir: &Path) -> Result<(), ConfigError> {
        std::fs::create_dir_all(dir)?;
        let json = serde_json::to_string_pretty(self)?;
        std::fs::write(dir.join("config.json"), json)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_security_first() {
        let c = Config::default();
        assert!(c.updates.disabled);
        assert!(c.updates.block_manual_check);
        assert!(c.telemetry.disabled);
        assert!(c.i18n.enabled);
        assert_eq!(c.i18n.locale, "zh-CN");
        assert_eq!(c.logging.level, "warn");
        assert_eq!(c.ui.recent_repos_limit, 3);
        assert!(c.desktop.path.is_none());
        // AI defaults: disabled, sensible defaults
        assert!(!c.ai.enabled);
        assert_eq!(c.ai.base_url, "https://api.openai.com/v1");
        assert_eq!(c.ai.model, "gpt-4o-mini");
        assert!(c.ai.api_key.is_empty());
        assert!(c.ai.fallback_to_copilot);
        assert_eq!(c.ai.timeout_secs, 30);
    }

    #[test]
    fn load_returns_default_when_missing() {
        let dir = std::env::temp_dir().join(format!("gdp-cfg-missing-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let c = Config::load(&dir).expect("load empty dir");
        // Non-existent dir -> default
        assert!(c.updates.disabled);
    }

    #[test]
    fn save_then_load_roundtrip() {
        let dir = std::env::temp_dir().join(format!("gdp-cfg-rt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut c = Config::default();
        c.i18n.locale = "en-US".into();
        c.ui.recent_repos_limit = 9;
        c.logging.level = "info".into();
        c.save(&dir).expect("save");
        let loaded = Config::load(&dir).expect("load back");
        assert_eq!(loaded.i18n.locale, "en-US");
        assert_eq!(loaded.ui.recent_repos_limit, 9);
        assert_eq!(loaded.logging.level, "info");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_optional_fields_use_defaults() {
        let c: Config = serde_json::from_str("{}").expect("parse {}");
        assert_eq!(c.ui.recent_repos_limit, 3);
        assert!(c.updates.block_manual_check);
        assert!(!c.ai.enabled);
        assert_eq!(c.ai.base_url, "https://api.openai.com/v1");
    }

    #[test]
    fn open_with_defaults_and_roundtrip() {
        let c: Config = serde_json::from_str("{}").expect("parse {}");
        assert!(!c.open_with.submenu);
        assert!(c.copilot.unlock);
        assert!(c.open_with.items.is_empty());

        // Only the three required fields — everything else falls back.
        let json = r#"{"open_with":{"items":[{"id":"zed","label":"Zed","path":"/usr/bin/zed"}]}}"#;
        let c: Config = serde_json::from_str(json).expect("parse items");
        assert_eq!(c.open_with.items.len(), 1);
        assert_eq!(c.open_with.items[0].group, "editor");
        assert!(c.open_with.items[0].enabled);
        assert!(!c.open_with.items[0].console);
    }

    #[test]
    fn ai_config_roundtrip() {
        let dir = std::env::temp_dir().join(format!("gdp-ai-cfg-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut c = Config::default();
        c.ai.enabled = true;
        c.ai.api_key = "sk-test".to_string();
        c.ai.model = "gpt-4o".to_string();
        c.ai.timeout_secs = 45;
        c.save(&dir).expect("save");
        let loaded = Config::load(&dir).expect("load");
        assert!(loaded.ai.enabled);
        assert_eq!(loaded.ai.api_key, "sk-test");
        assert_eq!(loaded.ai.model, "gpt-4o");
        assert_eq!(loaded.ai.timeout_secs, 45);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn config_error_io_propagation() {
        let path = std::path::Path::new("/this/path/should/not/exist/whatsoever");
        // load() returns Ok(default) when file doesn't exist; force an io error via save into a
        // path component that contains an existing FILE so create_dir_all fails.
        let tmp = std::env::temp_dir().join(format!("gdp-cfg-err-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        let blocker = tmp.join("blocker");
        std::fs::write(&blocker, b"x").unwrap();
        let nested = blocker.join("sub");
        let err = Config::default().save(&nested).unwrap_err();
        assert!(matches!(err, ConfigError::Io(_)));
        let _ = std::fs::remove_dir_all(&tmp);
        let _ = path; // silence unused
    }
}
