import assert from 'node:assert/strict'
import fs from 'node:fs'

const live=fs.readFileSync(new URL('../src/wb/live-sync.js',import.meta.url),'utf8')
const patch=fs.readFileSync(new URL('../apply-nightly-load-policy.mjs',import.meta.url),'utf8')
const rollback=fs.readFileSync(new URL('../apply-legacy-orders-production-rollback.mjs',import.meta.url),'utf8')

for(const stage of ['orders','sales','stocks','sellerStocks']) assert.ok(live.includes(`${stage}:`),`seller-day lane must include ${stage}`)
assert.ok(live.includes('orders: 7200')&&live.includes('sales: 7200'),'orders and sales must use the calm two-hour production cadence')
assert.ok(patch.includes("DAILY_READY_OPERATIONAL_RECOVERY_STAGES = Object.freeze(['orders','sales'])"),'Daily Ready must repair proven orders and sales independently')
for(const stage of ['products','advertising','reviews','questions','chats','financeReports','acquiringReports','jamSubscription']) {
  assert.ok(patch.includes(`${stage}: 24 * 60 * 60`),`nightly policy must include ${stage}`)
}
assert.ok(rollback.includes("stage IN ('orders','sales')"),'rollback must requeue both production statistics streams')
assert.ok(rollback.includes("- 'orderFeedPrimaryVersion'"),'rollback must clear stale Order Feed production metadata')

console.log('Nightly proven orders/sales production policy regression passed')
