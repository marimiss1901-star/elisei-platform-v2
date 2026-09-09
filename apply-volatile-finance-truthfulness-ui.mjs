import fs from 'node:fs'

// ELISEI 5.19.9 — volatile WB finance categories must never become a fake 0 ₽
// merely because another ledger source (for example paid storage) has rows.
const file='src/pages/DashboardPage.jsx'
let source=fs.readFileSync(file,'utf8')

function replaceOnce(before,after,label){
  if(source.includes(after)) return
  if(!source.includes(before)) throw new Error(`ELISEI 5.19.9 UI patch: ${label} marker not found`)
  source=source.replace(before,after)
}

replaceOnce(
`    const periodFinanceSummary = {\n      ...basePeriodFinanceSummary,`,
`    const volatileFinanceAmount = key => {\n      const value = Number(ledgerSummary?.[key] || 0)\n      return value !== 0 || selectedPeriodCovered ? value : null\n    }\n    const volatileComputedAmount = value => {\n      const numeric = Number(value || 0)\n      return numeric !== 0 || selectedPeriodCovered ? numeric : null\n    }\n    const periodFinanceSummary = {\n      ...basePeriodFinanceSummary,`,
'volatile finance helper')

replaceOnce(
`      penalties:ledgerAmount('penalties'),\n      deductions:ledgerAmount('deductions'),\n      subscriptions:ledgerAmount('subscriptions'),\n      otherWbExpenses,\n      additionalPayment:pnlCompensations,`,
`      penalties:volatileFinanceAmount('penalties'),\n      deductions:volatileFinanceAmount('deductions'),\n      subscriptions:volatileFinanceAmount('subscriptions'),\n      otherWbExpenses:volatileComputedAmount(otherWbExpenses),\n      additionalPayment:volatileComputedAmount(pnlCompensations),`,
'volatile finance rows')

source=source.replace(
'Неподтверждённые расходы не считаются реальным нулём. Подтверждённая детализация заменит оценки автоматически.',
'Штрафы, удержания, подписки / сервисы WB и прочие списания не считаются нулём до подтверждения выбранного периода финансовым отчётом WB. Подтверждённая детализация заменит оценки автоматически.'
)

fs.writeFileSync(file,source)
console.log('ELISEI 5.19.9 volatile finance truthfulness UI applied')
