import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  DAILY_READY_QUARTER_STAGES, nightlyQuarterTaxPeriod,
} from '../src/wb/daily-ready.js'

const period=nightlyQuarterTaxPeriod(new Date('2026-08-29T00:30:00.000Z'),'Europe/Moscow')
assert.deepEqual(period,{
  dateFrom:'2026-07-01',
  dateTo:'2026-08-28',
  days:59,
  closedDay:true,
  purpose:'quarter_tax',
})

for(const stage of [
  'finance','acquiring','advertising','paidStorage','acceptance','documents',
  'financeReports','acquiringReports','measurementPenalties','deductionsReport',
  'goodsReturns','funnel','searchQueries','stockHistory',
]) {
  assert.ok(DAILY_READY_QUARTER_STAGES.includes(stage),`${stage} must be queued for overnight quarter tax data`)
}

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
for(const marker of [
  'nightlyQuarterTaxPeriod',
  'DAILY_READY_QUARTER_STAGES.includes(stage)',
  'quarterlyTaxReady:true',
  'nightlyReadyVersion:3',
  "if (stage==='advertising') return boundedSyncPeriod(range,92)",
  "const period=syncPeriodForStage('finance',taxQuarterRange)",
]) assert.ok(server.includes(marker),`server.js must contain ${marker}`)

console.log('ELISEI overnight quarter tax period regression: OK')
