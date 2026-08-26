import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  stagePriority,schedulerGroup,schedulerWinnerKey,initialStageSchedule,chooseCycleWinners,schedulerVisualState,
} from '../src/wb/smart-scheduler.js'

assert.ok(stagePriority('products') < stagePriority('orders'),'catalog must be ready before operational stages')
assert.ok(stagePriority('orders') < stagePriority('sales'),'orders are first Order Feed priority')
assert.ok(stagePriority('sales') < stagePriority('finance'),'sales priority remains ahead of finance inside the business ordering')
assert.ok(stagePriority('finance') < stagePriority('fbsArchive'),'historical archive must never block current cabinet data')
assert.equal(schedulerGroup('orders'),'orderFeed')
assert.equal(schedulerGroup('sales'),'orderFeed')
assert.equal(schedulerGroup('advertising'),'promotion')
assert.equal(schedulerGroup('finance'),'finance')

const base=Date.parse('2026-08-17T10:00:00Z')
const schedule=initialStageSchedule(['documents','finance','orders','products','sales'],{now:base,gapMs:5000})
assert.deepEqual(schedule.map(item=>item.stage),['products','orders','sales','finance','documents'])
const byStage=Object.fromEntries(schedule.map(item=>[item.stage,item]))
assert.equal(Date.parse(byStage.products.nextAllowedAt),base)
assert.equal(Date.parse(byStage.orders.nextAllowedAt),base)
assert.equal(Date.parse(byStage.finance.nextAllowedAt),base)
assert.equal(Date.parse(byStage.documents.nextAllowedAt),base)
assert.ok(Date.parse(byStage.sales.nextAllowedAt)>Date.parse(byStage.orders.nextAllowedAt),'same Order Feed group must remain staggered')

const winners=chooseCycleWinners([
  {connection_id:'a',stage:'orders',status:'queued'},
  {connection_id:'a',stage:'stocks',status:'pending',task_id:'report-1'},
  {connection_id:'b',stage:'advertising',status:'queued'},
  {connection_id:'b',stage:'finance',status:'queued'},
])
assert.equal(winners.get(schedulerWinnerKey('a','orders')),'orders','Order Feed group should be allowed')
assert.equal(winners.get(schedulerWinnerKey('a','stocks')),'stocks','independent analytics group should run in the same cycle')
assert.equal(winners.get(schedulerWinnerKey('b','advertising')),'advertising','promotion group should run independently')
assert.equal(winners.get(schedulerWinnerKey('b','finance')),'finance','finance group should run independently')
assert.equal(winners.size,4,'one winner is expected per seller and API group, not per seller account')

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
  'wbRateWindowDelaySeconds(response)',
  "code:'WB_SCHEDULER_WAIT'",
  "mode:'smart_wb_scheduler_v1'",
  "smartSchedulerWinners.get(`${String(connectionId)}:${schedulerGroup(stage)}`)",
]) assert.ok(server.includes(marker),`server.js must contain ${marker}`)

const rateWindow=fs.readFileSync(new URL('../src/wb/rate-window.js',import.meta.url),'utf8')
for(const marker of [
  "response.headers.get('x-ratelimit-retry')",
  "response.headers.get('x-ratelimit-reset')",
  "Number(response.status||0)!==429",
]) assert.ok(rateWindow.includes(marker),`rate-window.js must contain ${marker}`)

const dashboard=fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx',import.meta.url),'utf8')
for(const marker of [
  'Smart WB Scheduler',
  'Ожидает окно WB',
  'Ожидает запуска',
  'Clock3',
]) assert.ok(dashboard.includes(marker),`Dashboard must contain ${marker}`)

console.log('WB grouped Smart Scheduler + Order Feed lane regression tests passed')
