import assert from 'node:assert/strict'
import fs from 'node:fs'

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
const dashboard=fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx',import.meta.url),'utf8')
const styles=fs.readFileSync(new URL('../../src/styles/app.css',import.meta.url),'utf8')
const api=fs.readFileSync(new URL('../../src/lib/api.js',import.meta.url),'utf8')

for (const marker of [
  "const ELISEI_CANONICAL_FRONTEND_PATCHES = '5.17.0'",
  "['Годовая аналитика', TrendingUp]",
  "['Закупки', Calculator]",
  'function monthlyAnalyticsRows',
  'const renderAnnualAnalytics',
  'const renderProcurement',
  'Склад WB подтверждённо пустой',
  'purchaseCost:recommended != null',
  "wbApi.sync(connectionId,['orders','sales'],{ period })",
]) assert.ok(dashboard.includes(marker),`DashboardPage must contain ${marker}`)

for (const marker of [
  'const cutoff = Date.now() - 370 * 86400000',
  'state?.metadata?.period?.dateFrom',
  "['orders','sales','advertising','searchQueries','stockHistory','finance','acquiring','documents']",
  'const confirmedEmptyStock',
  'Number(stockMeta?.totalQuantity || 0) === 0',
]) assert.ok(server.includes(marker),`server.js must contain ${marker}`)

assert.ok(api.includes('dashboard: (connectionId, params = {})'),'dashboard reader must accept the selected period')
assert.ok(styles.includes('ELISEI 5.17.0 — годовая аналитика и план закупок'),'annual and procurement styles must be canonical')

console.log('ELISEI 5.17.0 annual analytics and procurement regression: OK')
