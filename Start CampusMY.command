#!/bin/bash
set -e
cd "$(dirname "$0")"
if [ ! -d node_modules ] || [ ! -f services/api/.venv/bin/python ]; then
  bash scripts/setup.sh
fi
echo "Opening CampusMY locally. Visit http://localhost:3000 after the servers are ready."
echo "Keep this terminal open. Press Ctrl+C to stop both servers."
npm run dev
