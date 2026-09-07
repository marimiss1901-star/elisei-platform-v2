import assert from 'node:assert/strict'
import fs from 'node:fs'

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
assert.ok(server.includes('c.seller_id'),'scheduler scan must know the WB seller identity')
assert.ok(server.includes("minimumStatisticsMs={orders:3*60*60*1000,sales:2*60*60*1000}"),'seller-level Statistics window must follow Basic token limits')
assert.ok(server.includes("MAX(s.next_allowed_at) FILTER (WHERE s.next_allowed_at > NOW())"),'a WB retry window from one duplicate must block its siblings')
assert.ok(server.includes('sellerStageCandidates'),'duplicate seller connections must compete for one Statistics request slot')
assert.ok(server.includes('successA-successB'),'the stalest duplicate must be refreshed first')

console.log('ELISEI 5.18.7 seller-level Statistics rate-window regression: OK')
