use clap::{Parser, Subcommand, ValueEnum};

#[derive(Debug, Parser)]
#[command(
    name = "claude-signal",
    version,
    about = "Local Claude CLI live status monitor"
)]
pub struct Cli {
    #[arg(long, default_value = "0.0.0.0")]
    pub host: String,
    #[arg(short, long, default_value_t = 3000)]
    pub port: u16,
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Debug, Subcommand)]
pub enum Commands {
    Serve,
    #[command(hide = true)]
    Attach {
        #[arg(long)]
        session_id: Option<String>,
        #[arg(long)]
        parent_pid: Option<i32>,
        #[arg(long)]
        cwd: Option<String>,
    },
    #[command(hide = true)]
    Stop {
        #[arg(long)]
        session_id: Option<String>,
    },
    #[command(hide = true)]
    StopAll,
    #[command(hide = true)]
    StatusLine,
    #[command(hide = true)]
    ServeSession {
        #[arg(long)]
        session_id: String,
        #[arg(long)]
        parent_pid: Option<i32>,
        #[arg(long)]
        cwd: Option<String>,
    },
    Simulate {
        #[arg(long, value_enum, default_value_t = Scenario::Normal)]
        scenario: Scenario,
    },
    Run {
        #[arg(required = true, trailing_var_arg = true)]
        command: Vec<String>,
    },
}

#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum Scenario {
    Normal,
    SessionLimit,
    Error,
}
