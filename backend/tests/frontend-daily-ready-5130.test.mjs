import assert from 'node:assert/strict'
import fs from 'node:fs'

const dashboard=fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx',import.meta.url),'utf8')
for (const marker of [
  "periodPresetValue('yesterday')",
  "['yesterday','Вчера']",
  'loadDailyReady',
  'Вчерашний день подтверждён',
  'уже подтверждённые цифры не исчезают во время фонового обновления',
  'ELISEI готовит кабинет до вашего входа',
  'Диагностический запуск',
  'result?.meta?.stale',
]) assert.ok(dashboard.includes(marker),`Dashboard Daily Ready marker missing: ${marker}`)

const api=fs.readFileSync(new URL('../../src/lib/api.js',import.meta.url),'utf8')
assert.ok(api.includes('/api/wb/daily-ready/'),'Frontend API must expose daily-ready endpoint')

const css=fs.readFileSync(new URL('../../src/styles/app.css',import.meta.url),'utf8')
assert.ok(css.includes('.daily-ready-banner'),'Daily Ready banner styles must exist')

const rootPackage=JSON.parse(fs.readFileSync(new URL('../../package.json',import.meta.url),'utf8'))
const backendPackage=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'))
assert.equal(rootPackage.version,'5.13.2')
assert.equal(backendPackage.version,'2.25.2')

console.log('ELISEI 5.13.2 frontend Daily Ready regression tests passed')
