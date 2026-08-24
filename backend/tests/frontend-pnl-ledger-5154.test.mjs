import assert from 'node:assert/strict'
import fs from 'node:fs'

const page = fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx', import.meta.url), 'utf8')

assert.match(page,/const basePeriodFinanceSummary = analyticsCore\?\.summary \|\| summary \|\| \{\}/)
assert.match(page,/const ledgerHasMovements = Number\(ledgerSummary\.movements \|\| 0\) > 0/)
assert.match(page,/acquiring:ledgerAmount\('acquiring'\)/)
assert.match(page,/penalties:ledgerAmount\('penalties'\)/)
assert.match(page,/deductions:ledgerAmount\('deductions'\)/)
assert.match(page,/subscriptions:ledgerAmount\('subscriptions'\)/)
assert.match(page,/otherWbExpenses/)
assert.match(page,/Прочие списания WB/)
assert.match(page,/Подписки \/ сервисы WB/)
assert.match(page,/financePartial && value === 0 \? null : value/,
  'partial finance must not render an unconfirmed missing category as zero')
assert.match(page,/Number\(ledgerSummary\.expenses \|\| 0\) - Number\(ledgerSummary\.advertisingCharges \|\| 0\)/,
  'ledger total must exclude advertising when campaign spend is used, preventing double count')
assert.match(page,/pnlRevenue - pnlCogs - wbExpensesExAdvertising - pnlAdvertising - pnlFixed - pnlTax \+ Number\(pnlCompensations \|\| 0\)/,
  'operating profit must be rebuilt from ledger-backed WB expenses')
assert.doesNotMatch(page,/const periodFinanceSummary = analyticsCore\?\.summary \|\| summary\n/,
  'P&L must not read the old analytics summary directly')

console.log('ELISEI 5.15.4 ledger-backed P&L regression: OK')
