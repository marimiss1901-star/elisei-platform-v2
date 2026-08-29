import assert from 'node:assert/strict'
import fs from 'node:fs'

const page=fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx',import.meta.url),'utf8')

assert.match(page,/const ledgerHasMovements = financeMovementsInPeriod > 0/)
assert.match(page,/const coreFinanceSummary = analyticsCore\?\.finance\?\.summary \|\| \{\}/,
  'Main must use the durable core summary even when the detailed Finance page reader is idle')
assert.match(page,/const confirmedFinanceSummary = ledgerHasMovements \? \{/)
assert.match(page,/commission:Number\(ledgerSummary\.commission \|\| 0\)/)
assert.match(page,/const financeAvailableForPeriod = Boolean\(stateAvailable\(snapshotFinanceState,analyticsAvailability\.finance\) \|\| ledgerHasMovements \|\| selectedFinancePeriodCovered\)/,
  'saved ledger movements must make finance visible after a fresh login')
assert.match(page,/partial:financeMetricPartial/,
  'saved progress must not be confused with an incomplete selected period')
assert.match(page,/homeOperatingProfit/)
assert.match(page,/Number\(ledgerSummary\.expenses \|\| 0\)-Number\(ledgerSummary\.advertisingCharges \|\| 0\)/,
  'Main P&L must use the durable ledger and avoid double-counting advertising')
assert.match(page,/const selectedPeriodCovered = Boolean\(ledger\.coverage\?\.selectedPeriod\?\.covered\)/)

console.log('ELISEI 5.16.0 anytime Main finance regression: OK')
