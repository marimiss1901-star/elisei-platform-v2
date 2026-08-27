import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  ORDER_FEED_ENDPOINT,ORDER_FEED_PAGE_LIMIT,ORDER_FEED_PRIMARY_VERSION,buildOrderFeedRequest,unwrapOrderFeedResponse,normalizeOrderFeedOrder,
  orderFeedSalesRows,mergeOrderFeedOrders,mergeOrderFeedSales,orderFeedRateLimitSeconds,
} from '../src/wb/order-feed.js'
import { LIVE_SYNC_STAGES, defaultLiveSyncSettings, normalizeLiveSyncSettings } from '../src/wb/live-sync.js'
import { DAILY_READY_OPERATIONAL_RECOVERY_STAGES } from '../src/wb/daily-ready.js'
import { schedulerGroup } from '../src/wb/smart-scheduler.js'
import { WB_API_POLICY } from '../src/wb/api-policy.js'

// Keep the new Order Feed implementation verified in shadow mode. It must be
// ready for later comparison, but it is not allowed to control production until
// a real cabinet proves parity with the stable Statistics API readers.
const request=buildOrderFeedRequest({start:'2026-08-01T00:00:00Z',end:'2026-08-26T00:00:00Z',offset:0,limit:99999})
assert.equal(request.url,ORDER_FEED_ENDPOINT)
assert.equal(request.method,'POST')
const body=JSON.parse(request.body)
assert.equal(body.pagination.limit,ORDER_FEED_PAGE_LIMIT)
assert.equal(body.pagination.offset,0)
assert.equal(body.pagination.snapshotTime,undefined)
assert.throws(()=>buildOrderFeedRequest({start:'2026-07-01T00:00:00Z',end:'2026-08-26T00:00:00Z'}),/31/)
assert.equal(ORDER_FEED_PRIMARY_VERSION,3)

const raw={
  nmId:47254354,chrtId:91663228,srid:'7513432034713632943.1.0',
  createdAt:'2026-08-25T10:00:00+03:00',updatedAt:'2026-08-26T11:00:00+03:00',
  status:'buyout',warehouseName:'Склад WB',warehouseRegion:'',isMp:false,
  destinationCity:'Москва',destinationDistrict:'Центральный',sellerPrice:4328,isB2b:false,
}
const documentedResponse={data:{snapshotTime:'2026-08-26T12:00:00Z',currency:'RUB',orders:[raw]}}
const unwrapped=unwrapOrderFeedResponse(documentedResponse)
assert.equal(unwrapped.orders.length,1)
assert.equal(unwrapped.orders[0].srid,raw.srid)
assert.equal(unwrapped.snapshotTime,'2026-08-26T12:00:00Z')
assert.equal(unwrapped.currency,'RUB')
assert.deepEqual(unwrapOrderFeedResponse({data:{snapshotTime:'2026-08-26T12:00:00Z',currency:'RUB',orders:[]}}).orders,[])
assert.throws(()=>unwrapOrderFeedResponse({data:{snapshotTime:'2026-08-26T12:00:00Z'}}),/data\.orders/)

const order=normalizeOrderFeedOrder(raw,{snapshotTime:unwrapped.snapshotTime})
assert.equal(order.nmId,47254354)
assert.equal(order.fulfillmentMode,'FBO')
assert.equal(order.finishedPrice,4328)
assert.equal(order.orderFeedStatus,'buyout')
const fbs=normalizeOrderFeedOrder({...raw,isMp:true,status:'created',srid:'fbs-1'})
assert.equal(fbs.fulfillmentMode,'FBS')
const sale=orderFeedSalesRows([order])[0]
assert.equal(sale.isReturn,false)
const returned=orderFeedSalesRows([normalizeOrderFeedOrder({...raw,status:'return',srid:'ret-1'})])[0]
assert.equal(returned.isReturn,true)
assert.equal(orderFeedSalesRows([normalizeOrderFeedOrder({...raw,status:'cancel',srid:'cancel-1'})]).length,0)
const legacyOrder={srid:order.srid,date:'2026-08-25T00:00:00Z',source:'legacy'}
assert.equal(mergeOrderFeedOrders([legacyOrder],[order]).filter(row=>row.srid===order.srid).length,1)
const oldSale={srid:'changed-status',saleID:'S:changed-status',finishedPrice:1000,source:'legacy'}
const cancelled=normalizeOrderFeedOrder({...raw,srid:'changed-status',status:'cancel'})
assert.equal(mergeOrderFeedSales([oldSale],[],[cancelled]).some(row=>row.srid==='changed-status'),false)
assert.equal(orderFeedRateLimitSeconds({typeId:1,serviceSecretReady:false}),10800)
assert.equal(WB_API_POLICY.orderFeed.scope,'analytics')
assert.equal(WB_API_POLICY.orderFeed.maxPeriodDays,31)

// Production remains on the proven Statistics API path.
assert.equal(schedulerGroup('orders'),'statistics')
assert.equal(schedulerGroup('sales'),'statistics')
const defaults=defaultLiveSyncSettings()
assert.deepEqual(LIVE_SYNC_STAGES,['orders','sales','stocks','sellerStocks'])
assert.equal(defaults.intervals.orders,7200)
assert.equal(defaults.intervals.sales,7200)
assert.equal(normalizeLiveSyncSettings({intervals:{orders:1800,sales:1800}}).intervals.orders,7200)
assert.equal(normalizeLiveSyncSettings({intervals:{orders:1800,sales:1800}}).intervals.sales,7200)
assert.deepEqual(DAILY_READY_OPERATIONAL_RECOVERY_STAGES,['orders','sales'])

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
for(const marker of [
  "orders: { label: 'Заказы', scope: 'statistics' }",
  "sales: { label: 'Продажи', scope: 'statistics' }",
  "stage === 'orders' || stage === 'sales'",
  'loadStatisticsRows(stage, selected.token',
]) assert.ok(server.includes(marker),`production server must contain ${marker}`)
assert.ok(!server.includes('async function loadOrderFeedPrimary('),'Order Feed must not be injected into the production server')

const backendPackage=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'))
for(const script of ['prestart','predev','pretest']){
  assert.ok(!String(backendPackage.scripts?.[script]||'').includes('apply-order-feed-primary.mjs'),`${script} must not activate Order Feed in production`)
  assert.ok(!String(backendPackage.scripts?.[script]||'').includes('apply-order-feed-source-only.mjs'),`${script} must not activate single-source Order Feed scheduling`)
}
const frontendPackage=JSON.parse(fs.readFileSync(new URL('../../package.json',import.meta.url),'utf8'))
assert.ok(!String(frontendPackage.scripts?.prebuild||'').includes('apply-order-feed-ui.mjs'),'frontend must not present shadow Order Feed as production source')

const rollback=fs.readFileSync(new URL('../apply-legacy-orders-production-rollback.mjs',import.meta.url),'utf8')
assert.ok(rollback.includes("stage IN ('orders','sales')"))
assert.ok(rollback.includes("legacyOrdersRollbackVersion"))

console.log('WB Order Feed shadow contract + proven production Statistics API regression passed')
