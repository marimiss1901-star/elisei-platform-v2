import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  DAILY_READY_VERSION, AUTOMATIC_REFRESH_INTERVALS_SECONDS, dailyHeavyStagePlan, dailyReadySlot,
} from '../src/wb/daily-ready.js'

assert.equal(DAILY_READY_VERSION,7)
assert.equal(AUTOMATIC_REFRESH_INTERVALS_SECONDS.orders,30*60)
assert.equal(AUTOMATIC_REFRESH_INTERVALS_SECONDS.sales,30*60)
assert.equal(AUTOMATIC_REFRESH_INTERVALS_SECONDS.sellerStocks,30*60)
assert.equal(AUTOMATIC_REFRESH_INTERVALS_SECONDS.advertising,30*60)
assert.equal(AUTOMATIC_REFRESH_INTERVALS_SECONDS.chats,15*60)

const timezone='Europe/Moscow'
const night=Date.parse('2026-08-21T00:00:00Z') // 03:00 Moscow
const day=Date.parse('2026-08-21T14:49:00Z') // 17:49 Moscow
assert.equal(dailyReadySlot(new Date(night),timezone),'overnight')
assert.equal(dailyReadySlot(new Date(day),timezone),'late-check')

const emptyStates=[]
const nightPlan=dailyHeavyStagePlan({states:emptyStates,now:night,timeZone:timezone})
for(const stage of ['finance','acquiring','paidStorage','acceptance','documents']) {
  assert.ok(nightPlan.includes(stage),`night plan must include ${stage}`)
}
assert.deepEqual(dailyHeavyStagePlan({states:emptyStates,now:day,timeZone:timezone}),[],
  'fresh heavy downloads must not start during the seller workday')

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
for(const marker of [
  'OPERATIONAL_RETRY_CAP_SECONDS',
  'orders:15*60',
  'sales:15*60',
  'advertising:15*60',
  'recoverExcessiveOperationalBackoffs',
  "trigger:'nightly_ready'",
  'cabinetSpreadSeconds',
  "next_allowed_at=NOW() + INTERVAL '2 minutes'",
]) assert.ok(server.includes(marker),`server.js must contain ${marker}`)

console.log('ELISEI 5.15.3 Nightly Ready and operational retry caps: OK')
