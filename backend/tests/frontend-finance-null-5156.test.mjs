import assert from 'node:assert/strict'
import fs from 'node:fs'

const source=fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx',import.meta.url),'utf8')
assert.match(source,/financeEvidenceMissing = Number\(basePeriodFinanceSummary\?\.revenue \|\| 0\) > 0 && !ledgerHasMovements/,'period with revenue but no ledger movements must not be treated as confirmed finance')
assert.match(source,/value == null \? 'Не загружено' : formatMoney\(value\)/,'P&L must not render missing WB finance values as 0 ₽')
assert.match(source,/partial:statePartial\(snapshotFinanceState,financeHasAnyProgress \|\| Boolean\(syncStateFor\('paidStorage'\)\),persistedAvailability\.paidStorage\)/,'storage zero is confirmed only by the storage stream')
assert.match(source,/partial:statePartial\(snapshotFinanceState,financeHasAnyProgress \|\| Boolean\(syncStateFor\('acquiring'\)\),persistedAvailability\.acquiring\)/,'acquiring zero is confirmed only by the acquiring stream')
assert.doesNotMatch(source,/persistedAvailability\.finance \|\| persistedAvailability\.paidStorage/,'generic finance availability must not confirm storage zero')
assert.doesNotMatch(source,/persistedAvailability\.finance \|\| persistedAvailability\.acquiring/,'generic finance availability must not confirm acquiring zero')
console.log('ELISEI 5.15.6 P&L and dashboard missing-data regressions passed')
