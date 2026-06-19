use std::io::Write;
use tempfile::NamedTempFile;

use claude_signal::usage_history;

fn write_jsonl(lines: &[&str]) -> NamedTempFile {
    let mut file = NamedTempFile::new().unwrap();
    for line in lines {
        writeln!(file, "{}", line).unwrap();
    }
    file
}

fn assistant_record(session_id: &str, model: &str, input: u64, output: u64) -> String {
    serde_json::json!({
        "type": "assistant",
        "sessionId": session_id,
        "timestamp": "2026-06-19T10:00:00Z",
        "cwd": "/home/user/project",
        "message": {
            "id": format!("msg-{session_id}-{input}"),
            "model": model,
            "usage": {
                "input_tokens": input,
                "output_tokens": output,
                "cache_read_input_tokens": 0,
                "cache_creation_input_tokens": 0
            }
        }
    })
    .to_string()
}

fn assistant_record_no_message_id(session_id: &str, input: u64, output: u64) -> String {
    serde_json::json!({
        "type": "assistant",
        "sessionId": session_id,
        "timestamp": "2026-06-19T10:00:00Z",
        "cwd": "/home/user/project",
        "message": {
            "model": "claude-sonnet-4-20250514",
            "usage": {
                "input_tokens": input,
                "output_tokens": output,
                "cache_read_input_tokens": 0,
                "cache_creation_input_tokens": 0
            }
        }
    })
    .to_string()
}

#[test]
fn parses_valid_assistant_records() {
    let line = assistant_record("sess-1", "claude-sonnet-4-20250514", 1000, 200);
    let file = write_jsonl(&[&line]);

    let snapshot = usage_history::scan_paths(&[file.path().to_path_buf()]);

    assert_eq!(snapshot.turns, 1);
    assert_eq!(snapshot.all_time.input_tokens, 1000);
    assert_eq!(snapshot.all_time.output_tokens, 200);
}

#[test]
fn skips_malformed_json_lines() {
    let valid = assistant_record("sess-1", "claude-sonnet-4-20250514", 500, 100);
    let file = write_jsonl(&["not valid json {{{", &valid, "also broken"]);

    let snapshot = usage_history::scan_paths(&[file.path().to_path_buf()]);

    assert_eq!(snapshot.turns, 1);
    assert_eq!(snapshot.all_time.input_tokens, 500);
}

#[test]
fn skips_non_assistant_records() {
    let user_record = serde_json::json!({
        "type": "user",
        "sessionId": "sess-1",
        "message": { "content": "hello" }
    })
    .to_string();
    let valid = assistant_record("sess-1", "claude-sonnet-4-20250514", 300, 50);
    let file = write_jsonl(&[&user_record, &valid]);

    let snapshot = usage_history::scan_paths(&[file.path().to_path_buf()]);

    assert_eq!(snapshot.turns, 1);
    assert_eq!(snapshot.all_time.input_tokens, 300);
}

#[test]
fn skips_records_with_zero_tokens() {
    let zero = serde_json::json!({
        "type": "assistant",
        "sessionId": "sess-1",
        "timestamp": "2026-06-19T10:00:00Z",
        "cwd": "/home/user/project",
        "message": {
            "id": "msg-zero",
            "model": "claude-sonnet-4-20250514",
            "usage": {
                "input_tokens": 0,
                "output_tokens": 0,
                "cache_read_input_tokens": 0,
                "cache_creation_input_tokens": 0
            }
        }
    })
    .to_string();
    let valid = assistant_record("sess-1", "claude-sonnet-4-20250514", 100, 50);
    let file = write_jsonl(&[&zero, &valid]);

    let snapshot = usage_history::scan_paths(&[file.path().to_path_buf()]);

    assert_eq!(snapshot.turns, 1);
    assert_eq!(snapshot.all_time.input_tokens, 100);
}

#[test]
fn deduplicates_by_message_id() {
    let record = assistant_record("sess-1", "claude-sonnet-4-20250514", 1000, 200);
    // Same message ID appears twice — should be deduplicated
    let file = write_jsonl(&[&record, &record]);

    let snapshot = usage_history::scan_paths(&[file.path().to_path_buf()]);

    assert_eq!(snapshot.turns, 1);
    assert_eq!(snapshot.all_time.input_tokens, 1000);
}

#[test]
fn records_without_message_id_are_not_deduplicated() {
    let r1 = assistant_record_no_message_id("sess-1", 500, 100);
    let r2 = assistant_record_no_message_id("sess-1", 300, 50);
    let file = write_jsonl(&[&r1, &r2]);

    let snapshot = usage_history::scan_paths(&[file.path().to_path_buf()]);

    assert_eq!(snapshot.turns, 2);
    assert_eq!(snapshot.all_time.input_tokens, 800);
}

#[test]
fn skips_records_missing_required_fields() {
    let no_session = serde_json::json!({
        "type": "assistant",
        "message": {
            "id": "msg-1",
            "model": "claude-sonnet-4-20250514",
            "usage": { "input_tokens": 100, "output_tokens": 50 }
        }
    })
    .to_string();
    let no_usage = serde_json::json!({
        "type": "assistant",
        "sessionId": "sess-1",
        "message": { "id": "msg-2", "model": "claude-sonnet-4-20250514" }
    })
    .to_string();
    let file = write_jsonl(&[&no_session, &no_usage]);

    let snapshot = usage_history::scan_paths(&[file.path().to_path_buf()]);

    assert_eq!(snapshot.turns, 0);
}

#[test]
fn handles_empty_file() {
    let file = write_jsonl(&[]);

    let snapshot = usage_history::scan_paths(&[file.path().to_path_buf()]);

    assert_eq!(snapshot.turns, 0);
    assert_eq!(snapshot.transcript_files, 1);
}

#[test]
fn handles_blank_lines() {
    let valid = assistant_record("sess-1", "claude-sonnet-4-20250514", 100, 50);
    let file = write_jsonl(&["", "  ", &valid, ""]);

    let snapshot = usage_history::scan_paths(&[file.path().to_path_buf()]);

    assert_eq!(snapshot.turns, 1);
}
