import assert from 'node:assert/strict'
import { LIVE_SYNC_STAGES, dueLiveStages } from '../src/wb/live-sync.js'
import { DAILY_READY_OPERATIONAL_RECOVERY_STAGES, dailyHeavyStagePlan } from '../src/wb/daily-ready.js'

assert.deepEqual(LIVE_SYNC_STAGES,['orders','stocks','sellerStocks'],
  'seller-day recurring lane must contain one Order Feed source plus WB/FBS stocks')
assert.deepEqual(DAILY_READY_OPERATIONAL_RECOVERY_STAGES,['orders'],
  'closed-day orders/sales recovery must use one Order Feed source; advertising stays nightly')

const timezone='Europe/Moscow'
const day=Date.parse('2026-08-25T12:00:00Z') // 15:00 Moscow
const night=Date.parse('2026-08-25T00:00:00Z') // 03:00 Moscow
const stale='2026-08-17T00:00:00Z'
const states=[
  {stage:'orders',status:'success',last_success_at:stale},
  {stage:'sales',status:'success',last_success_at:stale},
  {stage:'stocks',status:'success',last_success_at:stale},
  {stage:'sellerStocks',status:'success',last_success_at:stale},
  {stage:'products',status:'success',last_success_at:stale},
  {stage:'advertising',status:'success',last_success_at:stale},
  {stage:'finance',status:'success',last_success_at:stale},
  {stage:'paidStorage',status:'success',last_success_at:stale},
  {stage:'acceptance',status:'success',last_success_at:stale},
  {stage:'acquiring',status:'success',last_success_at:stale},
  {stage:'reviews',status:'success',last_success_at:stale},
  {stage:'questions',status:'success',last_success_at:stale},
  {stage:'chats',status:'success',last_success_at:stale},
  {stage:'searchQueries',status:'success',last_success_at:stale},
]

const dayDue=dueLiveStages({settings:{enabled:true},states,now:day,timeZone:timezone})
assert.deepEqual(new Set(dayDue),new Set(['orders','stocks','sellerStocks']))
assert.ok(!dayDue.includes('sales'),'derived sales must not produce a second WB seller-day call')

const dayHeavy=dailyHeavyStagePlan({states,now:day,timeZone:timezone})
assert.deepEqual(dayHeavy,[],'non-operational refreshes must not start during seller day')

const nightHeavy=dailyHeavyStagePlan({states,now:night,timeZone:timezone})
for(const stage of ['products','advertising','finance','paidStorage','acceptance','acquiring','reviews','questions','chats','searchQueries']) {
  assert.ok(nightHeavy.includes(stage),`stale ${stage} must be eligible for the next nightly pass`)
}

console.log('Single-source seller-day/night load policy regression passed')
