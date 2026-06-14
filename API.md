# API Reference

ClaudeSignal exposes an HTTP API and a WebSocket endpoint. All responses are JSON.

## Base URL

```text
http://localhost:3000
```

Or from another device on the same network:

```text
http://<local-ip>:3000
```

## Endpoints

### `GET /`

Returns the mobile dashboard HTML page.

**Response**: `text/html`

---

### `GET /styles.css`

Returns the dashboard stylesheet.

**Response**: `text/css; charset=utf-8`

---

### `GET /app.js`

Returns the dashboard JavaScript.

**Response**: `application/javascript; charset=utf-8`

---

### `GET /api/health`

Health check endpoint.

**Response**: `application/json`

```json
{
  "ok": true,
  "name": "ClaudeSignal",
  "version": "0.1.0"
}
```

---

### `GET /api/status`

Returns the current session status snapshot.

**Response**: `application/json`

```json
{
  "status": "working",
  "isClaudeRunning": true,
  "lastOutput": "Refactoring scanner module...",
  "lastActivityAt": "2026-06-16T04:20:15Z",
  "startedAt": "2026-06-16T04:10:00Z",
  "completedAt": null,
  "durationSeconds": 615,
  "sessionId": "claude-signal-12345-1718505000",
  "recentLogs": [
    "Launching Claude command: claude \"review repo\"",
    "Reading project files...",
    "Refactoring scanner module..."
  ]
}
```

**Fields**:

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | One of: `offline`, `idle`, `starting`, `working`, `thinking`, `waiting_input`, `completed`, `error`, `session_limit` |
| `isClaudeRunning` | boolean | Whether a Claude process is currently active |
| `lastOutput` | string \| null | Most recent output line |
| `lastActivityAt` | ISO 8601 \| null | Timestamp of most recent output |
| `startedAt` | ISO 8601 \| null | When the session started |
| `completedAt` | ISO 8601 \| null | When the session finished (null if still running) |
| `durationSeconds` | integer | Elapsed time in seconds |
| `sessionId` | string \| null | Unique session identifier |
| `recentLogs` | string[] | Recent log lines (most recent last) |

---

### `GET /api/logs`

Returns all log entries in the buffer.

**Response**: `application/json`

```json
{
  "logs": [
    {
      "timestamp": "2026-06-16T04:10:01Z",
      "stream": "system",
      "line": "Launching Claude command: claude \"review repo\""
    },
    {
      "timestamp": "2026-06-16T04:10:03Z",
      "stream": "stdout",
      "line": "Reading project files..."
    },
    {
      "timestamp": "2026-06-16T04:10:05Z",
      "stream": "stderr",
      "line": "Warning: deprecated function"
    }
  ]
}
```

**Log entry fields**:

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | ISO 8601 | When the line was recorded |
| `stream` | string | One of: `stdout`, `stderr`, `system` |
| `line` | string | The log line content |

---

### `GET /ws`

WebSocket endpoint for real-time updates.

**Protocol**: `ws://` or `wss://`

#### Connection

```javascript
const ws = new WebSocket(`ws://${window.location.host}/ws`);
```

#### Events

On connect, the server immediately sends the current status snapshot. After that, it streams events as they occur.

**Status event** — sent whenever the session state changes:

```json
{
  "type": "status",
  "data": {
    "status": "working",
    "isClaudeRunning": true,
    "lastOutput": "Reading project files...",
    "lastActivityAt": "2026-06-16T04:20:15Z",
    "startedAt": "2026-06-16T04:10:00Z",
    "completedAt": null,
    "durationSeconds": 615,
    "sessionId": "claude-signal-12345-1718505000",
    "recentLogs": ["..."]
  }
}
```

**Log event** — sent for each new output line:

```json
{
  "type": "log",
  "data": {
    "timestamp": "2026-06-16T04:20:15Z",
    "stream": "stdout",
    "line": "Reading project files..."
  }
}
```

**Heartbeat event** — sent every 15 seconds to keep the connection alive:

```json
{
  "type": "heartbeat",
  "data": {
    "timestamp": "2026-06-16T04:20:15Z"
  }
}
```

#### Client Behavior

- Reconnect automatically on disconnect with exponential backoff (starts at 500ms, max 6s)
- The initial snapshot on connect provides the current state without polling
- No client → server messages are used (server ignores incoming data except close frames)

## Status State Machine

```text
                 ┌──────────┐
                 │ Offline  │
                 └────┬─────┘
                      │ start_session()
                      ▼
                 ┌──────────┐
            ┌───►│ Starting │
            │    └────┬─────┘
            │         │ record_output()
            │         ▼
            │    ┌──────────┐
            │    │ Working  │◄──────────────┐
            │    └────┬─────┘               │
            │         │                     │
            │         ├── 10s no output ────┤
            │         │                     │
            │         ▼                     │
            │    ┌──────────┐               │
            │    │ Thinking │───────────────┘
            │    └────┬─────┘  record_output()
            │         │
            │         ├── "continue?" matched ──► WaitingInput ──► record_output() ──► Working
            │         │
            │         ├── "usage limit" matched ──► SessionLimit ──► complete(false)
            │         │
            │         └── process exit ──► Completed (success) or Error (failure)
            │
            └── parent PID dies ──► Offline
```

## Error Responses

The API does not return error status codes under normal operation. All endpoints return 200 OK. If the server is unreachable, the client is offline.

## Rate Limiting

None. The server is designed for a single dashboard client on a local network.

## CORS

Not configured. The server is same-origin only (dashboard served from the same host).
