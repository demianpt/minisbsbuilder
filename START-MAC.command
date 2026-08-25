#!/bin/bash
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node.js 20 or newer, then run this file again."
  read -r -p "Press Return to close..."
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "Installing project packages..."
  npm install
fi
echo "Starting SBS Page Builder..."
npm run dev &
PID=$!
sleep 4
open "http://127.0.0.1:5173" >/dev/null 2>&1 || true
wait "$PID"
