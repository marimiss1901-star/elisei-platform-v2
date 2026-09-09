import assert from 'node:assert/strict'
import fs from 'node:fs'

const source=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')

assert.match(source,/async function loadHistoricalFinanceFallback\(/,
  'backend must derive a provisional finance fallback from persisted WB history')
assert.match(source,/historicalLogisticsPercent/,
  'historical logistics percentage must be carried into analytics settings')
assert.match(source,/historicalAcquiringPercent/,
  'historical acquiring percentage must be carried into analytics settings')
assert.match(source,/logisticsSource[\s\S]*historical_finance/,
  'logistics must be explicitly marked as historical estimate when current finance is absent')
assert.match(source,/acquiringSource[\s\S]*historical_finance/,
  'acquiring must be explicitly marked as historical estimate when current finance is absent')
assert.match(source,/boundedSyncPeriod\(periodRange,31\)/,
  'goods returns must never send more than 31 days to WB')
assert.match(source,/period\.limited=period\.requestedDays > 31/,
  'goods returns response metadata must disclose when WB window was clamped')

console.log('ELISEI 5.19.5 historical finance fallback regression: OK')
