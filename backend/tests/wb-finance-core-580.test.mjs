import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  FINANCE_METHOD_LIMITS,financeContinuation,financePageCooldownMs,documentsPageCooldownMs,
  normalizeDocumentCategories,normalizeDocumentRow,summarizeDocuments,deriveAcquiringFromLedgerRows,
} from '../src/wb/finance-core.js'
import { classifyFinanceSpecialOperation,normalizeFinanceLedgerRows } from '../src/wb/finance-ledger.js'

const huge='18446744073709551610'
assert.deepEqual(financeContinuation({incomingRows:[{rrdId:'2'},{rrdId:huge}],previousRrdId:'1'}),{
  complete:false,nextRrdId:huge,reason:'continue_until_204',
})
assert.equal(financeContinuation({incomingRows:[],previousRrdId:huge}).complete,true)
assert.equal(financeContinuation({incomingRows:[{rrdId:huge}],previousRrdId:huge}).reason,'cursor_missing_or_repeated')
assert.equal(financePageCooldownMs({typeId:1}),FINANCE_METHOD_LIMITS.baseDetailIntervalMs)
assert.equal(financePageCooldownMs({typeId:4}),FINANCE_METHOD_LIMITS.fastDetailIntervalMs)
assert.equal(documentsPageCooldownMs({typeId:1}),FINANCE_METHOD_LIMITS.baseDocumentsIntervalMs)
assert.equal(documentsPageCooldownMs({typeId:4}),FINANCE_METHOD_LIMITS.documentsFastIntervalMs)

const categories=normalizeDocumentCategories({data:[{name:'acts',title:'Акты'}]})
assert.deepEqual(categories,[{name:'acts',title:'Акты'}])
const document=normalizeDocumentRow({serviceName:'abc',extension:'.pdf',categoryName:'acts',creationTime:'2026-08-01',documentNumber:'55'},Object.fromEntries(categories.map(x=>[x.name,x.title])))
assert.equal(document.category,'Акты')
assert.equal(document.downloadable,true)
assert.equal(document.createdAt,'2026-08-01')
const documentSummary=summarizeDocuments([document,{...document,serviceName:'jam',category:'Подписка Джем'}],categories)
assert.equal(documentSummary.total,2)
assert.equal(documentSummary.downloadable,2)
assert.equal(documentSummary.jamDocuments,1)

assert.deepEqual(classifyFinanceSpecialOperation({bonusTypeName:'Списание за подписку Джем'}),{
  code:'jam_subscription',group:'subscriptions',name:'Подписка «Джем»',confirmed:true,
})
const jamRows=normalizeFinanceLedgerRows('finance',{rrdId:huge,rrDate:'2026-08-01',bonusTypeName:'Подписка Джем',deduction:'499'},`finance:rrd:${huge}`,0)
assert.ok(jamRows.some(row=>row.operationCode==='jam_subscription' && row.amount===-499))

const acquiring=deriveAcquiringFromLedgerRows([
  {operationGroup:'acquiring',detailOnly:false,amount:-18.4,rrdId:huge,operationDate:'2026-08-01',currency:'RUB'},
  {operationGroup:'acquiring',detailOnly:true,amount:-3},
])
assert.equal(acquiring.length,1)
assert.equal(acquiring[0].acquiringFee,18.4)
assert.equal(acquiring[0].vatBreakdownAvailable,false)

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
for (const marker of [
  '/api/finance/v1/sales-reports/detailed',
  "preserveInt64Fields:['rrdId'",
  '/api/v1/documents/categories?locale=ru',
  '/api/v1/documents/download?',
  '/api/common/v1/subscriptions',
  "stage === 'jamSubscription'",
  "derived://finance-ledger/acquiring",
  'documentsPageCooldownMs(financeRuntimeTokenInfo(tokenInfo))',
]) assert.ok(server.includes(marker),`server.js must contain ${marker}`)
assert.ok(fs.readFileSync(new URL('../src/wb/finance-core.js',import.meta.url),'utf8').includes('continue_until_204'))
assert.ok(!server.includes('/api/v5/supplier/reportDetailByPeriod'),'legacy finance endpoint must not return')

console.log('WB 5.8.0 finance core tests passed')
