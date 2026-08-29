import assert from 'node:assert/strict'
import { buildProduct360 } from '../src/wb/product-360.js'

const waiting = { status:'queued', lastCount:0, lastSuccessAt:null }
const coverage = {
  core:{ sales:false, orders:false, finance:false, advertising:false, stockDetails:false, fboStocks:false, sellerStocks:false },
  stages:{ sales:waiting, orders:waiting, finance:waiting, advertising:waiting, stocks:waiting, sellerStocks:waiting },
  streams:{ searchQueries:{status:'queued'}, reviews:{status:'queued'}, questions:{status:'queued'}, stockHistory:{status:'queued'} },
  finance:waiting,
}

const product = {
  key:'nm:2505',
  nmID:2505,
  vendorCode:'2505 черный 3м',
  title:'2505 черный 3м',
  revenue:311647,
  salesCount:491,
  ordersCount:520,
  returnsCount:3,
  returnRate:0.6,
  stock:340,
  fbsStock:340,
  fboStock:0,
  cogs:117120,
  commission:62329,
  logistics:15185,
  storage:0,
  acceptance:0,
  acquiring:32840,
  advertising:34818,
  tax:37398,
  fixedExpenses:0,
  expenses:299690,
  sellerPayable:249318,
  profit:11957,
  margin:3.8,
  averagePrice:635,
  unitCost:240,
  breakevenPrice:610,
}

const result = buildProduct360({ product, coverage, advertisingRows:[], period:{from:'2026-08-22',to:'2026-08-28',days:7} })

assert.equal(result.overview.revenue,311647,'saved revenue must stay visible in SKU 360')
assert.equal(result.overview.advertising,34818,'saved product ad spend must stay visible even before exact campaign rows arrive')
assert.equal(result.economics.cogs,117120,'saved COGS must stay visible')
assert.equal(result.economics.commission,62329,'saved commission must stay visible')
assert.equal(result.economics.logistics,15185,'saved logistics must stay visible')
assert.equal(result.economics.acquiring,32840,'saved acquiring must stay visible')
assert.equal(result.economics.tax,37398,'saved tax must stay visible')
assert.equal(result.economics.profit,11957,'saved profit must stay visible')
assert.equal(result.demand.advertising.summary.spend,34818,'advertising summary must fall back to saved product analytics')
assert.equal(result.demand.advertising.summary.source,'product_analytics_saved')

const zeroWaiting = buildProduct360({
  product:{ key:'nm:1', nmID:1, revenue:0, salesCount:0, advertising:0, stock:0, commission:0 },
  coverage,
})
assert.equal(zeroWaiting.overview.revenue,null,'waiting zero revenue must still stay hidden')
assert.equal(zeroWaiting.overview.advertising,null,'waiting zero advertising must still stay hidden')
assert.equal(zeroWaiting.economics.commission,null,'waiting zero commission must still stay hidden')

console.log('WB SKU 360 saved economics regression tests passed')
