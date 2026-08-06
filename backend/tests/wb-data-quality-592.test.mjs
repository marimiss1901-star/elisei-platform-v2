import assert from 'node:assert/strict'
import { buildDataQualityReport, extractStreamCoverage } from '../src/wb/data-quality.js'

const now=new Date('2026-08-04T14:38:00Z').getTime()
const requested={from:'2026-08-03',to:'2026-08-03'}
const state=(stage,status='success',extra={})=>({stage,status,lastCount:10,lastSuccessAt:'2026-08-04T14:35:00Z',...extra})
const row=(stream,payload,row_count=10,metadata={})=>({stream,payload,row_count,metadata,source:'postgres',updated_at:'2026-08-04T14:35:00Z'})

// Фактические строки должны быть важнее объявленного/запрошенного периода.
assert.deepEqual(
  extractStreamCoverage('orders',row('orders',{rows:[{date:'2026-06-04'},{date:'2026-08-04'}],period:{from:'2026-08-01',to:'2026-08-04'},complete:false})),
  {from:'2026-06-04',to:'2026-08-04',source:'rows'},
)

const report=buildDataQualityReport({
  now,requestedPeriod:requested,
  states:[
    state('products'),
    state('orders','rate_limited',{nextAllowedAt:'2026-08-04T15:27:15Z'}),
    state('sales','retry_scheduled',{nextAllowedAt:'2026-08-04T15:49:08Z'}),
    state('stocks'),
    state('sellerStocks'),
    state('finance','queued',{lastCount:20,nextAllowedAt:'2026-08-04T21:26:59Z'}),
    state('documents','rate_limited',{lastCount:0,nextAllowedAt:'2026-08-05T11:08:41Z'}),
  ],
  streamRows:[
    row('products',[{nmID:1}],1),
    row('orders',{rows:[{date:'2026-06-04'},{date:'2026-08-04'}],complete:false},9111,{complete:false}),
    row('sales',{rows:[{saleDt:'2026-06-04'},{saleDt:'2026-08-04'}],complete:false},9798,{complete:false}),
    row('stocks',{rows:[{date:'2026-08-04'}],complete:true},113,{complete:true}),
    row('sellerStocks',{rows:[{date:'2026-08-04'}],complete:true},223,{complete:true}),
    row('finance',{rows:[{rrDate:'2026-08-03'}],period:{from:'2026-08-03',to:'2026-08-03'},complete:false},20,{complete:false}),
  ],
  financeSummary:{movements:20,sellerPayable:800,grossRevenue:1000,expenses:200,compensations:0,componentNet:800,reconciliationDifference:0,dateFrom:'2026-08-03',dateTo:'2026-08-03'},
  productDiagnostics:{
    products:62,withBarcodes:60,withMappedStock:44,
    missingBarcodesCount:1,unmatchedStockCount:1,
    missingBarcodes:[{title:'Без ШК',vendorCode:'NO-BC',nmID:1,reason:'Нет штрихкодов'}],
    unmatchedStock:[{title:'Товар без строки',vendorCode:'MISS',nmID:2,reason:'В текущем снимке строка не найдена'}],
  },
})

const orders=report.streams.find(item=>item.stage==='orders')
const sales=report.streams.find(item=>item.stage==='sales')
const finance=report.streams.find(item=>item.stage==='finance')
const stocks=report.streams.find(item=>item.stage==='stocks')
const documentsIssue=report.issues.find(item=>item.id==='waiting:documents')

assert.equal(orders.status,'ready','полностью покрытый выбранный день не должен считаться частичным')
assert.equal(orders.selectedPeriodCovered,true)
assert.equal(orders.backgroundPending,true)
assert.equal(sales.status,'ready')
assert.equal(report.issues.some(item=>item.id==='partial:orders'),false)
assert.equal(report.issues.some(item=>item.id==='partial:sales'),false)
assert.equal(finance.status,'partial','незавершённая финансовая пагинация остаётся предварительной')
assert.equal(stocks.dataMode,'snapshot')
assert.equal(stocks.coverage,null)
assert.equal(stocks.dataModeLabel,'Текущий снимок')
assert.equal(documentsIssue.nextAllowedAt,'2026-08-05T11:08:41Z')
assert.equal(documentsIssue.text.includes('GMT'),false)
assert.equal(report.productDiagnostics.unmatchedStock.length,1)
assert.equal(report.productDiagnostics.unmatchedStockCount,1)
assert.equal(report.productDiagnostics.missingBarcodes.length,1)
assert.equal(report.productDiagnostics.missingBarcodesCount,1)

console.log('wb-data-quality-592: ok')
