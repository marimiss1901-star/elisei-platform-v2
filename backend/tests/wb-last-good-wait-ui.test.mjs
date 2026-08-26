import assert from 'node:assert/strict'
import fs from 'node:fs'

const repoRoot=new URL('../../',import.meta.url)
const patch=fs.readFileSync(new URL('../../apply-last-good-sync-status.mjs',import.meta.url),'utf8')
const pkg=fs.readFileSync(new URL('../../package.json',import.meta.url),'utf8')

for(const marker of [
  "['orders','sales','stocks','sellerStocks']",
  "['queued','rate_limited','retry_scheduled']",
  "state.lastSuccessAt",
  "Последние данные:",
  "Следующее обновление",
]) assert.ok(patch.includes(marker),`last-good UI patch must contain ${marker}`)

assert.ok(pkg.includes('apply-last-good-sync-status.mjs'),'frontend prebuild must apply last-good sync status patch')
assert.ok(!patch.includes("['finance','advertising','reviews','questions','chats']"),'background/non-operational streams must not be presented as fresh operational data')

console.log('WB last-known-good wait-state UI regression passed')
