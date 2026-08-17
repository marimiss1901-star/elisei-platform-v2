import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  financePageCooldownMs, financeProgressCopy, FINANCE_METHOD_LIMITS,
} from '../src/wb/finance-core.js'

assert.ok(FINANCE_METHOD_LIMITS.baseDetailIntervalMs >= 20000 && FINANCE_METHOD_LIMITS.baseDetailIntervalMs <= 30000,
  'base finance detail cooldown must follow current ~20s WB limit, not the obsolete 12h schedule')
assert.ok(FINANCE_METHOD_LIMITS.privilegedIntervalMs >= 20000 && FINANCE_METHOD_LIMITS.privilegedIntervalMs <= 30000,
  'privileged finance detail cooldown must use the same safe current interval')
assert.ok(financePageCooldownMs({typeId:1}) < 60000,'base finance pagination must continue within a minute')
assert.ok(financePageCooldownMs({typeId:4}) < 60000,'service finance pagination must continue within a minute')
assert.ok(!financeProgressCopy({tokenInfo:{typeId:1}}).limitNote.includes('12 часов'),'UI metadata must not advertise the obsolete 12-hour finance cooldown')
assert.ok(financeProgressCopy({tokenInfo:{typeId:1}}).limitNote.includes('20 секунд'),'finance progress must describe the current safe interval')

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
for(const marker of [
  'async function recoverLegacyFinanceCooldowns',
  "legacyFinanceCooldownRecovered",
  "await recoverLegacyFinanceCooldowns({ connectionId:connection.id })",
  "await recoverLegacyFinanceCooldowns()",
  "version: '2.22.3'",
  'ELISEI/2.22.3',
]) assert.ok(server.includes(marker),`server.js must contain ${marker}`)

const dashboard=fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx',import.meta.url),'utf8')
for(const marker of [
  "const financePartial = Boolean",
  "value:available ?",
  "Догружается…",
  "выбранный период ещё покрывается",
  "Лимит метода WB",
  "Остальные этапы продолжаются независимо",
]) assert.ok(dashboard.includes(marker),`DashboardPage must contain ${marker}`)

console.log('WB 5.10.2 finance throttle and partial-data truthfulness tests passed')
