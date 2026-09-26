#!/usr/bin/env bash
# Run VOLUM3 on macOS or Linux: ./start.sh (or double-click start.command on a Mac).
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get the LTS version from https://nodejs.org/ and run this again."
  exit 1
fi
if ! node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)||(a===20&&b>=19)?0:1)"; then
  echo "Your Node.js is too old. VOLUM3 needs 20.19 or newer: https://nodejs.org/"
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "Installing dependencies - first run only..."
  npm install || exit 1
fi
echo "Starting VOLUM3 - your browser will open. Press Ctrl+C here to stop."
npm run dev -- --open
