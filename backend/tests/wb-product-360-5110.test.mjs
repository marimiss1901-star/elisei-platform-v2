import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildProduct360, findProduct360Product, product360Matches } from '../src/wb/product-360.js'

const __dirname=path.dirname(fileURLToPath(import.meta.url))
const backendRoot=path.resolve(__dirname,'..')
const projectRoot=path.resolve(backendRoot,'..')

const product={
  key:'nm:111',nmID:111,vendorCode:'RED-1',barcode:'460001',barcodes:['460001'],title:'Футболка базовая',brand:'Demo',
  revenue:12000,profit:2400,margin:20,ordersCount:12,salesCount:10,returnsCount:2,returnRate:20,stock:8,stockCoverDays:12,
  advertising:1000,averagePrice:1200,unitCost:400,cogs:4000,commission:1800,logistics:900,storage:100,acceptance:0,acquiring:150,
  penalties:0,deductions:0,tax:0,fixedExpenses:650,expenses:9600,breakevenPrice:960,targetPrice:1200,peakPrice:1380,
  dailyRevenue:{'2026-08-16':5000,'2026-08-17':7000},dailySales:{'2026-08-16':4,'2026-08-17':6},dailyReturns:{'2026-08-17':2},dailyOrders:{'2026-08-16':5,'2026-08-17':7},
  fbsStock:3,fboStock:5,fulfillmentMode:'FBS + FBO',recommendation:'Запланировать поставку',
}
const other={key:'nm:222',nmID:222,vendorCode:'RED-2',barcode:'460002',title:'Футболка базовая'}

assert.equal(findProduct360Product([product,other],'nm:111')?.nmID,111)
assert.equal(findProduct360Product([product,other],'RED-1')?.nmID,111)
assert.equal(product360Matches({productDetails:{nmId:111,supplierArticle:'RED-1'}},product).matched,true)
assert.equal(product360Matches({nmID:222,title:'Футболка базовая'},product).matched,false)
assert.equal(product360Matches({title:'Футболка базовая'},product).matched,false,'title-only rows must never be joined to SKU 360')

const result=buildProduct360({
  product,
  advertisingRows:[
    {nmID:111,advertId:1,campaignName:'A',spend:1000,views:10000,clicks:500,orders:5,revenue:6000},
    {nmID:222,advertId:2,campaignName:'B',spend:99999,views:1,clicks:1,orders:0,revenue:0},
  ],
  searchRows:[
    {rowType:'query',nmID:111,searchText:'красная футболка',avgPosition:12,orders:4,orderSum:5000,frequency:1000},
    {rowType:'query',nmID:222,searchText:'другая карточка',avgPosition:1,orders:99,orderSum:99999},
  ],
  reviewRows:[
    {productDetails:{nmId:111,supplierArticle:'RED-1'},productValuation:2,text:'маломерит',isAnswered:false,createdDate:'2026-08-17'},
    {productDetails:{nmId:222,supplierArticle:'RED-2'},productValuation:1,text:'чужой отзыв',isAnswered:false,createdDate:'2026-08-17'},
    {title:'Футболка базовая',productValuation:1,text:'без идентификатора',isAnswered:false},
  ],
  questionRows:[{productDetails:{nmId:111},text:'какая длина?',isAnswered:true,createdDate:'2026-08-16'}],
  stockHistoryRows:[
    {nmID:111,date:'2026-08-16',quantity:10,warehouseName:'Коледино'},
    {nmID:111,date:'2026-08-17',quantity:8,warehouseName:'Коледино'},
    {nmID:222,date:'2026-08-17',quantity:500,warehouseName:'Чужой'},
  ],
  stockDetails:[{nmID:111,techSize:'M',barcode:'460001',warehouseName:'Коледино',quantity:8},{nmID:222,quantity:999}],
  financeMovements:[{nmId:111,operationDate:'2026-08-17',operationName:'Логистика',amount:-100}],
  period:{from:'2026-08-11',to:'2026-08-17',days:7},
})

assert.equal(result.demand.advertising.rows.length,1)
assert.equal(result.demand.advertising.summary.spend,1000)
assert.equal(result.demand.search.rows.length,1)
assert.equal(result.demand.search.rows[0].phrase,'красная футболка')
assert.equal(result.quality.reviews.length,1)
assert.equal(result.quality.reviewSummary.lowRated,1)
assert.equal(result.quality.lowRatedTexts[0],'маломерит')
assert.equal(result.stock.current.length,1)
assert.equal(result.stock.history.daily.at(-1).quantity,8)
assert.ok(result.matchingPolicy.includes('Название товара не используется'))
assert.ok(result.signals.some(item=>item.type==='quality'))

const server=fs.readFileSync(path.join(backendRoot,'src/server.js'),'utf8')
const api=fs.readFileSync(path.join(projectRoot,'src/lib/api.js'),'utf8')
const dashboard=fs.readFileSync(path.join(projectRoot,'src/pages/DashboardPage.jsx'),'utf8')
const drawer=fs.readFileSync(path.join(projectRoot,'src/components/Product360Drawer.jsx'),'utf8')
assert.ok(server.includes("app.get('/api/wb/product-360/:id'"),'backend must expose product 360 endpoint')
assert.ok(server.includes('loadProduct360ExtendedRows'),'backend must load product-scoped extended streams')
assert.ok(api.includes('/api/wb/product-360/'),'frontend API must expose product360')
assert.ok(dashboard.includes('<Product360Drawer'),'dashboard must render contextual SKU 360')
assert.ok(drawer.includes('SKU 360 · единый рентген товара'))

console.log('WB 5.11.0 SKU 360 regression tests passed')
