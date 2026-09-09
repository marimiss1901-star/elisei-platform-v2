import assert from 'node:assert/strict'
import fs from 'node:fs'

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
const mart=fs.readFileSync(new URL('../src/wb/core-mart.js',import.meta.url),'utf8')
const migration=fs.readFileSync(new URL('../migrate-paid-storage-dedup.mjs',import.meta.url),'utf8')

const keyStart=server.indexOf('function rawGeneratedReportKey')
const keyEnd=server.indexOf('\nfunction ',keyStart+10)
assert.ok(keyStart>=0,'rawGeneratedReportKey must exist')
const generatedKeySource=server.slice(keyStart,keyEnd>keyStart?keyEnd:keyStart+1800)

assert.match(generatedKeySource,/stablePayloadHash=crypto\.createHash\('sha1'\)/,
  'paidStorage keys must use a stable payload hash')
assert.doesNotMatch(generatedKeySource,/if \(stream === 'paidStorage'\)[\s\S]*?row\.warehouse \|\| '',index\]\.join\(':'\)/,
  'paidStorage keys must not include the response-local array index')
assert.match(mart,/const CORE_MART_VERSION = 3/,
  'core mart revision must invalidate pre-storage-breakdown cached P&L')
assert.match(migration,/PARTITION BY connection_id,source_stream,operation_group,operation_code,source_field,source_payload/,
  'ledger migration must remove only exact paidStorage payload duplicates')
assert.match(migration,/PARTITION BY connection_id,stream,sync_id,payload/,
  'stream migration must remove only exact payload duplicates inside one sync')

console.log('ELISEI 5.19.8 paid storage dedup regression: OK')
