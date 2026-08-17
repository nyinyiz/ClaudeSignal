use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// User-editable configuration loaded from `~/.claude-signal/config.toml`.
/// Every field has a sensible default so a config file is optional.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub budget: BudgetConfig,
    pub alerts: AlertsConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct BudgetConfig {
    /// Alert when a single day's estimated cost crosses this amount (USD).
    pub daily_budget_usd: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AlertsConfig {
    /// Warn when a rate-limit window reaches this percentage of its limit.
    pub rate_limit_warn_percent: f64,
    /// Show native macOS notifications for alerts via `osascript`.
    pub osascript_notifications: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            budget: BudgetConfig::default(),
            alerts: AlertsConfig::default(),
        }
    }
}

impl Default for BudgetConfig {
    fn default() -> Self {
        Self { daily_budget_usd: None }
    }
}

impl Default for AlertsConfig {
    fn default() -> Self {
        Self {
            rate_limit_warn_percent: 80.0,
            osascript_notifications: true,
        }
    }
}

impl Config {
    /// Default config file location: `~/.claude-signal/config.toml`.
    pub fn path() -> PathBuf {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        home.join(".claude-signal").join("config.toml")
    }

    /// Load the config from disk, falling back to defaults when the file is
    /// missing or cannot be parsed.
    pub fn load() -> Self {
        match std::fs::read_to_string(Self::path()) {
            Ok(text) => match toml::from_str(&text) {
                Ok(config) => config,
                Err(error) => {
                    tracing::warn!(%error, "failed to parse config file; using defaults");
                    Config::default()
                }
            },
            Err(_) => Config::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_config_file_uses_defaults() {
        let config = Config::default();
        assert_eq!(config.budget.daily_budget_usd, None);
        assert_eq!(config.alerts.rate_limit_warn_percent, 80.0);
        assert!(config.alerts.osascript_notifications);
    }

    #[test]
    fn parses_configured_budget_and_alerts() {
        let text = r#"
[budget]
daily_budget_usd = 12.5

[alerts]
rate_limit_warn_percent = 90
osascript_notifications = false
"#;
        let config: Config = toml::from_str(text).unwrap();
        assert_eq!(config.budget.daily_budget_usd, Some(12.5));
        assert_eq!(config.alerts.rate_limit_warn_percent, 90.0);
        assert!(!config.alerts.osascript_notifications);
    }

    #[test]
    fn partial_config_uses_defaults_for_missing_fields() {
        let text = r#"
[budget]
daily_budget_usd = 5.0
"#;
        let config: Config = toml::from_str(text).unwrap();
        assert_eq!(config.budget.daily_budget_usd, Some(5.0));
        assert_eq!(config.alerts.rate_limit_warn_percent, 80.0);
        assert!(config.alerts.osascript_notifications);
    }
}