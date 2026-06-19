# ClaudeSignal

A local-first Claude Code usage dashboard for macOS. Single Rust binary, no database, no telemetry — usage data stays on your machine.

![ClaudeSignal dashboard](docs/screenshots/dashboard.jpg)

## Features

- **Usage totals** — today, this week, all-time tokens and estimated cost
- **Model & project breakdowns** — see which models and projects consume the most
- **Activity chart** — tokens or cost view with 7-day, 4-week, and 6-month ranges
- **Recent sessions** — latest sessions with project, tokens, turns, and cost
- **Animated cat** — mood reacts to your daily token usage (sleeping → calm → curious → focus → busy → tired → overload)
- **Cat speech bubbles** — idle commentary and milestone alerts
- **World clock** — Thailand, UK, Hong Kong, Canada
- **Themes** — Cozy Warm, Matcha Calm, Graphite Focus, Ember Night

## How It Works

ClaudeSignal scans local JSONL transcripts that Claude Code writes automatically:

- `~/.claude/projects/`
- `~/Library/Developer/Xcode/CodingAssistant/ClaudeAgentConfig/projects/`

No API calls, no account access. It reads the files Claude Code already creates on your Mac and aggregates the token usage.

## Quick Start

```bash
# Build
cargo build

# Run
cargo run -- --port 3004 serve

# Open
open http://localhost:3004
```

The terminal also prints a network URL for access from other devices on the same Wi-Fi.

### Optional: live status-line integration

```bash
./scripts/install-claude-wrapper.sh
```

This configures Claude Code to POST live session data to the dashboard while Claude is actively running.

## Cat Moods

| Mood | Trigger | Behavior |
|------|---------|----------|
| Sleeping | 0 tokens today | Eyes closed, slow tail |
| Calm | < 1M tokens | Relaxed breathing |
| Curious | 1M+ tokens | Head tilt, perked ears |
| Focus | 6M+ tokens | Narrowed eyes, tapping paw |
| Busy | 15M+ tokens | Alert ears, active paw |
| Tired | 25M+ tokens | Droopy eyes, yawning |
| Overload | 45M+ tokens | Wide eyes, jitter |

| Sleeping | Calm | Curious |
|:--------:|:----:|:-------:|
| ![sleeping](docs/screenshots/mood-sleeping.png) | ![calm](docs/screenshots/mood-calm.png) | ![curious](docs/screenshots/mood-curious.png) |

| Focus | Tired | Overload |
|:-----:|:-----:|:--------:|
| ![focus](docs/screenshots/mood-focus.png) | ![tired](docs/screenshots/mood-tired.png) | ![overload](docs/screenshots/mood-overload.png) |

## Tech Stack

Rust, Axum, Tokio, static HTML/CSS/JS (no build step)

## Privacy

Everything runs locally. No hosted backend, no telemetry, no uploads. Bind to `0.0.0.0` for LAN access — use only on trusted networks.
