# Architecture

ClaudeSignal is a single-binary Rust application that monitors Claude sessions, serves a local dashboard, and summarizes Claude Code usage from local data.

## High-Level Flow

```text
                         ┌─────────────────────────────┐
                         │ Claude Code status-line JSON │
                         └──────────────┬──────────────┘
                                        │ POST /api/usage
                                        ▼
┌──────────────┐ stdout/stderr ┌────────────────┐   broadcast   ┌──────────────┐
│ Claude / CLI │──────────────►│ StatusStore    │──────────────►│ WebSocket /ws│
│ child PTY    │               │ UsageStore     │               └──────┬───────┘
└──────────────┘               └───────┬────────┘                      │
                                       │                               │
                                       ▼                               ▼
                              ┌────────────────┐              ┌────────────────┐
                              │ HTTP API        │─────────────►│ Web dashboard  │
                              │ Axum routes     │              │ cat + usage UI │
                              └───────┬────────┘              └────────────────┘
                                      │
                                      ▼
                         ┌─────────────────────────────┐
                         │ Local Claude JSONL scanner  │
                         │ ~/.claude/projects, Xcode   │
                         └─────────────────────────────┘
```

## Module Responsibilities

### Entry Points

#### `main.rs`

Entry point. Parses CLI arguments via clap and dispatches to the appropriate handler:

- `serve` -- starts the dashboard server only
- `run -- <cmd>` -- runs a command through the PTY monitor
- `simulate` -- replays a demo scenario
- `attach` -- starts or reuses a session-specific dashboard
- `stop` / `stop-all` -- stops background dashboard sessions
- `status-line` -- hidden bridge command for Claude Code status-line JSON
- `serve-session` -- internal worker for attached sessions

#### `cli.rs`

Defines the clap CLI interface. Global options (`--host`, `--port`) apply to all subcommands.

### Server Layer

#### `server.rs`

Creates shared `AppState` and binds Axum. `AppState` contains:

- `status_store: Arc<StatusStore>` -- in-memory session state
- `usage_store: Arc<UsageStore>` -- live usage snapshot
- `broadcaster: broadcast::Sender<ServerEvent>` -- Tokio broadcast channel for WebSocket events

The server prints local and network URLs on startup.

#### `routes.rs`

Registers all HTTP routes and serves static dashboard assets:

- Dashboard HTML/CSS/JS via `include_str!` (compiled into the binary)
- `/api/status` -- returns current `StatusSnapshot`
- `/api/logs` -- returns recent log entries
- `/api/usage` -- GET returns live usage, POST accepts status-line JSON
- `/api/usage/history` -- scans JSONL transcripts and returns aggregated history
- `/api/health` -- returns `{"ok": true, "name": "ClaudeSignal", "version": "..."}`

#### `websocket.rs`

Each WebSocket client receives the current snapshot immediately on connect, then subscribes to broadcast events (status, log, usage, heartbeat). Heartbeats are sent every 15 seconds to keep connections alive.

### Status System

#### `status.rs`

Core types:

- `ClaudeStatus` enum: `Offline`, `Idle`, `Starting`, `Working`, `Thinking`, `WaitingInput`, `Completed`, `Error`, `SessionLimit`
- `StatusSnapshot` -- serializable state including status, timestamps, duration, session ID, recent logs
- `LogEntry` -- timestamped log line with stream type (stdout/stderr/system)
- `ServerEvent` -- tagged enum for WebSocket broadcast: Status, Log, Usage, Heartbeat

#### `status_store.rs`

Async-safe in-memory store using `tokio::sync::RwLock`. Handles:

- Session lifecycle (start, complete, mark offline)
- Output recording with automatic status detection
- Activity tracking with thinking detection (10-second inactivity timeout)
- Log buffer management (max 200 lines)

#### `status_detector.rs`

Pattern-matching heuristic for detecting status from output lines:

- **Session limit**: matches phrases like "usage limit", "rate limit", "quota", "try again later"
- **Waiting input**: matches "continue?", "yes/no", "press enter", "do you want to"
- Falls back to `Working` for any other output

#### `log_buffer.rs`

Ring buffer (`VecDeque`) that stores the last N log entries. Provides recent lines for the status snapshot.

### Usage System

#### `usage.rs`

Normalizes Claude Code status-line JSON into `UsageSnapshot`. Handles multiple field naming conventions (snake_case, camelCase, nested paths) to be resilient against Claude Code API changes.

Tracks: model name, context window usage, input/output/cache tokens, estimated session cost, subscriber rate-limit windows (5-hour and 7-day).

`UsageStore` is a simple `RwLock<Option<UsageSnapshot>>`.

#### `usage_history.rs`

Scans local Claude Code JSONL transcript files from two directories:

