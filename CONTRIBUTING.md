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

# Custom port
cargo run -- --port 3004 serve
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

Fix any warnings before committing. Run `cargo fmt` before submitting.

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
  status_store.rs    In-memory state store with async locks
  status_detector.rs Pattern-matching status detection
  log_buffer.rs      Ring buffer for recent logs
  usage.rs           UsageSnapshot normalization from status-line JSON
  usage_history.rs   JSONL transcript scanning and aggregation
  claude_runner.rs   PTY command execution
  attach.rs          Multi-session management
  status_line.rs     Status-line bridge (stdin -> dashboard)
  simulator.rs       Demo mode with scenarios
  network.rs         Local IP detection
  error.rs           Custom error type
web/
  index.html         Dashboard HTML
  styles.css         Dashboard styles + cat animations
  app.js             Dashboard JavaScript (WebSocket client, cat mood logic)
tests/
  server_routes.rs   Integration tests for HTTP endpoints
  status_behavior.rs Unit tests for status, detection, buffer, store
scripts/
  install-claude-wrapper.sh   Installs claude wrapper + status-line bridge
  dev.sh                      Development helper
  capture-moods.mjs           Screenshot capture for cat moods
```

## Code Style

- Follow existing conventions. The codebase uses idiomatic Rust with minimal abstraction.
- No comments unless requested. Let the code speak.
- Prefer `anyhow` for error handling in binaries, `thiserror` for library errors.
- Use `tokio::sync::RwLock` for shared async state.
- Keep dependencies minimal -- check `Cargo.toml` before adding new crates.

## Commit Messages

- Use imperative mood: "Add feature" not "Added feature"
- Keep subject line under 72 characters
- Reference issues when applicable: "Fix #12: ..."

## Adding a New Status State

1. Add variant to `ClaudeStatus` in `src/status.rs`
2. Add pattern-matching rules in `src/status_detector.rs`
3. Add status metadata (icon, label, description) in `web/app.js` (`moodMeta`, `emotionHTML`, `emotionTypes`)
4. Add CSS animation in `web/styles.css` (keyframes + `[data-mood="..."]` rules)
5. Add mood threshold logic in `web/app.js` (`catMoodFromState`)
6. Update tests in `tests/status_behavior.rs`

## Adding a New Cat Mood

1. Add mood name to `moodMeta` in `web/app.js`
2. Add emotion HTML in `emotionHTML`
3. Add emotion type in `emotionTypes`
4. Add threshold logic in `catMoodFromState()`
5. Add mood description in `catMoodSentence()`
6. Add CSS class `.hero-card.usage-<mood>` and `.cat-stage[data-mood="<mood>"]` rules in `styles.css`
7. Add keyframe animations if needed

## Adding a New HTTP Route

1. Add handler function in `src/routes.rs`
2. Register route in `build_router()`
3. If it needs real-time updates, add a `ServerEvent` variant in `src/status.rs`
4. Add integration test in `tests/server_routes.rs`

## Adding a New CLI Command

1. Add variant to `Commands` enum in `src/cli.rs`
2. Add handler branch in `main.rs`
3. Update README with usage instructions

## Screenshots

To regenerate cat mood screenshots:

```bash
npm install playwright
npx playwright install chromium
node scripts/capture-moods.mjs
```

This starts the server, injects mock usage data for each mood threshold, and saves screenshots to `docs/screenshots/`.
