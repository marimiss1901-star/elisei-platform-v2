import assert from 'node:assert/strict'
import fs from 'node:fs'

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
const start=server.indexOf('async function recoverLegacyFinanceCooldowns')
const end=server.indexOf('\n\nconst backgroundWorkerState',start)
assert.ok(start>=0 && end>start,'recoverLegacyFinanceCooldowns must exist')
const block=server.slice(start,end)

assert.ok(block.includes("stage='finance'"),'migration must target finance only')
assert.ok(block.includes("status='queued'"),'migration must target normal queued continuation only')
assert.ok(block.includes("COALESCE(last_count,0) > 0"),'migration must preserve/resume an existing paginated run')
assert.ok(block.includes("next_allowed_at > NOW() + INTERVAL '2 minutes'"),'stale queued cooldown must be recognized without waiting hours')
assert.ok(!block.includes("ILIKE '%12 час%'"),'migration must not depend on legacy UI text that may be absent or nested')
assert.ok(block.includes("legacyFinanceCooldownPreviousNextAllowedAt"),'migration must record the replaced stale timestamp for diagnostics')
assert.ok(!block.includes("status='rate_limited'"),'real WB 429 state must not be rewritten by queued-continuation migration')

const initMarker="await recoverRetryableErrorStates()\n  // 5.10.3"
assert.ok(server.includes(initMarker),'legacy finance cooldown migration must run during backend startup')
assert.ok(server.includes("version: '2.22.3'"),'backend health must report 2.22.3')
assert.ok(server.includes('ELISEI/2.22.3'),'WB User-Agent must report backend 2.22.3')

console.log('WB 5.10.3 stale finance cooldown recovery regression test passed')
