# Contributing to ClaudeSignal

## Prerequisites

- Rust (install from [rustup.rs](https://rustup.rs/))
- `cargo` and `rustc` available in PATH
- macOS (primary target; Linux/Windows support is not guaranteed)

## Build

```bash
cargo build
```

For release builds:

```bash
cargo build --release
```

The binary is output to `target/debug/claude-signal` or `target/release/claude-signal`.

## Run

```bash
# Dashboard only
cargo run -- serve

# Simulator (demo mode)
cargo run -- simulate
cargo run -- simulate --scenario session-limit
cargo run -- simulate --scenario error

# Run a command through the monitor
cargo run -- run -- claude "your prompt here"
```

## Test

```bash
cargo test
```

This runs both unit tests (in `src/`) and integration tests (in `tests/`).

To run a specific test:

```bash
cargo test status_detector_prioritizes
cargo test -- --test-threads=1 server_routes
```

## Lint

```bash
cargo clippy -- -D warnings
```

Fix any warnings before committing. The project does not use `rustfmt` enforcement in CI, but run it manually before submitting:

```bash
cargo fmt
```

## Project Structure

```text
src/
  main.rs            Entry point, CLI dispatch
  lib.rs             Module declarations
  cli.rs             clap CLI definition
  server.rs          Axum server setup, AppState
  routes.rs          HTTP route handlers
  websocket.rs       WebSocket handler
  status.rs          Core types (ClaudeStatus, StatusSnapshot, LogEntry, ServerEvent)
  status_store.rs    In-memory state store
  status_detector.rs Pattern-matching status detection
  log_buffer.rs      Ring buffer for recent logs
  claude_runner.rs   PTY command execution
  attach.rs          Multi-session management
  simulator.rs       Demo mode
  network.rs         Local IP detection
  error.rs           Custom error type
web/
  index.html         Dashboard HTML
  styles.css         Dashboard styles + cat animations
  app.js             Dashboard JavaScript (WebSocket client)
tests/
  server_routes.rs   Integration tests for HTTP endpoints
  status_behavior.rs Unit tests for status, detection, buffer, store
scripts/
  install-claude-wrapper.sh   Installs claude wrapper + slash commands
  dev.sh                      Development helper (if present)
```

## Code Style

- Follow existing conventions. The codebase uses idiomatic Rust with minimal abstraction.
- No comments unless requested. Let the code speak.
- Prefer `anyhow` for error handling in binaries, `thiserror` for library errors.
- Use `tokio::sync::RwLock` for shared async state.
- Keep dependencies minimal — check `Cargo.toml` before adding new crates.

## Commit Messages

- Use imperative mood: "Add feature" not "Added feature"
- Keep subject line under 72 characters
- Reference issues when applicable: "Fix #12: ..."

## Adding a New Status State

1. Add variant to `ClaudeStatus` in `src/status.rs`
2. Add pattern-matching rules in `src/status_detector.rs`
3. Add status metadata (icon, label, description) in `web/app.js`
4. Add CSS animation in `web/styles.css`
5. Update tests in `tests/status_behavior.rs`

## Adding a New HTTP Route

1. Add handler function in `src/routes.rs`
2. Register route in `build_router()`
3. If it needs real-time updates, add a `ServerEvent` variant in `src/status.rs`
4. Add integration test in `tests/server_routes.rs`

## Adding a New CLI Command

1. Add variant to `Commands` enum in `src/cli.rs`
2. Add handler branch in `main.rs`
3. Update README with usage instructions
