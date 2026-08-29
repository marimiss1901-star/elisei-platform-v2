import assert from 'node:assert/strict'
import fs from 'node:fs'

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')

const workerStart=server.indexOf("function kickBackgroundWorkers(reason = 'timer')")
const workerEnd=server.indexOf('\n}\n',workerStart)
const workerSource=server.slice(workerStart,workerEnd+3)
assert.match(workerSource,/if \(!pool \|\| !databaseState\.ready\) return Promise\.resolve\(false\)/,
  'browser heartbeats must not start WB workers while PostgreSQL initializes')

const initStart=server.indexOf('async function initDatabase()')
const initEnd=server.indexOf('\n}\n\nlet financeLedgerBackfillTimer',initStart)
const initSource=server.slice(initStart,initEnd+3)
assert.doesNotMatch(initSource,/backfillFinanceLedgerFromStreamItems/,
  'finance ledger rebuild must not block login readiness')
assert.match(server,/scheduleFinanceLedgerBackfill\(30000\)/,
  'finance ledger repair must continue after the API becomes ready')
assert.match(server,/databaseUnavailable[\s\S]*DATABASE_RECONNECTING/,
  'login must translate a transient database restart into a retryable response')

console.log('ELISEI 5.16.1 startup database availability regression: OK')
