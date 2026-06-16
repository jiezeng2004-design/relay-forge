#!/usr/bin/env bash
# RelayForge v0.3.1 — quick start for Linux / macOS / WSL
# Usage: bash start.sh        (uses PORT env or default 18765)
#        PORT=39210 bash start.sh

set -euo pipefail

cd "$(dirname "$0")"
PORT="${RELAYFORGE_PORT:-${PORT:-18765}}"

if ! command -v node &>/dev/null; then
  echo "[ERROR] Node.js is required. Install from https://nodejs.org/"
  echo "  macOS: brew install node"
  echo "  Linux: https://nodejs.org/en/download/"
  echo "  WSL:  sudo apt install nodejs npm"
  exit 1
fi

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "[ERROR] Node.js >= 18 required. Current: $(node -v)"
  exit 1
fi

echo "============================================"
echo "  RelayForge v0.3.1"
echo "  Linux / macOS / WSL Quick Start"
echo "============================================"
echo ""

# Port check
if command -v ss &>/dev/null; then
  if ss -tlnp "sport = :$PORT" 2>/dev/null | grep -q .; then
    echo "[WARN] Port $PORT is already in use."
  fi
elif command -v lsof &>/dev/null; then
  if lsof -i :"$PORT" -P -n 2>/dev/null | grep -q LISTEN; then
    echo "[WARN] Port $PORT is already in use."
  fi
fi

# Check config
if [ ! -f config.json ]; then
  if [ -f config.example.json ]; then
    echo "[INFO] No config.json found. Copying from config.example.json..."
    cp config.example.json config.json
  fi
fi

# Check .env
if [ -f .env ]; then
  echo "[INFO] .env found"
else
  echo "[INFO] No .env file. Tokens configured via Dashboard Web Key manager."
fi

echo ""
echo "Starting relay on http://127.0.0.1:$PORT"
if [ "$PORT" = "18765" ]; then
  echo "[INFO] Port 18765 = RelayForge default local gateway port."
else
  echo "[INFO] Custom port $PORT. Set PORT=18765 for upstream openrelay default mode."
fi
echo ""
echo "  Dashboard: http://127.0.0.1:$PORT"
echo "  Stop:      Ctrl+C"
echo ""
echo "============================================"

exec node src/server.js
