#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node --check "$ROOT/payload/frontend/public/elisei-el.js"
for f in "$ROOT"/payload/backend/src/**/*.cjs; do node --check "$f"; done
node "$ROOT/tests/test-sources.cjs"
node "$ROOT/tests/test-agent.cjs"
bash "$ROOT/tests/test-installer.sh"
echo 'ALL TESTS PASSED'
