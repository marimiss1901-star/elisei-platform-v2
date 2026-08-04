import assert from 'node:assert/strict'
import fs from 'node:fs'

const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8')
const api = fs.readFileSync(new URL('../../src/lib/api.js', import.meta.url), 'utf8')
const dashboard = fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx', import.meta.url), 'utf8')
const workspace = fs.readFileSync(new URL('../../src/components/WbExtendedWorkspace.jsx', import.meta.url), 'utf8')
const styles = fs.readFileSync(new URL('../../src/styles/app.css', import.meta.url), 'utf8')

for (const marker of [
  'function boundedSyncPeriod',
  "if (stage==='stockHistory') return boundedSyncPeriod(range,90)",
  "if (stage==='advertising') return boundedSyncPeriod(range,31)",
  "if (stage==='searchQueries') return boundedSyncPeriod(range,365)",
  "allRequestedStages.filter(item => ['advertising','searchQueries','stockHistory'].includes(item))",
  'function extendedSqlFilter',
  'payload::text ILIKE',
  "app.get('/api/wb/extended/:stream'",
  "app.get('/api/wb/advertising/:id'",
  "app.get('/api/wb/finance-ledger/:id'",
  'selectedFrom = requestedRange?.from',
  'TO_TIMESTAMP((${raw})::numeric/1000)',
]) assert.ok(server.includes(marker), `server.js must contain ${marker}`)

for (const marker of [
  'financeLedger: (connectionId, params = {})',
  "for (const key of ['afterKey','from','to','query','status','rating','warehouse'])",
  'options?.period?.from && options?.period?.to',
]) assert.ok(api.includes(marker), `frontend api must contain ${marker}`)

for (const marker of [
  'renderSharedPeriodControls',
  "['Аналитика','Остатки','Финансы'].includes(active)",
  "active !== 'Реклама'",
  'period={analyticsPeriod}',
  'query={query} onQueryChange={setQuery}',
  "syncConnection(connection.connectionId,['advertising'],{ period:analyticsPeriod })",
  'wbApi.financeLedger(connectionId',
]) assert.ok(dashboard.includes(marker), `DashboardPage must contain ${marker}`)

assert.ok(!dashboard.includes('financeQuery'), 'finance must use the shared query')
assert.ok(!dashboard.includes('advertisingFilter'), 'advertising must use the shared query')

for (const marker of [
  'from:period?.from',
  'to:period?.to',
  'query,',
  'status:statusFilter',
  'await onSync(connection.connectionId,[stream],{period})',
  'coverageLimited',
]) assert.ok(workspace.includes(marker), `extended workspace must contain ${marker}`)

assert.ok(styles.includes('ELISEI 5.6.2 — единый период и фильтры всех рабочих разделов'))

const dateKeyStart = server.indexOf('function dateKey')
const dateKeyEnd = server.indexOf('function firstNumber', dateKeyStart)
assert.ok(dateKeyStart > 0 && dateKeyEnd > dateKeyStart)
const { dateKey } = new Function(`${server.slice(dateKeyStart,dateKeyEnd)}; return { dateKey }`)()
assert.equal(dateKey(1754236800),'2025-08-03','Unix seconds must be normalized')
assert.equal(dateKey(1754236800000),'2025-08-03','Unix milliseconds must be normalized')
assert.equal(dateKey('2026-08-03T10:00:00Z'),'2026-08-03')

console.log('WB global period and cross-section filter tests passed')
