import assert from 'node:assert/strict'
import { dueLiveStages } from '../src/wb/live-sync.js'

const now=Date.parse('2026-08-26T11:00:00Z') // 14:00 Moscow

// A stream that has never completed successfully must get one fair chance before
// already-working streams that are merely more overdue. This prevents orders from
// being permanently starved by sales/stocks in a single-slot statistics group.
const due=dueLiveStages({
  settings:{enabled:true},
  now,
  timeZone:'Europe/Moscow',
  states:[
    {stage:'orders',status:'error',last_attempt_at:'2026-08-26T08:00:00Z',updated_at:'2026-08-26T08:00:00Z'},
    {stage:'sales',status:'success',last_success_at:'2026-08-26T04:00:00Z'},
    {stage:'stocks',status:'success',last_success_at:'2026-08-26T03:00:00Z'},
    {stage:'sellerStocks',status:'success',last_success_at:'2026-08-26T05:00:00Z'},
  ],
})
assert.equal(due[0],'orders','never-successful orders must receive first-run priority once their interval is due')

// A never-successful stream must still respect its retry/cooldown window.
const blocked=dueLiveStages({
  settings:{enabled:true},
  now,
  timeZone:'Europe/Moscow',
  states:[
    {stage:'orders',status:'rate_limited',next_allowed_at:'2026-08-26T12:00:00Z'},
    {stage:'sales',status:'success',last_success_at:'2026-08-26T04:00:00Z'},
  ],
})
assert.ok(!blocked.includes('orders'),'first-success priority must never bypass WB rate-limit windows')

// Once orders have a success, normal overdue fairness applies again.
const normal=dueLiveStages({
  settings:{enabled:true},
  now,
  timeZone:'Europe/Moscow',
  states:[
    {stage:'orders',status:'success',last_success_at:'2026-08-26T08:30:00Z'},
    {stage:'sales',status:'success',last_success_at:'2026-08-26T04:00:00Z'},
  ],
})
assert.equal(normal[0],'sales','after first success the most overdue stream must win again')

console.log('WB first-success operational priority regression passed')
