#!/usr/bin/env bash
set -euo pipefail
PATCH_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/frontend/src" "$TMP/backend/src"
cat > "$TMP/frontend/src/App.jsx" <<'APP'
import React, { useState } from 'react';
export default function App(){ const [active] = useState('ads'); return (<main>{active === 'ads' && <section>legacy ads</section>}</main>); }
APP
cat > "$TMP/backend/src/server.js" <<'APP'
import express from 'express';
const app = express();
app.use(express.json());
app.listen(3000);
APP
(cd "$TMP" && node "$PATCH_ROOT/apply-ads-patch.mjs")
grep -q "AdvertisingPage" "$TMP/frontend/src/App.jsx"
grep -q "app.use('/api/ads', adsRouter)" "$TMP/backend/src/server.js"
test -f "$TMP/frontend/src/components/AdvertisingPage.jsx"
test -f "$TMP/backend/src/routes/ads.js"
test -f "$TMP/backend/src/services/cabinetTokenResolver.cjs"
! grep -R "WB_PROMOTION_TOKEN=" "$TMP"
echo "installer: ok"
