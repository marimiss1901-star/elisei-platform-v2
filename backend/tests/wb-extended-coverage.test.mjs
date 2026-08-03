import assert from 'node:assert/strict'
import fs from 'node:fs'
import { WB_STREAMS, normalizeStreamPayload, streamCount } from '../src/wb/stream-store.js'
import { normalizeFinanceLedgerRows } from '../src/wb/finance-ledger.js'

for (const stream of ['fbsArchive','measurementPenalties','deductionsReport','goodsReturns','tariffs','funnel','documents','searchQueries','stockHistory','reviews','questions','chats']) {
  assert.ok(WB_STREAMS.includes(stream), `${stream} is registered`)
  const payload=normalizeStreamPayload(stream,{rows:[{id:1}],totalRows:12})
  assert.equal(streamCount(stream,payload),12)
}

const penalty=normalizeFinanceLedgerRows('measurementPenalties',{nmId:42,amount:350,date:'2026-08-01'},'p1',0)
assert.equal(penalty.length,1)
assert.equal(penalty[0].operationGroup,'penalties')
assert.equal(penalty[0].amount,-350)
assert.equal(penalty[0].detailOnly,true)
assert.equal(penalty[0].includedInPnl,false)

const reversedPenalty=normalizeFinanceLedgerRows('measurementPenalties',{nmId:42,penaltyAmount:350,reversalAmount:125,dtBonus:'2026-08-01T10:00:00Z'},'p2',0)
assert.equal(reversedPenalty.length,2)
assert.equal(reversedPenalty[0].amount,-350)
assert.equal(reversedPenalty[1].operationGroup,'compensations')
assert.equal(reversedPenalty[1].amount,125)
assert.equal(reversedPenalty[1].includedInPnl,false)

const deduction=normalizeFinanceLedgerRows('deductionsReport',{nmId:42,bonusSumm:490,bonusType:'Подмена FBW',dtBonus:'2026-08-01T10:00:00Z'},'d1',0)
assert.equal(deduction.length,1)
assert.equal(deduction[0].operationGroup,'deductions')
assert.equal(deduction[0].amount,-490)
assert.equal(deduction[0].detailOnly,true)

const source=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
for (const marker of [
  '/api/marketplace/v3/fbs/orders/archive',
  '/api/analytics/v1/measurement-penalties',
  '/api/analytics/v1/deductions',
  '/api/v1/analytics/goods-return',
  '/api/v1/tariffs/commission',
  '/api/analytics/v3/sales-funnel/products',
  '/api/v1/documents/list',
  '/api/v2/search-report/report',
  '/api/v2/search-report/product/search-texts',
  'STOCK_HISTORY_DAILY_CSV',
  'feedbacks-api.wildberries.ru/api/v1/${plural}',
  '/api/v1/questions',
  'buyer-chat-api.wildberries.ru/api/v1/seller',
  "phase:'events'",
  "app.get('/api/wb/extended/:stream'",
  'advanceFbsArchiveTask',
  'advanceOffsetReportTask',
  'advanceQuestionsTask',
  'advanceChatsTask',
  'sanitizeChatObject',
  "currentPeriod:{start:detailPeriod.dateFrom,end:detailPeriod.dateTo}",
  "const nextPhase = stage === 'reviews' ? 'archive' : 'answered'",
  'year:String(selectedMonth.year)',
  'month:String(selectedMonth.month)',
  '/api/v1/tariffs/return?date=',
]) assert.ok(source.includes(marker),`server.js must contain ${marker}`)

console.log('WB extended API coverage tests passed')
