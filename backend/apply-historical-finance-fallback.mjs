import fs from 'node:fs'

// ELISEI 5.19.5 — safer provisional P&L + WB goods-return 31-day guard.
// When selected-period finance has not arrived yet, use the latest confirmed
// historical WB logistics/acquiring ratios instead of a false zero. Manual
// logisticsPerSale still wins when explicitly configured. The estimate remains
// provisional and is replaced automatically by current-period finance.
// goodsReturns must never send a date window longer than 31 days to WB.

const serverUrl = new URL('./src/server.js', import.meta.url)
let source = fs.readFileSync(serverUrl, 'utf8')

function replaceOnce(before, after, label) {
  if (source.includes(after)) return
  if (!source.includes(before)) throw new Error(`ELISEI 5.19.5 could not find ${label} marker in server.js`)
  source = source.replace(before, after)
}

replaceOnce(
`    logisticsPerSale: Math.max(0, finiteNumber(value.logisticsPerSale, 0)),
    storageMonthly: Math.max(0, finiteNumber(value.storageMonthly, 0)),`,
`    logisticsPerSale: Math.max(0, finiteNumber(value.logisticsPerSale, 0)),
    historicalLogisticsPercent: Math.min(80, Math.max(0, finiteNumber(value.historicalLogisticsPercent, 0))),
    historicalAcquiringPercent: Math.min(20, Math.max(0, finiteNumber(value.historicalAcquiringPercent, 0))),
    historicalFinanceFrom: String(value.historicalFinanceFrom || '').slice(0,10),
    historicalFinanceTo: String(value.historicalFinanceTo || '').slice(0,10),
    storageMonthly: Math.max(0, finiteNumber(value.storageMonthly, 0)),`,
  'historical fallback settings',
)

replaceOnce(
`function buildCoreAnalytics(data = {}, rawSettings = {}) {`,
`async function loadHistoricalFinanceFallback(connectionId, range) {
  if (!pool || !connectionId || !range?.from) return null
  try {
    const result = await pool.query(\`
      WITH anchor AS (
        SELECT MAX(operation_date) AS d
        FROM wb_finance_ledger
        WHERE connection_id=$1
          AND operation_date < $2::date
          AND operation_group='sales'
          AND metric_role='control'
          AND direction='income'
      ), historical AS (
        SELECT l.*
        FROM wb_finance_ledger l, anchor a
        WHERE l.connection_id=$1
          AND a.d IS NOT NULL
          AND l.operation_date BETWEEN a.d - INTERVAL '27 days' AND a.d
      )
      SELECT
        MIN(operation_date)::text AS from_date,
        MAX(operation_date)::text AS to_date,
        COALESCE(SUM(ABS(amount)) FILTER (WHERE operation_group='sales' AND metric_role='control' AND direction='income'),0)::float8 AS revenue,
        COALESCE(SUM(ABS(amount)) FILTER (WHERE operation_group='logistics' AND metric_role='breakdown' AND direction='expense'),0)::float8 AS logistics,
        COALESCE(SUM(ABS(amount)) FILTER (WHERE operation_group='acquiring' AND metric_role='breakdown' AND direction='expense'),0)::float8 AS acquiring
      FROM historical
    \`,[connectionId,range.from])
    const row=result.rows[0] || {}
    const revenue=Math.max(0,Number(row.revenue || 0))
    if (revenue < 1000) return null
    const logistics=Math.max(0,Number(row.logistics || 0))
    const acquiring=Math.max(0,Number(row.acquiring || 0))
    return {
      from:String(row.from_date || '').slice(0,10) || null,
      to:String(row.to_date || '').slice(0,10) || null,
      revenue,
      logistics,
      acquiring,
      logisticsPercent:logistics > 0 ? Math.min(80,logistics/revenue*100) : 0,
      acquiringPercent:acquiring > 0 ? Math.min(20,acquiring/revenue*100) : 0,
      source:'wb_finance_history',
    }
  } catch (error) {
    console.warn('Historical WB finance fallback unavailable:',error.message)
    return null
  }
}

function buildCoreAnalytics(data = {}, rawSettings = {}) {`,
  'historical finance helper',
)

replaceOnce(
`  const [settings,states] = await Promise.all([
    getBusinessSettings(req.auth.sub),
    range ? getSyncStates(connection.id) : Promise.resolve([]),
  ])
  const martRevision = range ? coreMartRevision(states,settings) : ''`,
`  const [settings,states] = await Promise.all([
    getBusinessSettings(req.auth.sub),
    range ? getSyncStates(connection.id) : Promise.resolve([]),
  ])
  const historicalFinanceFallback = range ? await loadHistoricalFinanceFallback(connection.id,range) : null
  const analyticsSettings = historicalFinanceFallback
    ? {
        ...settings,
        historicalLogisticsPercent:Number(historicalFinanceFallback.logisticsPercent || 0),
        historicalAcquiringPercent:Number(historicalFinanceFallback.acquiringPercent || 0),
        historicalFinanceFrom:historicalFinanceFallback.from || '',
        historicalFinanceTo:historicalFinanceFallback.to || '',
      }
    : settings
  const martRevision = range ? coreMartRevision(states,analyticsSettings) : ''`,
  'core-route historical settings',
)

