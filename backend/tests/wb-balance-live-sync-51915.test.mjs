import assert from 'node:assert/strict'
import { LIVE_SYNC_STAGES, dueLiveStages, effectiveLiveIntervalSeconds } from '../src/wb/live-sync.js'

assert.ok(LIVE_SYNC_STAGES.includes('balance'),'current WB balance must participate in live sync')

const activeNow=Date.parse('2026-09-11T09:00:00Z') // 12:00 Europe/Moscow
assert.equal(effectiveLiveIntervalSeconds('balance',{now:activeNow}),4*60*60,
  'balance should refresh every four hours during seller day')

const staleState={stage:'balance',status:'success',last_success_at:new Date(activeNow-5*60*60*1000).toISOString()}
assert.ok(dueLiveStages({states:[staleState],now:activeNow}).includes('balance'),
  'a five-hour-old balance must be due during seller day')

const freshState={stage:'balance',status:'success',last_success_at:new Date(activeNow-60*60*1000).toISOString()}
assert.ok(!dueLiveStages({states:[freshState],now:activeNow}).includes('balance'),
  'a one-hour-old balance must not be polled again')

console.log('ELISEI 5.19.15 current balance live-sync regression: OK')
