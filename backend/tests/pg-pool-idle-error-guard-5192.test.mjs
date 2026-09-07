import assert from 'node:assert/strict'
import fs from 'node:fs'
import pg from 'pg'

await import('../src/pg-pool-error-guard-preload.mjs')

const pool = new pg.Pool({
  connectionString:'postgresql://unused:unused@127.0.0.1:1/unused',
  max:1,
})
assert.ok(pool.listenerCount('error') >= 1,'every pg.Pool created after the preload must have an idle-client error listener')
assert.doesNotThrow(() => pool.emit('error',new Error('synthetic idle client disconnect')),
  'an idle pg client error must not terminate the Node process')
await pool.end()

const backendPackage=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'))
const start=String(backendPackage.scripts?.start || '')
const dev=String(backendPackage.scripts?.dev || '')
for (const command of [start,dev]) {
  assert.ok(command.includes('pg-pool-error-guard-preload.mjs'))
  assert.ok(command.indexOf('pg-pool-error-guard-preload.mjs') < command.indexOf('callcheck-auth-preload.mjs'),
    'pool error guard must load before callcheck creates its Pool')
  assert.ok(command.indexOf('pg-pool-error-guard-preload.mjs') < command.indexOf('bootstrap-business-preload.mjs'),
    'pool error guard must load before bootstrap creates its Pool')
}

console.log('ELISEI PostgreSQL preload pool idle-error guard regression passed')
