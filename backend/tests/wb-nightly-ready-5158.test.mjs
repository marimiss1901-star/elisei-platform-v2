import assert from 'node:assert/strict'
import { DAILY_READY_HEAVY_INTERVALS_SECONDS, dailyHeavyStagePlan } from '../src/wb/daily-ready.js'

const expected=[
  'finance','acquiring','paidStorage','acceptance','documents',
  'measurementPenalties','deductionsReport','warehouseMeasurements','antifraudRetention','labelingRetention',
  'goodsReturns','tariffs','funnel','searchQueries','stockHistory',
]
for(const stage of expected){
  assert.equal(DAILY_READY_HEAVY_INTERVALS_SECONDS[stage], stage==='finance'||stage==='acquiring' ? 20*60*60 : 24*60*60, stage+' must have nightly cadence')
}

const old='2026-08-23T01:00:00.000Z'
const states=expected.map(stage=>({stage,status:'success',last_success_at:old,next_allowed_at:null}))
const plan=dailyHeavyStagePlan({states,now:new Date('2026-08-25T00:30:00.000Z').getTime(),timeZone:'Europe/Moscow'})
for(const stage of expected) assert.ok(plan.includes(stage),stage+' should be eligible overnight when stale')
assert.ok(plan.indexOf('finance') < plan.indexOf('measurementPenalties'),'finance must remain ahead of secondary nightly reports')

const daytime=dailyHeavyStagePlan({states,now:new Date('2026-08-25T09:00:00.000Z').getTime(),timeZone:'Europe/Moscow'})
assert.deepEqual(daytime,[],'fresh heavy jobs must not start during seller daytime')
console.log('ELISEI 5.15.8 Nightly Ready extended layer regression: OK')
