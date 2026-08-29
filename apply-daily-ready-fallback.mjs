import fs from 'node:fs'

const file = 'src/pages/DashboardPage.jsx'
let source = fs.readFileSync(file, 'utf8')
if (source.includes('ELISEI_CANONICAL_FRONTEND_PATCHES')) process.exit(0)

function replaceOnce(oldText, newText, label) {
  if (source.includes(newText)) return
  if (!source.includes(oldText)) throw new Error(`Daily Ready fallback patch: ${label} target not found`)
  source = source.replace(oldText, newText)
}

replaceOnce(
`    const readyCore = readySnapshot?.core || null
    const businessSummary = readyCore?.summary || analyticsCore?.summary || summary || {}
    const previousSummary = readySnapshot?.previous?.core?.summary || analyticsCompareCore?.summary || {}
    const compareReady = Boolean(readySnapshot?.previous?.core || analyticsCompareCore)
    const snapshotFinance = readyCore?.finance?.summary || {}
    const loadedLedgerSummary = financeLedger?.summary || {}
    const coreFinanceSummary = analyticsCore?.finance?.summary || {}
    const ledgerSummary = Number(snapshotFinance?.movements || 0) > 0
      ? snapshotFinance
      : Number(loadedLedgerSummary?.movements || 0) > 0 ? loadedLedgerSummary : coreFinanceSummary
    const periodLabel = \`${'${formatDate(analyticsPeriod.from)}'} — ${'${formatDate(analyticsPeriod.to)}'}\`
    const periodDays = periodDaysBetween(analyticsPeriod)
    const analyticsAvailability = readyCore?.availability || analyticsCore?.availability || {}
    const snapshotStates = readySnapshot?.metricStates || {}
`,
`    const readyCore = readySnapshot?.core || null
    const snapshotStates = readySnapshot?.metricStates || {}
    const persistedSummary = analyticsCore?.summary || summary || {}
    const snapshotSummary = readyCore?.summary || {}
    const persistedAvailability = analyticsCore?.availability || {}
    const snapshotAvailability = readyCore?.availability || {}
    const analyticsAvailability = { ...persistedAvailability }
    for (const [key,value] of Object.entries(snapshotAvailability)) {
      if (value || analyticsAvailability[key] == null) analyticsAvailability[key] = value
    }
    const businessSummary = snapshotMode ? { ...persistedSummary, ...snapshotSummary } : persistedSummary
    const snapshotState = stage => String(snapshotStates?.[stage]?.state || '')
    const preserveConfirmedDomain = (stage, keys = []) => {
      if (!snapshotMode) return
      const state = snapshotState(stage)
      const persistedReady = Boolean(persistedAvailability?.[stage])
      for (const key of keys) {
        const persistedValue = persistedSummary?.[key]
        if (persistedValue == null) continue
        if ((persistedReady && state !== 'ready') || businessSummary?.[key] == null) businessSummary[key] = persistedValue
      }
    }
    preserveConfirmedDomain('sales',['revenue','sales','returns','returnRate','averagePrice'])
    preserveConfirmedDomain('orders',['orders'])
    preserveConfirmedDomain('advertising',['advertising'])
    preserveConfirmedDomain('finance',['commission','logistics','storage','acceptance','acquiring','penalties','deductions','adjustments','sellerPayable','operatingProfit','margin'])
    const previousSummary = readySnapshot?.previous?.core?.summary || analyticsCompareCore?.summary || {}
    const compareReady = Boolean(readySnapshot?.previous?.core || analyticsCompareCore)
    const snapshotFinance = readyCore?.finance?.summary || {}
    const loadedLedgerSummary = financeLedger?.summary || {}
    const coreFinanceSummary = analyticsCore?.finance?.summary || {}
    const sourceLedgerSummary = Number(snapshotFinance?.movements || 0) > 0
      ? snapshotFinance
      : Number(loadedLedgerSummary?.movements || 0) > 0 ? loadedLedgerSummary : coreFinanceSummary
    // Statistics sales expose the seller amount before the weekly realization
    // detail is ready. Keep that safe estimate visible instead of rendering an
    // empty settlement card for an otherwise fully loaded period.
    const ledgerSummary = Number(sourceLedgerSummary?.movements || 0) > 0
      ? sourceLedgerSummary
      : { ...sourceLedgerSummary,sellerPayable:businessSummary.revenue == null ? 0 : Number(businessSummary.revenue || 0) }
    const periodLabel = \`${'${formatDate(analyticsPeriod.from)}'} — ${'${formatDate(analyticsPeriod.to)}'}\`
    const periodDays = periodDaysBetween(analyticsPeriod)
`,
'home summary fallback')

