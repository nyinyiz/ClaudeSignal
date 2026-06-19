#!/usr/bin/env bash
set -euo pipefail

if command -v cargo-watch &>/dev/null; then
    cargo watch -x 'run -- simulate'
else
    echo "Tip: install cargo-watch for auto-reload (cargo install cargo-watch)"
    cargo run -- simulate
fi
