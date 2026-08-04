import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  WB_API_POLICY, assertWbApiRequestAllowed, buildOrderMetaDetailsRequest,
  orderMetaDetailsEndpoint, sellerWarehouseReadSummary,
} from '../src/wb/api-policy.js'

assert.equal(orderMetaDetailsEndpoint('dbs'),'https://marketplace-api.wildberries.ru/api/marketplace/v3/dbs/orders/meta/details')
assert.equal(orderMetaDetailsEndpoint('DBW'),'https://marketplace-api.wildberries.ru/api/marketplace/v3/dbw/orders/meta/details')
assert.equal(orderMetaDetailsEndpoint('click-collect'),'https://marketplace-api.wildberries.ru/api/marketplace/v3/click-collect/orders/meta/details')
const metaRequest=buildOrderMetaDetailsRequest('dbs',[10,10,20])
assert.equal(metaRequest.method,'POST')
assert.deepEqual(JSON.parse(metaRequest.body),{orders:[10,20]})

assert.throws(
  ()=>assertWbApiRequestAllowed('https://marketplace-api.wildberries.ru/api/marketplace/v3/dbs/orders/meta/info',{method:'POST'}),
  error=>error?.code==='WB_DEPRECATED_META_ENDPOINT' && error?.status===410,
)
assert.throws(
  ()=>assertWbApiRequestAllowed('https://marketplace-api.wildberries.ru/api/v3/dbw/orders/123/meta',{method:'GET'}),
  error=>error?.code==='WB_DEPRECATED_META_ENDPOINT' && error?.status===410,
)
assert.throws(
  ()=>assertWbApiRequestAllowed('https://marketplace-api.wildberries.ru/api/marketplace/v3/click-collect/orders/meta/info',{method:'POST'}),
  error=>error?.code==='WB_DEPRECATED_META_ENDPOINT' && error?.status===410,
)
assert.equal(assertWbApiRequestAllowed(orderMetaDetailsEndpoint('dbs'),{method:'POST',body:'{"orders":[1]}'},new Date('2026-08-06T00:00:00Z')),true)

assert.throws(
  ()=>assertWbApiRequestAllowed('https://marketplace-api.wildberries.ru/api/v3/warehouses',{method:'POST',body:JSON.stringify({cargoType:2})},new Date('2026-08-05T00:00:00Z')),
  error=>error?.code==='WB_SGT_WAREHOUSE_API_DISABLED' && error?.status===410,
)
assert.throws(
  ()=>assertWbApiRequestAllowed('https://marketplace-api.wildberries.ru/api/v3/warehouses',{method:'POST',body:JSON.stringify({cargoType:2})},new Date('2026-08-04T00:00:00Z')),
  error=>error?.code==='WB_SGT_WAREHOUSE_API_DISABLED',
)
assert.throws(
  ()=>assertWbApiRequestAllowed('https://marketplace-api.wildberries.ru/api/v3/warehouses/7',{method:'PUT',body:JSON.stringify({name:'Склад'})},new Date('2026-08-06T00:00:00Z')),
  error=>error?.code==='WB_WAREHOUSE_CARGO_TYPE_REQUIRED',
)
assert.equal(
  assertWbApiRequestAllowed('https://marketplace-api.wildberries.ru/api/v3/warehouses',{method:'POST',body:JSON.stringify({cargoType:1})},new Date('2026-08-06T00:00:00Z')),
  true,
)
assert.equal(
  assertWbApiRequestAllowed('https://marketplace-api.wildberries.ru/api/v3/warehouses',{method:'GET'},new Date('2026-08-06T00:00:00Z')),
  true,
)

const summary=sellerWarehouseReadSummary([{id:1,cargoType:1},{id:2,cargoType:2},{id:3,cargoType:2}])
assert.equal(summary.totalWarehouses,3)
assert.equal(summary.sgtWarehouses,2)
assert.deepEqual(summary.sgtWarehouseIds,[2,3])
assert.equal(summary.sgtManagement,'seller-cabinet-only')
assert.equal(WB_API_POLICY.sellerWarehouses.apiWriteCutoff,'2026-08-05T00:00:00+03:00')

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
assert.ok(server.includes('assertWbApiRequestAllowed(url, options)'))
assert.ok(server.includes('sellerWarehouseReadSummary(sellerWarehouses)'))
assert.ok(server.includes("warehouseManagement:Number(warehouse?.cargoType) === WB_API_POLICY.sellerWarehouses.sgtCargoType ? 'seller-cabinet-only' : 'api-supported'"))
assert.ok(!server.includes('/api/marketplace/v3/dbs/orders/meta/info'))
assert.ok(!/\/api\/v3\/dbw\/orders\/\$\{[^}]+\}\/meta/.test(server))
assert.ok(!server.includes("method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ cargoType:2"))

console.log('WB API migration and SGT warehouse policy tests passed')
