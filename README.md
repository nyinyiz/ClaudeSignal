# ClaudeSignal

ClaudeSignal is a local-first dashboard for Claude Code and Claude CLI sessions. It runs on your Mac, serves a web dashboard on your local network, and shows live session status, an animated cat companion that reacts to your usage, and detailed usage history parsed from local Claude Code transcripts.

No cloud service, telemetry, uploads, or hosted database. Everything stays on your machine.

## Dashboard

![ClaudeSignal dashboard](docs/screenshots/dashboard.jpg)

The top card features an animated cat whose mood, expression, and animations change based on your real-time token usage:

| Mood | Trigger | Cat behavior |
|------|---------|-------------|
| **Sleeping** | No usage history yet | Eyes closed, slow tail swish |
| **Calm** | < 500K tokens today | Relaxed breathing, gentle tail |
| **Curious** | 500K+ tokens today | Head tilt, perked ears |
| **Focus** | 4M+ tokens today | Narrowed eyes, tapping paw |
| **Tired** | 12M+ tokens today | Droopy eyes, yawning mouth, tired sway |
| **Overload** | 30M+ tokens today | Wide startled eyes, jitter animation |

The cat briefing summarizes your day in plain language:

```text
Good evening. You used 14M tokens today across 186 turns ($13.3).
That's 13% of this week and 1.6% of all-time usage.
The cat is tired because today's usage is already heavy.
```

The cat also responds to interaction -- mouse movement makes its eyes follow your cursor, and clicking triggers a playful pounce animation.

## Cat Mood Gallery

| Sleeping | Calm | Curious |
|:--------:|:----:|:-------:|
| ![sleeping](docs/screenshots/mood-sleeping.png) | ![calm](docs/screenshots/mood-calm.png) | ![curious](docs/screenshots/mood-curious.png) |

| Focus | Tired | Overload |
|:-----:|:-----:|:--------:|
| ![focus](docs/screenshots/mood-focus.png) | ![tired](docs/screenshots/mood-tired.png) | ![overload](docs/screenshots/mood-overload.png) |

## Quick Start

### 1. Build

```bash
cd /Volumes/Nyi-Nyi-Sandisk/Claude/ClaudeSignal
cargo build
```

### 2. Install the wrapper

```bash
./scripts/install-claude-wrapper.sh
```

This does three things:

- Installs a `claude` wrapper at `~/.local/bin/claude` that launches ClaudeCode through ClaudeSignal
- Creates a status-line bridge at `~/.claude/claude-signal-statusline.sh`
- Configures Claude Code `statusLine` settings so usage data streams to the dashboard automatically

### 3. Run Claude normally

Open a **new terminal** (so PATH picks up the wrapper):

```bash
claude "summarize this repo"
```

### 4. Open the dashboard

Inside Claude, type:

```text
/ClaudeSignal
```

ClaudeSignal prints a local URL and a network URL. Open the network URL from any device on the same Wi-Fi to view the dashboard.

## Run Manually

```bash
# Dashboard only (no Claude process monitoring)
cargo run -- serve

# Simulator with demo scenarios
cargo run -- simulate
cargo run -- simulate --scenario session-limit
cargo run -- simulate --scenario error

# Run a command through the monitor
cargo run -- run -- claude "review this repository"

# Custom port
cargo run -- --port 3004 serve
```

## What the Dashboard Shows

### Live Status Panel

The hero card shows:

- **Cat companion** with mood-driven animations and expressions
- **Status chip** with current state (Sleeping, Calm, Curious, Focus, Tired, Overload)
- **Cat briefing** summarizing today's usage in natural language
- **Uptime** and **last activity** timestamps

### World Clock

Shows the current time in four locations for quick working-hour context:

- Thailand (ICT, UTC+7)
- UK (GMT, UTC+0)
- Hong Kong (HKT, UTC+8)
- Canada (EST, UTC-5)

### Usage History

Scans local Claude Code JSONL transcripts from:

- `~/.claude/projects`
- `~/Library/Developer/Xcode/CodingAssistant/ClaudeAgentConfig/projects`

Displays:

- **Today / This week / All time** token totals with cost estimates
- **By model** breakdown (Opus, Sonnet, Haiku, etc.)
- **Top projects** ranked by token usage
- **Recent sessions** timeline with per-session summaries

History is polled every 30 seconds. Live status arrives over WebSocket in real time.

## Architecture

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

See [ARCHITECTURE.md](ARCHITECTURE.md) for module-level details.

## HTTP Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/` | GET | Dashboard HTML |
| `/styles.css` | GET | Dashboard stylesheet |
| `/app.js` | GET | Dashboard JavaScript |
| `/api/health` | GET | Health check |
| `/api/status` | GET | Current session status |
| `/api/logs` | GET | Recent log entries |
| `/api/usage` | GET | Live usage snapshot |
| `/api/usage` | POST | Post status-line JSON |
| `/api/usage/history` | GET | Aggregated usage history |
| `/ws` | GET | WebSocket for real-time updates |

See [API.md](API.md) for request/response schemas.

## Tech Stack

- **Rust** -- single binary, zero runtime dependencies
- **Axum** -- HTTP server with WebSocket support
- **Tokio** -- async runtime
- **portable-pty** -- pseudo-terminal for command monitoring
- **Static HTML/CSS/JS** -- no frontend build step
- **Local JSONL scanning** -- reads Claude Code transcripts directly

## Privacy and Security

ClaudeSignal is local-first:

- No hosted backend, telemetry, uploads, or external API calls
- Local transcript scanning only
- All data is in-memory, lost on restart
- Binds to `0.0.0.0:3000` by default -- accessible on your local network

**Use only on trusted, private Wi-Fi networks.** Do not port-forward to the internet.

See [SECURITY.md](SECURITY.md) for the full threat model and mitigations.

## Troubleshooting

**Dashboard does not update:**

- Restart the dashboard process
- Re-run `./scripts/install-claude-wrapper.sh`
- Open a new terminal after installing the wrapper
- Make sure you are opening the correct port

**Phone or another browser cannot open the dashboard:**

- Both devices must be on the same Wi-Fi
- Use the network URL, not `localhost`
- Check the Mac firewall settings
- Try another port: `--port 3004`

**Usage history is empty:**

- Run Claude Code at least once so JSONL transcripts exist
- Check whether `~/.claude/projects` exists
- Xcode Claude integration transcripts are scanned separately if present

## Known Limitations

- Claude CLI state detection uses local heuristics (pattern matching on output)
- Claude Code plan limits are only shown when Claude exposes them locally
- Cost is estimated from known model pricing and local token counts
- No authentication yet -- use only on trusted local networks

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for build, test, and development instructions.
