import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  defaultLiveSyncSettings,normalizeLiveSyncSettings,dueLiveStages,eventStages,safeEqualSecret,
} from '../src/wb/live-sync.js'

const defaults=defaultLiveSyncSettings()
assert.equal(defaults.enabled,false)
assert.equal(defaults.intervals.orders,120)
assert.equal(defaults.intervals.stocks,300)

const normalized=normalizeLiveSyncSettings({enabled:true,intervals:{orders:1,chats:10}})
assert.equal(normalized.enabled,true)
assert.equal(normalized.intervals.orders,60)
assert.equal(normalized.intervals.chats,1800)

const now=Date.parse('2026-08-04T12:00:00Z')
const due=dueLiveStages({settings:{enabled:true},states:[
  {stage:'orders',status:'success',last_success_at:'2026-08-04T11:57:00Z'},
  {stage:'sales',status:'success',last_success_at:'2026-08-04T11:58:00Z'},
  {stage:'stocks',status:'rate_limited',next_allowed_at:'2026-08-04T13:00:00Z'},
],now})
assert.ok(due.includes('orders'))
assert.ok(!due.includes('sales'))
assert.ok(!due.includes('stocks'))
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
  "version: '2.22.3'",
]) assert.ok(server.includes(marker),`server.js must contain ${marker}`)

const dashboard=fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx',import.meta.url),'utf8')
for(const marker of ['Живое обновление','Гибридный режим включён','setupLiveWebhooks','updateLiveSync']) assert.ok(dashboard.includes(marker),`Dashboard must contain ${marker}`)

console.log('WB 5.9.0 live sync and stock-history recovery tests passed')
