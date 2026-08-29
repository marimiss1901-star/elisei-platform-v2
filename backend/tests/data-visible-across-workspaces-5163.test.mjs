import assert from 'node:assert/strict'
import fs from 'node:fs'

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
const page=fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx',import.meta.url),'utf8')

assert.match(server,/function stockHistoryRetainedPeriod\(value = \{\}, now = Date\.now\(\)\)/,
  'stock history tasks must be clamped to the rolling WB retention window')
assert.match(server,/const period = phase === 'create' \? stockHistoryRetainedPeriod\(savedPeriod\) : savedPeriod/,
  'old queued stock-history tasks must not keep retrying an invalid start day')
assert.match(server,/async function recoverInvalidStockHistoryRetention\(\{ connectionId = null \} = \{\}\)/,
  'an existing invalid stock-history error must recover without requiring a client click')
assert.match(server,/await recoverInvalidStockHistoryRetention\(\{ connectionId:connection\.id \}\)/,
  'opening the cabinet must automatically requeue the corrected stock-history report')
assert.match(server,/statsAvailable:loaded\.length > 0/,
  'available advertising statistics must stay visible even when only part of the campaigns is loaded')
assert.match(page,/const showingSavedDocuments=Boolean\(!query\.trim\(\) && selectedRows\.length === 0 && archivedRows\.length > 0\)/,
  'the Documents screen must retain its saved archive when the selected day has no new documents')
assert.match(page,/За выбранный день новых документов нет — архив не скрываем/,
  'the document fallback must be clearly labelled instead of presented as current-period data')

console.log('ELISEI 5.16.4 cross-workspace data visibility regression: OK')
