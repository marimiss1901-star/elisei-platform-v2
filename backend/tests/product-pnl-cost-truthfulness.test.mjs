import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8')

assert.match(source,/source_stream='paidStorage'[\s\S]*operation_group='storage'/,
  'selected-period P&L must read durable storage rows from the finance ledger')
assert.match(source,/paidStorage:\{ \.\.\.analyticsAvailableRange\(rawData\.paidStorage,storageKeys\),selectedRows:paidStorage\.length \}/,
  'storage coverage must be evaluated for the selected period')
assert.match(source,/const logisticsSource = financeHasRows[\s\S]*historical_finance[\s\S]*not_loaded/,
  'missing current-period logistics must be explicit: WB, manual, historical estimate, or not loaded — never a false zero')
assert.match(source,/logistics: logisticsSource === 'not_loaded' \? null : Math\.round\(logistics\)/,
  'product logistics must expose null when neither WB detail nor a valid fallback is available')
assert.match(source,/acquiring: acquiringSource === 'not_loaded' \? null : Math\.round\(acquiring\)/,
  'product acquiring must expose null when neither WB detail nor a valid fallback is available')
assert.match(source,/paid_storage_report_partial/,
  'partial selected-period storage coverage must be explicit')
assert.match(source,/profitProvisional:/,
  'product profit must carry a provisional marker while costs are incomplete')

console.log('ELISEI product P&L cost truthfulness regression: OK')
