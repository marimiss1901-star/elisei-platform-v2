import assert from 'node:assert/strict'
import fs from 'node:fs'
import pg from 'pg'

await import('../src/pg-pool-resilience-preload.mjs')

const pool=new pg.Pool({connectionString:'postgresql://invalid:invalid@127.0.0.1:1/invalid'})
try {
  assert.ok(pool.listenerCount('error')>=1,'every Pool created after preload must have an error listener')
} finally {
  await pool.end()
}

const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'))
for(const scriptName of ['start','dev']) {
  const script=String(pkg.scripts?.[scriptName] || '')
  const resilience=script.indexOf('pg-pool-resilience-preload.mjs')
  const callcheck=script.indexOf('callcheck-auth-preload.mjs')
  const bootstrap=script.indexOf('bootstrap-business-preload.mjs')
  assert.ok(resilience>=0,`${scriptName} must load global pool resilience`)
  assert.ok(resilience<callcheck && resilience<bootstrap,`${scriptName} must load pool resilience before auxiliary pools`)
}

console.log('ELISEI 5.18.7 PostgreSQL auxiliary-pool resilience regression: OK')
