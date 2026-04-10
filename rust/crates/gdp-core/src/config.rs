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
        Self { disabled: true, block_manual_check: true }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryConfig {
    pub disabled: bool,
    pub block_exceptions: bool,
}

impl Default for TelemetryConfig {
    fn default() -> Self {
        Self {
            disabled: true,
            block_exceptions: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoggingConfig {
    pub level: String,
    pub disable_file_log: bool,
}

impl Default for LoggingConfig {
    fn default() -> Self {
        Self {
            level: "warn".to_string(),
            disable_file_log: false,
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

impl Default for Config {
    fn default() -> Self {
        Self {
            updates: UpdatesConfig::default(),
            telemetry: TelemetryConfig::default(),
            logging: LoggingConfig::default(),
            i18n: I18nConfig::default(),
            desktop: DesktopConfig::default(),
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
