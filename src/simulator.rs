use std::time::Duration;

use crate::{
    cli::Scenario,
    server::AppState,
    status::{ClaudeStatus, LogStream, ServerEvent},
};

pub async fn run(state: AppState, scenario: Scenario) {
    let session_id = match scenario {
        Scenario::Normal => "sim-normal",
        Scenario::SessionLimit => "sim-session-limit",
        Scenario::Error => "sim-error",
    };
    state.status_store.start_session(session_id).await;
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
            let mut ok = false;
            if matches!(status, ClaudeStatus::SessionLimit) {
                ok = false;
            }
            if matches!(status, ClaudeStatus::Error) {
                state.status_store.complete(ok).await;
            }
        }
        broadcast_status(&state).await;
        tokio::time::sleep(Duration::from_secs(delay)).await;
    }
}

async fn broadcast_status(state: &AppState) {
    let snapshot = state.status_store.snapshot().await;
    let _ = state.broadcaster.send(ServerEvent::Status(snapshot));
}
