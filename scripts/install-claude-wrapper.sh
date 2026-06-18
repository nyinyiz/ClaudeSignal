#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SIGNAL_BIN="${CLAUDE_SIGNAL_BIN:-"$ROOT_DIR/target/debug/claude-signal"}"
INSTALL_DIR="${CLAUDE_SIGNAL_WRAPPER_DIR:-"$HOME/.local/bin"}"
WRAPPER_PATH="$INSTALL_DIR/claude"
CLAUDE_DIR="${CLAUDE_SIGNAL_CLAUDE_DIR:-"$HOME/.claude"}"
STATUSLINE_PATH="$CLAUDE_DIR/claude-signal-statusline.sh"
SETTINGS_PATH="$CLAUDE_DIR/settings.json"

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

exec "$REAL_CLAUDE" "\$@"
EOF

chmod +x "$WRAPPER_PATH"

mkdir -p "$CLAUDE_DIR"
cat > "$STATUSLINE_PATH" <<EOF
#!/usr/bin/env bash
set -euo pipefail

exec "$SIGNAL_BIN" status-line
EOF

chmod +x "$STATUSLINE_PATH"

STATUSLINE_CONFIGURED=false
if command -v node >/dev/null 2>&1; then
  SETTINGS_PATH="$SETTINGS_PATH" STATUSLINE_PATH="$STATUSLINE_PATH" node <<'NODE'
const fs = require("fs");
const settingsPath = process.env.SETTINGS_PATH;
const statuslinePath = process.env.STATUSLINE_PATH;
let settings = {};
try {
  if (fs.existsSync(settingsPath)) {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  }
} catch (error) {
  settings = {};
}
settings.statusLine = {
  type: "command",
  command: statuslinePath,
  refreshInterval: 5,
};
fs.mkdirSync(require("path").dirname(settingsPath), { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
NODE
  STATUSLINE_CONFIGURED=true
fi

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
echo "  Usage:    $STATUSLINE_PATH"
[[ "$STATUSLINE_CONFIGURED" == "true" ]] && echo "  Settings: configured statusLine in $SETTINGS_PATH"
[[ "$PATH_ADDED" == "true" ]] && echo "  PATH:     added to $SHELL_PROFILE"
echo ""
if [[ "$STATUSLINE_CONFIGURED" != "true" ]]; then
  echo "Add this to $SETTINGS_PATH to enable live usage:"
  echo '  "statusLine": {'
  echo '    "type": "command",'
  echo "    \"command\": \"$STATUSLINE_PATH\","
  echo '    "refreshInterval": 5'
  echo '  }'
echo ""
fi
echo "Open a new terminal and run: claude \"your prompt\""
echo "Start the dashboard separately with: $SIGNAL_BIN serve"
