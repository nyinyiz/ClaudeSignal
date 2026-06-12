use clap::Parser;
use claude_signal::{
    attach, claude_runner,
    cli::{Cli, Commands},
    server::{self, AppState},
    simulator,
    status::ClaudeStatus,
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    let cli = Cli::parse();
    let state = AppState::new(200);

    match cli.command {
        Commands::Serve => server::serve(state, &cli.host, cli.port).await,
        Commands::Attach {
            session_id,
            parent_pid,
            cwd,
        } => {
            let session_id = session_id
                .or_else(|| std::env::var("CLAUDE_SIGNAL_SESSION_ID").ok())
                .unwrap_or_else(|| format!("manual-{}", uuid::Uuid::new_v4()));
            let parent_pid =
                parent_pid.or_else(|| std::env::var("CLAUDE_SIGNAL_CLAUDE_PID").ok()?.parse().ok());
            let cwd = cwd.or_else(|| {
                std::env::current_dir()
                    .ok()
                    .map(|path| path.display().to_string())
            });
            attach::attach(&cli.host, cli.port, session_id, parent_pid, cwd)?;
            Ok(())
        }
        Commands::Stop { session_id } => {
            let session_id = session_id
                .or_else(|| std::env::var("CLAUDE_SIGNAL_SESSION_ID").ok())
                .unwrap_or_else(|| "manual".to_string());
            attach::stop(session_id)?;
            Ok(())
        }
        Commands::StopAll => {
            attach::stop_all()?;
            Ok(())
        }
        Commands::ServeSession {
            session_id,
            parent_pid,
            cwd,
        } => {
            state.status_store.start_session(session_id).await;
            state.status_store.set_status(ClaudeStatus::Idle).await;
            if let Some(cwd) = cwd {
                state
                    .status_store
                    .add_system_log(format!("ClaudeSignal attached to {cwd}"))
                    .await;
            }
            let monitor_state = state.clone();
            tokio::spawn(async move {
                attach::monitor_parent(monitor_state, parent_pid).await;
            });
            server::serve(state, &cli.host, cli.port).await
        }
        Commands::Simulate { scenario } => {
            let simulation_state = state.clone();
            tokio::spawn(async move {
                simulator::run(simulation_state, scenario).await;
            });
            server::serve(state, &cli.host, cli.port).await
        }
        Commands::Run { command } => {
            let server_state = state.clone();
            let host = cli.host.clone();
            let server_task = tokio::spawn(async move {
                if let Err(error) = server::serve(server_state, &host, cli.port).await {
                    tracing::warn!(%error, "ClaudeSignal dashboard server unavailable; continuing Claude normally");
                }
            });

            let result = claude_runner::run_command(state, command).await;
            server_task.abort();
            result
        }
    }
}
