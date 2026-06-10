use chrono::Utc;
use tokio::sync::RwLock;

use crate::{
    log_buffer::LogBuffer,
    status::{ClaudeStatus, LogEntry, LogStream, StatusSnapshot},
    status_detector::detect_status_from_line,
};

pub struct StatusStore {
    snapshot: RwLock<StatusSnapshot>,
    logs: RwLock<LogBuffer>,
}

impl StatusStore {
    pub fn new(max_logs: usize) -> Self {
        Self {
            snapshot: RwLock::new(StatusSnapshot::default()),
            logs: RwLock::new(LogBuffer::new(max_logs)),
        }
    }

    pub async fn snapshot(&self) -> StatusSnapshot {
        let mut snapshot = self.snapshot.read().await.clone();
        if let Some(started_at) = snapshot.started_at {
            let end = snapshot.completed_at.unwrap_or_else(Utc::now);
            snapshot.duration_seconds = (end - started_at).num_seconds().max(0) as u64;
        }
        snapshot
    }

    pub async fn logs(&self) -> Vec<LogEntry> {
        self.logs.read().await.entries()
    }

    pub async fn set_status(&self, status: ClaudeStatus) {
        let mut snapshot = self.snapshot.write().await;
        snapshot.status = status;
    }

    pub async fn start_session(&self, session_id: impl Into<String>) {
        let now = Utc::now();
        let mut snapshot = self.snapshot.write().await;
        snapshot.status = ClaudeStatus::Starting;
        snapshot.is_claude_running = true;
        snapshot.started_at = Some(now);
        snapshot.completed_at = None;
        snapshot.last_activity_at = Some(now);
        snapshot.session_id = Some(session_id.into());
    }

    pub async fn record_output(&self, stream: LogStream, line: impl Into<String>) -> LogEntry {
        let line = line.into();
        let entry = LogEntry::new(stream, line.clone());
        {
            let mut logs = self.logs.write().await;
            logs.push(entry.clone());
            let mut snapshot = self.snapshot.write().await;
            snapshot.last_output = Some(line.clone());
            snapshot.last_activity_at = Some(entry.timestamp);
            snapshot.recent_logs = logs.recent_lines();
            snapshot.status = detect_status_from_line(&line).unwrap_or(ClaudeStatus::Working);
            snapshot.is_claude_running = !matches!(
                snapshot.status,
                ClaudeStatus::Completed | ClaudeStatus::Error | ClaudeStatus::Offline
            );
        }
        entry
    }

    pub async fn add_system_log(&self, line: impl Into<String>) -> LogEntry {
        let line = line.into();
        let entry = LogEntry::new(LogStream::System, line.clone());
        {
            let mut logs = self.logs.write().await;
            logs.push(entry.clone());
            let mut snapshot = self.snapshot.write().await;
            snapshot.last_output = Some(line);
            snapshot.last_activity_at = Some(entry.timestamp);
            snapshot.recent_logs = logs.recent_lines();
        }
        entry
    }

    pub async fn touch_activity(&self) {
        let mut snapshot = self.snapshot.write().await;
        snapshot.last_activity_at = Some(Utc::now());
        if snapshot.is_claude_running
            && !matches!(
                snapshot.status,
                ClaudeStatus::WaitingInput | ClaudeStatus::SessionLimit
            )
        {
            snapshot.status = ClaudeStatus::Working;
        }
    }

    pub async fn mark_thinking_if_inactive(&self, inactive_seconds: u64) -> bool {
        let mut snapshot = self.snapshot.write().await;
        if snapshot.is_claude_running
            && !matches!(
                snapshot.status,
                ClaudeStatus::Idle | ClaudeStatus::WaitingInput | ClaudeStatus::SessionLimit
            )
            && inactive_seconds >= crate::status_detector::THINKING_TIMEOUT_SECONDS
        {
            snapshot.status = ClaudeStatus::Thinking;
            return true;
        }
        false
    }

    pub async fn complete(&self, ok: bool) {
        let mut snapshot = self.snapshot.write().await;
        snapshot.is_claude_running = false;
        snapshot.completed_at = Some(Utc::now());
        snapshot.status = if ok {
            ClaudeStatus::Completed
        } else {
            ClaudeStatus::Error
        };
    }

    pub async fn mark_offline(&self) {
        let mut snapshot = self.snapshot.write().await;
        snapshot.is_claude_running = false;
        snapshot.completed_at = Some(Utc::now());
        snapshot.status = ClaudeStatus::Offline;
    }
}