replaceOnce(
`  const core = buildCoreAnalytics(selectedData, settings)
  if (ledgerFinanceRows.length) {`,
`  const core = buildCoreAnalytics(selectedData, analyticsSettings)
  core.historicalFinanceFallback = historicalFinanceFallback
  if (ledgerFinanceRows.length) {`,
  'core-route analytics settings use',
)

replaceOnce(
`    const manualCommission = Math.max(0, item.revenue) * settings.commissionPercent / 100
    const manualLogistics = item.salesCount * settings.logisticsPerSale
    const commission = financeHasRows`,
`    const manualCommission = Math.max(0, item.revenue) * settings.commissionPercent / 100
    const manualLogistics = item.salesCount * settings.logisticsPerSale
    const historicalLogistics = Math.max(0,item.revenue) * Number(settings.historicalLogisticsPercent || 0) / 100
    const historicalAcquiring = Math.max(0,item.revenue) * Number(settings.historicalAcquiringPercent || 0) / 100
    const commission = financeHasRows`,
  'historical product estimates',
)

replaceOnce(
`    const logistics = financeHasRows
      ? item.financeLogistics + unallocatedFinance.logistics * revenueShare
      : manualLogistics`,
`    const logistics = financeHasRows
      ? item.financeLogistics + unallocatedFinance.logistics * revenueShare
      : manualLogistics > 0
        ? manualLogistics
        : historicalLogistics`,
  'historical logistics fallback',
)

replaceOnce(
`    const acquiring = financeAcquiringAvailable
      ? item.financeAcquiring + unallocatedFinance.acquiring * revenueShare
      : availability.acquiring
        ? item.detailAcquiring + unallocatedAcquiring * revenueShare
        : 0`,
`    const acquiring = financeAcquiringAvailable
      ? item.financeAcquiring + unallocatedFinance.acquiring * revenueShare
      : availability.acquiring
        ? item.detailAcquiring + unallocatedAcquiring * revenueShare
        : historicalAcquiring`,
  'historical acquiring fallback',
)

replaceOnce(
`  const logisticsSource = financeHasRows ? 'wb_api' : Number(settings.logisticsPerSale || 0) > 0 ? 'manual' : 'not_loaded'`,
`  const logisticsSource = financeHasRows
    ? 'wb_api'
    : Number(settings.logisticsPerSale || 0) > 0
      ? 'manual'
      : Number(settings.historicalLogisticsPercent || 0) > 0 ? 'historical_finance' : 'not_loaded'`,
  'historical logistics source',
)

replaceOnce(
`  const acquiringSource = financeAcquiringAvailable ? 'finance_report' : availability.acquiring ? 'acquiring_report' : 'not_loaded'`,
`  const acquiringSource = financeAcquiringAvailable
    ? 'finance_report'
    : availability.acquiring
      ? 'acquiring_report'
      : Number(settings.historicalAcquiringPercent || 0) > 0 ? 'historical_finance' : 'not_loaded'`,
  'historical acquiring source',
)

replaceOnce(
`      logisticsSource,
      storageSource,
      acceptanceSource,
      acquiringSource,
      profitProvisional:`,
`      logisticsSource,
      storageSource,
      acceptanceSource,
      acquiringSource,
      historicalFinanceFrom:settings.historicalFinanceFrom || null,
      historicalFinanceTo:settings.historicalFinanceTo || null,
      profitProvisional:`,
  'historical source period metadata',
)

replaceOnce(
`  const endpoint = \`https://seller-analytics-api.wildberries.ru/api/v1/analytics/goods-return?dateFrom=\${period.dateFrom}&dateTo=\${period.dateTo}\``,
`  const originalPeriod = { ...period }
  const periodRange = analyticsPeriodRange({ from:period.dateFrom,to:period.dateTo })
  const safePeriod = periodRange ? boundedSyncPeriod(periodRange,31) : period
  if (periodRange?.days > 31) {
    console.warn(\`Goods returns period clamped to WB 31-day window: \${period.dateFrom}..\${period.dateTo} -> \${safePeriod.dateFrom}..\${safePeriod.dateTo}\`)
  }
  period.dateFrom=safePeriod.dateFrom
  period.dateTo=safePeriod.dateTo
  period.days=safePeriod.days
  period.requestedFrom=originalPeriod.dateFrom
  period.requestedTo=originalPeriod.dateTo
  period.requestedDays=Number(originalPeriod.days || periodRange?.days || period.days)
  period.limited=period.requestedDays > 31
  const endpoint = \`https://seller-analytics-api.wildberries.ru/api/v1/analytics/goods-return?dateFrom=\${period.dateFrom}&dateTo=\${period.dateTo}\``,
  'goods returns 31-day window',
)

fs.writeFileSync(serverUrl, source)
console.log('ELISEI 5.19.5 historical finance fallback + goods returns window applied')
