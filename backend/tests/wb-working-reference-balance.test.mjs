import assert from 'node:assert/strict'
import fs from 'node:fs'
import { WB_STREAMS } from '../src/wb/stream-store.js'
import { dailyHeavyStagePlan } from '../src/wb/daily-ready.js'
import { stagePriority, schedulerGroup } from '../src/wb/smart-scheduler.js'

assert.ok(WB_STREAMS.includes('balance'),'current WB balance must be a persisted first-class stream')
assert.equal(schedulerGroup('balance'),'finance','balance must share the finance rate-limit group')
assert.ok(stagePriority('balance') < stagePriority('finance'),'light current balance should be eligible before heavy finance pagination')

const now=Date.parse('2026-08-26T00:30:00Z') // 03:30 Europe/Moscow
const stale='2026-08-24T00:00:00Z'
const nightly=dailyHeavyStagePlan({states:[{stage:'balance',status:'success',last_success_at:stale}],now,timeZone:'Europe/Moscow'})
assert.ok(nightly.includes('balance'),'stale balance must be picked up by Nightly Ready')
const daytime=dailyHeavyStagePlan({states:[{stage:'balance',status:'success',last_success_at:stale}],now:Date.parse('2026-08-26T09:00:00Z'),timeZone:'Europe/Moscow'})
assert.ok(!daytime.includes('balance'),'balance must not become recurring seller-day traffic')

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
for(const marker of [
  "balance: { label: 'Баланс WB', scope: 'finance' }",
  'async function loadSellerBalance(',
  'https://finance-api.wildberries.ru/api/v1/account/balance',
  'for_withdraw:money(raw?.for_withdraw)',
  "stage === 'balance'",
  'balance: accountBalanceData',
]) assert.ok(server.includes(marker),`server balance integration must contain ${marker}`)

const quality=fs.readFileSync(new URL('../src/wb/data-quality.js',import.meta.url),'utf8')
assert.ok(quality.includes("balance:{ label:'Баланс WB'"),'data quality must expose a balance snapshot passport')

const dashboard=fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx',import.meta.url),'utf8')
for(const marker of [
  "label:'Доступно к выводу'",
  'analyticsCore?.finance?.balance?.for_withdraw',
  'label="Баланс WB"',
  "stage:'balance', title:'Баланс WB'",
  'не зависит от выбранного периода',
]) assert.ok(dashboard.includes(marker),`dashboard must keep period payable separate from current balance: ${marker}`)

console.log('WB working-reference current balance regression passed')
