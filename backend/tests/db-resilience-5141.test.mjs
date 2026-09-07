import assert from 'node:assert/strict'
import fs from 'node:fs'

const preload = fs.readFileSync(new URL('../src/db-resilience-preload.mjs', import.meta.url), 'utf8')
const backendPackage = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const frontendPackage = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))

assert.equal(frontendPackage.version, '5.15.9')
const backendVersion = backendPackage.version.split('.').map(Number)
assert.ok(backendVersion[0] > 2 || (backendVersion[0] === 2 && backendVersion[1] >= 27), 'DB resilience regression must remain enabled on backend 2.27+')
assert.match(backendPackage.scripts.start, /db-resilience-preload\.mjs/)
assert.match(preload, /Express 4 does not automatically forward rejected async route promises/)
assert.match(preload, /DATABASE_RECONNECTING/)
assert.match(preload, /Retry-After/)
assert.match(preload, /connection terminated unexpectedly/i)
assert.match(preload, /database system is in recovery mode/i)
assert.match(preload, /result\.catch\(error => handleRejectedRoute/)
assert.match(preload, /return next\(error\)/)

console.log('ELISEI 5.15.9 DB reconnect resilience regression: OK')