replaceOnce(
`    const financePartial = snapshotMode
      ? snapshotFinanceState === 'partial' && !selectedFinancePeriodCovered
      : Boolean(!selectedFinancePeriodCovered && (financeLedger?.coverage?.financePartial || (financePersistedRows > 0 && ['queued','running','rate_limited','retry_scheduled'].includes(String(financeState?.status || '')))))
`,
`    const financePartial = snapshotMode
      ? snapshotFinanceState === 'partial' && !selectedFinancePeriodCovered && !Boolean(persistedAvailability.finance)
      : Boolean(!selectedFinancePeriodCovered && (financeLedger?.coverage?.financePartial || (financePersistedRows > 0 && ['queued','running','rate_limited','retry_scheduled'].includes(String(financeState?.status || '')))))
`,
'finance availability fallback')

replaceOnce(
`    const stateAvailable = (name, fallback) => snapshotMode ? ['ready','partial'].includes(name) : Boolean(fallback)
    const statePartial = (name, fallback) => snapshotMode ? name === 'partial' : Boolean(fallback)
`,
`    const stateAvailable = (name, fallback) => snapshotMode ? ['ready','partial'].includes(name) || Boolean(fallback) : Boolean(fallback)
    const statePartial = (name, fallback, persistedReady = false) => snapshotMode ? name === 'partial' && !Boolean(persistedReady) : Boolean(fallback)
`,
'metric availability fallback')

const replacements = [
  ["partial:statePartial(snapshotSalesState,!analyticsAvailability.sales && Boolean(syncStateFor('sales')))", "partial:statePartial(snapshotSalesState,!analyticsAvailability.sales && Boolean(syncStateFor('sales')),persistedAvailability.sales)"],
  ["partial:statePartial(snapshotOrdersState,!analyticsAvailability.orders && Boolean(syncStateFor('orders')))", "partial:statePartial(snapshotOrdersState,!analyticsAvailability.orders && Boolean(syncStateFor('orders')),persistedAvailability.orders)"],
  ["partial:statePartial(snapshotAdvertisingState,!analyticsAvailability.advertising && Boolean(syncStateFor('advertising')))", "partial:statePartial(snapshotAdvertisingState,!analyticsAvailability.advertising && Boolean(syncStateFor('advertising')),persistedAvailability.advertising)"],
  ["const financeMetricPartial = statePartial(snapshotFinanceState,financePartial)", "const financeMetricPartial = Boolean(statePartial(snapshotFinanceState,financePartial,persistedAvailability.finance) || financeEstimateAvailable)"],
]
for (const [oldText,newText] of replacements) {
  if (source.includes(newText)) continue
  if (!source.includes(oldText)) throw new Error(`Daily Ready fallback patch: metric target not found: ${oldText}`)
  source = source.replaceAll(oldText,newText)
}

replaceOnce(
`    const topProducts = snapshotMode
      ? (salesAvailableForPeriod ? (readyCore?.topProducts || []) : [])
      : (analyticsAvailability.sales ? [...analyticsBaseProducts].sort((a,b)=>Number(b.revenue || 0)-Number(a.revenue || 0)).slice(0,10) : [])
`,
`    const persistedTopProducts = analyticsAvailability.sales
      ? [...analyticsBaseProducts].sort((a,b)=>Number(b.revenue || 0)-Number(a.revenue || 0)).slice(0,10)
      : []
    const snapshotTopProducts = readyCore?.topProducts || []
    const topProducts = snapshotMode
      ? (snapshotSalesState === 'ready' && snapshotTopProducts.length
          ? snapshotTopProducts
          : persistedAvailability.sales && persistedTopProducts.length
            ? persistedTopProducts
            : salesAvailableForPeriod ? snapshotTopProducts : [])
      : persistedTopProducts
`,
'top products fallback')

fs.writeFileSync(file, source)
console.log('Daily Ready confirmed-data fallback applied')
