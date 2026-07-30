#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node "$ROOT/tests/test-client.cjs"
node "$ROOT/tests/test-analytics.cjs"
"$ROOT/tests/test-installer.sh"
node --check "$ROOT/apply-ads-patch.mjs"
node --check "$ROOT/payload/backend/src/integrations/wb/promotionClient.cjs"
node --check "$ROOT/payload/backend/src/services/adsAnalytics.cjs"
echo "all tests: ok"
