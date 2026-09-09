import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/server.js', import.meta.url),'utf8')
const packageJson = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url),'utf8'))

assert.match(source,/if \(stage==='goodsReturns'\) return boundedSyncPeriod\(range,31\)/,
  'goodsReturns must always be scheduled with a WB-valid 31-day maximum window')
assert.ok(packageJson.scripts.prestart.indexOf('apply-goods-returns-31d-window.mjs') < packageJson.scripts.prestart.indexOf('apply-goods-returns-requeue.mjs'),
  'the 31-day guard must apply before legacy goodsReturns errors are requeued')

console.log('ELISEI 5.19.7 goodsReturns 31-day regression: OK')
