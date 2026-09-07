import fs from 'node:fs'

// ELISEI 5.19.3 — product P&L cost truthfulness.
// A selected analytics period must use durable, date-addressable storage rows
// already persisted in wb_finance_ledger. Missing WB finance detail is unknown,
// not a confirmed zero: keep reserve calculations internal, but expose null for
// unavailable logistics/acquiring/storage and mark product profit provisional.

const serverUrl = new URL('./src/server.js', import.meta.url)
let source = fs.readFileSync(serverUrl, 'utf8')

function replaceOnce(before, after, label) {
  if (source.includes(after)) return
  if (!source.includes(before)) throw new Error(`ELISEI 5.19.3 could not find ${label} marker in server.js`)
  source = source.replace(before, after)
}

replaceOnce(
`  const ledgerFinanceRows = range
    ? await queryFinanceCoreRows(pool,{ connectionId:connection.id,from:range.from,to:range.to })
    : []
  const ledgerFinanceSummary = summarizeFinanceCoreRows(ledgerFinanceRows)
  const periodData = ledgerFinanceRows.length`,
`  const ledgerFinanceRows = range
    ? await queryFinanceCoreRows(pool,{ connectionId:connection.id,from:range.from,to:range.to })
    : []
  const ledgerStorageRows = range
    ? (await pool.query(\`
        SELECT operation_date::text AS date,
          NULLIF(nm_id,'') AS "nmID",
          NULLIF(vendor_code,'') AS "vendorCode",
          NULLIF(barcode,'') AS barcode,
          NULLIF(warehouse,'') AS warehouse,
          ABS(amount)::float8 AS "warehousePrice"
        FROM wb_finance_ledger
        WHERE connection_id=$1
          AND source_stream='paidStorage'
          AND operation_group='storage'
          AND operation_date >= $2::date AND operation_date <= $3::date
        ORDER BY operation_date,nm_id,vendor_code
      \`,[connection.id,range.from,range.to])).rows
    : []
  const ledgerFinanceSummary = summarizeFinanceCoreRows(ledgerFinanceRows)
  const financePeriodData = ledgerFinanceRows.length`,
  'durable selected-period storage query',
)

replaceOnce(
`    : data
  const selectedData = analyticsFilterConnectionData(periodData, range)`,
`    : data
  const periodData = ledgerStorageRows.length
    ? { ...financePeriodData, paidStorage:ledgerStorageRows }
    : financePeriodData
  const selectedData = analyticsFilterConnectionData(periodData, range)`,
  'period data merge',
)

replaceOnce(
`      finance:{ ...analyticsAvailableRange(rawData?.finance?.rows,financeKeys),selectedRows:financeRows.length },
      advertising:{`,
`      finance:{ ...analyticsAvailableRange(rawData?.finance?.rows,financeKeys),selectedRows:financeRows.length },
      paidStorage:{ ...analyticsAvailableRange(rawData.paidStorage,storageKeys),selectedRows:paidStorage.length },
      acceptance:{ ...analyticsAvailableRange(rawData.acceptance,acceptanceKeys),selectedRows:acceptance.length },
      acquiring:{ ...analyticsAvailableRange(rawData?.acquiring?.rows,acquiringKeys),selectedRows:acquiringRows.length },
      advertising:{`,
  'dedicated cost period coverage',
)

replaceOnce(
`    paidStorage: streamDataAvailable(stageStatus, 'paidStorage', paidStorageRows.length),
    acceptance: streamDataAvailable(stageStatus, 'acceptance', acceptanceRows.length),
    acquiring: streamDataAvailable(stageStatus, 'acquiring', acquiringRows.length),`,
`    paidStorage: data?.__periodFiltered ? (periodCoverageConfirms('paidStorage') || paidStorageRows.length > 0) : streamDataAvailable(stageStatus, 'paidStorage', paidStorageRows.length),
    acceptance: data?.__periodFiltered ? (periodCoverageConfirms('acceptance') || acceptanceRows.length > 0) : streamDataAvailable(stageStatus, 'acceptance', acceptanceRows.length),
    acquiring: data?.__periodFiltered ? (periodCoverageConfirms('acquiring') || acquiringRows.length > 0) : streamDataAvailable(stageStatus, 'acquiring', acquiringRows.length),`,
  'period-aware dedicated availability',
)

