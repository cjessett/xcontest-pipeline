#!/bin/bash
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18+ is required. Install Node.js, then run this file again."
  read -r -p "Press Enter to close..."
  exit 1
fi
URL="http://localhost:8787"
(sleep 1; open "$URL") &
node server.mjs
