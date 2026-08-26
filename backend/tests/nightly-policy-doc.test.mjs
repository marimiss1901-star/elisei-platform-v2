import assert from 'node:assert/strict'
import fs from 'node:fs'

const live=fs.readFileSync(new URL('../src/wb/live-sync.js',import.meta.url),'utf8')
const patch=fs.readFileSync(new URL('../apply-nightly-load-policy.mjs',import.meta.url),'utf8')

for(const stage of ['orders','stocks','sellerStocks']) assert.ok(live.includes(`${stage}:`),`seller-day lane must include ${stage}`)
assert.ok(!/STAGE_DEFAULTS[\s\S]*?\bsales\s*:/.test(live),'sales must be derived from Order Feed rather than scheduled as a second seller-day request')
assert.ok(patch.includes("DAILY_READY_OPERATIONAL_RECOVERY_STAGES = Object.freeze(['orders'])"),'Daily Ready must repair orders/sales through the single Order Feed source')
for(const stage of ['products','advertising','reviews','questions','chats','financeReports','acquiringReports','jamSubscription']) {
  assert.ok(patch.includes(`${stage}: 24 * 60 * 60`),`nightly policy must include ${stage}`)
}

console.log('Nightly single-source Order Feed policy regression passed')
