use chrono::{DateTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    pub updated_at: DateTime<Utc>,
    pub session_id: Option<String>,
    pub model_name: Option<String>,
    pub context_tokens_used: Option<u64>,
    pub context_tokens_remaining: Option<u64>,
    pub context_window_size: Option<u64>,
    pub context_percent_used: Option<f64>,
    pub context_percent_remaining: Option<f64>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cache_creation_tokens: Option<u64>,
    pub cache_read_tokens: Option<u64>,
    pub session_cost_usd: Option<f64>,
    pub five_hour_percent: Option<f64>,
    pub five_hour_resets_at: Option<String>,
    pub seven_day_percent: Option<f64>,
    pub seven_day_resets_at: Option<String>,
}

impl UsageSnapshot {
    pub fn from_status_line_json(value: &Value) -> Self {
        Self {
            updated_at: Utc::now(),
            session_id: string_at(value, &[&["session_id"], &["sessionId"]]),
            model_name: string_at(
                value,
                &[
                    &["model", "display_name"],
                    &["model", "name"],
                    &["model", "id"],
                    &["modelName"],
                    &["model_name"],
                ],
            ),
            context_tokens_used: u64_at(
                value,
                &[
                    &["context_window", "total_input_tokens"],
                    &["context", "tokens_used"],
                    &["context", "tokensUsed"],
                    &["context_tokens_used"],
                    &["contextTokensUsed"],
                ],
            ),
            context_tokens_remaining: u64_at(
                value,
                &[
                    &["context_window", "tokens_remaining"],
                    &["context", "tokens_remaining"],
                    &["context", "tokensRemaining"],
                    &["context_tokens_remaining"],
                    &["contextTokensRemaining"],
                ],
            )
            .or_else(|| context_tokens_remaining(value)),
            context_window_size: u64_at(
                value,
                &[
                    &["context_window", "context_window_size"],
                    &["contextWindow", "contextWindowSize"],
                    &["context_window_size"],
                    &["contextWindowSize"],
                ],
            ),
            context_percent_used: percent_at(
                value,
                &[
                    &["context_window", "used_percentage"],
                    &["contextWindow", "usedPercentage"],
                    &["context", "percentage_used"],
                    &["context", "percent_used"],
                    &["context", "percentageUsed"],
                    &["context", "percentUsed"],
                    &["context_percent_used"],
                    &["contextPercentUsed"],
                ],
            ),
            context_percent_remaining: percent_at(
                value,
                &[
                    &["context_window", "remaining_percentage"],
                    &["contextWindow", "remainingPercentage"],
                    &["context", "percentage_remaining"],
                    &["context", "remainingPercentage"],
                    &["context_percent_remaining"],
                    &["contextPercentRemaining"],
                ],
            ),
            input_tokens: u64_at(
                value,
                &[
                    &["context_window", "current_usage", "input_tokens"],
                    &["contextWindow", "currentUsage", "inputTokens"],
                    &["usage", "input_tokens"],
                    &["usage", "inputTokens"],
                    &["token_usage", "input_tokens"],
                    &["input_tokens"],
                    &["inputTokens"],
                ],
            ),
            output_tokens: u64_at(
                value,
                &[
                    &["context_window", "current_usage", "output_tokens"],
                    &["contextWindow", "currentUsage", "outputTokens"],
                    &["context_window", "total_output_tokens"],
                    &["usage", "output_tokens"],
                    &["usage", "outputTokens"],
                    &["token_usage", "output_tokens"],
                    &["output_tokens"],
                    &["outputTokens"],
                ],
            ),
            cache_creation_tokens: u64_at(
                value,
                &[
                    &[
                        "context_window",
                        "current_usage",
                        "cache_creation_input_tokens",
                    ],
                    &["contextWindow", "currentUsage", "cacheCreationInputTokens"],
                    &["usage", "cache_creation_input_tokens"],
                    &["usage", "cacheCreationInputTokens"],
                    &["cache_creation_input_tokens"],
                    &["cacheCreationInputTokens"],
                ],
            ),
            cache_read_tokens: u64_at(
                value,
                &[
                    &["context_window", "current_usage", "cache_read_input_tokens"],
                    &["contextWindow", "currentUsage", "cacheReadInputTokens"],
                    &["usage", "cache_read_input_tokens"],
                    &["usage", "cacheReadInputTokens"],
                    &["cache_read_input_tokens"],
                    &["cacheReadInputTokens"],
                ],
            ),
            session_cost_usd: f64_at(
                value,
                &[
                    &["cost", "total_cost_usd"],
                    &["cost", "totalCostUsd"],
                    &["session_cost_usd"],
                    &["sessionCostUsd"],
                    &["total_cost_usd"],
                    &["totalCostUsd"],
                ],
            ),
            five_hour_percent: percent_at(
                value,
                &[
                    &["rate_limits", "five_hour", "used_percentage"],
                    &["rate_limits", "fiveHour", "usedPercentage"],
                    &["rateLimits", "fiveHour", "usedPercentage"],
                    &["five_hour_percent"],
                    &["fiveHourPercent"],
                ],
            ),
            five_hour_resets_at: timestamp_at(
                value,
                &[
                    &["rate_limits", "five_hour", "resets_at"],
                    &["rate_limits", "fiveHour", "resetsAt"],
                    &["rateLimits", "fiveHour", "resetsAt"],
                    &["five_hour_resets_at"],
                    &["fiveHourResetsAt"],
                ],
            ),
            seven_day_percent: percent_at(
                value,
                &[
                    &["rate_limits", "seven_day", "used_percentage"],
                    &["rate_limits", "sevenDay", "usedPercentage"],
                    &["rateLimits", "sevenDay", "usedPercentage"],
                    &["seven_day_percent"],
                    &["sevenDayPercent"],
                ],
            ),
            seven_day_resets_at: timestamp_at(
                value,
                &[
                    &["rate_limits", "seven_day", "resets_at"],
                    &["rate_limits", "sevenDay", "resetsAt"],
                    &["rateLimits", "sevenDay", "resetsAt"],
                    &["seven_day_resets_at"],
                    &["sevenDayResetsAt"],
                ],
            ),
        }
    }

