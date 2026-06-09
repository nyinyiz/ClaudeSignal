use thiserror::Error;

#[derive(Debug, Error)]
pub enum ClaudeSignalError {
    #[error("command cannot be empty")]
    EmptyCommand,
}
