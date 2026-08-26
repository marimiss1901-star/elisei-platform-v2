import assert from 'node:assert/strict'
import fs from 'node:fs'
import { aggregateWbWarehouseItems, CURRENT_STOCK_ENDPOINTS } from '../src/wb/current-stocks.js'

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

assert.equal(CURRENT_STOCK_ENDPOINTS.wb,'https://seller-analytics-api.wildberries.ru/api/analytics/v1/stocks-report/wb-warehouses')
assert.equal(CURRENT_STOCK_ENDPOINTS.seller,undefined,'FBS must not use Seller Analytics current-stock helper')

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
for(const marker of [
  "stocks: { label: 'Склад WB', scope: 'analytics' }",
  "sellerStocks: { label: 'Остатки FBS', scope: 'marketplace' }",
  "return loadCurrentWbStocks(token, { request:wbFetch, deadlineAt })",
  "const warehouseEndpoint = 'https://marketplace-api.wildberries.ru/api/v3/warehouses'",
  "https://marketplace-api.wildberries.ru/api/v3/stocks/${warehouseId}",
  "String(req.query?.wake || '') === 'daily-ready'",
  "kickBackgroundWorkers('daily-ready-wake')",
]) assert.ok(server.includes(marker),`server must contain ${marker}`)

assert.ok(!server.includes('loadCurrentSellerStocks'),'FBS must keep the Marketplace API reader and Marketplace token scope')
assert.ok(!server.includes("stocks: { label: 'Остатки FBO'"),'legacy FBO backend label must not be exposed')

const dashboard=fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx',import.meta.url),'utf8')
assert.ok(dashboard.includes("title:'Склад WB'"),'connections UI must call consolidated stock Склад WB')
assert.ok(dashboard.includes("['stocks','Склад WB']"),'sync UI must call consolidated stock Склад WB')
assert.ok(!dashboard.includes('Остатки FBO'),'frontend must not expose the obsolete FBO stock label')

const frontendPackage=fs.readFileSync(new URL('../../package.json',import.meta.url),'utf8')
assert.ok(frontendPackage.includes('apply-wb-stock-labels.mjs'),'frontend build must apply WB stock terminology patch')

console.log('WB current stocks 2026 regression passed')
