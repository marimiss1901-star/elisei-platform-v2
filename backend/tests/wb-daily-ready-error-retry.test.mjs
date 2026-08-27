import assert from 'node:assert/strict'
import fs from 'node:fs'
import { dailyOperationalRecoveryPlan } from '../src/wb/daily-ready.js'

const now=Date.parse('2026-08-27T10:00:00Z')
const date='2026-08-26'

// A transient Statistics API error must not freeze yesterday forever. After the
// short Daily Ready cooldown the missing orders day is eligible for recovery.
const recoverable=dailyOperationalRecoveryPlan({
  date,now,coverage:{},minimumRetryMs:5*60*1000,
  states:[
    {stage:'orders',status:'error',last_attempt_at:'2026-08-27T09:50:00Z',updated_at:'2026-08-27T09:50:00Z'},
    {stage:'sales',status:'rate_limited',next_allowed_at:'2026-08-27T10:30:00Z'},
    {stage:'advertising',status:'running'},
  ],
})
assert.deepEqual(recoverable,['orders'])

// The same error is not retried in a hot loop before the cooldown expires.
const cooling=dailyOperationalRecoveryPlan({
  date,now,coverage:{},minimumRetryMs:5*60*1000,
  states:[
    {stage:'orders',status:'error',last_attempt_at:'2026-08-27T09:58:00Z',updated_at:'2026-08-27T09:58:00Z'},
    {stage:'sales',status:'rate_limited',next_allowed_at:'2026-08-27T10:30:00Z'},
    {stage:'advertising',status:'running'},
  ],
})
assert.deepEqual(cooling,[])

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
assert.ok(server.includes("if(status==='error' && lastFailureAt && now-lastFailureAt<5*60*1000) continue"),'server must cool down transient errors instead of hard-blocking them')
assert.ok(!server.includes("'subscription_required','optional_unavailable','error'])"),'error must not remain a hard-blocked Daily Ready status')
assert.ok(server.includes('LEGACY_ORDERS_ROLLBACK_VERSION=2'),'current cabinets must be requeued once after this recovery fix')

console.log('WB Daily Ready transient orders error recovery regression passed')
