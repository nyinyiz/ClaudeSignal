# Security

## Threat Model

ClaudeSignal is designed for **trusted local networks only**. It is not hardened for internet-facing deployment.

### What ClaudeSignal exposes

- Claude CLI output (stdout/stderr) — may contain code, file paths, error messages, and terminal content
- Session metadata (status, timestamps, session ID)
- System logs (command launch messages, status transitions)

### What ClaudeSignal does NOT expose

- Authentication credentials
- File system contents (only CLI output is captured)
- Network access beyond the local machine
- Persistent storage (all data is in-memory, lost on restart)

## Network Exposure

ClaudeSignal binds to `0.0.0.0:3000` by default, making it accessible to any device on the local network.

**Risks:**
- Any device on the same Wi-Fi can view the dashboard
- Any device on the same Wi-Fi can read Claude CLI output via `/api/status`, `/api/logs`, or WebSocket
- No authentication or authorization is enforced

**Mitigations:**
- Use only on trusted, private Wi-Fi networks
- Do not port-forward to the internet
- Do not use on public or shared networks (cafes, airports, hotels)
- Consider firewall rules to restrict access to known devices

## Authentication

The MVP has **no authentication**. This is a deliberate tradeoff for simplicity.

Recommended future additions:
- Password or pairing code (shared secret)
- localhost-only mode (no network access)
- mTLS or token-based auth

## Data Lifecycle

| Data | Storage | Lifetime |
|------|---------|----------|
| Status snapshot | In-memory `RwLock` | Until process restart |
| Log buffer | In-memory `VecDeque` | Until process restart (max 200 lines) |
| Session files | `/tmp/claude-signal-sessions/` | Until session stops or process restart |
| WebSocket state | Per-connection tokio task | Until client disconnects |

No data is written to persistent storage. No data leaves the local machine.

## Session Files

The `attach` command writes session metadata to `/tmp/claude-signal-sessions/<session-id>.json`:

```json
{
  "session_id": "claude-signal-12345-1718505000",
  "port": 3000,
  "worker_pid": 12345,
  "parent_pid": 67890,
  "cwd": "/Users/nyinyizaw/Documents/my-project"
}
```

**Risks:**
- Session files are world-readable on macOS/Linux (default `/tmp` permissions)
- Files contain the working directory path and process IDs

**Mitigations:**
- Files are deleted when the session stops
- Files are in `/tmp` which is cleared on reboot
- Consider using a private directory or restrictive permissions in future versions

## PTY Security

The `claude_runner` module spawns commands in a pseudo-terminal. The PTY inherits the calling user's permissions.

**Risks:**
- The monitored command runs with full user permissions
- PTY output is buffered in memory and broadcast to WebSocket clients

**Mitigations:**
- Only run commands you trust
- The PTY does not escalate privileges beyond the calling user

## WebSocket Security

- No authentication on the WebSocket endpoint
- Any device on the network can connect and receive real-time Claude output
- The server does not validate the `Origin` header

**Mitigations:**
- Use on trusted networks only
- Consider adding origin checking or token auth in future versions

## Recommendations for Production Use

If deploying beyond personal use:

1. **Add authentication** — at minimum a shared password or pairing code
2. **Bind to localhost** — use `--host 127.0.0.1` to restrict to local access
3. **Add TLS** — for encrypted WebSocket connections
4. **Rate limit** — prevent abuse from network clients
5. **Audit logging** — track who accesses the dashboard
6. **Restrict `/tmp` permissions** — use `umask` or a private directory for session files

## Responsible Disclosure

If you discover a security issue, please open a GitHub issue or contact the maintainer directly. Do not disclose publicly until a fix is available.
