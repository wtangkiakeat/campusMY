#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

command -v node >/dev/null || { echo "Install Node.js 22 or newer first."; exit 1; }
command -v uv >/dev/null || { echo "Install uv (https://docs.astral.sh/uv/) first."; exit 1; }
node -e 'const [major,minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 18)) process.exit(1)' || { echo "Node.js 22.18 or newer is required."; exit 1; }

uv venv --python 3.12 --allow-existing --cache-dir .runtime/uv-cache services/api/.venv
uv pip install --cache-dir .runtime/uv-cache --python services/api/.venv/bin/python -r services/api/requirements.lock -e 'services/api[test]'
npm ci --cache .runtime/npm-cache
python3 scripts/import_seed.py
(
  cd services/api
  .venv/bin/python -m app.cli init
)
echo "Setup complete. Start CampusMY with: npm run dev"
echo "Public browsing works locally. Configure provider credentials to enable real login and email verification."
