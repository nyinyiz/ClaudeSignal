use crate::status::ClaudeStatus;

pub const THINKING_TIMEOUT_SECONDS: u64 = 10;

const SESSION_LIMIT_PATTERNS: &[&str] = &[
    "usage limit",
    "session limit",
    "rate limit",
    "limit reached",
    "try again later",
    "too many requests",
    "quota",
];

const WAITING_INPUT_PATTERNS: &[&str] = &[
    "continue?",
    "yes/no",
    "press enter",
    "waiting for input",
    "do you want to",
    "confirm",
];

pub fn detect_status_from_line(line: &str) -> Option<ClaudeStatus> {
    let lower = line.to_lowercase();
    if SESSION_LIMIT_PATTERNS
        .iter()
        .any(|pattern| lower.contains(pattern))
    {
        return Some(ClaudeStatus::SessionLimit);
    }

    if WAITING_INPUT_PATTERNS
        .iter()
        .any(|pattern| lower.contains(pattern))
    {
        return Some(ClaudeStatus::WaitingInput);
    }

    None
}
