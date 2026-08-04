import assert from 'node:assert/strict'
import { buildDataQualityReport, extractStreamCoverage } from '../src/wb/data-quality.js'

const now=new Date('2026-08-04T12:00:00Z').getTime()
const requested={from:'2026-07-29',to:'2026-08-04'}
const success=stage=>({stage,status:'success',lastCount:10,lastSuccessAt:'2026-08-04T11:55:00Z',metadata:{complete:true}})
const rows=(stream,payload,row_count=10)=>({stream,payload,row_count,metadata:{complete:true},source:'sync',updated_at:'2026-08-04T11:55:00Z'})

assert.deepEqual(extractStreamCoverage('sales',rows('sales',[{saleDt:'2026-07-29'},{saleDt:'2026-08-04'}])),{from:'2026-07-29',to:'2026-08-04',source:'rows'})

const confirmed=buildDataQualityReport({
  now,requestedPeriod:requested,
  states:['products','orders','sales','stocks','sellerStocks','finance','documents'].map(success),
  streamRows:[
    rows('products',[{nmID:1}],1),
    rows('orders',[{date:'2026-07-29'},{date:'2026-08-04'}],2),
    rows('sales',[{saleDt:'2026-07-29'},{saleDt:'2026-08-04'}],2),
    rows('stocks',[{date:'2026-08-04'}],1),
    rows('sellerStocks',[{date:'2026-08-04'}],1),
    rows('finance',{rows:[{rrDate:'2026-07-29'},{rrDate:'2026-08-04'}],complete:true,period:requested},2),
    rows('documents',{rows:[{date:'2026-07-29'},{date:'2026-08-04'}],complete:true,period:requested},2),
  ],
  financeSummary:{movements:20,sellerPayable:800,grossRevenue:1000,expenses:200,compensations:0,componentNet:800,reconciliationDifference:0,dateFrom:'2026-07-29',dateTo:'2026-08-04'},
  productDiagnostics:{products:10,withBarcodes:10,withMappedStock:9},
})
assert.equal(confirmed.profitConfidence.status,'confirmed')
assert.deepEqual(confirmed.confirmedPeriod,requested)
assert.equal(confirmed.finance.withinTolerance,true)
assert.equal(confirmed.issues.some(item=>item.id==='finance:empty'),false)
assert.ok(confirmed.score>60)

const partial=buildDataQualityReport({
  now,requestedPeriod:requested,
  states:[success('products'),success('orders'),success('sales'),{stage:'finance',status:'queued',lastCount:5,nextAllowedAt:'2026-08-04T21:00:00Z',metadata:{persistedCount:5,complete:false}},{stage:'documents',status:'rate_limited',lastCount:0,nextAllowedAt:'2026-08-05T14:00:00Z'}],
  streamRows:[
    rows('products',[{nmID:1}],1),
    rows('orders',[{date:'2026-07-29'},{date:'2026-08-04'}],2),
    rows('sales',[{saleDt:'2026-07-29'},{saleDt:'2026-08-04'}],2),
    {stream:'finance',payload:{rows:[{rrDate:'2026-07-29'}],complete:false,period:{from:'2026-07-29',to:'2026-07-31'}},row_count:5,metadata:{complete:false},source:'partial-sync',updated_at:'2026-08-04T10:00:00Z'},
  ],
  financeSummary:{movements:5,sellerPayable:500,grossRevenue:900,expenses:100,compensations:0,componentNet:800,reconciliationDifference:-300,dateFrom:'2026-07-29',dateTo:'2026-07-31'},
  productDiagnostics:{products:10,withBarcodes:6,withMappedStock:2},
})
assert.equal(partial.profitConfidence.status,'preliminary')
assert.equal(partial.streams.find(item=>item.stage==='finance').status,'partial')
assert.ok(partial.issues.some(item=>item.id==='finance:reconciliation'))
assert.ok(partial.issues.some(item=>item.id==='products:barcodes'))
assert.ok(partial.issues.some(item=>item.id==='waiting:documents'))

console.log('wb-data-quality-591: ok')
