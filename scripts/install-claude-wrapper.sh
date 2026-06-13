#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SIGNAL_BIN="${CLAUDE_SIGNAL_BIN:-"$ROOT_DIR/target/debug/claude-signal"}"
INSTALL_DIR="${CLAUDE_SIGNAL_WRAPPER_DIR:-"$HOME/.local/bin"}"
WRAPPER_PATH="$INSTALL_DIR/claude"
COMMAND_DIR="${CLAUDE_SIGNAL_COMMAND_DIR:-"$HOME/.claude/commands"}"

if [[ ! -x "$SIGNAL_BIN" ]]; then
  echo "Building ClaudeSignal..."
  cd "$ROOT_DIR" && cargo build --quiet 2>/dev/null
  SIGNAL_BIN="$ROOT_DIR/target/debug/claude-signal"
  if [[ ! -x "$SIGNAL_BIN" ]]; then
    echo "Build failed. Run: cd \"$ROOT_DIR\" && cargo build"
    exit 1
  fi
fi

REAL_CLAUDE="${CLAUDE_SIGNAL_REAL_CLAUDE:-}"
if [[ -z "$REAL_CLAUDE" ]]; then
  while IFS= read -r candidate; do
    if [[ "$candidate" != "$WRAPPER_PATH" ]]; then
      REAL_CLAUDE="$candidate"
      break
    fi
  done < <(which -a claude 2>/dev/null || true)
fi

if [[ -z "$REAL_CLAUDE" ]]; then
  echo "Could not find the real claude binary in PATH."
  echo "Run with: CLAUDE_SIGNAL_REAL_CLAUDE=/path/to/claude $0"
  exit 1
fi

mkdir -p "$INSTALL_DIR"

cat > "$WRAPPER_PATH" <<EOF
#!/usr/bin/env bash
set -euo pipefail

export CLAUDE_SIGNAL_BIN="$SIGNAL_BIN"
export CLAUDE_SIGNAL_REAL_CLAUDE="$REAL_CLAUDE"
export CLAUDE_SIGNAL_CLAUDE_PID="\$\$"
export CLAUDE_SIGNAL_SESSION_ID="\${CLAUDE_SIGNAL_SESSION_ID:-claude-signal-\$\$-\$(date +%s)}"

if [[ "\${CLAUDE_SIGNAL_BYPASS:-}" == "1" ]]; then
  exec "$REAL_CLAUDE" "\$@"
fi

exec "$SIGNAL_BIN" run -- "$REAL_CLAUDE" "\$@"
EOF

chmod +x "$WRAPPER_PATH"

mkdir -p "$COMMAND_DIR"
cat > "$COMMAND_DIR/ClaudeSignal.md" <<EOF
---
description: Show the ClaudeSignal dashboard URL
allowed-tools: Bash
---

\`\`\`bash
LOCAL_IP=\$(ifconfig en0 2>/dev/null | grep 'inet ' | awk '{print \$2}')
echo "ClaudeSignal Dashboard"
echo "  Local:  http://localhost:3000"
echo "  Phone:  http://\${LOCAL_IP:-localhost}:3000"
\`\`\`
EOF

cat > "$COMMAND_DIR/ClaudeSignalStop.md" <<EOF
---
description: Stop the ClaudeSignal dashboard
allowed-tools: Bash
---

\`\`\`bash
"\${CLAUDE_SIGNAL_BIN:-$SIGNAL_BIN}" stop-all 2>/dev/null || true
echo "Dashboard stopped."
\`\`\`
EOF

cp "$COMMAND_DIR/ClaudeSignal.md" "$COMMAND_DIR/claudesignal.md" 2>/dev/null || true
cp "$COMMAND_DIR/ClaudeSignalStop.md" "$COMMAND_DIR/claudesignalstop.md" 2>/dev/null || true

# Add to PATH if not already there
SHELL_PROFILE=""
if [[ -f "$HOME/.zshrc" ]]; then
  SHELL_PROFILE="$HOME/.zshrc"
elif [[ -f "$HOME/.bash_profile" ]]; then
  SHELL_PROFILE="$HOME/.bash_profile"
elif [[ -f "$HOME/.bashrc" ]]; then
  SHELL_PROFILE="$HOME/.bashrc"
fi

PATH_ADDED=false
if [[ -n "$SHELL_PROFILE" ]] && ! grep -q '$HOME/.local/bin' "$SHELL_PROFILE" 2>/dev/null; then
  echo '' >> "$SHELL_PROFILE"
  echo '# ClaudeSignal' >> "$SHELL_PROFILE"
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$SHELL_PROFILE"
  PATH_ADDED=true
fi

echo "Done! ClaudeSignal is installed."
echo ""
echo "  Wrapper:  $WRAPPER_PATH"
echo "  Claude:   $REAL_CLAUDE"
[[ "$PATH_ADDED" == "true" ]] && echo "  PATH:     added to $SHELL_PROFILE"
echo ""
echo "Open a new terminal and run: claude \"your prompt\""
echo "Then type /ClaudeSignal inside Claude to see the dashboard URL."