    pub fn status_line_text(&self) -> String {
        let model = self
            .model_name
            .as_deref()
            .filter(|name| !name.is_empty())
            .unwrap_or("Claude");
        let context = self
            .context_percent_used
            .map(|value| format!("ctx {}%", rounded_percent(value)))
            .unwrap_or_else(|| "ctx --".to_string());
        let five_hour = self
            .five_hour_percent
            .map(|value| format!("session {}%", rounded_percent(value)))
            .unwrap_or_else(|| "session --".to_string());
        let seven_day = self
            .seven_day_percent
            .map(|value| format!("week {}%", rounded_percent(value)))
            .unwrap_or_else(|| "week --".to_string());

        format!("{model} | {context} | {five_hour} | {seven_day}")
    }
}

pub struct UsageStore {
    snapshot: RwLock<Option<UsageSnapshot>>,
}

impl UsageStore {
    pub fn new() -> Self {
        Self {
            snapshot: RwLock::new(None),
        }
    }

    pub async fn snapshot(&self) -> Option<UsageSnapshot> {
        self.snapshot.read().await.clone()
    }

    pub async fn set(&self, snapshot: UsageSnapshot) {
        *self.snapshot.write().await = Some(snapshot);
    }
}

fn value_at<'a>(value: &'a Value, paths: &[&[&str]]) -> Option<&'a Value> {
    paths.iter().find_map(|path| {
        let mut current = value;
        for key in *path {
            current = current.get(*key)?;
        }
        Some(current)
    })
}

fn string_at(value: &Value, paths: &[&[&str]]) -> Option<String> {
    value_at(value, paths).and_then(|value| match value {
        Value::String(text) if !text.is_empty() => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    })
}

