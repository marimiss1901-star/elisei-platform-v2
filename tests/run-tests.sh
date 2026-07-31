#!/usr/bin/env bash
set -euo pipefail
node --check ../backend/apply-el-all-modules.mjs
node --check ../frontend/apply-el-all-modules-frontend.mjs
for f in ../backend/payload/backend/src/routes/*.cjs ../backend/payload/backend/src/services/*.cjs ../frontend/payload/frontend/public/elisei-el.js; do node --check "$f"; done
node test-capabilities.cjs
node test-agent.cjs