- `~/.claude/projects` (Claude Code)
- `~/Library/Developer/Xcode/CodingAssistant/ClaudeAgentConfig/projects` (Xcode integration)

Parses assistant records, deduplicates by `message.id` (last streaming record wins), estimates cost from known model pricing (Opus, Sonnet, Haiku, Fable/Mythos), and aggregates:

- Today / This week / All time totals
- By model breakdown
- Top 5 projects by token volume
- 5 most recent sessions

### Command Execution

#### `claude_runner.rs`

Runs a command through a pseudo-terminal:

1. Opens a PTY via `portable-pty`
2. Spawns the command in the PTY
3. Copies stdin to the PTY
4. Records PTY activity into `StatusStore`
5. Broadcasts status/log events via WebSocket
6. Marks completion or error when the process exits

#### `attach.rs`

Supports `/ClaudeSignal`-style attached dashboards:

- Finds an available port starting from the configured default
- Spawns a detached `serve-session` worker process (with `setsid` for process group isolation)
- Stores session metadata in `/tmp/claude-signal-sessions/<session-id>.json`
- Monitors the parent Claude process PID -- marks offline when it exits
- Reuses an existing session when the session ID already has a running worker

#### `status_line.rs`

Bridge between Claude Code's status-line feature and the dashboard:

1. Reads status-line JSON from stdin
2. Normalizes it into `UsageSnapshot`
3. Posts the raw JSON to the active dashboard's `/api/usage` endpoint
4. Prints a compact terminal status line: `ModelName | ctx N% | session N% | week N%`

The installer writes `~/.claude/claude-signal-statusline.sh` and configures `settings.json`.

### Dashboard (Frontend)

#### `web/index.html`

Static HTML structure with semantic sections:

- Top bar with brand, connection status, and controls
- Dashboard grid: hero card (cat + status) and world clock
- Usage dashboard: history card and recent sessions timeline
- Footer with system status

#### `web/styles.css`

Dark-theme design system using CSS custom properties. Key features:

- CSS-only cat built from div elements (body, head, ears, eyes, nose, mouth, whiskers, paws, tail)
- Mood-driven animations via `data-mood` and `data-pressure` attributes:
  - `cat-breathe` (calm/sleeping), `cat-tired-sway` (tired), `cat-jitter` (overload)
  - `tail-swish` (normal), `tail-alert` (overload), `paw-tap` (focus)
  - `cat-pounce` (click interaction), `cat-blink` (idle blink)
- Eye-tracking via CSS custom properties `--look-x` / `--look-y`
- Responsive grid layouts with breakpoints at 980px and 720px
- JetBrains Mono for monospace, Manrope for sans-serif

#### `web/app.js`

Client-side JavaScript handling:

- WebSocket connection with automatic reconnection (exponential backoff)
- Status rendering with cat mood computation from usage thresholds
- Usage history rendering with token formatting and cost estimation
- World clock updates every second
- Cat interaction: mouse tracking for eye movement, click for pounce animation
- Mood thresholds: sleeping (no data), calm (<500K), curious (500K+), focus (4M+), tired (12M+), overload (30M+)

### Support Modules

#### `network.rs`

Detects the local network IP address for printing the network URL on startup.

#### `error.rs`

Custom error type using `thiserror`.

#### `simulator.rs`

Replays demo scenarios for local UI development. Three scenarios:

- **Normal**: Starting -> Working -> Thinking -> Working -> WaitingInput -> Working -> Completed
- **SessionLimit**: Starting -> Working -> SessionLimit
- **Error**: Starting -> Working -> Error

Each scenario includes simulated usage data with appropriate rate-limit percentages.

## Concurrency Model

- `StatusStore` and `UsageStore` use `tokio::sync::RwLock`
- WebSocket events use a Tokio `broadcast::channel(256)`
- PTY I/O uses a blocking OS thread bridged into Tokio
- Transcript history scanning is synchronous and done on request
- The dashboard polls history every 30 seconds; live status arrives via WebSocket

## Data Flow

1. **Status-line bridge** reads JSON from stdin, posts to `/api/usage`
2. **Server** normalizes into `UsageSnapshot`, stores in `UsageStore`, broadcasts to WebSocket
3. **Dashboard** receives WebSocket event, updates cat mood and usage display
4. **History** is scanned from local JSONL files on each `/api/usage/history` request
5. **Cat mood** is computed from today's and this week's token totals against fixed thresholds

## Privacy Model

ClaudeSignal is local-first:

- No hosted backend, telemetry, uploads, or external API calls
- All data is in-memory, lost on restart
- Transcript files are read locally and summarized in API responses
- The HTTP server binds to the configured host/port -- reachable on the local network
- No authentication -- use only on trusted Wi-Fi
