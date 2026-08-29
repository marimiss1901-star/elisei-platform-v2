import assert from 'node:assert/strict'
import fs from 'node:fs'
import { queryFinanceCoreRows, summarizeFinanceCoreRows } from '../src/wb/finance-ledger.js'

const calls=[]
const db={
  async query(sql,params){
    calls.push({sql:String(sql),params})
    return {rows:[{
      operationDate:'2026-08-27',nmId:'2505',vendorCode:'CABLE-3M',barcode:'4600000000001',
      fulfillmentMode:'FBO',rowCount:'4',grossRevenueAmount:'1000',sellerPayableAmount:'610',
      commissionAmount:'210',logisticsAmount:'70',logisticsRebillAmount:'15',storageAmount:'9',
      acceptanceAmount:'5',acquiringAmount:'18',penaltiesAmount:'3',deductionsAmount:'2',
      additionalPaymentAmount:'11',
    }]}
  },
}

const rows=await queryFinanceCoreRows(db,{
  connectionId:'22222222-2222-4222-8222-222222222222',from:'2026-08-22',to:'2026-08-28',
})
assert.equal(rows.length,1)
assert.equal(rows[0].__aggregated,true)
assert.equal(rows[0].operationDate,'2026-08-27','durable finance row must retain its selected-period date')
assert.equal(rows[0].sellerPayableAmount,610)
assert.equal(rows[0].logisticsAmount,70)
assert.equal(rows[0].logisticsRebillAmount,15)
const summary=summarizeFinanceCoreRows(rows)
assert.equal(summary.movements,4)
assert.equal(summary.sellerPayable,610)
assert.equal(summary.logistics,85)
assert.deepEqual(calls[0].params,['22222222-2222-4222-8222-222222222222','2026-08-22','2026-08-28'])
assert.match(calls[0].sql,/source_stream='finance'/)
assert.match(calls[0].sql,/operation_date >= \$2::date AND operation_date <= \$3::date/)
assert.match(calls[0].sql,/operation_code<>'transport_reimbursement'/,
  'delivery and transport reimbursement must not be counted twice')

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
assert.match(server,/return \[stream,operationDate,id\.nmId \|\| '',id\.vendorCode,id\.barcode,mode\]\.join\('\|'\)/,
  'heavy stream compact identity must be separated by operation date')
assert.match(server,/operationDate:operationDate \|\| null/,
  'date must survive in the compact finance snapshot')
assert.match(server,/await queryFinanceCoreRows\(pool,\{ connectionId:connection\.id,from:range\.from,to:range\.to \}\)/,
  'selected-period core must read durable ledger rows before rendering')
assert.match(server,/summary:ledgerFinanceSummary/,
  'selected-period core must expose a compact finance summary for Main without a second heavy reader')
assert.match(server,/selectedPeriodCovered/)

console.log('ELISEI 5.16.0 anytime finance persistence regression: OK')
