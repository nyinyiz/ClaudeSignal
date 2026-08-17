use std::process::Command;

use chrono::{Local, NaiveDate};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tokio::time::{interval, Duration};

use crate::config::Config;
use crate::server::AppState;
use crate::status::ServerEvent;
use crate::usage::UsageSnapshot;
use crate::usage_history;

/// Which rate-limit window an alert refers to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RateWindow {
    FiveHour,
    SevenDay,
}

/// The kind of alert that fired.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data", rename_all = "snake_case")]
pub enum AlertKind {
    /// A rate-limit window crossed the configured warning threshold.
    RateLimit {
        window: RateWindow,
        percent: f64,
        threshold: f64,
    },
    /// A single day's estimated cost crossed the configured budget.
    DailyBudget { spent: f64, limit: f64 },
}

/// A human-readable alert that can be pushed to the dashboard and the OS.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Alert {
    pub title: String,
    pub message: String,
    #[serde(flatten)]
    pub kind: AlertKind,
}

impl Alert {
    fn rate_limit(window: RateWindow, percent: f64, threshold: f64) -> Self {
        let window_label = match window {
            RateWindow::FiveHour => "5-hour",
            RateWindow::SevenDay => "7-day",
        };
        Self {
            title: "Rate limit warning".to_string(),
            message: format!(
                "{window_label} window at {percent:.0}% (warned at {threshold:.0}%)"
            ),
            kind: AlertKind::RateLimit {
                window,
                percent,
                threshold,
            },
        }
    }

    fn daily_budget(spent: f64, limit: f64) -> Self {
        Self {
            title: "Daily budget exceeded".to_string(),
            message: format!("Spent ${spent:.2} of the ${limit:.2} daily budget"),
            kind: AlertKind::DailyBudget { spent, limit },
        }
    }
}

/// Tracks which alerts have already fired so we don't spam the user.
#[derive(Default)]
struct AlertState {
    five_hour_armed: bool,
    seven_day_armed: bool,
    budget_fired_on: Option<NaiveDate>,
}

/// Evaluates usage snapshots and daily totals against the configured
/// thresholds, de-duplicating alerts that have already fired.
pub struct AlertManager {
    state: RwLock<AlertState>,
}

impl Default for AlertManager {
    fn default() -> Self {
        Self::new()
    }
}

impl AlertManager {
    pub fn new() -> Self {
        Self {
            state: RwLock::new(AlertState::default()),
        }
    }

    /// Check a live usage snapshot for rate-limit threshold crossings.
    ///
    /// An alert fires once when a window crosses the threshold from below;
    /// it re-arms only after the usage drops back under the threshold.
    pub async fn check_rate_limits(&self, snapshot: &UsageSnapshot, config: &Config) -> Vec<Alert> {
        let threshold = config.alerts.rate_limit_warn_percent;
        let mut state = self.state.write().await;
        let mut alerts = Vec::new();

        if let Some(percent) = snapshot.five_hour_percent {
            if percent >= threshold {
                if !state.five_hour_armed {
                    state.five_hour_armed = true;
                    alerts.push(Alert::rate_limit(RateWindow::FiveHour, percent, threshold));
                }
            } else {
                state.five_hour_armed = false;
            }
        }

        if let Some(percent) = snapshot.seven_day_percent {
            if percent >= threshold {
                if !state.seven_day_armed {
                    state.seven_day_armed = true;
                    alerts.push(Alert::rate_limit(RateWindow::SevenDay, percent, threshold));
                }
            } else {
                state.seven_day_armed = false;
            }
        }

        alerts
    }

    /// Check a daily cost total against the configured budget.
    /// Fires at most once per day.
    pub async fn check_daily_budget(&self, spent: f64, date: NaiveDate, config: &Config) -> Vec<Alert> {
        let Some(limit) = config.budget.daily_budget_usd else {
            return Vec::new();
        };
        if spent < limit {
            return Vec::new();
        }
        let mut state = self.state.write().await;
        if state.budget_fired_on == Some(date) {
            return Vec::new();
        }
        state.budget_fired_on = Some(date);
        vec![Alert::daily_budget(spent, limit)]
    }
}

/// Show a native macOS notification via `osascript`. Failures are logged,
/// not propagated — notifications are best-effort.
pub fn notify_macos(title: &str, message: &str) {
    let escaped_message = message.replace('\\', "\\\\").replace('"', "\\\"");
    let escaped_title = title.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        "display notification \"{escaped_message}\" with title \"{escaped_title}\""
    );
    match Command::new("osascript").arg("-e").arg(&script).spawn() {
        Ok(_) => {}
        Err(error) => {
            tracing::warn!(%error, "failed to launch osascript notification");
        }
    }
}

/// How often the daily-budget check re-scans history (only when a budget is set).
const BUDGET_CHECK_INTERVAL_SECS: u64 = 300;

