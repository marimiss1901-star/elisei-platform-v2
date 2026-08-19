import assert from 'node:assert/strict'
import fs from 'node:fs'

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
const dashboard=fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx',import.meta.url),'utf8')

for (const marker of [
  "row?.metadata?.trigger === 'daily_ready_recovery'",
  "const recoveryOrder = new Map([['orders',0],['sales',1],['advertising',2]])",
  "NOW() + INTERVAL '70 seconds'",
  "smartSchedulerWinners.set(connectionId,String(winner.stage))",
  "version: '2.25.3'",
  'ELISEI/2.25.3',
]) assert.ok(server.includes(marker),`server must contain ${marker}`)

assert.ok(dashboard.includes('Готов к автоповтору'))
assert.ok(dashboard.includes('Запрос к WB ещё не выполняется'))
console.log('wb-daily-ready-5133: sequential recovery lane ok')
