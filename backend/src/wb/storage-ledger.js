const num = value => Number.isFinite(Number(value)) ? Number(value) : 0
const round2 = value => Math.round(num(value) * 100) / 100
const norm = value => String(value ?? '').trim().toLowerCase()
const nmKey = value => String(value ?? '').trim()

export async function queryPaidStorageBreakdown(pool, { connectionId, from, to } = {}) {
  if (!pool || !connectionId || !from || !to) return []
  const result = await pool.query(`
    SELECT
      COALESCE(NULLIF(nm_id,''),'') AS "nmId",
      COALESCE(NULLIF(vendor_code,''),'') AS "vendorCode",
      COALESCE(NULLIF(warehouse,''),'Склад WB РФ') AS warehouse,
      COUNT(DISTINCT operation_date)::int AS days,
      ROUND(SUM(ABS(amount))::numeric,2)::float8 AS amount,
      MIN(operation_date)::text AS "dateFrom",
      MAX(operation_date)::text AS "dateTo",
      BOOL_OR(
        COALESCE(NULLIF(warehouse,''),'Склад WB РФ')='Склад WB РФ'
        OR COALESCE(source_payload->>'officeId','') IN ('','0')
      ) AS "warehouseAggregated"
    FROM wb_finance_ledger
    WHERE connection_id=$1
      AND source_stream='paidStorage'
      AND operation_group='storage'
      AND metric_role='detail'
      AND operation_date BETWEEN $2::date AND $3::date
    GROUP BY
      COALESCE(NULLIF(nm_id,''),''),
      COALESCE(NULLIF(vendor_code,''),''),
      COALESCE(NULLIF(warehouse,''),'Склад WB РФ')
    ORDER BY amount DESC
  `,[connectionId,from,to])
  return result.rows.map(row => ({
    nmId:nmKey(row.nmId),
    vendorCode:String(row.vendorCode || '').trim(),
    warehouse:String(row.warehouse || 'Склад WB РФ').trim() || 'Склад WB РФ',
    days:Math.max(0,Number(row.days || 0)),
    amount:round2(row.amount),
    rubPerDay:row.days ? round2(num(row.amount) / Number(row.days)) : 0,
    dateFrom:String(row.dateFrom || '').slice(0,10) || null,
    dateTo:String(row.dateTo || '').slice(0,10) || null,
    warehouseAggregated:Boolean(row.warehouseAggregated),
  }))
}

function productIdentity(product = {}) {
  return {
    nmId:nmKey(product.nmID ?? product.nmId ?? product.nm_id),
    vendorCode:norm(product.vendorCode ?? product.vendor_code ?? product.article ?? product.supplierArticle),
  }
}

export function applyPaidStorageBreakdown(core, rows = []) {
  if (!core || !Array.isArray(core.products)) return core
  const safeRows = Array.isArray(rows) ? rows.filter(row => num(row.amount) > 0) : []
  const byNm = new Map()
  const byVendor = new Map()
  for (const row of safeRows) {
    const nm = nmKey(row.nmId)
    const vendor = norm(row.vendorCode)
    if (nm) {
      const list = byNm.get(nm) || []
      list.push(row)
      byNm.set(nm,list)
    }
    if (vendor) {
      const list = byVendor.get(vendor) || []
      list.push(row)
      byVendor.set(vendor,list)
    }
  }

  const enriched = []
  let previousStorageTotal = 0
  let actualStorageTotal = 0

  for (const product of core.products) {
    const identity = productIdentity(product)
    const matched = identity.nmId && byNm.has(identity.nmId)
      ? byNm.get(identity.nmId)
      : identity.vendorCode && byVendor.has(identity.vendorCode)
        ? byVendor.get(identity.vendorCode)
        : []
    const previousStorage = Math.max(0,num(product.storage))
    const actualStorage = round2(matched.reduce((sum,row) => sum + num(row.amount),0))
    previousStorageTotal += previousStorage

    // Replace product storage only where WB actually supplied detail for the SKU.
    // Missing rows remain at their previous value to avoid converting incomplete
    // paid-storage coverage into a false zero.
    if (matched.length) {
      const delta = actualStorage - previousStorage
      product.storage = actualStorage
      product.detailStorage = actualStorage
      product.storageSource = 'paid_storage_ledger'
      product.expenses = round2(num(product.expenses) + delta)
      if (product.profit != null) product.profit = round2(num(product.profit) - delta)
      if (num(product.revenue) > 0 && product.profit != null) product.margin = round2(num(product.profit) / num(product.revenue) * 100)
    }
    actualStorageTotal += matched.length ? actualStorage : previousStorage

    for (const row of matched) {
      enriched.push({
        ...row,
        title:String(product.title || product.vendorCode || row.vendorCode || (row.nmId ? `nmID ${row.nmId}` : 'Товар WB')),
        vendorCode:String(product.vendorCode || row.vendorCode || '').trim(),
        nmId:identity.nmId || nmKey(row.nmId),
        revenue:round2(product.revenue),
        shareOfRevenue:num(product.revenue) > 0 ? round2(num(row.amount) / num(product.revenue) * 100) : null,
      })
    }
  }

  core.storageBreakdown = enriched.sort((a,b) => num(b.amount) - num(a.amount))
  core.storageBreakdownSummary = {
    rows:core.storageBreakdown.length,
    total:round2(core.storageBreakdown.reduce((sum,row) => sum + num(row.amount),0)),
    warehouses:new Set(core.storageBreakdown.map(row => row.warehouse)).size,
    products:new Set(core.storageBreakdown.map(row => row.nmId || row.vendorCode).filter(Boolean)).size,
    source:'wb_paid_storage_ledger',
  }

  const summary = core.summary && typeof core.summary === 'object' ? core.summary : null
  if (summary && safeRows.length) {
    const previousSummaryStorage = Math.max(0,num(summary.storage))
    const correctedStorage = round2(actualStorageTotal)
    const delta = correctedStorage - previousSummaryStorage
    summary.storage = correctedStorage
    summary.storageSource = 'paid_storage_ledger'
    if (summary.operatingProfit != null) summary.operatingProfit = round2(num(summary.operatingProfit) - delta)
    if (num(summary.revenue) > 0 && summary.operatingProfit != null) summary.margin = round2(num(summary.operatingProfit) / num(summary.revenue) * 100)
  }

  return core
}
