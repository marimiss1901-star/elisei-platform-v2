import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { WB_STREAMS, normalizeStreamPayload, streamCount } from '../src/wb/stream-store.js'

assert.deepEqual(WB_STREAMS, [
  'products','orders','sales','stocks','sellerStocks','advertising','finance','paidStorage','acceptance','acquiring',
  'fbsArchive','measurementPenalties','deductionsReport','goodsReturns','tariffs','funnel','documents',
  'searchQueries','stockHistory','reviews','questions','chats',
])

const finance = normalizeStreamPayload('finance', {
  rows:[{ nmId:1, paidStorage:'10', paidAcceptance:'5', deliveryService:'20' }],
  totals:{ storage:10 },
})
assert.equal(streamCount('finance', finance), 1)
assert.equal(streamCount('sellerStocks', [{ chrtId:1, amount:7 }]), 1)

const source = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8')
for (const marker of [
  '/api/finance/v1/sales-reports/detailed',
  '/api/finance/v1/acquiring/detailed',
  '/api/v1/paid_storage',
  '/api/v1/acceptance_report',
  '/api/v3/stocks/${warehouseId}',
  "paidStorage','paid_storage'",
  "paidAcceptance','paid_acceptance'",
  "fulfillmentMode:'FBS'",
  "fulfillmentMode:fulfillmentLabel",
  "row.deliveryMethod || row.delivery_method",
]) assert.ok(source.includes(marker), `server.js must contain ${marker}`)

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `${name} is present`)
  const candidates = [source.indexOf('\nfunction ', start + 10), source.indexOf('\nasync function ', start + 10)].filter(value => value > start)
  const end = candidates.length ? Math.min(...candidates) : source.length
  return source.slice(start, end).trim()
}

const sandbox = { Math, Number, String, Object, Array }
vm.createContext(sandbox)
vm.runInContext([
  extractFunction('fieldNumber'),
  extractFunction('financeSign'),
  extractFunction('financeCommissionAmount'),
  extractFunction('financeRowAmounts'),
  extractFunction('summarizeFinanceRows'),
  'globalThis.result = summarizeFinanceRows([{docTypeName:"Продажа",retailPriceWithDiscRub:"1000",forPay:"700",ppvzSalesCommission:"180",vw:"180",vwNds:"36",deliveryService:"50",rebillLogisticCost:"5",paidStorage:"10",paidAcceptance:"7",acquiringFee:"12",penalty:"3",deduction:"4",additionalPayment:"2"}])',
].join('\n'), sandbox)

assert.equal(sandbox.result.grossRevenue, 1000)
assert.equal(sandbox.result.sellerPayable, 700)
assert.equal(sandbox.result.commission, 216)
assert.equal(sandbox.result.logistics, 50)
assert.equal(sandbox.result.logisticsRebill, 5)
assert.equal(sandbox.result.storage, 10)
assert.equal(sandbox.result.acceptance, 7)
assert.equal(sandbox.result.acquiring, 12)
assert.equal(sandbox.result.penalties, 3)
assert.equal(sandbox.result.deductions, 4)
assert.equal(sandbox.result.additionalPayment, 2)

console.log('WB finance + FBS/FBO patch tests passed')
