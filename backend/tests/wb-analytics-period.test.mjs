import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8')
const start = source.indexOf('function analyticsPeriodRange')
const end = source.indexOf("app.get('/api/wb/dashboard/:id'", start)
assert.ok(start > 0 && end > start, 'Analytics period helpers must exist before dashboard routes')
const helpersSource = source.slice(start, end)

const dateKey = value => {
  if (!value) return ''
  const raw = String(value)
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0,10)
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0,10)
}
const summarizeFinanceRows = rows => ({ rows:rows.length, sellerPayable:rows.reduce((sum,row)=>sum+Number(row.sellerPayable||0),0) })
const loadHelpers = new Function('dateKey','summarizeFinanceRows',`${helpersSource}; return { analyticsPeriodRange, analyticsFilterConnectionData }`)
const { analyticsPeriodRange, analyticsFilterConnectionData } = loadHelpers(dateKey,summarizeFinanceRows)

const range = analyticsPeriodRange({ from:'2026-08-01',to:'2026-08-03' })
assert.equal(range.days,3,'inclusive period must contain exactly three days')
assert.throws(() => analyticsPeriodRange({from:'2025-01-01',to:'2026-08-03'}),/не более 366 дней/)

const raw = {
  products:[{nmID:1}],
  stocks:[{nmID:1,quantity:8}],
  orders:[{date:'2026-08-01',nmID:1},{date:'2026-08-04',nmID:1}],
  sales:[{sale_dt:'2026-08-02',nmID:1},{sale_dt:'2026-07-31',nmID:1}],
  finance:{rows:[{rrDate:'2026-08-03',sellerPayable:100},{rrDate:'2026-08-05',sellerPayable:500}],totals:{sellerPayable:999}},
  advertising:{
    period:{from:'2026-07-05',to:'2026-08-03'},
    campaigns:[{advertId:10,statsStatus:'loaded',dailyStats:[
      {date:'2026-08-01',views:100,clicks:10,spend:50,orders:2,revenue:500},
      {date:'2026-08-04',views:200,clicks:20,spend:100,orders:4,revenue:1000},
    ],nmStats:[{nmID:1,spend:150}]}],
    daily:[],
  },
}
const filtered = analyticsFilterConnectionData(raw,range)
assert.equal(filtered.orders.length,1)
assert.equal(filtered.sales.length,1)
assert.equal(filtered.finance.rows.length,1)
assert.equal(filtered.finance.totals.sellerPayable,100,'filtered finance totals must not reuse whole-history totals')
assert.equal(filtered.stocks.length,1,'current stock snapshot must remain available')
assert.equal(filtered.__periodDays,3)
assert.equal(filtered.__periodCoverage.sales.selectedRows,1)
assert.equal(filtered.advertising.daily.length,1)
assert.equal(filtered.advertising.totals.spend,50)
assert.equal(filtered.advertising.campaigns[0].nmStats.length,0,'nmID totals from another snapshot period must not be treated as exact')

console.log('WB analytics period and filter tests passed')
