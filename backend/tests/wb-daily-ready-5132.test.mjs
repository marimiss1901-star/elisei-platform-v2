import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  dailyOperationalRecoveryPlan,buildDailyMetricStates,
} from '../src/wb/daily-ready.js'

const now=Date.parse('2026-08-19T10:00:00Z')
const date='2026-08-18'

// Closed-day recovery: orders and sales now share one authoritative WB Order
// Feed. If the saved feed stops before yesterday, Daily Ready queues only the
// source stage `orders`; the same response persists the derived sales model.
const plan=dailyOperationalRecoveryPlan({
  date,now,
  coverage:{
    orders:{from:'2026-08-01',to:'2026-08-17',selectedRows:0},
    sales:{from:'2026-08-01',to:'2026-08-17',selectedRows:0},
    advertising:{from:'2026-07-20',to:'2026-08-18',selectedRows:0},
  },
  states:[
    {stage:'orders',status:'success',last_attempt_at:'2026-08-19T08:00:00Z'},
    {stage:'sales',status:'success',last_attempt_at:'2026-08-19T08:00:00Z'},
    {stage:'advertising',status:'success',last_attempt_at:'2026-08-19T08:00:00Z'},
  ],
})
assert.deepEqual(plan,['orders'])

// Never duplicate a source stage that is already queued or waiting for a real
// WB window. Sales and advertising are not independent daytime recovery jobs.
const blocked=dailyOperationalRecoveryPlan({
  date,now,coverage:{},
  states:[
    {stage:'orders',status:'queued',next_allowed_at:'2026-08-19T09:00:00Z'},
    {stage:'sales',status:'rate_limited',next_allowed_at:'2026-08-19T11:00:00Z'},
    {stage:'advertising',status:'running'},
  ],
})
assert.deepEqual(blocked,[])

// A successful explicit Order Feed backfill confirms both business read models,
// including a legitimate zero-sales day, so neither side enters a retry loop.
const zeroConfirmed=buildDailyMetricStates({
  date,
  core:{periodCoverage:{orders:{from:null,to:null,selectedRows:0},sales:{from:null,to:null,selectedRows:0},advertising:{from:'2026-08-18',to:'2026-08-18',selectedRows:0}},finance:{complete:false}},
  states:[
    {stage:'orders',status:'success',metadata:{dailyReadyConfirmedFrom:date,dailyReadyConfirmedThrough:date}},
    {stage:'sales',status:'success',metadata:{dailyReadyConfirmedFrom:date,dailyReadyConfirmedThrough:date,derivedFromOrders:true}},
    {stage:'advertising',status:'success'},
    {stage:'finance',status:'queued'},
  ],
  financeLedger:{summary:{movements:0,dateFrom:null,dateTo:null}},
})
assert.equal(zeroConfirmed.orders.state,'ready')
assert.equal(zeroConfirmed.orders.evidence,'wb_query_confirmed_date')
assert.equal(zeroConfirmed.sales.state,'ready')
assert.equal(zeroConfirmed.sales.evidence,'wb_query_confirmed_date')

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
for (const marker of [
  "trigger:'daily_ready_recovery'",
  'dailyReadyConfirmedThrough',
  'siblingDailyReadyConfirmation',
  'derivedFromOrders:true',
  'missingCoverage:true',
]) assert.ok(server.includes(marker),`server must contain ${marker}`)

console.log('wb-daily-ready-5132 single Order Feed recovery: ok')
