import assert from 'node:assert/strict'
import fs from 'node:fs'

const source=fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx',import.meta.url),'utf8')

assert.match(source,/const ELISEI_CANONICAL_FRONTEND_PATCHES = '5\.17\.0'/,
  'the committed frontend must be canonical so prebuild patches cannot overwrite the fix')
assert.match(source,/const financeEstimateAvailable = Boolean\(!ledgerHasMovements && salesAvailableForPeriod && businessSummary\.revenue != null\)/,
  'Main must offer an estimate whenever operational sales exist without a closed WB ledger')
assert.match(source,/showProvisionalZero:financeEstimateAvailable/,
  'a valid provisional zero must remain visible instead of becoming “Уточняется”')
assert.match(source,/предварительно по оперативным продажам/,
  'seller payable fallback must be visibly marked as provisional')
assert.match(source,/const financeEstimateAvailable = Boolean\(!ledgerHasMovements && !financeScopeFiltered && basePeriodFinanceSummary\.revenue != null\)/,
  'Finance page must calculate a provisional P&L while the WB ledger is not closed')
assert.match(source,/financeEstimateAvailable \? 'Предварительный расчёт доступен'/,
  'Finance page must explain that its reserve calculation is provisional')
assert.match(source,/Подтверждённая детализация заменит оценки автоматически/,
  'the UI must promise automatic replacement only when confirmed WB detail arrives')

console.log('ELISEI 5.16.4 provisional finance visibility regression: OK')
