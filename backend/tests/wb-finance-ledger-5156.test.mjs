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
    if(text.includes('SELECT DISTINCT ON (stream)')) return {rows:[{stream:'finance',sync_id:'11111111-1111-4111-8111-111111111111',source_updated_at:'2026-08-24T08:00:00Z'}]}
    if(text.includes('SELECT MAX(updated_at) AS ledger_updated_at')) return {rows:[{ledger_updated_at:null}]}
    if(text.includes('SELECT row_key,payload FROM wb_stream_items')) return {rows:[{row_key:'finance:rrd:90071992547409931',payload:jamRow}]}
    if(text.includes('INSERT INTO wb_finance_ledger')) return {rows:[]}
    throw new Error(`Unexpected SQL in finance backfill regression: ${text.slice(0,120)}`)
  },
}
const repaired=await backfillFinanceLedgerFromStreamItems(db,{connectionId:'22222222-2222-4222-8222-222222222222'})
assert.equal(repaired.processedStreams,1,'finance stream must be processed even when ledger migration is incremental')
assert.ok(repaired.movements>=1,'saved finance row must create ledger movements')
assert.equal(calls.some(call=>call.text.includes('COUNT(*)::int AS count FROM wb_finance_ledger WHERE connection_id=$1')),false,'backfill must not abort merely because another ledger movement exists')

console.log('ELISEI 5.15.6 finance ledger regression passed')
