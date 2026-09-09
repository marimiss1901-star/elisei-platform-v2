import assert from 'node:assert/strict'
import fs from 'node:fs'

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'))
const migration=fs.readFileSync(new URL('../migrate-labeling-retention-31d-requeue.mjs',import.meta.url),'utf8')

assert.match(server,/labelingRetention:\{[\s\S]*periodDays:31/,
  'WB goods-labeling must remain configured for a 31-day maximum')
assert.match(server,/const requestedPeriod = definition\.periodDays \? \(state\?\.metadata\?\.period \|\| reportPeriod\(definition\.periodDays\)\) : null/,
  'legacy saved periods must be separated from the actual request period')
assert.match(server,/stage === 'labelingRetention'[\s\S]*safeFrom=new Date\(safeEndMs-29\*86400000\)/,
  'labeling retention must normalize legacy state to a hard 30-day request window')
assert.match(server,/params\.set\('dateFrom',safeFrom\)[\s\S]*params\.set\('dateTo',safeTo\)/,
  'actual goods-labeling query params must be overwritten at the request boundary')
assert.match(server,/labelingRequestWindowVersion:2/,
  'request metadata must identify the hardened labeling window')
assert.doesNotMatch(server,/const period = definition\.periodDays \? \(state\?\.metadata\?\.period \|\| reportPeriod\(definition\.periodDays\)\) : null/,
  'legacy metadata period must never bypass the WB limit')

assert.ok(pkg.scripts.prestart.includes('apply-labeling-retention-31d.mjs'))
assert.ok(pkg.scripts.predev.includes('apply-labeling-retention-31d.mjs'))
assert.ok(pkg.scripts.pretest.includes('apply-labeling-retention-31d.mjs'))
assert.ok(pkg.scripts.prestart.includes('migrate-labeling-retention-31d-requeue.mjs'))
assert.match(migration,/stage='labelingRetention'/)
assert.match(migration,/less or equal 31 days/)
assert.match(migration,/labelingRetention31dRecoveryVersion',2/)
assert.match(migration,/SET status='queued'/)

console.log('ELISEI 5.19.11 labeling retention request-boundary regression: OK')
