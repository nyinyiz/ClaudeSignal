# Contributing

## Prerequisites

- Rust ([rustup.rs](https://rustup.rs/))
- macOS (primary target)

## Commands

```bash
cargo build              # Build
cargo test               # Run all tests
cargo clippy             # Lint
cargo run -- --port 3004 serve      # Run dashboard
cargo run -- --port 3004 simulate   # Run with demo data
```

## Project Structure

```
src/
  main.rs, cli.rs              CLI entry point
  server.rs, routes.rs         Axum server and HTTP routes
  websocket.rs                 WebSocket handler
  status.rs, status_store.rs   Session state types and store
  status_detector.rs           Output pattern matching
  usage.rs                     Live status-line normalization
  usage_history.rs             JSONL transcript scanner
  claude_runner.rs             PTY command execution
  attach.rs                    Multi-session management
web/
  index.html, styles.css, app.js   Dashboard frontend
tests/
  server_routes.rs, status_behavior.rs, usage_history_parsing.rs, websocket_behavior.rs
```

## Adding a New Cat Mood

1. Add to `moodMeta`, `emotionHTML`, `emotionTypes` in `app.js`
2. Add threshold in `MOOD_THRESHOLDS` in `app.js`
3. Add CSS rules for `.hero-card.usage-<mood>` and `.cat-stage[data-mood="<mood>"]` in `styles.css`
4. Add idle bubbles in `idleBubbles` in `app.js`

## Adding a New HTTP Route

1. Add handler in `src/routes.rs`
2. Register in `build_router()`
3. Add test in `tests/server_routes.rs`
