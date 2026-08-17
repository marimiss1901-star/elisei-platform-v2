import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildProduct360 } from '../src/wb/product-360.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
const waiting = { status:'queued', lastCount:0, lastSuccessAt:null }
const product = {
  key:'nm:777', nmID:777, vendorCode:'SKU-777', title:'SKU state test',
  revenue:12000, salesCount:6, ordersCount:7, returnsCount:1, returnRate:16.7,
  commission:0, logistics:950, storage:0, acceptance:0, acquiring:0,
  sellerPayable:8800, advertising:0, profit:1900, margin:15.8,
}
const coverage = {
  core:{sales:true,orders:true,finance:true,advertising:true,paidStorage:true,acceptance:true,acquiring:true,sellerStocks:true,fboStocks:false,stockDetails:true},
  stages:{
    sales:{status:'success',lastSuccessAt:'2026-08-17T10:00:00Z',lastCount:6},
    orders:{status:'success',lastSuccessAt:'2026-08-17T10:00:00Z',lastCount:7},
    finance:{status:'rate_limited',lastSuccessAt:null,lastCount:100000},
    advertising:{status:'success',lastSuccessAt:'2026-08-17T10:00:00Z',lastCount:188},
    paidStorage:{status:'success',lastSuccessAt:'2026-08-17T10:00:00Z',lastCount:33},
    acceptance:{status:'success',lastSuccessAt:'2026-08-17T10:00:00Z',lastCount:0},
    acquiring:{status:'queued',lastSuccessAt:null,lastCount:0},
    sellerStocks:{status:'success',lastSuccessAt:'2026-08-17T10:00:00Z',lastCount:75},
    stocks:waiting,
  },
  streams:{
    searchQueries:{status:'success',rows:5,lastSuccessAt:'2026-08-17T10:00:00Z'},
    reviews:{status:'success',rows:0,lastSuccessAt:'2026-08-17T10:00:00Z'},
    questions:{status:'success',rows:0,lastSuccessAt:'2026-08-17T10:00:00Z'},
    stockHistory:{status:'queued',rows:0},
  },
  finance:{status:'rate_limited',lastSuccessAt:null,lastCount:100000},
}

const result = buildProduct360({ product, coverage })
assert.equal(result.readiness.finance,'partial')
assert.equal(result.economics.metricStates.commission,'partial')
assert.equal(result.economics.metricStates.logistics,'partial')
assert.equal(result.economics.metricStates.advertising,'ready')
assert.equal(result.readiness.stocks,'partial')
assert.equal(result.economics.commission,null,'partial zero must remain hidden')
assert.equal(result.economics.logistics,950,'partial non-zero may remain visible')
assert.equal(result.overview.advertising,0,'confirmed advertising zero must remain visible')

const drawer = fs.readFileSync(path.join(projectRoot,'src/components/Product360Drawer.jsx'),'utf8')
assert.ok(drawer.includes('Источники SKU:'),'coverage banner must explain that it counts streams, not visible grouped pills')
assert.ok(drawer.includes('Пока нет в загруженной части'),'partial missing metric must not be labelled as simply not loaded')
assert.ok(drawer.includes('Подтверждено: по этому SKU в выбранной выборке рекламных кампаний или расходов нет.'),'ready empty advertising must be described as a confirmed zero/absence')
assert.ok(drawer.includes('FBS ${readinessText(readiness.fbsStocks)} · FBO ${readinessText(readiness.fboStocks)}'),'partial stock card must explain FBS/FBO separately')
assert.ok(drawer.includes('metricStates.revenue'),'economics rows must use per-metric readiness states')

console.log('WB 5.11.2 SKU 360 state-language regression tests passed')
