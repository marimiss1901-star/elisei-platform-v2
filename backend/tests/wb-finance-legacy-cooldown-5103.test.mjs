import assert from 'node:assert/strict'
import fs from 'node:fs'

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
const start=server.indexOf('async function recoverLegacyFinanceCooldowns')
const end=server.indexOf('\n\nconst backgroundWorkerState',start)
assert.ok(start>=0 && end>start,'compatibility helper must still exist')
const block=server.slice(start,end)

assert.ok(block.includes('12 часов'),'5.10.4 must document that a long Base finance cooldown can be valid')
assert.ok(block.includes('return []'),'legacy recovery must be disabled instead of rewriting valid WB cooldowns')
assert.ok(!block.includes('UPDATE wb_sync_states'),'5.10.4 must never clear finance rate limits by SQL migration')
assert.ok(server.includes("version: '2.23.4'"),'backend health must report 2.22.4')
assert.ok(server.includes('ELISEI/2.23.4'),'WB User-Agent must report backend 2.22.4')

console.log('WB 5.10.4 finance cooldown preservation regression test passed')
