use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs,
    path::{Path, PathBuf},
};

use chrono::{DateTime, Datelike, Local, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsageTotals {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_creation_tokens: u64,
    pub turns: u64,
    pub estimated_cost_usd: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    pub model: String,
    pub totals: UsageTotals,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectUsage {
    pub project: String,
    pub totals: UsageTotals,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentSession {
    pub session_id: String,
    pub project: String,
    pub model: String,
    pub last_activity_at: Option<String>,
    pub totals: UsageTotals,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyActivity {
    pub date: String,
    pub label: String,
    pub totals: UsageTotals,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageHistorySnapshot {
    pub generated_at: DateTime<Utc>,
    pub transcript_files: usize,
    pub turns: usize,
    pub today: UsageTotals,
    pub week: UsageTotals,
    pub all_time: UsageTotals,
    pub by_model: Vec<ModelUsage>,
    pub top_projects: Vec<ProjectUsage>,
    pub recent_sessions: Vec<RecentSession>,
    pub daily_activity: Vec<DailyActivity>,
    pub weekly_activity: Vec<DailyActivity>,
    pub monthly_activity: Vec<DailyActivity>,
    pub pricing_updated: String,
    pub unpriced_models: Vec<String>,
}

#[derive(Debug, Clone)]
struct TurnUsage {
    session_id: String,
    timestamp: Option<DateTime<Utc>>,
    model: String,
    cwd: String,
    input_tokens: u64,
    output_tokens: u64,
    cache_read_tokens: u64,
    cache_creation_tokens: u64,
}

#[derive(Default)]
struct SessionAggregate {
    project: String,
    model_counts: HashMap<String, u64>,
    last_activity_at: Option<DateTime<Utc>>,
    totals: UsageTotals,
}

pub fn scan_default() -> UsageHistorySnapshot {
    let mut transcript_files = Vec::new();
    for dir in default_projects_dirs() {
        collect_jsonl_files(&dir, &mut transcript_files);
    }
    transcript_files.sort();
    scan_paths(&transcript_files)
}

pub fn scan_paths(transcript_files: &[PathBuf]) -> UsageHistorySnapshot {
    let mut turns = Vec::new();
    for file in transcript_files {
        turns.extend(parse_jsonl_file(file));
    }
    build_snapshot(transcript_files.len(), turns)
}

fn default_projects_dirs() -> Vec<PathBuf> {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    vec![
        home.join(".claude/projects"),
        home.join("Library/Developer/Xcode/CodingAssistant/ClaudeAgentConfig/projects"),
    ]
}

fn collect_jsonl_files(dir: &Path, files: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl_files(&path, files);
        } else if path.extension().and_then(|value| value.to_str()) == Some("jsonl") {
            files.push(path);
        }
    }
}

fn parse_jsonl_file(path: &Path) -> Vec<TurnUsage> {
    let Ok(text) = fs::read_to_string(path) else {
        return Vec::new();
    };

    let mut by_message_id: HashMap<String, TurnUsage> = HashMap::new();
    let mut without_message_id = Vec::new();

    for line in text.lines().filter(|line| !line.trim().is_empty()) {
        let Ok(record) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if record.get("type").and_then(Value::as_str) != Some("assistant") {
            continue;
        }

        let Some(turn) = turn_from_record(&record) else {
            continue;
        };
        let message_id = record
            .get("message")
            .and_then(|message| message.get("id"))
            .and_then(Value::as_str)
            .unwrap_or("");

        if message_id.is_empty() {
            without_message_id.push(turn);
        } else {
            by_message_id.insert(message_id.to_string(), turn);
        }
    }

    without_message_id.extend(by_message_id.into_values());
    without_message_id
}

fn turn_from_record(record: &Value) -> Option<TurnUsage> {
    let session_id = record.get("sessionId")?.as_str()?.to_string();
    let message = record.get("message")?;
    let usage = message.get("usage")?;

    let input_tokens = u64_value(usage, "input_tokens");
    let output_tokens = u64_value(usage, "output_tokens");
    let cache_read_tokens = u64_value(usage, "cache_read_input_tokens");
    let cache_creation_tokens = u64_value(usage, "cache_creation_input_tokens");
    if input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens == 0 {
        return None;
    }

    Some(TurnUsage {
        session_id,
        timestamp: record
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(parse_timestamp),
        model: message
            .get("model")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string(),
        cwd: record
            .get("cwd")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_creation_tokens,
    })
}

fn build_snapshot(transcript_files: usize, turns: Vec<TurnUsage>) -> UsageHistorySnapshot {
    let today = Local::now().date_naive();
    let week_start = today - chrono::Duration::days(today.weekday().num_days_from_monday() as i64);

    let mut today_totals = UsageTotals::default();
    let mut week_totals = UsageTotals::default();
    let mut all_time_totals = UsageTotals::default();
    let mut by_model: BTreeMap<String, UsageTotals> = BTreeMap::new();
    let mut by_project: BTreeMap<String, UsageTotals> = BTreeMap::new();
    let mut daily_activity = (0..7)
        .rev()
        .map(|offset| {
            let date = today - chrono::Duration::days(offset);
            (date, UsageTotals::default())
        })
        .collect::<BTreeMap<_, _>>();
    // Weekly: last 4 weeks, keyed by week-start (Monday)
    let mut weekly_activity: BTreeMap<chrono::NaiveDate, UsageTotals> = (0..4)
        .rev()
        .map(|offset| {
            let ws = week_start - chrono::Duration::weeks(offset);
            (ws, UsageTotals::default())
        })
        .collect();
    // Monthly: last 6 months, keyed by first day of month
    let mut monthly_activity: BTreeMap<chrono::NaiveDate, UsageTotals> = (0..6)
        .rev()
        .filter_map(|offset| {
            let m = if today.month() as i32 - offset > 0 {
                chrono::NaiveDate::from_ymd_opt(today.year(), (today.month() as i32 - offset) as u32, 1)
            } else {
                let year_offset = (offset - today.month() as i32) / 12 + 1;
                let month = 12 - ((offset - today.month() as i32) % 12);
                chrono::NaiveDate::from_ymd_opt(today.year() - year_offset, month as u32, 1)
            };
            m.map(|date| (date, UsageTotals::default()))
        })
        .collect();
    let mut sessions: HashMap<String, SessionAggregate> = HashMap::new();
    let mut unpriced_models: BTreeSet<String> = BTreeSet::new();
    let mut seen_turns = 0;

    for turn in &turns {
        seen_turns += 1;
        if turn.model != "unknown" && pricing_for_model(&turn.model).is_none() {
            unpriced_models.insert(turn.model.clone());
        }
        let turn_date = turn
            .timestamp
            .map(|timestamp| timestamp.with_timezone(&Local).date_naive());
        add_turn(&mut all_time_totals, turn);
        add_turn(by_model.entry(turn.model.clone()).or_default(), turn);
        add_turn(
            by_project
                .entry(project_name_from_cwd(&turn.cwd))
                .or_default(),
            turn,
        );

        if turn_date == Some(today) {
            add_turn(&mut today_totals, turn);
        }
        if turn_date.is_some_and(|date| date >= week_start && date <= today) {
            add_turn(&mut week_totals, turn);
        }
        if let Some(totals) = turn_date.and_then(|date| daily_activity.get_mut(&date)) {
            add_turn(totals, turn);
        }
        if let Some(date) = turn_date {
            let turn_week_start = date
                - chrono::Duration::days(date.weekday().num_days_from_monday() as i64);
            if let Some(totals) = weekly_activity.get_mut(&turn_week_start) {
                add_turn(totals, turn);
            }
            let turn_month_start =
                chrono::NaiveDate::from_ymd_opt(date.year(), date.month(), 1);
            if let Some(ms) = turn_month_start {
                if let Some(totals) = monthly_activity.get_mut(&ms) {
                    add_turn(totals, turn);
                }
            }
        }

        let session = sessions
            .entry(turn.session_id.clone())
            .or_insert_with(|| SessionAggregate {
                project: project_name_from_cwd(&turn.cwd),
                ..SessionAggregate::default()
            });
        add_turn(&mut session.totals, turn);
        *session.model_counts.entry(turn.model.clone()).or_insert(0) += 1;
        if turn.timestamp > session.last_activity_at {
            session.last_activity_at = turn.timestamp;
        }
    }

    let mut by_model = by_model
        .into_iter()
        .map(|(model, totals)| ModelUsage { model, totals })
        .collect::<Vec<_>>();
    by_model.sort_by_key(|item| {
        std::cmp::Reverse(item.totals.input_tokens + item.totals.output_tokens)
    });

    let mut top_projects = by_project
        .into_iter()
        .map(|(project, totals)| ProjectUsage { project, totals })
        .collect::<Vec<_>>();
    top_projects.sort_by_key(|item| {
        std::cmp::Reverse(item.totals.input_tokens + item.totals.output_tokens)
    });
    top_projects.truncate(5);

    let mut recent_sessions = sessions
        .into_iter()
        .map(|(session_id, session)| RecentSession {
            session_id: session_id.chars().take(8).collect(),
            project: session.project,
            model: most_common_model(session.model_counts),
            last_activity_at: session
                .last_activity_at
                .map(|timestamp| timestamp.to_rfc3339()),
            totals: session.totals,
        })
        .collect::<Vec<_>>();
    recent_sessions.sort_by_key(|session| std::cmp::Reverse(session.last_activity_at.clone()));
    recent_sessions.truncate(5);

    let daily_activity = daily_activity
        .into_iter()
        .map(|(date, totals)| DailyActivity {
            date: date.to_string(),
            label: date.format("%a").to_string().to_uppercase(),
            totals,
        })
        .collect();

    let weekly_activity = weekly_activity
        .into_iter()
        .map(|(date, totals)| {
            DailyActivity {
                date: date.to_string(),
                label: format!("{}", date.format("%b %d")),
                totals,
            }
        })
        .collect();

    let monthly_activity = monthly_activity
        .into_iter()
        .map(|(date, totals)| DailyActivity {
            date: date.to_string(),
            label: date.format("%b").to_string().to_uppercase(),
            totals,
        })
        .collect();

    UsageHistorySnapshot {
        generated_at: Utc::now(),
        transcript_files,
        turns: seen_turns,
        today: today_totals,
        week: week_totals,
        all_time: all_time_totals,
        by_model,
        top_projects,
        recent_sessions,
        daily_activity,
        weekly_activity,
        monthly_activity,
        pricing_updated: PRICING_UPDATED.to_string(),
        unpriced_models: unpriced_models.into_iter().collect(),
    }
}

fn add_turn(totals: &mut UsageTotals, turn: &TurnUsage) {
    totals.input_tokens += turn.input_tokens;
    totals.output_tokens += turn.output_tokens;
    totals.cache_read_tokens += turn.cache_read_tokens;
    totals.cache_creation_tokens += turn.cache_creation_tokens;
    totals.turns += 1;
    totals.estimated_cost_usd += estimate_cost_for_model(
        &turn.model,
        turn.input_tokens,
        turn.output_tokens,
        turn.cache_read_tokens,
        turn.cache_creation_tokens,
    );
}

fn estimate_cost_for_model(
    model: &str,
    input: u64,
    output: u64,
    cache_read: u64,
    cache_creation: u64,
) -> f64 {
    let Some(pricing) = pricing_for_model(model) else {
        return 0.0;
    };
    input as f64 * pricing.input / 1_000_000.0
        + output as f64 * pricing.output / 1_000_000.0
        + cache_read as f64 * pricing.cache_read / 1_000_000.0
        + cache_creation as f64 * pricing.cache_creation / 1_000_000.0
}

struct Pricing {
    input: f64,
    output: f64,
    cache_read: f64,
    cache_creation: f64,
}

/// Last verified date for the pricing table below.
/// Update this whenever you verify prices against https://docs.anthropic.com/en/docs/about-claude/pricing
pub const PRICING_UPDATED: &str = "2025-06-20";

/// Prices are per million tokens (USD).
fn pricing_for_model(model: &str) -> Option<Pricing> {
    let lower = model.to_lowercase();
    if lower.contains("fable") || lower.contains("mythos") {
        Some(Pricing {
            input: 10.0,
            output: 50.0,
            cache_read: 1.0,
            cache_creation: 12.5,
        })
    } else if lower.contains("opus") {
        Some(Pricing {
            input: 15.0,
            output: 75.0,
            cache_read: 1.5,
            cache_creation: 18.75,
        })
    } else if lower.contains("sonnet") {
        Some(Pricing {
            input: 3.0,
            output: 15.0,
            cache_read: 0.3,
            cache_creation: 3.75,
        })
    } else if lower.contains("haiku") {
        Some(Pricing {
            input: 0.8,
            output: 4.0,
            cache_read: 0.08,
            cache_creation: 1.0,
        })
    } else {
        None
    }
}

fn u64_value(value: &Value, key: &str) -> u64 {
    value.get(key).and_then(Value::as_u64).unwrap_or(0)
}

fn parse_timestamp(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|timestamp| timestamp.with_timezone(&Utc))
}

fn project_name_from_cwd(cwd: &str) -> String {
    if cwd.is_empty() {
        return "unknown".to_string();
    }
    let parts = cwd
        .replace('\\', "/")
        .trim_end_matches('/')
        .split('/')
        .filter(|part| !part.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    if parts.len() >= 2 {
        parts[parts.len() - 2..].join("/")
    } else {
        parts
            .last()
            .cloned()
            .unwrap_or_else(|| "unknown".to_string())
    }
}

fn most_common_model(counts: HashMap<String, u64>) -> String {
    counts
        .into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(model, _)| model)
        .unwrap_or_else(|| "unknown".to_string())
}
