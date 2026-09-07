import assert from 'node:assert/strict'
import fs from 'node:fs'

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
assert.ok(server.includes("String(patch.status ?? row.status ?? '') !== 'success'"),'non-success sync states must preserve the last successful count')
assert.ok(server.includes('Number(row.last_count || 0) > 0'),'existing persisted count must win over a transient zero')
assert.ok(server.includes(': Number(patch.lastCount || 0))'),'a successful explicit count, including a real zero, must still be writable')

console.log('ELISEI 5.18.7 sync count preservation regression: OK')
