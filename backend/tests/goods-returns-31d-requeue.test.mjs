import assert from 'node:assert/strict'
import fs from 'node:fs'

const source=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'))

assert.match(source,/boundedSyncPeriod\(periodRange,31\)/,
  'goodsReturns request must be clamped to WB maximum 31-day window')
assert.match(source,/stage='goodsReturns'[\s\S]*difference between dateFrom and dateTo should be less or equal 31 days/,
  'legacy 31-day validation errors must be recovered into the automatic retry lane')
assert.match(pkg.scripts.prestart,/apply-goods-returns-requeue\.mjs/,
  'goodsReturns recovery must run before every production start')

console.log('ELISEI 5.19.6 goods returns 31-day recovery regression: OK')
