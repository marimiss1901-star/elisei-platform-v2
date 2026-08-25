import assert from 'node:assert/strict'
import fs from 'node:fs'

const live=fs.readFileSync(new URL('../src/wb/live-sync.js',import.meta.url),'utf8')
const patch=fs.readFileSync(new URL('../apply-nightly-load-policy.mjs',import.meta.url),'utf8')

for(const stage of ['orders','sales','stocks','sellerStocks']) assert.ok(live.includes(`${stage}:`),`seller-day lane must include ${stage}`)
for(const stage of ['products','advertising','reviews','questions','chats','financeReports','acquiringReports','jamSubscription']) {
  assert.ok(patch.includes(`${stage}: 24 * 60 * 60`),`nightly policy must include ${stage}`)
}

console.log('Nightly policy declaration regression passed')
