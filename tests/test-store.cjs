'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'elisei-ads-store-'));
process.env.ELISEI_ADS_CACHE_FILE = path.join(temp, 'cache.json');
const store = require(path.resolve(__dirname, '../payload/backend/src/store/adsStore.cjs'));

store.setRange('scope-a', '2026-07-01', '2026-07-07', { syncedAt: '2026-07-30T10:00:00Z', spend: 100 }, { cabinetId: 'cab-a' });
store.setRange('scope-b', '2026-07-01', '2026-07-07', { syncedAt: '2026-07-30T10:01:00Z', spend: 900 }, { cabinetId: 'cab-b' });
assert.equal(store.getRange('scope-a', '2026-07-01', '2026-07-07').spend, 100);
assert.equal(store.getRange('scope-b', '2026-07-01', '2026-07-07').spend, 900);
assert.equal(store.getRange('scope-c', '2026-07-01', '2026-07-07'), null);
const persisted = JSON.parse(fs.readFileSync(process.env.ELISEI_ADS_CACHE_FILE, 'utf8'));
assert.equal(persisted.version, 2);
assert.equal(Object.keys(persisted.scopes).length, 2);
fs.rmSync(temp, { recursive: true, force: true });
console.log('store: ok');
