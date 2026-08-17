import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  stagePriority,schedulerGroup,initialStageSchedule,chooseCycleWinners,schedulerVisualState,
} from '../src/wb/smart-scheduler.js'

assert.ok(stagePriority('products') < stagePriority('orders'),'catalog must be ready before operational stages')
assert.ok(stagePriority('orders') < stagePriority('sales'),'orders are first operational priority')
assert.ok(stagePriority('sales') < stagePriority('finance'),'sales must precede finance in a cold-start queue')
assert.ok(stagePriority('finance') < stagePriority('fbsArchive'),'historical archive must never block current cabinet data')
assert.equal(schedulerGroup('orders'),'statistics')
assert.equal(schedulerGroup('advertising'),'promotion')
assert.equal(schedulerGroup('finance'),'finance')

const base=Date.parse('2026-08-17T10:00:00Z')
const schedule=initialStageSchedule(['documents','finance','orders','products','sales'],{now:base,gapMs:5000})
assert.deepEqual(schedule.map(item=>item.stage),['products','orders','sales','finance','documents'])
assert.equal(Date.parse(schedule[0].nextAllowedAt),base)
for(let i=1;i<schedule.length;i++) assert.ok(Date.parse(schedule[i].nextAllowedAt)>Date.parse(schedule[i-1].nextAllowedAt),'initial sync must be staggered, not burst at one timestamp')

const winners=chooseCycleWinners([
  {connection_id:'a',stage:'orders',status:'queued'},
  {connection_id:'a',stage:'stocks',status:'pending',task_id:'report-1'},
  {connection_id:'b',stage:'advertising',status:'queued'},
  {connection_id:'b',stage:'finance',status:'queued'},
])
assert.equal(winners.get('a'),'stocks','already-created WB report must be finished before starting another call')
assert.equal(winners.get('b'),'finance','one highest-priority due stage must win per seller account')
assert.equal(winners.size,2)

assert.equal(schedulerVisualState({status:'rate_limited',next_allowed_at:'2026-08-17T11:00:00Z'},base),'waiting_window')
assert.equal(schedulerVisualState({status:'queued',last_count:100,next_allowed_at:'2026-08-17T11:00:00Z'},base),'partial')
assert.equal(schedulerVisualState({status:'queued',next_allowed_at:'2026-08-17T11:00:00Z'},base),'waiting_window')
assert.equal(schedulerVisualState({status:'retry_scheduled',next_allowed_at:'2026-08-17T11:00:00Z'},base),'retry')
assert.equal(schedulerVisualState({status:'error'},base),'error')

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
for(const marker of [
  'prepareSmartSchedulerCycle()',
  'chooseCycleWinners',
  'initialStageSchedule',
  'waitForWbRuntimeWindow',
  "response.headers.get('x-ratelimit-remaining')",
  "response.headers.get('x-ratelimit-reset')",
  "code:'WB_SCHEDULER_WAIT'",
  "mode:'smart_wb_scheduler_v1'",
  "version: '2.23.3'",
  'ELISEI/2.23.3',
]) assert.ok(server.includes(marker),`server.js must contain ${marker}`)

const dashboard=fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx',import.meta.url),'utf8')
for(const marker of [
  'Smart WB Scheduler',
  'Ожидает окно WB',
  'Ожидает запуска',
  'Clock3',
]) assert.ok(dashboard.includes(marker),`Dashboard must contain ${marker}`)

console.log('WB 5.10.5 Smart Scheduler regression tests passed')
