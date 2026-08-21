import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  dailyOperationalStageCovered,
  dailyOperationalRecoveryPlan,
  buildDailyMetricStates,
} from '../src/wb/daily-ready.js'

const date='2026-08-18'
const gapCoverage={ from:'2026-08-17',to:'2026-08-19',selectedRows:0,totalRows:20 }
const liveRateLimited={
  stage:'orders',status:'rate_limited',next_allowed_at:'2026-08-19T12:00:00.000Z',
  metadata:{ trigger:'live_poll' },
}

// A min/max range spanning the date does NOT prove that the exact closed day exists.
assert.equal(dailyOperationalStageCovered({stage:'orders',coverage:gapCoverage,state:liveRateLimited,date}),false)
assert.equal(dailyOperationalStageCovered({stage:'sales',coverage:gapCoverage,state:{stage:'sales'},date}),false)

// A successful recovery can explicitly confirm an empty day.
const confirmedEmpty={
  stage:'orders',status:'success',metadata:{ dailyReadyConfirmedFrom:date,dailyReadyConfirmedThrough:date },
}
assert.equal(dailyOperationalStageCovered({stage:'orders',coverage:gapCoverage,state:confirmedEmpty,date}),true)

// Missing exact-day rows must stay waiting instead of becoming a fake ready state.
const metricStates=buildDailyMetricStates({
  core:{ periodCoverage:{ orders:gapCoverage,sales:gapCoverage,advertising:{},finance:{} },finance:{} },
  states:[liveRateLimited,{stage:'sales',status:'idle'}],date,financeLedger:{summary:{}},
})
assert.equal(metricStates.orders.state,'waiting')
assert.equal(metricStates.sales.state,'waiting')

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
const dashboard=fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx',import.meta.url),'utf8')
for (const marker of [
  "const recoverableQueuedStatuses = new Set(['queued','rate_limited','retry_scheduled'])",
  "trigger:'daily_ready_recovery'",
  "await updateSyncState(row.id,stage,{metadata})",
  'recoveryAdoptedAt',
]) assert.ok(server.includes(marker),`server must contain ${marker}`)
assert.ok(dashboard.includes("state.metadata?.dailyReadyDate"))

console.log('wb-daily-ready-5134: live-poll recovery adoption and exact-day coverage ok')
