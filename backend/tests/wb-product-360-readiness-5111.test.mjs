import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildProduct360 } from '../src/wb/product-360.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')

const baseProduct = {
  key:'nm:111', nmID:111, vendorCode:'SKU-111', title:'Тестовый товар',
  revenue:0, ordersCount:0, salesCount:0, returnsCount:0, returnRate:0,
  stock:0, fbsStock:0, fboStock:0, advertising:0, averagePrice:0,
  commission:0, logistics:0, storage:0, acceptance:0, acquiring:0,
  penalties:0, deductions:0, sellerPayable:0, tax:0, fixedExpenses:0,
  profit:0, margin:0,
}

const waiting = { status:'queued', lastCount:0, lastSuccessAt:null }
const emptyCoverage = {
  core:{sales:false,orders:false,finance:false,advertising:false,stockDetails:false,fboStocks:false,sellerStocks:false},
  stages:{sales:waiting,orders:waiting,finance:waiting,advertising:waiting,stocks:waiting,sellerStocks:waiting},
  streams:{
    searchQueries:{status:'queued',rows:0}, reviews:{status:'queued',rows:0}, questions:{status:'queued',rows:0}, stockHistory:{status:'queued',rows:0},
  },
  finance:waiting,
}

const waitingResult = buildProduct360({ product:baseProduct, coverage:emptyCoverage })
assert.equal(waitingResult.overview.revenue,null,'unconfirmed sales must not become 0 revenue')
assert.equal(waitingResult.overview.returnRate,null,'unconfirmed returns must not become 0%')
assert.equal(waitingResult.overview.stock,null,'unconfirmed stock must not become 0 units')
assert.equal(waitingResult.overview.advertising,null,'unconfirmed advertising must not become 0 spend')
assert.equal(waitingResult.pricing.averagePrice,null,'unconfirmed sales must not become 0 price')
assert.equal(waitingResult.economics.commission,null,'unconfirmed finance must not become 0 commission')
assert.equal(waitingResult.quality.reviewSummary.total,null,'waiting reviews must not become 0 reviews')
assert.equal(waitingResult.quality.questionSummary.total,null,'waiting questions must not become 0 questions')
assert.equal(waitingResult.signals[0]?.type,'waiting','SKU 360 must not claim there are no problems while core streams are missing')

const partialFinanceCoverage = {
  ...emptyCoverage,
  core:{...emptyCoverage.core,sales:true,orders:true,finance:true},
  stages:{
    ...emptyCoverage.stages,
    sales:{status:'success',lastSuccessAt:'2026-08-17T10:00:00Z',lastCount:12},
    orders:{status:'success',lastSuccessAt:'2026-08-17T10:00:00Z',lastCount:14},
    finance:{status:'rate_limited',lastSuccessAt:null,lastCount:100000},
  },
  finance:{status:'rate_limited',lastSuccessAt:null,lastCount:100000},
}
const partialFinanceResult = buildProduct360({
  product:{...baseProduct,revenue:25000,salesCount:10,ordersCount:12,returnsCount:1,returnRate:10,averagePrice:2500,commission:0,logistics:1800,sellerPayable:19000,profit:4200,margin:16.8},
  coverage:partialFinanceCoverage,
})
assert.equal(partialFinanceResult.readiness.finance,'partial')
assert.equal(partialFinanceResult.economics.commission,null,'zero from partial finance is not a confirmed zero')
assert.equal(partialFinanceResult.economics.logistics,1800,'non-zero partial finance may be shown as preliminary')
assert.equal(partialFinanceResult.economics.sellerPayable,19000)
assert.equal(partialFinanceResult.overview.revenue,25000)

const partialStockCoverage = {
  ...emptyCoverage,
  core:{...emptyCoverage.core,sellerStocks:true,stockDetails:true},
  stages:{...emptyCoverage.stages,sellerStocks:{status:'success',lastSuccessAt:'2026-08-17T10:00:00Z',lastCount:75},stocks:{status:'queued',lastSuccessAt:null,lastCount:0}},
}
const partialStockResult = buildProduct360({ product:baseProduct, coverage:partialStockCoverage })
assert.equal(partialStockResult.readiness.stocks,'partial')
assert.equal(partialStockResult.stock.fbsStock,0,'confirmed FBS zero remains a valid zero')
assert.equal(partialStockResult.stock.fboStock,null,'waiting FBO must not become zero')
assert.equal(partialStockResult.overview.stock,null,'combined zero is unsafe while one stock mode is still missing')

const drawer = fs.readFileSync(path.join(projectRoot,'src/components/Product360Drawer.jsx'),'utf8')
assert.ok(drawer.includes('const hasPayload = Boolean(data)'),'drawer must distinguish loaded payload from initial product row')
assert.ok(drawer.includes('!hasPayload && !error'),'drawer must show a loading shell before SKU 360 payload arrives')
assert.ok(!drawer.includes('const overview = view.overview || item'),'drawer must never use raw table zeros as SKU 360 metrics while loading')
assert.ok(drawer.includes('Частичные нули скрываются до завершения потока.'),'drawer must explain partial data policy')

console.log('WB 5.11.1 SKU 360 readiness regression tests passed')
