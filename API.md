# API Reference

Local HTTP API served from the same Axum server as the dashboard.

## Endpoints

| Route | Method | Description |
|-------|--------|-------------|
| `/` | GET | Dashboard HTML |
| `/styles.css` | GET | Stylesheet |
| `/app.js` | GET | JavaScript |
| `/api/health` | GET | Health check |
| `/api/status` | GET | Current session status |
| `/api/logs` | GET | Recent log entries |
| `/api/usage` | GET | Live status-line usage snapshot |
| `/api/usage` | POST | Post Claude Code status-line JSON |
| `/api/usage/history` | GET | Aggregated local transcript usage |
| `/ws` | GET | WebSocket for real-time updates |

## Key Responses

### `GET /api/status`

```json
{
  "status": "working",
  "isClaudeRunning": true,
  "lastActivityAt": "2026-06-17T15:12:05Z",
  "durationSeconds": 527,
  "recentLogs": []
}
```

Status values: `offline`, `idle`, `starting`, `working`, `thinking`, `waiting_input`, `completed`, `error`, `session_limit`

### `GET /api/usage/history`

Scans JSONL transcripts from `~/.claude/projects` and Xcode paths.

```json
{
  "generatedAt": "2026-06-17T15:12:05Z",
  "transcriptFiles": 49,
  "turns": 3511,
  "today": { "inputTokens": 0, "outputTokens": 0, "turns": 0, "estimatedCostUsd": 0 },
  "week": {},
  "allTime": {},
  "byModel": [],
  "topProjects": [],
  "recentSessions": [],
  "dailyActivity": [],
  "weeklyActivity": [],
  "monthlyActivity": []
}
```

### `GET /ws`

WebSocket events:

```json
{ "type": "status", "data": { "status": "working" } }
{ "type": "log", "data": { "stream": "stdout", "line": "..." } }
{ "type": "usage", "data": { "modelName": "Claude Sonnet" } }
{ "type": "heartbeat", "data": { "timestamp": "..." } }
```

## Notes

- No CORS (same-origin only)
- No authentication or rate limiting — designed for trusted local networks
