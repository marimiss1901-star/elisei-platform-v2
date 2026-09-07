import assert from 'node:assert/strict'
import {
  LIVE_SYNC_STAGES,
  defaultLiveSyncSettings,
  effectiveLiveIntervalSeconds,
  dueLiveStages,
} from '../src/wb/live-sync.js'

assert.ok(LIVE_SYNC_STAGES.includes('advertising'),'advertising must be part of automatic live-sync stages')
assert.equal(defaultLiveSyncSettings().intervals.advertising,3600,'advertising default cadence must be hourly')

const activeNow=new Date('2026-09-07T11:20:00.000Z').getTime() // 14:20 Moscow
assert.equal(effectiveLiveIntervalSeconds('advertising',{now:activeNow}),3600,'advertising active-day cadence must be one hour')

const staleAdvertisingState={
  stage:'advertising',status:'success',
  last_success_at:'2026-09-06T10:04:32.278Z',
  last_attempt_at:'2026-09-06T10:04:32.278Z',
  updated_at:'2026-09-06T10:04:32.278Z',
}
const due=dueLiveStages({settings:defaultLiveSyncSettings(),states:[staleAdvertisingState],now:activeNow})
assert.ok(due.includes('advertising'),'stale successful advertising must be queued again automatically')

const freshAdvertisingState={
  ...staleAdvertisingState,
  last_success_at:'2026-09-07T10:50:00.000Z',
  last_attempt_at:'2026-09-07T10:50:00.000Z',
  updated_at:'2026-09-07T10:50:00.000Z',
}
const freshDue=dueLiveStages({settings:defaultLiveSyncSettings(),states:[freshAdvertisingState],now:activeNow})
assert.ok(!freshDue.includes('advertising'),'fresh advertising must not be over-polled inside the hourly window')

console.log('ELISEI 5.18.9 advertising live-sync regression: OK')