fn u64_at(value: &Value, paths: &[&[&str]]) -> Option<u64> {
    value_at(value, paths).and_then(|value| match value {
        Value::Number(number) => number.as_u64(),
        Value::String(text) => text.parse().ok(),
        _ => None,
    })
}

fn f64_at(value: &Value, paths: &[&[&str]]) -> Option<f64> {
    value_at(value, paths).and_then(|value| match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.parse().ok(),
        _ => None,
    })
}

fn timestamp_at(value: &Value, paths: &[&[&str]]) -> Option<String> {
    value_at(value, paths).and_then(|value| match value {
        Value::Number(number) => number
            .as_i64()
            .and_then(|epoch_seconds| Utc.timestamp_opt(epoch_seconds, 0).single())
            .map(|timestamp| timestamp.to_rfc3339()),
        Value::String(text) if !text.is_empty() => text
            .parse::<i64>()
            .ok()
            .and_then(|epoch_seconds| Utc.timestamp_opt(epoch_seconds, 0).single())
            .map(|timestamp| timestamp.to_rfc3339())
            .or_else(|| Some(text.clone())),
        _ => None,
    })
}

fn percent_at(value: &Value, paths: &[&[&str]]) -> Option<f64> {
    f64_at(value, paths).map(|percent| {
        if (0.0..=1.0).contains(&percent) {
            percent * 100.0
        } else {
            percent
        }
    })
}

fn context_tokens_remaining(value: &Value) -> Option<u64> {
    let size = u64_at(
        value,
        &[
            &["context_window", "context_window_size"],
            &["contextWindow", "contextWindowSize"],
        ],
    )?;
    let used = u64_at(
        value,
        &[
            &["context_window", "total_input_tokens"],
            &["contextWindow", "totalInputTokens"],
        ],
    )?;
    Some(size.saturating_sub(used))
}

fn rounded_percent(value: f64) -> u64 {
    value.clamp(0.0, 100.0).round() as u64
}

#[cfg(test)]
mod tests {
    use super::UsageSnapshot;

    #[test]
    fn parses_official_status_line_payload() {
        let payload = serde_json::json!({
            "session_id": "abc123",
            "model": { "display_name": "Sonnet" },
            "cost": { "total_cost_usd": 0.25 },
            "context_window": {
                "total_input_tokens": 15500,
                "total_output_tokens": 1200,
                "context_window_size": 200000,
                "used_percentage": 8,
                "remaining_percentage": 92,
                "current_usage": {
                    "input_tokens": 8500,
                    "output_tokens": 1200,
                    "cache_creation_input_tokens": 5000,
                    "cache_read_input_tokens": 2000
                }
            },
            "rate_limits": {
                "five_hour": { "used_percentage": 23.5, "resets_at": 1781622000 },
                "seven_day": { "used_percentage": 41.2, "resets_at": 1781946000 }
            }
        });

        let snapshot = UsageSnapshot::from_status_line_json(&payload);

        assert_eq!(snapshot.session_id.as_deref(), Some("abc123"));
        assert_eq!(snapshot.model_name.as_deref(), Some("Sonnet"));
        assert_eq!(snapshot.context_tokens_used, Some(15_500));
        assert_eq!(snapshot.context_tokens_remaining, Some(184_500));
        assert_eq!(snapshot.context_window_size, Some(200_000));
        assert_eq!(snapshot.input_tokens, Some(8_500));
        assert_eq!(snapshot.output_tokens, Some(1_200));
        assert_eq!(snapshot.cache_creation_tokens, Some(5_000));
        assert_eq!(snapshot.cache_read_tokens, Some(2_000));
        assert_eq!(snapshot.five_hour_percent, Some(23.5));
        assert_eq!(
            snapshot.status_line_text(),
            "Sonnet | ctx 8% | session 24% | week 41%"
        );
    }
}
