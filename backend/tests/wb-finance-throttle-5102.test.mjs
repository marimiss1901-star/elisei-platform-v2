import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  financePageCooldownMs, documentsPageCooldownMs, financeProgressCopy, FINANCE_METHOD_LIMITS,
} from '../src/wb/finance-core.js'

assert.equal(FINANCE_METHOD_LIMITS.baseDetailIntervalMs,12*60*60*1000,'Base without service secret must respect WB 12h finance interval')
assert.ok(FINANCE_METHOD_LIMITS.fastDetailIntervalMs >= 60000 && FINANCE_METHOD_LIMITS.fastDetailIntervalMs <= 70000,
  'Service/Personal/Base+secret finance detail cooldown must be about one minute')
assert.equal(financePageCooldownMs({typeId:1}),12*60*60*1000,'plain Base finance pagination must not be forced through a real WB rate limit')
assert.ok(financePageCooldownMs({typeId:1,hasServiceSecret:true}) < 70000,'Base+secret must use the fast finance rate')
assert.ok(financePageCooldownMs({typeId:4}) < 70000,'Service finance pagination must use the fast finance rate')
assert.equal(documentsPageCooldownMs({typeId:1}),24*60*60*1000,'plain Base documents list must respect the 24h WB interval')
assert.ok(documentsPageCooldownMs({typeId:1,hasServiceSecret:true}) < 15000,'Base+secret documents list must use the fast rate')
assert.ok(financeProgressCopy({tokenInfo:{typeId:1}}).limitNote.includes('12 часов'),'Base progress must explain the real WB 12-hour interval')
assert.ok(financeProgressCopy({tokenInfo:{typeId:1},pageLimit:100000}).pageLimit===100000,'finance progress must expose the large page size')

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
for(const marker of [
  'Math.min(100000',
  'WB_FINANCE_PAGE_LIMIT || 100000',
  'financeRuntimeTokenInfo',
  "version: '2.23.6'",
  'ELISEI/2.23.6',
]) assert.ok(server.includes(marker),`server.js must contain ${marker}`)

const dashboard=fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx',import.meta.url),'utf8')
for(const marker of [
  'Ожидает окно WB · финансы',
  'официальный интервал WB',
  'второй пользовательский токен не требуется',
]) assert.ok(dashboard.includes(marker),`DashboardPage must contain ${marker}`)

console.log('WB 5.10.4 finance token-rate and large-page regression tests passed')
