import assert from 'node:assert/strict'
import fs from 'node:fs'

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
const mart=fs.readFileSync(new URL('../src/wb/core-mart.js',import.meta.url),'utf8')
const migration=fs.readFileSync(new URL('../migrate-paid-storage-dedup.mjs',import.meta.url),'utf8')

assert.match(server,/stablePayloadHash=crypto\.createHash\('sha1'\)/,
  'paidStorage keys must use a stable payload hash')
assert.doesNotMatch(server,/row\.warehouse \|\| '',index\]\.join\(':'\)/,
  'paidStorage keys must not include the response-local array index')
assert.match(mart,/const CORE_MART_VERSION = 2/,
  'core mart revision must invalidate pre-dedup cached P&L')
assert.match(migration,/PARTITION BY connection_id,source_stream,operation_group,operation_code,source_field,source_payload/,
  'ledger migration must remove only exact paidStorage payload duplicates')
assert.match(migration,/PARTITION BY connection_id,stream,sync_id,payload/,
  'stream migration must remove only exact payload duplicates inside one sync')

console.log('ELISEI 5.19.7 paid storage dedup regression: OK')
