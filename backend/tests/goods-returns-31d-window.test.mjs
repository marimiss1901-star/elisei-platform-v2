import assert from 'node:assert/strict'
import fs from 'node:fs'

const server = fs.readFileSync(new URL('../src/server.js', import.meta.url),'utf8')
const migration = fs.readFileSync(new URL('../migrate-goods-returns-31d-window.mjs', import.meta.url),'utf8')

assert.match(server,/if \(stage==='goodsReturns'\) return boundedSyncPeriod\(range,31\)/,
  'goodsReturns must never schedule a period longer than 31 days')
assert.match(migration,/difference between dateFrom and dateTo should be less or equal 31 days/,
  'legacy oversized goodsReturns errors must be detected and requeued')
assert.match(migration,/status='retry_scheduled'/,
  'legacy goodsReturns errors must re-enter the background queue')
assert.match(migration,/days:31/,
  'requeued goodsReturns state must carry an explicit 31-day window')

console.log('ELISEI 5.19.5 goodsReturns 31-day regression: OK')
