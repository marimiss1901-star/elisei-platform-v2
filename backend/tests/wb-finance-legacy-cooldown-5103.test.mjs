import assert from 'node:assert/strict'
import fs from 'node:fs'

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
const start=server.indexOf('async function recoverLegacyFinanceCooldowns')
const end=server.indexOf('\n\nasync function recoverLegacyRuntimeRateWindows',start)
assert.ok(start>=0 && end>start,'finance compatibility helper must still exist')
const block=server.slice(start,end)

// Current finance period pagination is paced by financePageCooldownMs (~1 min).
// This compatibility hook must not rewrite a real finance rate limit in SQL.
assert.ok(block.includes('financePageCooldownMs'),'finance compatibility comment must point to current endpoint pacing')
assert.ok(block.includes('return []'),'legacy finance recovery stays a no-op')
assert.ok(!block.includes('UPDATE wb_sync_states'),'finance compatibility hook must never clear real WB rate limits')

console.log('WB finance cooldown compatibility regression passed')