replaceOnce(
`  const storageSource = financeStorageAvailable ? 'finance_report' : availability.paidStorage ? 'paid_storage_report' : 'manual'
  const acceptanceSource = financeAcceptanceAvailable ? 'finance_report' : availability.acceptance ? 'acceptance_report' : 'not_loaded'
  const acquiringSource = financeAcquiringAvailable ? 'finance_report' : availability.acquiring ? 'acquiring_report' : 'not_loaded'`,
`  const logisticsSource = financeHasRows ? 'wb_api' : Number(settings.logisticsPerSale || 0) > 0 ? 'manual' : 'not_loaded'
  const storageSource = financeStorageAvailable
    ? 'finance_report'
    : availability.paidStorage
      ? (data?.__periodFiltered && !periodCoverageConfirms('paidStorage') ? 'paid_storage_report_partial' : 'paid_storage_report')
      : Number(settings.storageMonthly || 0) > 0 ? 'manual' : 'not_loaded'
  const acceptanceSource = financeAcceptanceAvailable ? 'finance_report' : availability.acceptance ? 'acceptance_report' : 'not_loaded'
  const acquiringSource = financeAcquiringAvailable ? 'finance_report' : availability.acquiring ? 'acquiring_report' : 'not_loaded'`,
  'truthful product cost sources',
)

replaceOnce(
`      commission: Math.round(commission),
      logistics: Math.round(logistics),
      storage: Math.round(storage),
      acceptance: Math.round(acceptance),
      acquiring: Math.round(acquiring),`,
`      commission: Math.round(commission),
      logistics: logisticsSource === 'not_loaded' ? null : Math.round(logistics),
      storage: storageSource === 'not_loaded' ? null : Math.round(storage),
      acceptance: acceptanceSource === 'not_loaded' ? null : Math.round(acceptance),
      acquiring: acquiringSource === 'not_loaded' ? null : Math.round(acquiring),`,
  'product cost values',
)

replaceOnce(
`      financeSource:financeHasRows ? 'wb_finance_api' : 'manual_fallback',
      storageSource,
      acceptanceSource,
      acquiringSource,`,
`      financeSource:financeHasRows ? 'wb_finance_api' : 'manual_fallback',
      logisticsSource,
      storageSource,
      acceptanceSource,
      acquiringSource,
      profitProvisional: financeHasRows !== true || logisticsSource !== 'wb_api' || acquiringSource === 'not_loaded' || storageSource === 'not_loaded' || storageSource === 'paid_storage_report_partial',`,
  'product cost source metadata',
)

replaceOnce(
`      commission: Math.round(totals.commission),
      commissionSource: financeHasRows ? 'wb_api' : 'manual',
      logistics: Math.round(totals.logistics),
      logisticsSource: financeHasRows ? 'wb_api' : 'manual',
      advertising: Math.round(totals.advertising),
      advertisingSource: availability.advertising && advertisingStatsAvailable ? 'wb_api' : 'manual',
      storage: Math.round(totals.storage),`,
`      commission: Math.round(totals.commission),
      commissionSource: financeHasRows ? 'wb_api' : 'manual',
      logistics: logisticsSource === 'not_loaded' ? null : Math.round(totals.logistics),
      logisticsSource,
      advertising: Math.round(totals.advertising),
      advertisingSource: availability.advertising && advertisingStatsAvailable ? 'wb_api' : 'manual',
      storage: storageSource === 'not_loaded' ? null : Math.round(totals.storage),`,
  'summary logistics and storage truthfulness',
)

replaceOnce(
`      acquiring: Math.round(totals.acquiring),
      acquiringSource,`,
`      acquiring: acquiringSource === 'not_loaded' ? null : Math.round(totals.acquiring),
      acquiringSource,`,
  'summary acquiring truthfulness',
)

fs.writeFileSync(serverUrl, source)
console.log('ELISEI 5.19.3 product P&L cost truthfulness applied')
