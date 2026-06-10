use std::collections::VecDeque;

use crate::status::LogEntry;

#[derive(Debug)]
pub struct LogBuffer {
    max_len: usize,
    entries: VecDeque<LogEntry>,
}

impl LogBuffer {
    pub fn new(max_len: usize) -> Self {
        Self {
            max_len: max_len.max(1),
            entries: VecDeque::new(),
        }
    }

    pub fn push(&mut self, entry: LogEntry) {
        if self.entries.len() == self.max_len {
            self.entries.pop_front();
        }
        self.entries.push_back(entry);
    }

    pub fn entries(&self) -> Vec<LogEntry> {
        self.entries.iter().cloned().collect()
    }

    pub fn recent_lines(&self) -> Vec<String> {
        self.entries
            .iter()
            .map(|entry| entry.line.clone())
            .collect()
    }
}
