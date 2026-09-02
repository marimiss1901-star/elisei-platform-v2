import assert from 'node:assert/strict'
import fs from 'node:fs'

const source=fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx',import.meta.url),'utf8')
assert.match(source,/financeEvidenceMissing = !financeScopeFiltered && Number\(basePeriodFinanceSummary\?\.revenue \|\| 0\) > 0 && !ledgerHasMovements/,'period with revenue but no ledger movements must not be treated as confirmed finance')
assert.match(source,/ledgerHasMovements \\|\\| financeScopeFiltered \\? rawLedgerSummary/,'filtered finance scopes must not inherit whole-cabinet fallback amounts')
assert.match(source,/value == null \? 'Не загружено' : formatMoney\(value\)/,'P&L must not render missing WB finance values as 0 ₽')
assert.match(source,/financeEstimateAvailable \? 'Предварительно: комиссия и логистика рассчитаны по резервным параметрам/,'reserve values must be explicitly identified as provisional rather than confirmed WB values')
assert.match(source,/const storageMetricPartial = financeMetricPartial && !Boolean\(analyticsAvailability\.paidStorage\)/,'storage zero is confirmed by durable finance coverage or the storage stream')
assert.match(source,/const acquiringMetricPartial = financeMetricPartial && !Boolean\(analyticsAvailability\.acquiring\)/,'acquiring zero is confirmed by durable finance coverage or the acquiring stream')
assert.doesNotMatch(source,/persistedAvailability\.finance \|\| persistedAvailability\.paidStorage/,'generic finance availability must not confirm storage zero')
assert.doesNotMatch(source,/persistedAvailability\.finance \|\| persistedAvailability\.acquiring/,'generic finance availability must not confirm acquiring zero')
console.log('ELISEI 5.15.6 P&L and dashboard missing-data regressions passed')
