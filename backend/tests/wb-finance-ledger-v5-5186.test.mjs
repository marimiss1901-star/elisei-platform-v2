import assert from 'node:assert/strict'
import fs from 'node:fs'

const source=fs.readFileSync(new URL('../src/wb/finance-ledger.js',import.meta.url),'utf8')
assert.match(source,/,5,NOW\(\)\n\s+FROM jsonb_array_elements/,'new ledger movements must be written as normalization v5')
assert.match(source,/normalization_version=5,updated_at/,'existing movements must be upgraded to v5 on conflict')
assert.match(source,/minVersion < 5/,'backfill must rebuild historical v4 rows')
assert.match(source,/normalization_version<5/,'backfill must remove pre-v5 movements before rebuilding')
assert.match(source,/normalizationVersion:5/,'backfill metadata must report v5')
assert.match(source,/base\.fulfillmentMode = mode/,'v5 must persist the resolved FBS/FBO scheme')

console.log('WB finance ledger normalization v5 5.18.6: OK')
