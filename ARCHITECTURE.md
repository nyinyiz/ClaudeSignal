# Architecture

ClaudeSignal is a single-binary Rust application that monitors Claude CLI sessions and serves a real-time dashboard over HTTP/WebSocket.

## High-Level Flow

```text
┌──────────────┐     stdout/stderr      ┌──────────────────┐
│  Claude CLI  │ ──────────────────────► │  claude_runner   │
│  (child PTY) │ ◄──── stdin ─────────── │  (portable-pty)  │
└──────────────┘                         └────────┬─────────┘
                                                  │
                                          record_output() / touch_activity()
                                                  │
                                                  ▼
                                         ┌──────────────────┐
                                         │   StatusStore    │
                                         │  (RwLock state)  │
                                         └────────┬─────────┘
                                                  │
                                         broadcast::Sender
                                                  │
                        ┌─────────────────────────┼─────────────────────────┐
                        │                         │                         │
                        ▼                         ▼                         ▼
               ┌────────────────┐      ┌────────────────┐      ┌────────────────┐
               │  GET /api/status│      │  WebSocket /ws │      │  GET /api/logs │
               │  (snapshot)     │      │  (live events) │      │  (full buffer) │
               └────────────────┘      └────────────────┘      └────────────────┘
                        │                         │
                        ▼                         ▼
               ┌─────────────────────────────────────────┐
               │         Mobile Dashboard (web/)         │
               │   HTML + CSS cat + vanilla JS client    │
               └─────────────────────────────────────────┘
```

## Module Responsibilities

### `cli.rs` — Command Definition

Defines the CLI interface using `clap`. Commands:

| Command | Purpose |
|---------|---------|
| `serve` | Start the dashboard server only |
| `run -- <cmd>` | Execute a command through the monitor |
| `simulate` | Run a demo scenario |
| `attach` | Start a background session monitor |
| `stop` / `stop-all` | Kill background sessions |

Global flags: `--host` (default `0.0.0.0`), `--port` (default `3000`).

### `server.rs` — Server Setup

- Creates `AppState` (shared state container)
- Binds Axum to the configured address
- Prints startup URLs (local + network)

`AppState` holds:
- `status_store: Arc<StatusStore>` — the single source of truth for session state
- `broadcaster: broadcast::Sender<ServerEvent>` — fans out events to all WebSocket clients

### `status.rs` — Core Types

**`ClaudeStatus`** — the 9-state enum:
- `Offline` — no session active
- `Idle` — session attached but Claude quiet
- `Starting` — session just began
- `Working` — Claude is actively producing output
- `Thinking` — no output for ≥10s (heuristic)
- `WaitingInput` — pattern matched in output (e.g. "continue?")
- `Completed` — finished successfully
- `Error` — finished with error
- `SessionLimit` — pattern matched (e.g. "usage limit")

**`StatusSnapshot`** — serializable snapshot of current state, sent to clients.

**`LogEntry`** — single log line with timestamp + stream tag (stdout/stderr/system).

**`ServerEvent`** — tagged enum for WebSocket messages: `Status`, `Log`, `Heartbeat`.

### `status_store.rs` — In-Memory State

Thread-safe store using `tokio::sync::RwLock`. Key methods:

- `start_session()` — initializes a new session
- `record_output()` — logs a line, detects status changes, updates snapshot
- `touch_activity()` — updates last activity timestamp (for PTY mode)
- `mark_thinking_if_inactive()` — transitions to Thinking after timeout
- `complete()` — marks session as finished
- `mark_offline()` — marks session as disconnected

The ring buffer (`LogBuffer`) retains the most recent N log lines (default 200).

### `status_detector.rs` — Heuristic Detection

Pattern-matching on lowercase output lines:

1. **Session limit** — checked first. Patterns: "usage limit", "session limit", "rate limit", "limit reached", "try again later", "too many requests", "quota"
2. **Waiting input** — checked second. Patterns: "continue?", "yes/no", "press enter", "waiting for input", "do you want to", "confirm"
3. **Thinking** — not pattern-based. Triggered when `is_claude_running == true` and no activity for ≥10 seconds.

Session limit patterns take priority over waiting-input patterns.

### `claude_runner.rs` — PTY Execution

Spawns the target command in a pseudo-terminal:

1. Opens a PTY pair (40 rows × 120 cols)
2. Spawns the command on the slave side
3. Spawns an input thread: copies stdin → PTY writer
4. Spawns an output thread: reads PTY reader → stdout + `touch_activity()`
5. Waits for child process to exit
6. Reports success/failure via `complete()`

A background "thinking watcher" task ticks every 10s and calls `mark_thinking_if_inactive()`.

### `attach.rs` — Multi-Session Management

For running multiple Claude sessions with independent dashboards:

- Spawns a background `serve-session` process per session
- Stores session metadata in `/tmp/claude-signal-sessions/<id>.json`
- Monitors parent PID — if the parent dies, marks session offline
- Auto-discovers available ports starting from the configured port
- Uses `setsid()` (Unix) to detach worker processes from the terminal

### `websocket.rs` — Real-Time Events

Each WebSocket connection:
1. Receives the current snapshot immediately on connect
2. Subscribes to the broadcast channel
3. Forwards all `ServerEvent`s as JSON
4. Sends a heartbeat every 15 seconds
5. Handles clean disconnect on close/error

### `simulator.rs` — Demo Mode

Replays predefined scenarios with timed delays:
- **Normal**: Starting → Working → Thinking → Working → WaitingInput → Working → Completed
- **SessionLimit**: Starting → Working → SessionLimit
- **Error**: Starting → Working → Error

## Data Flow for `run` Command

```text
1. User runs: cargo run -- run -- claude "summarize repo"
2. main.rs starts the Axum server in a background task
3. claude_runner::run_command() is called
4. Session starts: status = Starting
5. System log: "Launching Claude command: claude \"summarize repo\""
6. PTY opens, command spawns
7. Output thread reads PTY → stdout, calls touch_activity()
8. WebSocket clients receive Status + Log events in real time
9. Command finishes → complete(true/false)
10. Server task is aborted, process exits
```

## Data Flow for `attach` Command

```text
1. User types /ClaudeSignal in Claude CLI
2. Wrapper script calls: claude-signal attach --session-id ... --parent-pid ... --cwd ...
3. attach() checks for existing session on disk
4. If none: finds available port, spawns serve-session worker
5. Worker starts Axum server, monitors parent PID
6. Dashboard accessible at http://<local-ip>:<port>
7. When Claude CLI exits: parent PID dies → worker detects → marks offline
```

## Concurrency Model

- **StatusStore**: single `RwLock` per field group, no contention in normal operation
- **Broadcast channel**: capacity 256, lagged clients skip missed events
- **PTY output**: dedicated OS thread (blocking I/O), bridges to tokio via `Handle::block_on()`
- **WebSocket**: one tokio task per connection, selects on broadcast recv / heartbeat tick / client messages
- **Thinking watcher**: single tokio task per session, 10s interval
