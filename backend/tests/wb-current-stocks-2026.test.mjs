import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  aggregateWbWarehouseItems, normalizeSellerWarehouseItems, CURRENT_STOCK_ENDPOINTS,
} from '../src/wb/current-stocks.js'

const wb=aggregateWbWarehouseItems([
  {nmId:100,chrtId:10,warehouseId:1,warehouseName:'Коледино',quantity:4,inWayToClient:1},
  {nmId:100,chrtId:10,warehouseId:2,warehouseName:'Казань',quantity:6,inWayFromClient:2},
  {nmId:100,chrtId:11,warehouseId:-999999,warehouseName:'Склад WB',regionName:'Склад WB',quantity:3},
])
assert.equal(wb.length,2)
const size10=wb.find(row=>row.chrtId===10)
assert.equal(size10.warehouseId,-999999)
assert.equal(size10.warehouseName,'Склад WB')
assert.equal(size10.regionName,'Склад WB')
assert.equal(size10.quantity,10)
assert.equal(size10.inWayToClient,1)
assert.equal(size10.inWayFromClient,2)

const fbs=normalizeSellerWarehouseItems([
  {nmId:200,chrtId:20,warehouseId:555,warehouseName:'Мой склад',quantity:7},
])
assert.equal(fbs[0].warehouseName,'Мой склад')
assert.equal(fbs[0].quantity,7)

assert.equal(CURRENT_STOCK_ENDPOINTS.wb,'https://seller-analytics-api.wildberries.ru/api/analytics/v1/stocks-report/wb-warehouses')
assert.equal(CURRENT_STOCK_ENDPOINTS.seller,'https://seller-analytics-api.wildberries.ru/api/analytics/v1/stocks-report/seller-warehouses')

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
for(const marker of [
  "stocks: { label: 'Склад WB', scope: 'analytics' }",
  "sellerStocks: { label: 'Остатки FBS', scope: 'analytics' }",
  "return loadCurrentWbStocks(token, { request:wbFetch, deadlineAt })",
  "return loadCurrentSellerStocks(token, products, { request:wbFetch, deadlineAt })",
  "String(req.query?.wake || '') === 'daily-ready'",
  "kickBackgroundWorkers('daily-ready-wake')",
]) assert.ok(server.includes(marker),`server must contain ${marker}`)

assert.ok(!server.includes("https://marketplace-api.wildberries.ru/api/v3/stocks/${warehouseId}"),'active FBS reader must not poll each seller warehouse')
assert.ok(!server.includes("stocks: { label: 'Остатки FBO'"),'legacy FBO label must not be exposed for current WB stock')

console.log('WB current stocks 2026 regression passed')
