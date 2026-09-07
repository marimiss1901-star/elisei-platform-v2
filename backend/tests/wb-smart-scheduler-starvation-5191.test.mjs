import assert from 'node:assert/strict'
import {
  chooseCycleWinners,
  schedulerWinnerKey,
  SMART_SCHEDULER_STARVATION_MS,
} from '../src/wb/smart-scheduler.js'

const now = Date.now()
const iso = offsetMs => new Date(now + offsetMs).toISOString()

// Fresh work keeps normal business priority: current stocks should beat a
// newly-due stock-history request in the shared analytics lane.
const fresh = chooseCycleWinners([
  {connection_id:'seller-a',stage:'stocks',status:'queued',next_allowed_at:iso(-1000)},
  {connection_id:'seller-a',stage:'stockHistory',status:'queued',next_allowed_at:iso(-2000)},
])
assert.equal(fresh.get(schedulerWinnerKey('seller-a','stocks')),'stocks')

// Once stockHistory is genuinely overdue it must be allowed to finish instead
// of being starved forever by fresher higher-priority analytics stages.
const overdue = chooseCycleWinners([
  {connection_id:'seller-b',stage:'stocks',status:'queued',next_allowed_at:iso(-1000)},
  {
    connection_id:'seller-b',stage:'stockHistory',status:'queued',last_count:80,
    metadata:{persistedCount:80},
    next_allowed_at:iso(-(SMART_SCHEDULER_STARVATION_MS + 60_000)),
  },
])
assert.equal(overdue.get(schedulerWinnerKey('seller-b','stockHistory')),'stockHistory')

// If several rows are already starved, the oldest due row wins the group. This
// gives every WB stream a bounded path through the queue.
const twoOverdue = chooseCycleWinners([
  {connection_id:'seller-c',stage:'funnel',status:'queued',next_allowed_at:iso(-(SMART_SCHEDULER_STARVATION_MS + 60_000))},
  {connection_id:'seller-c',stage:'stockHistory',status:'queued',next_allowed_at:iso(-(SMART_SCHEDULER_STARVATION_MS + 120_000))},
])
assert.equal(twoOverdue.get(schedulerWinnerKey('seller-c','stockHistory')),'stockHistory')

console.log('WB scheduler starvation guard regression tests passed')
