import fs from 'node:fs'

// ELISEI 5.19.8 — durable paid-storage allocation.
// Product P&L must use the period-addressable finance ledger rather than the
// latest compact paidStorage chunk. Also expose product -> warehouse detail.

const serverUrl = new URL('./src/server.js', import.meta.url)
let source = fs.readFileSync(serverUrl,'utf8')

function replaceOnce(before,after,label){
  if(source.includes(after)) return
  if(!source.includes(before)) throw new Error(`ELISEI 5.19.8 storage breakdown: ${label} marker not found`)
  source=source.replace(before,after)
}

replaceOnce(
`import { ensureCoreMartSchema, coreMartRevision, loadCoreMart, saveCoreMart } from './wb/core-mart.js'`,
`import { ensureCoreMartSchema, coreMartRevision, loadCoreMart, saveCoreMart } from './wb/core-mart.js'\nimport { queryPaidStorageBreakdown, applyPaidStorageBreakdown } from './wb/storage-ledger.js'`,
'storage ledger import')

replaceOnce(
`  const core = buildCoreAnalytics(selectedData, analyticsSettings)\n  core.historicalFinanceFallback = historicalFinanceFallback\n  if (ledgerFinanceRows.length) {`,
`  const core = buildCoreAnalytics(selectedData, analyticsSettings)\n  core.historicalFinanceFallback = historicalFinanceFallback\n  if (range) {\n    try {\n      const paidStorageBreakdown = await queryPaidStorageBreakdown(pool,{\n        connectionId:connection.id,from:range.from,to:range.to,\n      })\n      applyPaidStorageBreakdown(core,paidStorageBreakdown)\n    } catch (error) {\n      console.warn('Paid storage product/warehouse breakdown unavailable:',error.message)\n    }\n  }\n  if (ledgerFinanceRows.length) {`,
'core storage allocation')

fs.writeFileSync(serverUrl,source)
console.log('ELISEI 5.19.8 product/warehouse storage ledger applied')
