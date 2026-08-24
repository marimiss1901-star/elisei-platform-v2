import fs from 'node:fs'

function replaceOnce(source, from, to, label) {
  if (source.includes(to)) return source
  const count = source.split(from).length - 1
  if (count !== 1) throw new Error(`${label}: expected one marker, found ${count}`)
  return source.replace(from, to)
}

const path = 'src/pages/DashboardPage.jsx'
let source = fs.readFileSync(path, 'utf8')

source = replaceOnce(
  source,
  "    const periodFinanceSummary = analyticsCore?.summary || summary\n",
  "    const basePeriodFinanceSummary = analyticsCore?.summary || summary || {}\n",
  'base P&L summary'
)

source = replaceOnce(
  source,
  "    const financeComplete = financeReady && !financePartial\n",
  `    const financeComplete = financeReady && !financePartial
    const ledgerHasMovements = Number(ledgerSummary.movements || 0) > 0
    const ledgerAmount = (key, fallbackKey = key) => {
      if (ledgerHasMovements) {
        const value = Number(ledgerSummary?.[key] || 0)
        // Пока финансовая детализация догружается, отсутствие конкретной
        // категории не является подтверждённым нулём.
        return financePartial && value === 0 ? null : value
      }
      if (!financeComplete) return null
      const fallback = basePeriodFinanceSummary?.[fallbackKey]
      return fallback == null ? 0 : Number(fallback || 0)
    }
    const ledgerAdvertisingCharges = ledgerHasMovements ? Number(ledgerSummary.advertisingCharges || 0) : null
    const campaignAdvertising = basePeriodFinanceSummary.advertising == null ? null : Number(basePeriodFinanceSummary.advertising || 0)
    // Реклама берётся из рекламной статистики, если она доступна. Финансовое
    // списание рекламы используется как fallback и не суммируется второй раз.
    const pnlAdvertising = campaignAdvertising ?? ledgerAdvertisingCharges
    const wbExpensesExAdvertising = ledgerHasMovements
      ? Math.max(0, Number(ledgerSummary.expenses || 0) - Number(ledgerSummary.advertisingCharges || 0))
      : financeComplete
        ? [
            basePeriodFinanceSummary.commission, basePeriodFinanceSummary.logistics, basePeriodFinanceSummary.storage,
            basePeriodFinanceSummary.acceptance, basePeriodFinanceSummary.acquiring, basePeriodFinanceSummary.penalties,
            basePeriodFinanceSummary.deductions,
          ].reduce((total, value) => total + Number(value || 0), 0)
        : null
    const knownWbExpenseParts = ['commission','logistics','storage','acceptance','acquiring','penalties','deductions','subscriptions']
      .map(key => ledgerAmount(key))
      .filter(value => value != null)
      .reduce((total, value) => total + Number(value || 0), 0)
    const otherWbExpenses = wbExpensesExAdvertising == null
      ? null
      : Math.max(0, wbExpensesExAdvertising - knownWbExpenseParts)
    const pnlCompensations = ledgerHasMovements
      ? (financePartial && Number(ledgerSummary.compensations || 0) === 0 ? null : Number(ledgerSummary.compensations || 0))
      : financeComplete
        ? Number(basePeriodFinanceSummary.additionalPayment || 0)
        : null
    const pnlRevenue = basePeriodFinanceSummary.revenue == null ? null : Number(basePeriodFinanceSummary.revenue || 0)
    const pnlCogs = basePeriodFinanceSummary.cogs == null ? null : Number(basePeriodFinanceSummary.cogs || 0)
    const pnlFixed = basePeriodFinanceSummary.fixed == null ? 0 : Number(basePeriodFinanceSummary.fixed || 0)
    const pnlTax = basePeriodFinanceSummary.tax == null ? 0 : Number(basePeriodFinanceSummary.tax || 0)
    const pnlOperatingProfit = pnlRevenue != null && pnlCogs != null && wbExpensesExAdvertising != null && pnlAdvertising != null
      ? pnlRevenue - pnlCogs - wbExpensesExAdvertising - pnlAdvertising - pnlFixed - pnlTax + Number(pnlCompensations || 0)
      : null
    const periodFinanceSummary = {
      ...basePeriodFinanceSummary,
      commission:ledgerAmount('commission'),
      logistics:ledgerAmount('logistics'),
      storage:ledgerAmount('storage'),
      acceptance:ledgerAmount('acceptance'),
      acquiring:ledgerAmount('acquiring'),
      penalties:ledgerAmount('penalties'),
      deductions:ledgerAmount('deductions'),
      subscriptions:ledgerAmount('subscriptions'),
      otherWbExpenses,
      additionalPayment:pnlCompensations,
      advertising:pnlAdvertising,
      operatingProfit:pnlOperatingProfit,
      margin:pnlOperatingProfit != null && pnlRevenue > 0 ? pnlOperatingProfit / pnlRevenue * 100 : null,
    }
`,
  'ledger-backed P&L'
)

source = replaceOnce(
  source,
  "['Корректировки / доплаты',periodFinanceSummary.additionalPayment],['Реклама',periodFinanceSummary.advertising]",
  "['Подписки / сервисы WB',periodFinanceSummary.subscriptions],['Прочие списания WB',periodFinanceSummary.otherWbExpenses],['Корректировки / доплаты',periodFinanceSummary.additionalPayment],['Реклама',periodFinanceSummary.advertising]",
  'P&L all WB deductions rows'
)

source = replaceOnce(
  source,
  '«К перечислению» не уменьшается повторно на компоненты отчёта. Отдельные отчёты хранения, приёмки и эквайринга используются для детализации без двойного счёта.',
  'WB-расходы в P&L берутся из финансового реестра за выбранный период. Неподтверждённый ноль не показывается; отдельные отчёты используются для детализации без двойного счёта.',
  'P&L source note'
)

if (!source.includes("acquiring:ledgerAmount('acquiring')")) throw new Error('acquiring ledger source was not applied')
if (!source.includes('Прочие списания WB')) throw new Error('other WB expenses row was not applied')
fs.writeFileSync(path, source)

console.log('ELISEI 5.15.4 P&L ledger-source patch applied')
