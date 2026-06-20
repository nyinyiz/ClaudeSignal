use std::time::Duration;

use crate::{
    cli::Scenario,
    server::AppState,
    status::{ClaudeStatus, LogStream, ServerEvent},
    usage::UsageSnapshot,
};

pub async fn run(state: AppState, scenario: Scenario) {
    let session_id = match scenario {
        Scenario::Normal => "sim-normal",
        Scenario::SessionLimit => "sim-session-limit",
        Scenario::Error => "sim-error",
    };
    state.status_store.start_session(session_id).await;
    let usage = simulated_usage(session_id, scenario);
    state.usage_store.set(usage.clone()).await;
    let _ = state.broadcaster.send(ServerEvent::Usage(usage));
    broadcast_status(&state).await;

    let steps: Vec<(ClaudeStatus, LogStream, &str, u64)> = match scenario {
        Scenario::Normal => vec![
            (
                ClaudeStatus::Starting,
                LogStream::System,
                "Starting Claude...",
                1,
            ),
            (
                ClaudeStatus::Working,
                LogStream::Stdout,
                "Reading project files...",
                2,
            ),
            (
                ClaudeStatus::Thinking,
                LogStream::System,
                "No output for a while. Claude may be thinking.",
                2,
            ),
            (
                ClaudeStatus::Working,
                LogStream::Stdout,
                "Refactoring scanner module...",
                2,
            ),
            (
                ClaudeStatus::WaitingInput,
                LogStream::Stdout,
                "Do you want to continue? yes/no",
                2,
            ),
            (
                ClaudeStatus::Working,
                LogStream::Stdout,
                "Applying final changes...",
                2,
            ),
            (
                ClaudeStatus::Completed,
                LogStream::System,
                "Claude completed successfully.",
                1,
            ),
        ],
        Scenario::SessionLimit => vec![
            (
                ClaudeStatus::Starting,
                LogStream::System,
                "Starting Claude...",
                1,
            ),
            (
                ClaudeStatus::Working,
                LogStream::Stdout,
                "Planning requested change...",
                2,
            ),
            (
                ClaudeStatus::SessionLimit,
                LogStream::Stderr,
                "Usage limit reached. Try again later.",
                2,
            ),
        ],
        Scenario::Error => vec![
            (
                ClaudeStatus::Starting,
                LogStream::System,
                "Starting Claude...",
                1,
            ),
            (
                ClaudeStatus::Working,
                LogStream::Stdout,
                "Reading project files...",
                2,
            ),
            (
                ClaudeStatus::Error,
                LogStream::Stderr,
                "Claude exited with a non-zero status.",
                2,
            ),
        ],
    };

    for (status, stream, line, delay) in steps {
        let log = state.status_store.record_output(stream, line).await;
        let _ = state.broadcaster.send(ServerEvent::Log(log));
        state.status_store.set_status(status.clone()).await;
        if matches!(status, ClaudeStatus::Completed) {
            state.status_store.complete(true).await;
        } else if matches!(status, ClaudeStatus::Error | ClaudeStatus::SessionLimit) {
            state.status_store.complete(false).await;
        }
        broadcast_status(&state).await;
        tokio::time::sleep(Duration::from_secs(delay)).await;
    }
}

fn simulated_usage(session_id: &str, scenario: Scenario) -> UsageSnapshot {
    let (five_hour_percent, seven_day_percent) = match scenario {
        Scenario::Normal => (58.0, 34.0),
        Scenario::SessionLimit => (98.0, 76.0),
        Scenario::Error => (44.0, 29.0),
    };

    UsageSnapshot {
        updated_at: chrono::Utc::now(),
        session_id: Some(session_id.to_string()),
        model_name: Some("Claude Sonnet".to_string()),
        context_tokens_used: Some(82_000),
        context_tokens_remaining: Some(118_000),
        context_window_size: Some(200_000),
        context_percent_used: Some(41.0),
        context_percent_remaining: Some(59.0),
        input_tokens: Some(32_000),
        output_tokens: Some(4_200),
        cache_creation_tokens: Some(1_200),
        cache_read_tokens: Some(48_000),
        session_cost_usd: Some(0.18),
        five_hour_percent: Some(five_hour_percent),
        five_hour_resets_at: Some((chrono::Utc::now() + chrono::Duration::hours(2)).to_rfc3339()),
        seven_day_percent: Some(seven_day_percent),
        seven_day_resets_at: Some((chrono::Utc::now() + chrono::Duration::days(3)).to_rfc3339()),
    }
}

async fn broadcast_status(state: &AppState) {
    let snapshot = state.status_store.snapshot().await;
    let _ = state.broadcaster.send(ServerEvent::Status(snapshot));
}
