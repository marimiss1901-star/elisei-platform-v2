import assert from 'node:assert/strict'
import { chooseCycleWinners } from '../src/wb/smart-scheduler.js'

const now=Date.now()
const connection_id='cabinet-1'
const finance={
  connection_id,stage:'finance',status:'queued',
  next_allowed_at:new Date(now-20*60*1000).toISOString(),
  metadata:{persistedCount:0},
}
const acquiring={
  connection_id,stage:'acquiring',status:'queued',
  // Deliberately older than finance: before 5.19.15 starvation ordering could
  // choose this dependent row first once both were overdue >10 minutes.
  next_allowed_at:new Date(now-21*60*1000).toISOString(),
  last_count:4140,
  metadata:{waitingForFinance:true,persistedCount:4140},
}

const winners=chooseCycleWinners([acquiring,finance])
assert.equal(winners.get(`${connection_id}:finance`),'finance',
  'finance must always beat acquiring when acquiring is explicitly waitingForFinance')

console.log('ELISEI 5.19.15 finance prerequisite scheduler regression: OK')
