import assert from 'node:assert/strict'
import fs from 'node:fs'

const source=fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx',import.meta.url),'utf8')
assert.match(source,/financeEvidenceMissing = Number\(basePeriodFinanceSummary\?\.revenue \|\| 0\) > 0 && !ledgerHasMovements/,'period with revenue but no ledger movements must not be treated as confirmed finance')
assert.match(source,/value == null \? 'Не загружено' : formatMoney\(value\)/,'P&L must not render missing WB finance values as 0 ₽')
console.log('ELISEI 5.15.6 P&L missing-data regression passed')
