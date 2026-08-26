import assert from 'node:assert/strict'
import fs from 'node:fs'
import { WB_STREAMS } from '../src/wb/stream-store.js'
import { normalizeFinanceLedgerRows } from '../src/wb/finance-ledger.js'

assert.equal(WB_STREAMS.length,29)
for (const stream of ['balance','financeReports','acquiringReports','warehouseMeasurements','antifraudRetention','labelingRetention']) {
  assert.ok(WB_STREAMS.includes(stream),`${stream} must be registered`)
}

const selfPurchase=normalizeFinanceLedgerRows('antifraudRetention',{nmID:700,sum:'1250',dateFrom:'2026-07-01',dateTo:'2026-07-07'},'self:1',0)
assert.equal(selfPurchase.length,1)
assert.equal(selfPurchase[0].amount,-1250)
assert.equal(selfPurchase[0].detailOnly,true)
assert.equal(selfPurchase[0].includedInPnl,false)

const labeling=normalizeFinanceLedgerRows('labelingRetention',{nmID:700,sku:'460123',amount:'900',date:'2026-08-01'},'label:1',0)
assert.equal(labeling.length,1)
assert.equal(labeling[0].amount,-900)
assert.equal(labeling[0].detailOnly,true)
assert.equal(labeling[0].includedInPnl,false)

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
for (const marker of [
  'advanceFinanceReportListTask',
  '/api/finance/v1/sales-reports/list',
  '/api/finance/v1/acquiring/list',
  '/api/analytics/v1/warehouse-measurements',
  '/api/v1/analytics/antifraud-details',
  '/api/v1/analytics/goods-labeling',
  "balance: { label: 'Баланс WB', scope: 'finance' }",
  '/api/v1/account/balance',
  'reports:{',
  'riskDetails:{',
]) assert.ok(server.includes(marker),`server.js must contain ${marker}`)

const ledger=fs.readFileSync(new URL('../src/wb/finance-ledger.js',import.meta.url),'utf8')
assert.ok(ledger.includes('timeline:timelineRows.rows'))
assert.ok(ledger.includes("operation_group IN ('penalties','deductions')"))

const dashboard=fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx',import.meta.url),'utf8')
for (const marker of ['Динамика','Причины удержаний','Отчёты реализации','Самовыкупы','Нарушения маркировки','Доступно к выводу']) {
  assert.ok(dashboard.includes(marker),`Dashboard must contain ${marker}`)
}

console.log('WB complete finance contour tests passed')
