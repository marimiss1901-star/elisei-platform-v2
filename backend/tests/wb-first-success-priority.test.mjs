import assert from 'node:assert/strict'
import { dueLiveStages } from '../src/wb/live-sync.js'

const now=Date.parse('2026-08-26T11:00:00Z') // 14:00 Moscow

// Until Order Feed is verified live, orders and sales are independent proven
// Statistics API streams. A never-successful operational stream gets one fair
// chance before already-working streams that are merely more overdue.
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
assert.ok(due.includes('sales'),'proven sales must remain an independent seller-day candidate')

// A never-successful stream must still respect its retry/cooldown window. Other
// operational streams may continue when they are due.
const blocked=dueLiveStages({
  settings:{enabled:true},
  now,
  timeZone:'Europe/Moscow',
  states:[
    {stage:'orders',status:'rate_limited',next_allowed_at:'2026-08-26T12:00:00Z'},
    {stage:'sales',status:'success',last_success_at:'2026-08-26T04:00:00Z'},
    {stage:'stocks',status:'success',last_success_at:'2026-08-26T10:30:00Z'},
    {stage:'sellerStocks',status:'success',last_success_at:'2026-08-26T10:30:00Z'},
  ],
})
assert.ok(!blocked.includes('orders'),'first-success priority must never bypass WB rate-limit windows')
assert.ok(blocked.includes('sales'),'sales must not be blocked by the orders cooldown')

// Once every operational stream has a success, normal overdue fairness applies.
const normal=dueLiveStages({
  settings:{enabled:true},
  now,
  timeZone:'Europe/Moscow',
  states:[
    {stage:'orders',status:'success',last_success_at:'2026-08-26T08:30:00Z'},
    {stage:'sales',status:'success',last_success_at:'2026-08-26T04:00:00Z'},
    {stage:'stocks',status:'success',last_success_at:'2026-08-26T08:45:00Z'},
    {stage:'sellerStocks',status:'success',last_success_at:'2026-08-26T08:45:00Z'},
  ],
})
assert.equal(normal[0],'sales','after first success the most overdue proven stream must win again')

console.log('WB first-success proven orders/sales operational priority regression passed')
