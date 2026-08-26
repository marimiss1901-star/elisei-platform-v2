import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  ORDER_FEED_ENDPOINT,ORDER_FEED_PAGE_LIMIT,buildOrderFeedRequest,normalizeOrderFeedOrder,
  orderFeedSalesRows,mergeOrderFeedOrders,mergeOrderFeedSales,orderFeedRateLimitSeconds,
} from '../src/wb/order-feed.js'
import { LIVE_SYNC_STAGES, defaultLiveSyncSettings, normalizeLiveSyncSettings } from '../src/wb/live-sync.js'
import { DAILY_READY_OPERATIONAL_RECOVERY_STAGES } from '../src/wb/daily-ready.js'
import { schedulerGroup } from '../src/wb/smart-scheduler.js'
import { WB_API_POLICY } from '../src/wb/api-policy.js'

const request=buildOrderFeedRequest({start:'2026-08-01T00:00:00Z',end:'2026-08-26T00:00:00Z',offset:0,limit:99999})
assert.equal(request.url,ORDER_FEED_ENDPOINT)
assert.equal(request.method,'POST')
const body=JSON.parse(request.body)
assert.equal(body.pagination.limit,ORDER_FEED_PAGE_LIMIT)
assert.equal(body.pagination.offset,0)
assert.equal(body.pagination.snapshotTime,undefined)
assert.throws(()=>buildOrderFeedRequest({start:'2026-07-01T00:00:00Z',end:'2026-08-26T00:00:00Z'}),/31/)

const raw={
  nmId:47254354,chrtId:91663228,srid:'7513432034713632943.1.0',
  createdAt:'2026-08-25T10:00:00+03:00',updatedAt:'2026-08-26T11:00:00+03:00',
  status:'buyout',warehouseName:'Склад WB',warehouseRegion:'',isMp:false,
  destinationCity:'Москва',destinationDistrict:'Центральный',sellerPrice:4328,isB2b:false,
}
const order=normalizeOrderFeedOrder(raw,{snapshotTime:'2026-08-26T12:00:00Z'})
assert.equal(order.nmId,47254354)
assert.equal(order.fulfillmentMode,'FBO')
assert.equal(order.finishedPrice,4328)
assert.equal(order.orderFeedStatus,'buyout')
assert.equal(order.source,'order_feed')
const fbs=normalizeOrderFeedOrder({...raw,isMp:true,status:'created',srid:'fbs-1'})
assert.equal(fbs.fulfillmentMode,'FBS')

const sale=orderFeedSalesRows([order])[0]
assert.equal(sale.isReturn,false)
assert.equal(sale.saleID,`S:${order.srid}`)
const returned=orderFeedSalesRows([normalizeOrderFeedOrder({...raw,status:'return',srid:'ret-1'})])[0]
assert.equal(returned.isReturn,true)
assert.match(returned.saleID,/^R:/)
assert.equal(orderFeedSalesRows([normalizeOrderFeedOrder({...raw,status:'cancel',srid:'cancel-1'})]).length,0)

const legacyOrder={srid:order.srid,date:'2026-08-25T00:00:00Z',source:'legacy'}
assert.equal(mergeOrderFeedOrders([legacyOrder],[order]).filter(row=>row.srid===order.srid).length,1)
const oldSale={srid:'changed-status',saleID:'S:changed-status',finishedPrice:1000,source:'legacy'}
const cancelled=normalizeOrderFeedOrder({...raw,srid:'changed-status',status:'cancel'})
assert.equal(mergeOrderFeedSales([oldSale],[],[cancelled]).some(row=>row.srid==='changed-status'),false,'current cancel must remove stale legacy buyout')

assert.equal(orderFeedRateLimitSeconds({typeId:1,serviceSecretReady:false}),10800)
assert.equal(orderFeedRateLimitSeconds({typeId:1,serviceSecretReady:true}),60)
assert.equal(WB_API_POLICY.orderFeed.scope,'analytics')
assert.equal(WB_API_POLICY.orderFeed.maxPeriodDays,31)
assert.equal(schedulerGroup('orders'),'orderFeed')
assert.equal(schedulerGroup('sales'),'orderFeed')

const defaults=defaultLiveSyncSettings()
assert.deepEqual(LIVE_SYNC_STAGES,['orders','stocks','sellerStocks'])
assert.equal(defaults.intervals.orders,10800)
assert.equal(defaults.intervals.sales,undefined,'sales is derived from orders and must not poll WB independently')
assert.equal(defaults.intervals.stocks,7200)
assert.equal(normalizeLiveSyncSettings({intervals:{orders:7200,sales:1800}}).intervals.orders,10800)
assert.equal(normalizeLiveSyncSettings({intervals:{orders:7200,sales:1800}}).intervals.sales,undefined)
assert.deepEqual(DAILY_READY_OPERATIONAL_RECOVERY_STAGES,['orders','advertising'],'Daily Ready repairs sales through the orders Order Feed source')

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
for(const marker of [
  "orders: { label: 'Заказы', scope: 'analytics' }",
  "sales: { label: 'Продажи', scope: 'analytics' }",
  'async function loadOrderFeedPrimary(',
  'buildOrderFeedRequest({start,end,offset,limit:ORDER_FEED_PAGE_LIMIT,snapshotTime})',
  "stage === 'orders'",
  "stage === 'sales'",
  "stream:'sales',payload:siblingSalesValue",
  'recoverLegacyOrderFeedState({ connectionId:connection.id })',
  'await recoverLegacyOrderFeedState()',
  'orderFeedPrimaryVersion:ORDER_FEED_PRIMARY_VERSION',
]) assert.ok(server.includes(marker),`server must contain ${marker}`)
assert.ok(!server.includes("} else if (stage === 'orders' || stage === 'sales') {\n      const loaded = await loadStatisticsRows"),'orders/sales runner must no longer call legacy supplier statistics directly')

const dashboard=fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx',import.meta.url),'utf8')
assert.ok(dashboard.includes('единой Ленты заказов WB примерно раз в 3 часа'))
assert.ok(dashboard.includes('единый Order Feed'))

console.log('WB Order Feed primary + single-source scheduling regression passed')
