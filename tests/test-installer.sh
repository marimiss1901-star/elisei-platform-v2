#!/usr/bin/env bash
set -euo pipefail
PATCH="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/frontend" "$TMP/backend/src"
cat > "$TMP/frontend/index.html" <<'HTML'
<html><head></head><body><div id="root"></div></body></html>
HTML
cat > "$TMP/backend/src/server.js" <<'JS'
const express = require('express');
const app = express();
app.use(express.json());
app.listen(3000);
JS
(cd "$TMP" && node "$PATCH/apply-el-intelligence-core.mjs")
grep -q 'elisei-el.js' "$TMP/frontend/index.html"
grep -q "app.use('/api/el'" "$TMP/backend/src/server.js"
test -f "$TMP/frontend/public/elisei-el.js"
test -f "$TMP/backend/src/routes/elCore.cjs"
echo 'installer ok'
