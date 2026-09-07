import assert from 'node:assert/strict'
import fs from 'node:fs'

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
const pkg=fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')

assert.match(pkg,/apply-nightly-memory-guard\.mjs && node apply-finance-night-priority\.mjs/,
  'finance-first patch must run after the nightly memory guard')
assert.match(server,/const heavyDispatchRank=stage=>\(\{finance:0,acquiring:1,paidStorage:2,acceptance:3\}/,
  'heavy dispatch must explicitly prioritize finance and its direct dependants')
assert.match(server,/if\(heavyA && heavyB\)/,
  'finance-first ordering must affect only competing heavy stages')
assert.match(server,/return stagePriority\(a\?\.stage\)-stagePriority\(b\?\.stage\)/,
  'remaining heavy stages must retain Smart Scheduler priority order')
assert.match(server,/if \(memoryHeavy && memoryHeavyProcessed\) continue/,
  'global memory guard must remain active after finance-first ordering')

console.log('ELISEI 5.19.4 finance-first night priority regression: OK')
