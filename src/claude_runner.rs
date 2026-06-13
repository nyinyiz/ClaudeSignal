use std::{
    io::{Read, Write},
    thread,
    time::Duration,
};

use anyhow::Context;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tokio::runtime::Handle;
use uuid::Uuid;

use crate::{
    error::ClaudeSignalError,
    server::AppState,
    status::{ClaudeStatus, ServerEvent},
    status_detector::THINKING_TIMEOUT_SECONDS,
};

pub async fn run_command(state: AppState, command: Vec<String>) -> anyhow::Result<()> {
    let (program, args) = command
        .split_first()
        .ok_or(ClaudeSignalError::EmptyCommand)?;

    state
        .status_store
        .start_session(format!("local-{}", Uuid::new_v4()))
        .await;
    broadcast_status(&state).await;

    let log = state
        .status_store
        .add_system_log(format_launch_message(program, args))
        .await;
    let _ = state.broadcaster.send(ServerEvent::Log(log));
    broadcast_status(&state).await;

    spawn_thinking_watcher(state.clone());

    let program = program.clone();
    let args = args.to_vec();
    let pty_state = state.clone();
    let handle = Handle::current();
    let success =
        tokio::task::spawn_blocking(move || run_command_in_pty(pty_state, handle, &program, &args))
            .await??;

    state.status_store.complete(success).await;
    let line = if success {
        "Claude process completed."
    } else {
        "Claude process exited with an error."
    };
    let log = state.status_store.add_system_log(line).await;
    let _ = state.broadcaster.send(ServerEvent::Log(log));
    if success {
        state.status_store.set_status(ClaudeStatus::Completed).await;
    } else {
        state.status_store.set_status(ClaudeStatus::Error).await;
    }
    broadcast_status(&state).await;
    Ok(())
}

fn run_command_in_pty(
    state: AppState,
    handle: Handle,
    program: &str,
    args: &[String],
) -> anyhow::Result<bool> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 40,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .context("failed to open pseudo-terminal")?;

    let mut command = CommandBuilder::new(program);
    for arg in args {
        command.arg(arg);
    }

    let mut child = pair
        .slave
        .spawn_command(command)
        .with_context(|| format!("failed to spawn `{program}` in pseudo-terminal"))?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader()?;
    let mut writer = pair.master.take_writer()?;

    let _input_thread = thread::spawn(move || {
        let mut stdin = std::io::stdin();
        let _ = std::io::copy(&mut stdin, &mut writer);
    });

    let output_state = state.clone();
    let output_handle = handle.clone();
    let output_thread = thread::spawn(move || {
        let mut stdout = std::io::stdout();
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    let _ = stdout.write_all(&buffer[..n]);
                    let _ = stdout.flush();
                    output_handle.block_on(async {
                        output_state.status_store.touch_activity().await;
                        broadcast_status(&output_state).await;
                    });
                }
                Err(_) => break,
            }
        }
    });

    let status = child.wait()?;
    let _ = output_thread.join();
    Ok(status.success())
}

fn spawn_thinking_watcher(state: AppState) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(THINKING_TIMEOUT_SECONDS));
        loop {
            ticker.tick().await;
            let snapshot = state.status_store.snapshot().await;
            if !snapshot.is_claude_running {
                break;
            }
            if let Some(last_activity_at) = snapshot.last_activity_at {
                let inactive = (chrono::Utc::now() - last_activity_at).num_seconds().max(0) as u64;
                if state.status_store.mark_thinking_if_inactive(inactive).await {
                    broadcast_status(&state).await;
                }
            }
        }
    });
}

async fn broadcast_status(state: &AppState) {
    let snapshot = state.status_store.snapshot().await;
    let _ = state.broadcaster.send(ServerEvent::Status(snapshot));
}

fn format_launch_message(program: &str, args: &[String]) -> String {
    let mut command = vec![shell_quote(program)];
    command.extend(args.iter().map(|arg| shell_quote(arg)));
    format!("Launching Claude command: {}", command.join(" "))
}

fn shell_quote(value: &str) -> String {
    if value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.' | '/' | ':'))
    {
        value.to_string()
    } else {
        format!("\"{}\"", value.replace('"', "\\\""))
    }
}

#[cfg(test)]
mod tests {
    use super::format_launch_message;

    #[test]
    fn launch_message_quotes_prompt_arguments() {
        let args = vec!["summarize this repo".to_string()];

        assert_eq!(
            format_launch_message("claude", &args),
            "Launching Claude command: claude \"summarize this repo\""
        );
    }
}
