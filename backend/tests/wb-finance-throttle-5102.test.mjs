import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  financePageCooldownMs, documentsPageCooldownMs, financeProgressCopy, FINANCE_METHOD_LIMITS,
} from '../src/wb/finance-core.js'

assert.ok(FINANCE_METHOD_LIMITS.baseDetailIntervalMs >= 60000 && FINANCE_METHOD_LIMITS.baseDetailIntervalMs <= 70000,
  'Current WB period finance endpoint must use about one minute between pages')
assert.ok(FINANCE_METHOD_LIMITS.fastDetailIntervalMs >= 60000 && FINANCE_METHOD_LIMITS.fastDetailIntervalMs <= 70000,
  'Finance detail cooldown must be about one minute')
assert.ok(financePageCooldownMs({typeId:1}) < 70000,'single Base token must not inherit the obsolete 12-hour period-detail cooldown')
assert.ok(financePageCooldownMs({typeId:1,hasServiceSecret:true}) < 70000,'Base+secret uses the same current period-detail window')
assert.ok(financePageCooldownMs({typeId:4}) < 70000,'Service finance pagination must use the one-minute window')
assert.equal(documentsPageCooldownMs({typeId:1}),24*60*60*1000,'documents remain a separate token-dependent endpoint')
assert.ok(documentsPageCooldownMs({typeId:1,hasServiceSecret:true}) < 15000,'Base+secret documents list must use the fast rate')
assert.ok(financeProgressCopy({tokenInfo:{typeId:1}}).limitNote.includes('через минуту'),'finance progress must explain the current one-minute period-detail interval')
assert.ok(financeProgressCopy({tokenInfo:{typeId:1}}).limitNote.includes('Второй пользовательский токен не требуется'),'one-token flow must be explicit')
assert.ok(financeProgressCopy({tokenInfo:{typeId:1},pageLimit:100000}).pageLimit===100000,'finance progress must expose the large page size')

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
for(const marker of [
  'Math.min(100000',
  'WB_FINANCE_PAGE_LIMIT || 100000',
  'financeRuntimeTokenInfo',
]) assert.ok(server.includes(marker),`server.js must contain ${marker}`)

console.log('WB 5.15.0 current finance period-limit regression tests passed')
