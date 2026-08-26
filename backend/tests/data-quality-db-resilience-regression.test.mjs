import assert from 'node:assert/strict'
import fs from 'node:fs'

const server = fs.readFileSync(new URL('../src/server.js', import.meta.url),'utf8')
const routeStart = server.indexOf("app.get('/api/wb/data-quality/:id'")
assert.ok(routeStart >= 0,'data-quality route must exist')
const route = server.slice(routeStart,routeStart + 1800)
assert.match(route,/timeout exceeded when trying to connect/,'data-quality route must recognize PostgreSQL connect timeout')
assert.match(route,/if\(transientDb\) throw error/,'transient data-quality DB failures must reach the shared resilience layer')

const frontendPatch = fs.readFileSync(new URL('../../apply-data-quality-resilience.mjs', import.meta.url),'utf8')
assert.match(frontendPatch,/return cachedRead\(/,'data quality must use last-known-good read cache')
assert.match(frontendPatch,/quality:\\?\$\{connectionId\}/,'data-quality cache must be scoped by connection')
assert.match(frontendPatch,/DATABASE_RECONNECTING/,'transient DB reconnect must not surface as a raw toast')
assert.match(frontendPatch,/timeout exceeded when trying to connect/,'legacy raw pg timeout must be treated as transient during rollout')

console.log('Data Quality DB resilience regression passed')
