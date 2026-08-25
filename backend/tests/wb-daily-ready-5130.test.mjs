import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  businessDateKey,yesterdayDateKey,dailyReadySlot,dailyHeavyStagePlan,buildDailyMetricStates,dailyReadinessSummary,
  compactDailyCore,dailySnapshotSourceRevision,snapshotNeedsRefresh,mergeDailyReadySnapshots,
} from '../src/wb/daily-ready.js'

const moscow='Europe/Moscow'
assert.equal(businessDateKey(new Date('2026-08-18T22:30:00Z'),moscow),'2026-08-19')
assert.equal(yesterdayDateKey(new Date('2026-08-19T08:00:00Z'),moscow),'2026-08-18')
assert.equal(dailyReadySlot(new Date('2026-08-19T02:30:00Z'),moscow),'preopen') // 05:30 MSK
assert.equal(dailyReadySlot(new Date('2026-08-19T04:45:00Z'),moscow),'morning-ready') // 07:45 MSK

// Heavy work is eligible before opening time, not during the workday.
// Non-operational streams now share the same overnight lane and are deliberately
// scheduled after the core finance stages.
const now=Date.parse('2026-08-19T02:00:00Z') // 05:00 MSK
const states=[
  {stage:'finance',status:'success',last_success_at:new Date(now-21*3600000).toISOString()},
  {stage:'paidStorage',status:'success',last_success_at:new Date(now-25*3600000).toISOString()},
  {stage:'acceptance',status:'queued',next_allowed_at:new Date(now+3600000).toISOString(),last_success_at:new Date(now-30*3600000).toISOString()},
  {stage:'acquiring',status:'success',last_success_at:new Date(now-2*3600000).toISOString()},
  {stage:'documents',status:'success',last_success_at:new Date(now-2*3600000).toISOString()},
]
assert.deepEqual(dailyHeavyStagePlan({states,now,timeZone:moscow}),[
  'finance','paidStorage',
  'products','advertising','reviews','questions','chats','financeReports','acquiringReports','jamSubscription',
  'measurementPenalties','deductionsReport','warehouseMeasurements','antifraudRetention','labelingRetention',
  'goodsReturns','tariffs','funnel','searchQueries','stockHistory',
])
assert.deepEqual(dailyHeavyStagePlan({states,now:Date.parse('2026-08-19T12:00:00Z'),timeZone:moscow}),[])

const core={
  periodCoverage:{
    orders:{from:'2026-08-01',to:'2026-08-18',selectedRows:10},
    sales:{from:'2026-08-01',to:'2026-08-18',selectedRows:8},
    advertising:{from:'2026-08-01',to:'2026-08-18',selectedRows:1},
  },
  finance:{complete:false},
  summary:{revenue:1000,orders:10,sales:8,advertising:100,commission:0},
  availability:{orders:true,sales:true,advertising:true,finance:true},
  products:[{id:'a',revenue:900},{id:'b',revenue:100}],recommendations:[],dailyTrend:[],
}
const metricStates=buildDailyMetricStates({
  core,date:'2026-08-18',
  states:[
    {stage:'orders',status:'success'},{stage:'sales',status:'success'},{stage:'advertising',status:'success'},
    {stage:'finance',status:'queued'},{stage:'stocks',status:'success'},{stage:'sellerStocks',status:'success'},
  ],
  financeLedger:{summary:{movements:3,dateFrom:'2026-08-18',dateTo:'2026-08-18'}},
})
assert.equal(metricStates.orders.state,'ready')
assert.equal(metricStates.sales.state,'ready')
assert.equal(metricStates.advertising.state,'ready')
assert.equal(metricStates.finance.state,'partial')
assert.equal(metricStates.stocks.state,'ready')
const readiness=dailyReadinessSummary(metricStates)
assert.equal(readiness.status,'partial')
assert.equal(readiness.ready,3)
assert.equal(readiness.partial,1)
assert.equal(readiness.operationalReady,true)

// Persisted coverage is the source of truth for a closed day.
// A newly queued refresh must not make yesterday's confirmed figures disappear.
const queuedButPersisted=buildDailyMetricStates({
  core,date:'2026-08-18',
  states:[
    {stage:'orders',status:'queued'},{stage:'sales',status:'running'},{stage:'advertising',status:'rate_limited'},
    {stage:'finance',status:'queued'},
  ],
  financeLedger:{summary:{movements:3,dateFrom:'2026-08-18',dateTo:'2026-08-18'}},
})
assert.equal(queuedButPersisted.orders.state,'ready')
assert.equal(queuedButPersisted.sales.state,'ready')
assert.equal(queuedButPersisted.advertising.state,'ready')
assert.equal(queuedButPersisted.finance.state,'partial')

const lastGood={
  date:'2026-08-18',generatedAt:'2026-08-19T04:30:00Z',
  metricStates:{orders:{state:'ready'},sales:{state:'ready'},advertising:{state:'ready'},finance:{state:'ready'},stocks:{state:'ready'}},
  core:{
    summary:{orders:12,revenue:1200,sales:10,returns:1,returnRate:10,advertising:100,commission:200,logistics:50,sellerPayable:850,stockUnits:40},
    topProducts:[{id:'good'}],dailyTrend:[{date:'2026-08-18',revenue:1200}],
    advertising:{totals:{spend:100}},finance:{summary:{movements:5,sellerPayable:850}},stockMeta:{trusted:true},
  },
}
const transient={
  date:'2026-08-18',generatedAt:'2026-08-19T05:00:00Z',
  metricStates:{orders:{state:'waiting'},sales:{state:'waiting'},advertising:{state:'partial'},finance:{state:'waiting'},stocks:{state:'waiting'}},
  core:{
    summary:{orders:null,revenue:null,sales:null,returns:null,advertising:0,commission:0,logistics:0,sellerPayable:null,stockUnits:null},
    topProducts:[],dailyTrend:[],advertising:{totals:{}},finance:{summary:{}},stockMeta:null,
  },
}
const stable=mergeDailyReadySnapshots(lastGood,transient)
assert.equal(stable.metricStates.sales.state,'ready')
assert.equal(stable.metricStates.finance.state,'ready')
assert.equal(stable.core.summary.revenue,1200)
assert.equal(stable.core.summary.sellerPayable,850)
assert.deepEqual(stable.core.topProducts,[{id:'good'}])
assert.equal(stable.status,'ready')
assert.ok(stable.stability.lastKnownGood)

const compact=compactDailyCore(core,{summary:{movements:3,sellerPayable:700}})
assert.equal(compact.topProducts.length,2)
assert.equal(compact.summary.sellerPayable,700)
const rev=dailySnapshotSourceRevision([{stage:'orders',status:'success',last_success_at:'2026-08-19T01:00:00Z',last_count:10}], '2026-08-18')
assert.equal(snapshotNeedsRefresh({source_revision:rev,generated_at:new Date(now-1000).toISOString()},rev,{now,maxAgeMs:60000}),false)
assert.equal(snapshotNeedsRefresh({source_revision:'old',generated_at:new Date(now-1000).toISOString()},rev,{now,maxAgeMs:60000}),true)

const workflow=fs.readFileSync(new URL('../../.github/workflows/elisei-daily-ready-wake.yml',import.meta.url),'utf8')
for (const marker of ["'0 2 * * *'","'30 4 * * *'","'30 8 * * *'",'/health','ELISEI_BACKEND_URL']) {
  assert.ok(workflow.includes(marker),`Daily Ready wake workflow must contain ${marker}`)
}

console.log('wb-daily-ready-5130: ok')
