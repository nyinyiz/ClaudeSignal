# API Reference

ClaudeSignal exposes a small local HTTP API plus a WebSocket endpoint. All JSON is served from the same local Axum server as the dashboard.

## Base URL

```text
http://localhost:3000
```

From another device on the same trusted network:

```text
http://<local-ip>:<port>
```

## Endpoints

### `GET /`

Returns the dashboard HTML.

**Response**: `text/html`

### `GET /styles.css`

Returns the dashboard stylesheet.

**Response**: `text/css; charset=utf-8`

### `GET /app.js`

Returns the dashboard JavaScript.

**Response**: `application/javascript; charset=utf-8`

### `GET /api/health`

Health check endpoint.

```json
{
  "ok": true,
  "name": "ClaudeSignal",
  "version": "0.1.0"
}
```

### `GET /api/status`

Returns the current Claude session status snapshot.

```json
{
  "status": "completed",
  "isClaudeRunning": false,
  "lastOutput": "Done",
  "lastActivityAt": "2026-06-17T15:12:05Z",
  "startedAt": "2026-06-17T15:03:18Z",
  "completedAt": "2026-06-17T15:12:05Z",
  "durationSeconds": 527,
  "sessionId": "claude-signal-12345-1781718198",
  "recentLogs": ["..."]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | `offline`, `idle`, `starting`, `working`, `thinking`, `waiting_input`, `completed`, `error`, or `session_limit` |
| `isClaudeRunning` | boolean | Whether a Claude process is active |
| `lastOutput` | string \| null | Most recent output line |
| `lastActivityAt` | ISO 8601 \| null | Most recent activity timestamp |
| `startedAt` | ISO 8601 \| null | Session start timestamp |
| `completedAt` | ISO 8601 \| null | Session completion timestamp |
| `durationSeconds` | integer | Elapsed seconds |
| `sessionId` | string \| null | Session identifier |
| `recentLogs` | string[] | Recent in-memory logs |

### `GET /api/logs`

Returns all entries currently retained in the in-memory log buffer.

```json
{
  "logs": [
    {
      "timestamp": "2026-06-17T15:03:19Z",
      "stream": "system",
      "line": "ClaudeSignal dashboard started"
    }
  ]
}
```

### `GET /api/usage`

Returns the most recent live Claude Code status-line usage snapshot, if one has been posted.

```json
{
  "usage": {
    "sessionId": "session-a",
    "modelName": "Claude Sonnet",
    "contextTokensUsed": 82000,
    "contextTokensRemaining": 118000,
    "contextWindowSize": 200000,
    "contextPercentUsed": 41.0,
    "inputTokens": 32000,
    "outputTokens": 4200,
    "cacheCreationTokens": 1200,
    "cacheReadTokens": 48000,
    "sessionCostUsd": 0.18,
    "fiveHourPercent": 64.0,
    "fiveHourResetsAt": "2026-06-16T15:00:00+00:00",
    "sevenDayPercent": 37.0,
    "sevenDayResetsAt": "2026-06-20T09:00:00+00:00",
    "updatedAt": "2026-06-17T15:12:05Z"
  }
}
```

### `POST /api/usage`

Accepts Claude Code status-line JSON and stores a normalized usage snapshot. The status-line bridge created by the installer uses this endpoint.

**Request**: official Claude Code status-line JSON.

**Response**:

```json
{
  "ok": true,
  "usage": {
    "sessionId": "session-a",
    "modelName": "Claude Sonnet"
  }
}
```

The server also broadcasts a `usage` WebSocket event.

### `GET /api/usage/history`

Scans local Claude Code transcript JSONL files and returns aggregate usage history.

Default scanned locations:

- `~/.claude/projects`
- `~/Library/Developer/Xcode/CodingAssistant/ClaudeAgentConfig/projects`

```json
{
  "generatedAt": "2026-06-17T15:12:05Z",
  "transcriptFiles": 49,
  "turns": 3511,
  "today": {
    "inputTokens": 1200,
    "outputTokens": 140000,
    "cacheReadTokens": 13000000,
    "cacheCreationTokens": 430000,
    "turns": 186,
    "estimatedCostUsd": 13.3
  },
  "week": { "turns": 590, "estimatedCostUsd": 104.0 },
  "allTime": { "turns": 3511, "estimatedCostUsd": 582.0 },
  "byModel": [],
  "topProjects": [],
  "recentSessions": []
}
```

Assistant turns are deduplicated by `message.id`; the last streaming record wins.

### `GET /ws`

WebSocket endpoint for real-time dashboard updates.

```javascript
const ws = new WebSocket(`ws://${window.location.host}/ws`);
```

Events:

```json
{ "type": "status", "data": { "status": "working" } }
```

```json
{ "type": "log", "data": { "stream": "stdout", "line": "Reading files..." } }
```

```json
{ "type": "usage", "data": { "modelName": "Claude Sonnet" } }
```

```json
{ "type": "heartbeat", "data": { "timestamp": "2026-06-17T15:12:05Z" } }
```

## Error Responses

The dashboard API is optimized for a local single-user flow. Normal endpoints return `200 OK`; if the server is unreachable, the client treats it as offline.

## CORS

CORS is not configured. The dashboard and API are same-origin.

## Rate Limiting

None. ClaudeSignal is designed for trusted local-network use.
