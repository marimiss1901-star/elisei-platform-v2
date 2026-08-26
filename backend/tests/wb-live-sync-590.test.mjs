import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  LIVE_SYNC_STAGES,defaultLiveSyncSettings,normalizeLiveSyncSettings,dueLiveStages,eventStages,safeEqualSecret,
  effectiveLiveIntervalSeconds,liveCadenceWindow,
} from '../src/wb/live-sync.js'

const defaults=defaultLiveSyncSettings()
assert.equal(defaults.enabled,true)
assert.deepEqual(LIVE_SYNC_STAGES,['orders','sales','stocks','sellerStocks'])
assert.equal(defaults.intervals.orders,10800)
assert.equal(defaults.intervals.sales,10800)
assert.equal(defaults.intervals.stocks,7200)
assert.equal(defaults.intervals.sellerStocks,7200)
assert.equal(defaults.intervals.advertising,undefined,'advertising belongs to nightly ready, not seller-day polling')
assert.equal(defaults.intervals.reviews,undefined,'reviews belong to nightly ready')
assert.equal(defaults.intervals.questions,undefined,'questions belong to nightly ready')
assert.equal(defaults.intervals.chats,undefined,'chats belong to nightly ready')
assert.equal(defaults.intervals.products,undefined,'products belong to nightly ready')

// Existing cabinets migrate from old 30/60/120-minute settings. Order Feed uses
// the universally safe 3-hour window, while current stocks stay at two hours.
const normalized=normalizeLiveSyncSettings({enabled:true,intervals:{orders:7200,sales:1800,stocks:3600,sellerStocks:1800,chats:10}})
assert.equal(normalized.enabled,true)
assert.equal(normalized.intervals.orders,10800)
assert.equal(normalized.intervals.sales,10800)
assert.equal(normalized.intervals.stocks,7200)
assert.equal(normalized.intervals.sellerStocks,7200)
assert.equal(normalized.intervals.chats,undefined,'legacy chat cadence must not re-enable daytime polling')

const active=Date.parse('2026-08-04T12:00:00Z') // 15:00 Moscow
const overnight=Date.parse('2026-08-04T01:00:00Z') // 04:00 Moscow
assert.equal(liveCadenceWindow(active,'Europe/Moscow'),'active')
assert.equal(liveCadenceWindow(overnight,'Europe/Moscow'),'overnight')
assert.equal(effectiveLiveIntervalSeconds('orders',{settings:{},now:active}),10800)
assert.equal(effectiveLiveIntervalSeconds('orders',{settings:{},now:overnight}),21600)
assert.equal(effectiveLiveIntervalSeconds('stocks',{settings:{intervals:{stocks:3600}},now:active}),7200,'old one-hour stock cadence must migrate to two hours')

const due=dueLiveStages({settings:{enabled:true},states:[
  {stage:'orders',status:'success',last_success_at:'2026-08-04T08:20:00Z'},
  {stage:'sales',status:'success',last_success_at:'2026-08-04T11:45:00Z'},
  {stage:'stocks',status:'rate_limited',next_allowed_at:'2026-08-04T13:00:00Z'},
  {stage:'advertising',status:'success',last_success_at:'2026-08-01T11:00:00Z'},
  {stage:'reviews',status:'success',last_success_at:'2026-08-01T11:00:00Z'},
],now:active,timeZone:'Europe/Moscow'})
assert.ok(due.includes('orders'))
assert.ok(!due.includes('sales'))
assert.ok(!due.includes('stocks'))
assert.ok(!due.includes('advertising'),'advertising must never enter recurring seller-day polling')
assert.ok(!due.includes('reviews'),'reviews must never enter recurring seller-day polling')

const fair=dueLiveStages({settings:{enabled:true},states:[
  {stage:'orders',status:'success',last_success_at:'2026-08-04T07:00:00Z'},
  {stage:'sales',status:'success',last_success_at:'2026-08-04T08:00:00Z'},
  {stage:'sellerStocks',status:'success',last_success_at:'2026-08-04T07:00:00Z'},
  {stage:'stocks',status:'success',last_success_at:'2026-08-04T11:30:00Z'},
],now:active,timeZone:'Europe/Moscow'})
assert.equal(fair[0],'sellerStocks','most overdue operational stream must not be starved by fixed stage order')

assert.deepEqual(eventStages({type:'card_changed'}),['products'])
assert.deepEqual(eventStages({type:'feedback_updated',payload:{entityType:'question'}}),['questions'])
assert.deepEqual(eventStages({type:'feedback_updated',payload:{}}),['reviews'])
assert.deepEqual(eventStages({type:'report_generation_complete',payload:{reportType:'STOCK_HISTORY_DAILY_CSV'}}),['stockHistory'])
assert.deepEqual(eventStages({type:'report_generation_complete',payload:[{reportType:'STOCK_HISTORY_DAILY_CSV'}]}),['stockHistory'])
assert.deepEqual(eventStages({type:'report_generation_complete',payload:[]}),[])
assert.equal(safeEqualSecret('secret','secret'),true)
assert.equal(safeEqualSecret('secret','Secret'),false)

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
for(const marker of [
  'wb_live_sync_settings','wb_webhooks','wb_webhook_events',
  "/api/wb/webhooks/inbound/:connectionId/:receiverKey",
  "/api/wb/live/:id/webhooks/setup",
  'scheduleDueLiveSyncStages()',
  "scope:'contentanalytics',event:'report_generation_complete'",
  'idempotency_key TEXT NOT NULL',
  'async function persistWebhookEvents',
  '.slice(0,100)',
  'queued:liveEnabled',
  "status:'queued',nextAllowedAt:new Date().toISOString()",
  'recoveredDuplicateId:true',
  'replacedDuplicateReportId:reportId',
  'WB_CATALOG_SERVICE_ENABLED',
  "kickBackgroundWorkers('webhook-report-ready')",
  'scheduleDailyReadyStages()',
  'refreshDailyReadySnapshots()',
  '/api/wb/daily-ready/:id',
]) assert.ok(server.includes(marker),`server.js must contain ${marker}`)

const dashboard=fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx',import.meta.url),'utf8')
for(const marker of ['Автоматическое обновление','ELISEI готовит кабинет до вашего входа','setupLiveWebhooks','updateLiveSync','Снимок за вчера']) assert.ok(dashboard.includes(marker),`Dashboard must contain ${marker}`)

console.log('WB Order Feed seller-day cadence and nightly background policy tests passed')
