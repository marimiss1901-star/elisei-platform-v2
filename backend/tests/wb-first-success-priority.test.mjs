import assert from 'node:assert/strict'
import { dueLiveStages } from '../src/wb/live-sync.js'

const now=Date.parse('2026-08-26T11:00:00Z') // 14:00 Moscow

// A source stream that has never completed successfully must get one fair chance
// before already-working stock streams that are merely more overdue. `sales` is
// intentionally absent: it is persisted from the same successful Order Feed call.
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
assert.equal(due[0],'orders','never-successful Order Feed must receive first-run priority once its interval is due')
assert.ok(!due.includes('sales'),'derived sales must never become an independent live-sync candidate')

// A never-successful source must still respect its retry/cooldown window.
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
assert.ok(!blocked.includes('sales'))

// Once the source has succeeded, normal overdue fairness applies only among the
// three real seller-day sources. Here Order Feed is not yet due (3h cadence), so
// the equally overdue 2h stock streams are ordered by their operational priority.
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
assert.equal(normal[0],'sellerStocks','after first success normal fairness must apply to real source streams')
assert.ok(!normal.includes('sales'))

console.log('WB first-success single-source operational priority regression passed')
