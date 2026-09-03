import assert from 'node:assert/strict'
import fs from 'node:fs'
import { normalizeFinanceLedgerRows } from '../src/wb/finance-ledger.js'

const currentFinanceRow = {
  rrdId:'9007199254740993123',
  rrDate:'2026-08-23T11:15:00Z',
  nmId:123456789,
  vendorCode:'TEST-1',
  sku:'4600000000001',
  docTypeName:'Продажа',
  sellerOperName:'Продажа',
  retailAmount:'1000.00',
  forPay:'650.00',
  vw:'180.00',
  vwNds:'36.00',
  deliveryService:'50.00',
  acquiringFee:'20.00',
  penalty:'10.00',
  currency:'RUB',
}
const finance = normalizeFinanceLedgerRows('finance',currentFinanceRow,'finance:rrd:9007199254740993123',7)
const byGroup = group => finance.find(row=>row.operationGroup===group)
assert.equal(finance[0]?.operationDate,'2026-08-23','current WB rrDate must survive period filtering')
assert.equal(byGroup('commission')?.amount,-216,'WB commission must include vw + VAT')
assert.equal(byGroup('logistics')?.amount,-50,'WB logistics must enter P&L')
assert.equal(byGroup('acquiring')?.amount,-20,'acquiringFee must enter P&L')
assert.equal(byGroup('penalties')?.amount,-10,'penalty must enter P&L')
assert.equal(finance.find(row=>row.operationCode==='seller_payable')?.amount,650)

const jam = normalizeFinanceLedgerRows('finance',{
  rrdId:'777777777777777777',
  rrDate:'2026-08-20T09:00:00Z',
  sellerOperName:'Удержание',
  bonusTypeName:'Подписка Джем',
  deduction:'18000.00',
},'finance:rrd:777777777777777777',0)
const jamCharge = jam.find(row=>row.operationCode==='jam_subscription')
assert.ok(jamCharge,'Jam charge must be recognized from the WB finance row')
assert.equal(jamCharge.operationGroup,'subscriptions')
assert.equal(jamCharge.amount,-18000)
assert.equal(jamCharge.includedInPnl,true)
assert.equal(jamCharge.operationDate,'2026-08-20')

const acquiring = normalizeFinanceLedgerRows('acquiring',{
  saleDate:'2026-08-22T10:00:00Z',
  acquiringFee:'120.50',
  acquiringFeeVat:'24.10',
  paymentSystem:'МИР',
},'acquiring:row:1',0)
assert.equal(acquiring[0]?.operationDate,'2026-08-22','new acquiring saleDate must be queryable by selected period')
assert.equal(acquiring[0]?.amount,-144.6)

const stableA = normalizeFinanceLedgerRows('finance',currentFinanceRow,'finance:rrd:9007199254740993123',1).map(row=>row.movementKey)
const stableB = normalizeFinanceLedgerRows('finance',currentFinanceRow,'finance:rrd:9007199254740993123',999).map(row=>row.movementKey)
assert.deepEqual(stableA,stableB,'movement identity must not depend on page-local array index')

const source=fs.readFileSync(new URL('../src/wb/finance-ledger.js',import.meta.url),'utf8')
for(const marker of [
  'normalization_version=5',
  'normalization_version<4',
  'COUNT(DISTINCT row_key)',
  'COUNT(DISTINCT source_row_key)',
  'DELETE FROM wb_finance_ledger',
  'saleDate',
  'acqDate',
]) assert.ok(source.includes(marker),`finance ledger migration must contain ${marker}`)

console.log('ELISEI 5.15.7 finance ledger migration regression: OK')
