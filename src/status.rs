use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::usage::UsageSnapshot;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ClaudeStatus {
    Offline,
    Idle,
    Starting,
    Working,
    Thinking,
    WaitingInput,
    Completed,
    Error,
    SessionLimit,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusSnapshot {
    pub status: ClaudeStatus,
    pub is_claude_running: bool,
    pub last_output: Option<String>,
    pub last_activity_at: Option<DateTime<Utc>>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub duration_seconds: u64,
    pub session_id: Option<String>,
    pub recent_logs: Vec<String>,
}

impl Default for StatusSnapshot {
    fn default() -> Self {
        Self {
            status: ClaudeStatus::Offline,
            is_claude_running: false,
            last_output: None,
            last_activity_at: None,
            started_at: None,
            completed_at: None,
            duration_seconds: 0,
            session_id: None,
            recent_logs: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LogStream {
    Stdout,
    Stderr,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub timestamp: DateTime<Utc>,
    pub stream: LogStream,
    pub line: String,
}

impl LogEntry {
    pub fn new(stream: LogStream, line: impl Into<String>) -> Self {
        Self {
            timestamp: Utc::now(),
            stream,
            line: line.into(),
        }
    }

    pub fn system(line: impl Into<String>) -> Self {
        Self::new(LogStream::System, line)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum ServerEvent {
    Status(StatusSnapshot),
    Log(LogEntry),
    Usage(UsageSnapshot),
    Heartbeat { timestamp: DateTime<Utc> },
}
