use chrono::{TimeZone, Utc};
use claude_signal::{
    log_buffer::LogBuffer,
    status::{ClaudeStatus, LogEntry, LogStream, StatusSnapshot},
    status_detector::detect_status_from_line,
    status_store::StatusStore,
};

#[test]
fn serializes_status_snapshot_with_required_json_names() {
    let snapshot = StatusSnapshot {
        status: ClaudeStatus::Thinking,
        is_claude_running: true,
        last_output: Some("Reading project files...".to_string()),
        last_activity_at: Some(Utc.with_ymd_and_hms(2026, 6, 16, 4, 20, 0).unwrap()),
        started_at: Some(Utc.with_ymd_and_hms(2026, 6, 16, 4, 10, 0).unwrap()),
        completed_at: None,
        duration_seconds: 600,
        session_id: Some("local-session-001".to_string()),
        recent_logs: vec!["Starting Claude...".to_string()],
    };

    let value = serde_json::to_value(snapshot).unwrap();

    assert_eq!(value["status"], "thinking");
    assert_eq!(value["isClaudeRunning"], true);
    assert_eq!(value["lastOutput"], "Reading project files...");
    assert_eq!(value["startedAt"], "2026-06-16T04:10:00Z");
    assert!(value["completedAt"].is_null());
    assert_eq!(value["durationSeconds"], 600);
    assert_eq!(value["sessionId"], "local-session-001");
    assert_eq!(value["recentLogs"][0], "Starting Claude...");
}

#[test]
fn status_detector_prioritizes_session_limit_and_waiting_input_patterns() {
    assert_eq!(
        detect_status_from_line("Usage limit reached. Try again later."),
        Some(ClaudeStatus::SessionLimit)
    );
    assert_eq!(
        detect_status_from_line("Do you want to continue? yes/no"),
        Some(ClaudeStatus::WaitingInput)
    );
    assert_eq!(
        detect_status_from_line("Refactoring scanner module..."),
        None
    );
}

#[test]
fn status_detector_does_not_false_positive_on_discussion_text() {
    // "confirm" without trailing "?" should not trigger WaitingInput
    assert_eq!(
        detect_status_from_line("I can confirm the deployment succeeded"),
        None
    );
    // "quota" alone should not trigger SessionLimit
    assert_eq!(
        detect_status_from_line("Let me check the API quota configuration"),
        None
    );
    // "rate limit" in code discussion should still trigger (acceptable trade-off)
    assert_eq!(
        detect_status_from_line("Rate limit exceeded"),
        Some(ClaudeStatus::SessionLimit)
    );
    // "confirm?" should trigger
    assert_eq!(
        detect_status_from_line("Please confirm?"),
        Some(ClaudeStatus::WaitingInput)
    );
    // "[y/n]" should trigger
    assert_eq!(
        detect_status_from_line("Proceed with changes? [y/n]"),
        Some(ClaudeStatus::WaitingInput)
    );
    // "quota exceeded" should trigger
    assert_eq!(
        detect_status_from_line("API quota exceeded for this session"),
        Some(ClaudeStatus::SessionLimit)
    );
}

#[test]
fn log_buffer_keeps_only_the_most_recent_lines() {
    let mut buffer = LogBuffer::new(2);
    buffer.push(LogEntry::system("one"));
    buffer.push(LogEntry::system("two"));
    buffer.push(LogEntry::system("three"));

    let logs = buffer.entries();

    assert_eq!(logs.len(), 2);
    assert_eq!(logs[0].line, "two");
    assert_eq!(logs[1].line, "three");
}

#[tokio::test]
async fn status_store_records_logs_and_updates_snapshot() {
    let store = StatusStore::new(10);

    store.start_session("session-a").await;
    store
        .record_output(LogStream::Stdout, "Reading project files...")
        .await;

    let snapshot = store.snapshot().await;
    let logs = store.logs().await;

    assert_eq!(snapshot.status, ClaudeStatus::Working);
    assert!(snapshot.is_claude_running);
    assert_eq!(
        snapshot.last_output.as_deref(),
        Some("Reading project files...")
    );
    assert_eq!(snapshot.session_id.as_deref(), Some("session-a"));
    assert_eq!(snapshot.recent_logs, vec!["Reading project files..."]);
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0].stream, LogStream::Stdout);
}

#[tokio::test]
async fn starting_session_can_show_a_system_log_before_claude_outputs_anything() {
    let store = StatusStore::new(10);

    store.start_session("session-a").await;
    store
        .add_system_log("Launching Claude command: claude \"summarize this repo\"")
        .await;

    let snapshot = store.snapshot().await;
    let logs = store.logs().await;

    assert_eq!(snapshot.status, ClaudeStatus::Starting);
    assert!(snapshot.is_claude_running);
    assert_eq!(
        snapshot.last_output.as_deref(),
        Some("Launching Claude command: claude \"summarize this repo\"")
    );
    assert_eq!(
        snapshot.recent_logs,
        vec!["Launching Claude command: claude \"summarize this repo\""]
    );
    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0].stream, LogStream::System);
}

#[tokio::test]
async fn pty_activity_updates_status_without_storing_terminal_output() {
    let store = StatusStore::new(10);

    store.start_session("session-a").await;
    store.touch_activity().await;

    let snapshot = store.snapshot().await;
    let logs = store.logs().await;

    assert_eq!(snapshot.status, ClaudeStatus::Working);
    assert!(snapshot.is_claude_running);
    assert!(snapshot.last_activity_at.is_some());
    assert!(snapshot.last_output.is_none());
    assert!(snapshot.recent_logs.is_empty());
    assert!(logs.is_empty());
}

#[tokio::test]
async fn idle_attached_session_does_not_become_thinking_from_inactivity() {
    let store = StatusStore::new(10);

    store.start_session("session-a").await;
    store.set_status(ClaudeStatus::Idle).await;
    let changed_to_thinking = store.mark_thinking_if_inactive(60).await;

    let snapshot = store.snapshot().await;

    assert!(!changed_to_thinking);
    assert_eq!(snapshot.status, ClaudeStatus::Idle);
    assert!(snapshot.is_claude_running);
}

#[tokio::test]
async fn system_logs_after_exit_do_not_revive_the_claude_process() {
    let store = StatusStore::new(10);

    store.start_session("session-a").await;
    store
        .record_output(LogStream::Stderr, "Error: Input must be provided")
        .await;
    store.complete(false).await;
    store
        .add_system_log("Claude process exited with an error.")
        .await;
    let changed_to_thinking = store.mark_thinking_if_inactive(60).await;

    let snapshot = store.snapshot().await;

    assert!(!changed_to_thinking);
    assert_eq!(snapshot.status, ClaudeStatus::Error);
    assert!(!snapshot.is_claude_running);
    assert_eq!(
        snapshot.last_output.as_deref(),
        Some("Claude process exited with an error.")
    );
    assert_eq!(
        snapshot.recent_logs,
        vec![
            "Error: Input must be provided",
            "Claude process exited with an error."
        ]
    );
}
