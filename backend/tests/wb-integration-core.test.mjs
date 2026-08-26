import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { normalizeCatalogPage, validateCatalog } from '../src/wb/adapters/catalog.js'
import { normalizeWarehouseRemains, reconcileWarehouseRemains } from '../src/wb/adapters/warehouse-remains.js'
import { normalizeCampaignList, normalizeFullStats, mergeAdvertisingSnapshot } from '../src/wb/adapters/promotion.js'
import { buildProductMaster } from '../src/wb/product-master.js'
import { CURRENT_STOCK_ENDPOINTS, aggregateWbWarehouseItems } from '../src/wb/current-stocks.js'

const catalogPayload = {
  cards:[
    {
      nmID:101,
      vendorCode:'SELLER-101',
      title:'Товар 101',
      brand:'Brand',
      photos:[{ big:'https://example.test/101.jpg' }],
      sizes:[
        { chrtID:1001, techSize:'42', skus:['4600000000101'] },
        { chrtID:1002, techSize:'43', skus:['4600000000102'] },
      ],
    },
    {
      nmID:202,
      vendorCode:'SELLER-202',
      title:'Товар 202',
      sizes:[{ chrtID:2001, techSize:'0', skus:['4600000000202'] }],
    },
  ],
  cursor:{ updatedAt:'2026-07-30T00:00:00Z', nmID:202, total:2 },
}
const catalogPage = normalizeCatalogPage(catalogPayload)
assert.equal(catalogPage.products.length,2)
assert.deepEqual(validateCatalog(catalogPage.products), { products:2, nmIDs:2, barcodes:3 })
assert.equal(catalogPage.products[0].sizes[0].skus[0], '4600000000101')

// Keep the legacy warehouse-remains adapter covered because historical snapshots
// still use that shape. Live stock reads are asserted separately below.
const warehousePayload = [
  {
    nmId:101,
    vendorCode:'SELLER-101',
    barcode:'4600000000101',
    techSize:'42',
    warehouses:[
      { warehouseName:'Рязань', quantity:5 },
      { warehouseName:'В пути до получателей', quantity:99 },
      { warehouseName:'Всего находится на складах', quantity:5 },
    ],
  },
  {
    nmId:101,
    vendorCode:'SELLER-101',
    barcode:'4600000000102',
    techSize:'43',
    warehouses:[{ warehouseName:'Тула', quantity:7 }],
  },
  {
    nmId:202,
    vendorCode:'SELLER-202',
    barcode:'4600000000202',
    techSize:'0',
    warehouses:[{ warehouseName:'Коледино', quantity:11 }],
  },
]
const normalizedStocks = normalizeWarehouseRemains(warehousePayload)
assert.equal(normalizedStocks.rows.length,3)
assert.equal(normalizedStocks.meta.totalQuantity,23)
assert.equal(normalizedStocks.meta.identityCounts.barcodes,3)
const allocation = reconcileWarehouseRemains(catalogPage.products, normalizedStocks.rows)
assert.equal(allocation.diagnostics.matchedRows,3)
assert.equal(allocation.diagnostics.unmatchedRows,0)
assert.equal(allocation.diagnostics.matchedQuantity,23)
assert.equal(allocation.products.find(item => String(item.nmID)==='101').totalQuantity,12)
assert.equal(allocation.products.find(item => String(item.nmID)==='202').totalQuantity,11)
assert.equal(allocation.diagnostics.methods.barcode,3)

const campaignPayload = [
  { advertId:9001, name:'Кампания товара 101', status:9, type:8, nms:[101] },
  { advertId:9002, name:'Кампания товара 202', status:11, type:8, nms:[202] },
]
const campaigns = normalizeCampaignList(campaignPayload)
assert.equal(campaigns.length,2)
const statsPayload = [
  {
    advertId:9001,
    views:1000,
    clicks:100,
    sum:2500,
    orders:8,
    sum_price:16000,
    days:[{ date:'2026-07-29', apps:[{ appType:1, views:1000, clicks:100, sum:2500, orders:8, sum_price:16000, nms:[{ nmId:101, views:1000, clicks:100, sum:2500, orders:8, sum_price:16000 }] }] }],
  },
  {
    advertId:9002,
    views:0,
    clicks:0,
    sum:0,
    orders:0,
    sum_price:0,
    days:[],
  },
]
const stats = normalizeFullStats(statsPayload)
assert.equal(stats.size,2)
assert.equal(stats.get('9001').nmStats[0].nmID,'101')
assert.equal(stats.get('9002').statsAvailable,true)
const advertising = mergeAdvertisingSnapshot({ campaigns, statsByAdvertId:stats, requestedIds:['9001','9002'], period:{ days:30 } })
assert.equal(advertising.campaigns[0].statsStatus,'loaded')
assert.equal(advertising.campaigns[1].statsStatus,'loaded')
assert.equal(advertising.totals.spend,2500)
assert.equal(advertising.totals.cpc,25)
assert.equal(advertising.totals.orderConversion,8)
assert.equal(advertising.totals.romi,540)
assert.equal(advertising.daily.length,1)
assert.equal(advertising.daily[0].date,'2026-07-29')
assert.equal(advertising.daily[0].spend,2500)

const master = buildProductMaster({ catalog:catalogPage.products, stockAllocation:allocation, advertising })
assert.equal(master.length,2)
assert.equal(master.find(item => item.nmID==='101').stock,12)
assert.equal(master.find(item => item.nmID==='101').advertising.spend,2500)
assert.equal(master.find(item => item.nmID==='202').stock,11)

const missingStats = mergeAdvertisingSnapshot({ campaigns, statsByAdvertId:new Map(), requestedIds:['9001'], period:{ days:30 } })
assert.equal(missingStats.campaigns.find(item => item.advertId==='9001').statsStatus,'empty_response')
assert.equal(missingStats.campaigns.find(item => item.advertId==='9001').spend,null)

assert.throws(
  () => normalizeWarehouseRemains([{ warehouses:[{ warehouseName:'Рязань', quantity:100 }] }]),
  /отсутствуют nmId, barcode и vendorCode/,
)

const liveWbStocks = aggregateWbWarehouseItems([
  {nmId:101,chrtId:1001,warehouseId:-999999,warehouseName:'Склад WB',regionName:'Склад WB',quantity:5},
  {nmId:101,chrtId:1001,warehouseId:42,warehouseName:'Переходный склад',quantity:7},
])
assert.equal(liveWbStocks.length,1)
assert.equal(liveWbStocks[0].warehouseId,-999999)
assert.equal(liveWbStocks[0].warehouseName,'Склад WB')
assert.equal(liveWbStocks[0].quantity,12)
assert.equal(CURRENT_STOCK_ENDPOINTS.wb,'https://seller-analytics-api.wildberries.ru/api/analytics/v1/stocks-report/wb-warehouses')
assert.equal(CURRENT_STOCK_ENDPOINTS.seller,undefined)

const here = dirname(fileURLToPath(import.meta.url))
const serverSource = readFileSync(resolve(here, '../src/server.js'), 'utf8')
assert.match(serverSource, /loadCurrentWbStocks/)
assert.doesNotMatch(serverSource, /loadCurrentSellerStocks/)
assert.match(serverSource, /https:\/\/marketplace-api\.wildberries\.ru\/api\/v3\/warehouses/)
assert.match(serverSource, /https:\/\/marketplace-api\.wildberries\.ru\/api\/v3\/stocks\/\$\{warehouseId\}/)

console.log('WB integration core tests: OK')
