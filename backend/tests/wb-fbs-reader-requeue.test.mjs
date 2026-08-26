import assert from 'node:assert/strict'
import fs from 'node:fs'

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')

for(const marker of [
  'async function recoverLegacyFbsMarketplaceReaderError()',
  "WHERE stage='sellerStocks'",
  "ILIKE '%token does not satisfy additional requirements%'",
  "TIMESTAMPTZ '2026-08-26T07:54:09Z'",
  'fbsMarketplaceReaderMigration',
  'await recoverLegacyFbsMarketplaceReaderError()',
  "sellerStocks: { label: 'Остатки FBS', scope: 'marketplace' }",
  "https://marketplace-api.wildberries.ru/api/v3/stocks/${warehouseId}",
]) assert.ok(server.includes(marker),`server must contain ${marker}`)

assert.ok(!server.includes("sellerStocks: { label: 'Остатки FBS', scope: 'analytics' }"))
console.log('Legacy FBS reader error one-time requeue regression passed')
