import assert from 'node:assert/strict'
import fs from 'node:fs'

const page = fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx', import.meta.url), 'utf8')

assert.match(page,/const financeAnalyticsPeriodAligned = analyticsPeriodsMatch\(analyticsVisiblePeriod,analyticsPeriod\)/,
  'Finance must know whether the visible analytics cache belongs to the selected period')
assert.match(page,/const basePeriodFinanceSummary = financeAnalyticsPeriodAligned \? \(analyticsCore\?\.summary \|\| \{\}\) : \{\}/,
  'a previous-period analytics summary must never be relabeled as the selected Finance period')
assert.match(page,/const financeLedgerPeriodAligned = !financeLedger \|\| analyticsPeriodsMatch\(financeLedgerSelectedPeriod,analyticsPeriod\)/,
  'a previous-period finance-ledger response must be rejected')
assert.match(page,/const rawLedgerSummary = ledger\.summary \|\| \{\}/)
assert.match(page,/const ledgerHasMovements = Number\(rawLedgerSummary\.movements \|\| 0\) > 0/,
  'movement evidence must be checked before provisional values are layered onto the display summary')
assert.match(page,/sellerPayable:null/,
  'forPay is confirmed-only and must not be synthesized from revenue')
assert.match(page,/penalties:null/)
assert.match(page,/deductions:null/)
assert.match(page,/compensations:null/)
assert.match(page,/const financeReady = Boolean\(financeLedgerPeriodAligned && \(ledgerHasMovements \|\| selectedPeriodCovered\)\)/,
  'finance readiness must belong to the selected period')
assert.match(page,/acquiring:ledgerAmount\('acquiring'\)/)
assert.match(page,/penalties:(?:ledgerAmount|volatileFinanceAmount)\('penalties'\)/)
assert.match(page,/deductions:(?:ledgerAmount|volatileFinanceAmount)\('deductions'\)/)
assert.match(page,/subscriptions:(?:ledgerAmount|volatileFinanceAmount)\('subscriptions'\)/)
assert.match(page,/otherWbExpenses/)
assert.match(page,/Прочие списания WB/)
assert.match(page,/Подписки \/ сервисы WB/)
assert.match(page,/financePartial && value === 0 \? null : value/,
  'partial finance must not render an unconfirmed missing category as zero')
assert.match(page,/Number\(ledgerSummary\.expenses \|\| 0\) - Number\(ledgerSummary\.advertisingCharges \|\| 0\)/,
  'ledger total must exclude advertising when campaign spend is used, preventing double count')
assert.match(page,/pnlRevenue - pnlCogs - wbExpensesExAdvertising - pnlAdvertising - pnlFixed - pnlTax \+ Number\(pnlCompensations \|\| 0\)/,
  'operating profit must be rebuilt from ledger-backed WB expenses')
assert.match(page,/const financeBalance = rawFinanceLedger\?\.balance \|\| analyticsCore\?\.finance\?\.balance \|\| null/,
  'current account balance stays independent from the selected P&L period and prefers the dedicated Finance response')
assert.doesNotMatch(page,/const periodFinanceSummary = analyticsCore\?\.summary \|\| summary\n/,
  'P&L must not read the old analytics summary directly')

console.log('ELISEI 5.19.14 selected-period ledger-backed P&L regression: OK')
