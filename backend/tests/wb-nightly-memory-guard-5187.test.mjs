import assert from 'node:assert/strict'
import fs from 'node:fs'

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'))

assert.ok(server.includes("const financeRepairWindow=['overnight','preopen'].includes(slot)"),'finance freshness repair must run only in the business-night window')
assert.ok(server.includes('const financeSpreadSeconds=2*60+(cabinetHash%(45*60))'),'finance repair must be spread across cabinets instead of stampeding at the same minute')
assert.ok(server.includes('const heavyBusy=repairedHeavyStages.size>0 || states.some'),'nightly scheduler must detect an existing heavy continuation per cabinet')
assert.ok(server.includes('.slice(0,1)'),'nightly scheduler must queue at most one new heavy stage per cabinet pass')
assert.ok(server.includes('let memoryHeavyProcessed=false'),'deferred worker must have a global per-cycle heavy-stage guard')
assert.ok(server.includes('if (memoryHeavy && memoryHeavyProcessed) continue'),'deferred worker must skip a second heavy stage in the same worker cycle')
assert.ok(server.includes('if (memoryHeavy) memoryHeavyProcessed=true'),'deferred worker must mark the heavy slot before executing it')
assert.ok(server.includes('const cacheTimer=setTimeout(()=>{'),'canonical hydration cache must have active expiry')
assert.ok(server.includes('canonicalConnectionDataRecent.delete(key)'),'expired canonical hydration cache entries must be released')
assert.ok(pkg.scripts.prestart.includes('apply-nightly-memory-guard.mjs'),'production prestart must apply the nightly memory guard')
assert.ok(pkg.scripts.pretest.includes('apply-nightly-memory-guard.mjs'),'tests must exercise the patched production server')

console.log('ELISEI 5.18.7 nightly memory guard regression: OK')
