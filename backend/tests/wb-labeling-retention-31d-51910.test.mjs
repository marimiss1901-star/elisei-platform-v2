import assert from 'node:assert/strict'
import fs from 'node:fs'

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'))
const migration=fs.readFileSync(new URL('../migrate-labeling-retention-31d-requeue.mjs',import.meta.url),'utf8')

assert.match(server,/labelingRetention:\{[\s\S]*periodDays:31/,
  'WB goods-labeling must remain configured for a 31-day maximum')
assert.match(server,/const requestedPeriod = definition\.periodDays \? \(state\?\.metadata\?\.period \|\| reportPeriod\(definition\.periodDays\)\) : null/,
  'legacy saved periods must be separated from the actual request period')
assert.match(server,/const earliestFrom=new Date\(endMs-\(maxDays-1\)\*86400000\)/,
  'retention request must clamp an oversized saved period before calling WB')
assert.doesNotMatch(server,/const period = definition\.periodDays \? \(state\?\.metadata\?\.period \|\| reportPeriod\(definition\.periodDays\)\) : null/,
  'legacy metadata period must never bypass the WB limit')

assert.ok(pkg.scripts.prestart.includes('apply-labeling-retention-31d.mjs'))
assert.ok(pkg.scripts.predev.includes('apply-labeling-retention-31d.mjs'))
assert.ok(pkg.scripts.pretest.includes('apply-labeling-retention-31d.mjs'))
assert.ok(pkg.scripts.prestart.includes('migrate-labeling-retention-31d-requeue.mjs'))
assert.match(migration,/stage='labelingRetention'/)
assert.match(migration,/less or equal 31 days/)
assert.match(migration,/SET status='queued'/)

console.log('ELISEI 5.19.10 labeling retention 31-day regression: OK')
