import assert from 'node:assert/strict'
import { backfillFinanceLedgerFromStreamItems, normalizeFinanceLedgerRows } from '../src/wb/finance-ledger.js'

const jamRow = {
  rrdId:'90071992547409931',
  rrDate:'2026-08-20T00:00:00Z',
  sellerOperName:'Удержание за сервис',
  bonusTypeName:'Подписка Джем',
  deduction:'18000',
}

const normalized = normalizeFinanceLedgerRows('finance',jamRow,'finance:rrd:90071992547409931',0)
const jam = normalized.find(row=>row.operationCode==='jam_subscription')
assert.ok(jam,'списание Джем должно распознаваться в основной финансовой детализации')
assert.equal(jam.operationGroup,'subscriptions')
assert.equal(jam.amount,-18000)
assert.equal(jam.includedInPnl,true)
assert.equal(jam.operationDate,'2026-08-20')

const calls=[]
const db={
  async query(sql,params=[]){
    const text=String(sql)
    calls.push({text,params})
    if(text.includes('COUNT(DISTINCT row_key)::int AS source_rows')) {
      return {rows:[{stream:'finance',source_rows:1,source_updated_at:'2026-08-24T08:00:00Z'}]}
    }
    if(text.includes('COUNT(DISTINCT source_row_key)::int AS ledger_source_rows')) {
      return {rows:[{ledger_source_rows:0,min_version:1,ledger_updated_at:null}]}
    }
    if(text.includes('DELETE FROM wb_finance_ledger')) return {rows:[]}
    if(text.includes('SELECT DISTINCT ON (row_key) row_key,payload')) {
      return {rows:[{row_key:'finance:rrd:90071992547409931',payload:jamRow}]}
    }
    if(text.includes('INSERT INTO wb_finance_ledger')) return {rows:[]}
    throw new Error(`Unexpected SQL in finance backfill regression: ${text.slice(0,160)}`)
  },
}
const repaired=await backfillFinanceLedgerFromStreamItems(db,{connectionId:'22222222-2222-4222-8222-222222222222'})
assert.equal(repaired.processedStreams,1,'finance stream must be processed when stored source rows are missing from ledger')
assert.ok(repaired.movements>=1,'saved finance row must create ledger movements')
assert.equal(repaired.normalizationVersion, 5)
assert.equal(calls.some(call=>call.text.includes('DELETE FROM wb_finance_ledger')),true,'old finance normalization must be removed before authoritative rebuild')
assert.equal(calls.some(call=>call.text.includes('COUNT(*)::int AS count FROM wb_finance_ledger WHERE connection_id=$1')),false,'backfill must not abort merely because another ledger movement exists')

console.log('ELISEI 5.15.7 finance ledger backfill regression passed')
