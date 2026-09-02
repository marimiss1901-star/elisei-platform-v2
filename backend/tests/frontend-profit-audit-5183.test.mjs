import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx',import.meta.url),'utf8')
const css = fs.readFileSync(new URL('../../src/styles/app.css',import.meta.url),'utf8')

assert.match(source,/const profitAuditReady = homeOperatingProfit != null/,'home must only show the audit for a complete profit formula')
assert.match(source,/\['Выручка',Number\(businessSummary\.revenue/,'audit must start from revenue')
assert.match(source,/\['Себестоимость',Number\(businessSummary\.cogs/,'audit must expose COGS')
assert.match(source,/\['Все расходы WB',Number\(homeWbExpenses/,'audit must expose the complete WB expense bucket')
assert.match(source,/reconciliationDifference/,'audit must expose the WB reconciliation check')
assert.match(css,/\.profit-audit\{/,'profit audit must have a compact dashboard layout')

console.log('frontend profit audit 5.18.3: OK')