/// Long-running task that watches usage events and daily totals, firing
/// alerts through the broadcast channel and (optionally) macOS notifications.
pub async fn run_watcher(state: AppState) {
    let config = state.config.clone();
    let alerts = state.alerts.clone();

    let mut usage_events = state.broadcaster.subscribe();
    let mut budget_tick = interval(Duration::from_secs(BUDGET_CHECK_INTERVAL_SECS));
    budget_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            event = usage_events.recv() => {
                if let Ok(ServerEvent::Usage(snapshot)) = event {
                    for alert in alerts.check_rate_limits(&snapshot, &config).await {
                        emit(&state, &config, &alert).await;
                    }
                }
            }
            _ = budget_tick.tick() => {
                if config.budget.daily_budget_usd.is_some() {
                    let date = Local::now().date_naive();
                    let spent = tokio::task::spawn_blocking(daily_cost)
                        .await
                        .unwrap_or(0.0);
                    for alert in alerts.check_daily_budget(spent, date, &config).await {
                        emit(&state, &config, &alert).await;
                    }
                }
            }
        }
    }
}

async fn emit(state: &AppState, config: &Config, alert: &Alert) {
    let _ = state.broadcaster.send(ServerEvent::Alert(alert.clone()));
    if config.alerts.osascript_notifications {
        notify_macos(&alert.title, &alert.message);
    }
}

/// Best-effort estimate of today's spend from the latest history scan.
fn daily_cost() -> f64 {
    usage_history::scan_default().today.estimated_cost_usd
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};

    fn snapshot_with(five_hour: Option<f64>, seven_day: Option<f64>) -> UsageSnapshot {
        UsageSnapshot {
            updated_at: Utc::now(),
            session_id: None,
            model_name: None,
            context_tokens_used: None,
            context_tokens_remaining: None,
            context_window_size: None,
            context_percent_used: None,
            context_percent_remaining: None,
            input_tokens: None,
            output_tokens: None,
            cache_creation_tokens: None,
            cache_read_tokens: None,
            session_cost_usd: None,
            five_hour_percent: five_hour,
            five_hour_resets_at: None,
            seven_day_percent: seven_day,
            seven_day_resets_at: None,
        }
    }

    #[tokio::test]
    async fn fires_rate_limit_alert_once_when_crossing_threshold() {
        let manager = AlertManager::new();
        let config = Config::default();

        let under = snapshot_with(Some(79.0), Some(40.0));
        assert!(manager.check_rate_limits(&under, &config).await.is_empty());

        let over = snapshot_with(Some(85.0), Some(40.0));
        let alerts = manager.check_rate_limits(&over, &config).await;
        assert_eq!(alerts.len(), 1);
        assert!(matches!(
            alerts[0].kind,
            AlertKind::RateLimit {
                window: RateWindow::FiveHour,
                ..
            }
        ));

        // Still over the threshold: no duplicate alert.
        let still_over = snapshot_with(Some(91.0), Some(40.0));
        assert!(manager.check_rate_limits(&still_over, &config).await.is_empty());

        // Drops back under, then crosses again: fires again.
        let under_again = snapshot_with(Some(60.0), Some(40.0));
        manager.check_rate_limits(&under_again, &config).await;
        let over_again = snapshot_with(Some(88.0), Some(40.0));
        assert_eq!(manager.check_rate_limits(&over_again, &config).await.len(), 1);
    }

    #[tokio::test]
    async fn fires_for_both_windows_independently() {
        let manager = AlertManager::new();
        let config = Config::default();

        let alerts = manager
            .check_rate_limits(&snapshot_with(Some(95.0), Some(95.0)), &config)
            .await;
        assert_eq!(alerts.len(), 2);
    }

    #[tokio::test]
    async fn daily_budget_fires_once_per_day() {
        let manager = AlertManager::new();
        let config = Config {
            budget: crate::config::BudgetConfig {
                daily_budget_usd: Some(10.0),
            },
            ..Config::default()
        };
        let date = Utc.with_ymd_and_hms(2026, 8, 16, 0, 0, 0).unwrap().date_naive();

        assert!(manager.check_daily_budget(9.5, date, &config).await.is_empty());
        assert_eq!(manager.check_daily_budget(12.0, date, &config).await.len(), 1);
        assert!(manager.check_daily_budget(15.0, date, &config).await.is_empty());
    }

    #[tokio::test]
    async fn daily_budget_without_configured_limit_never_fires() {
        let manager = AlertManager::new();
        let config = Config::default();
        let date = Utc.with_ymd_and_hms(2026, 8, 16, 0, 0, 0).unwrap().date_naive();
        assert!(manager.check_daily_budget(999.0, date, &config).await.is_empty());
    }
}
