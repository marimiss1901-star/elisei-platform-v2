import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  defaultLiveSyncSettings,normalizeLiveSyncSettings,dueLiveStages,eventStages,safeEqualSecret,
  effectiveLiveIntervalSeconds,liveCadenceWindow,
} from '../src/wb/live-sync.js'

const defaults=defaultLiveSyncSettings()
assert.equal(defaults.enabled,true)
assert.equal(defaults.intervals.orders,1800)
assert.equal(defaults.intervals.sales,1800)
assert.equal(defaults.intervals.stocks,3600)
assert.equal(defaults.intervals.sellerStocks,1800)
assert.equal(defaults.intervals.advertising,1800)
assert.equal(defaults.intervals.reviews,3600)
assert.equal(defaults.intervals.questions,3600)
assert.equal(defaults.intervals.chats,900)

const normalized=normalizeLiveSyncSettings({enabled:true,intervals:{orders:1,chats:10}})
assert.equal(normalized.enabled,true)
assert.equal(normalized.intervals.orders,1800,'orders must not poll faster than WB source freshness')
assert.equal(normalized.intervals.chats,300,'chat lane may be configured as low as 5 minutes')

const active=Date.parse('2026-08-04T12:00:00Z') // 15:00 Moscow
const overnight=Date.parse('2026-08-04T01:00:00Z') // 04:00 Moscow
assert.equal(liveCadenceWindow(active,'Europe/Moscow'),'active')
assert.equal(liveCadenceWindow(overnight,'Europe/Moscow'),'overnight')
assert.equal(effectiveLiveIntervalSeconds('orders',{settings:{},now:active}),1800)
assert.equal(effectiveLiveIntervalSeconds('orders',{settings:{},now:overnight}),3600)
assert.equal(effectiveLiveIntervalSeconds('advertising',{settings:{intervals:{advertising:3600}},now:active}),1800,'legacy 1h ad cadence is migrated to 30m effectively')
assert.equal(effectiveLiveIntervalSeconds('chats',{settings:{intervals:{chats:3600}},now:active}),900,'legacy 1h chat cadence is migrated to 15m effectively')
assert.equal(effectiveLiveIntervalSeconds('reviews',{settings:{webhooksEnabled:true},now:active}),7200,'webhook-covered streams use slower polling fallback')

const due=dueLiveStages({settings:{enabled:true},states:[
  {stage:'orders',status:'success',last_success_at:'2026-08-04T11:20:00Z'},
  {stage:'sales',status:'success',last_success_at:'2026-08-04T11:45:00Z'},
  {stage:'stocks',status:'rate_limited',next_allowed_at:'2026-08-04T13:00:00Z'},
],now:active,timeZone:'Europe/Moscow'})
assert.ok(due.includes('orders'))
assert.ok(!due.includes('sales'))
assert.ok(!due.includes('stocks'))

const fair=dueLiveStages({settings:{enabled:true},states:[
  {stage:'orders',status:'success',last_success_at:'2026-08-04T10:00:00Z'},
  {stage:'sales',status:'success',last_success_at:'2026-08-04T11:00:00Z'},
  {stage:'chats',status:'success',last_success_at:'2026-08-04T11:00:00Z'},
],now:active,timeZone:'Europe/Moscow'})
assert.equal(fair[0],'chats','most overdue fast CRM stream must not be starved by fixed stage order')

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

console.log('WB adaptive live sync, daily-ready and stock-history recovery tests passed')
