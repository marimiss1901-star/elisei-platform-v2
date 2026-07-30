#!/usr/bin/env bash
set -euo pipefail
BASE="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
mkdir -p "$TMP/frontend/src" "$TMP/backend/src"
cat > "$TMP/frontend/src/App.jsx" <<'APP'
import React from 'react';
export default function App(){ return (<main><div>ELISEI</div></main>); }
APP
cat > "$TMP/backend/src/server.js" <<'SERVER'
const express = require('express');
const app = express();
app.use(express.json());
app.get('/api/test', (req,res)=>res.json({ok:true}));
SERVER
(cd "$TMP" && node "$BASE/apply-period-runtime-fix.mjs")
grep -q 'GlobalPeriodBar' "$TMP/frontend/src/App.jsx"
grep -q 'app.use(periodMiddleware)' "$TMP/backend/src/server.js"
test -f "$TMP/frontend/src/lib/periodStore.js"
test -f "$TMP/backend/src/lib/period.cjs"
rm -rf "$TMP"
echo 'installer test: ok'
