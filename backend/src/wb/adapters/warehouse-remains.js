import {
  buildCatalogIdentityIndex,
  cleanBarcode,
  cleanNumericId,
  cleanText,
  cleanVendorCode,
  identityCounts,
  matchCatalogProduct,
} from '../identity.js'

const AGGREGATE_NAMES = new Set(['всего находится на складах', 'итого', 'всего'])

function arrayPayload(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload?.result)) return payload.result
  if (Array.isArray(payload?.items)) return payload.items
  if (Array.isArray(payload?.rows)) return payload.rows
  return []
}

function quantity(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

function isTransit(name) {
  const normalized = cleanText(name).toLocaleLowerCase('ru-RU')
  return normalized.includes('в пути') || normalized.includes('к получател') || normalized.includes('от клиентов')
}

function warehouseName(row = {}) {
  return cleanText(row?.warehouseName ?? row?.warehouse_name ?? row?.warehouse ?? row?.officeName ?? row?.name) || 'Все склады'
}

export function normalizeWarehouseRemains(payload) {
  const productRows = arrayPayload(payload)
  const rows = []

  for (const item of productRows) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const identity = {
      nmId: cleanNumericId(item?.nmId ?? item?.nmID),
      vendorCode: cleanText(item?.vendorCode ?? item?.supplierArticle),
      barcode: cleanBarcode(item?.barcode ?? item?.barCode),
      techSize: cleanText(item?.techSize),
      brand: cleanText(item?.brand),
      subjectName: cleanText(item?.subjectName),
    }
    const warehouses = Array.isArray(item?.warehouses) ? item.warehouses : []
    const physical = warehouses.filter(warehouse => {
      const name = warehouseName(warehouse).toLocaleLowerCase('ru-RU')
      return !AGGREGATE_NAMES.has(name) && !isTransit(name)
    })
    const aggregates = warehouses.filter(warehouse => AGGREGATE_NAMES.has(warehouseName(warehouse).toLocaleLowerCase('ru-RU')))
    const source = physical.length ? physical : aggregates.length ? aggregates : warehouses

    if (source.length) {
      for (const warehouse of source) {
        rows.push({
          ...identity,
          warehouseName:warehouseName(warehouse),
          quantity:quantity(warehouse?.quantity),
        })
      }
    } else {
      rows.push({
        ...identity,
        warehouseName:warehouseName(item),
        quantity:quantity(item?.quantity),
      })
    }
  }

  const meta = buildWarehouseMeta(rows, { sourceRows:productRows.length })
  validateWarehouseRemains(rows, meta)
  return { rows, meta, sourceRows:productRows.length }
}

export function buildWarehouseMeta(rows = [], extra = {}) {
  const safeRows = Array.isArray(rows) ? rows : []
  const counts = identityCounts(safeRows)
  const totalQuantity = safeRows.reduce((sum, row) => sum + quantity(row?.quantity), 0)
  const warehouses = new Set(safeRows.map(row => cleanText(row?.warehouseName)).filter(Boolean))
  return {
    schemaVersion:5,
    source:'wb_warehouse_remains',
    rows:safeRows.length,
    totalQuantity:Math.round(totalQuantity),
    nonZeroRows:safeRows.filter(row => quantity(row?.quantity) > 0).length,
    warehouses:warehouses.size,
    identityCounts:counts,
    receivedAt:new Date().toISOString(),
    ...extra,
  }
}

export function validateWarehouseRemains(rows = [], meta = buildWarehouseMeta(rows)) {
  const total = Number(meta?.totalQuantity || 0)
  const counts = meta?.identityCounts || identityCounts(rows)
  if (total > 0 && counts.nmIDs === 0 && counts.barcodes === 0 && counts.vendorCodes === 0) {
    throw Object.assign(new Error('WB вернул остаток, но в строках отчёта отсутствуют nmId, barcode и vendorCode. Снимок отклонён до сохранения.'), {
      code:'WB_STOCK_IDENTITIES_MISSING',
      status:502,
      details:{ totalQuantity:total, identityCounts:counts },
    })
  }
  return { totalQuantity:total, identityCounts:counts }
}

export function reconcileWarehouseRemains(catalog = [], stockRows = []) {
  const index = buildCatalogIdentityIndex(catalog)
  const byProduct = new Map()
  const unmatched = []
  const methods = { barcode:0, nmID:0, vendorCode:0, chrtID:0 }
  let sourceQuantity = 0
  let matchedQuantity = 0

  for (const row of Array.isArray(stockRows) ? stockRows : []) {
    const rowQuantity = quantity(row?.quantity)
    sourceQuantity += rowQuantity
    const match = matchCatalogProduct(index, row, ['barcode', 'nmID', 'vendorCode', 'chrtID'])
    if (!match.product) {
      unmatched.push({ ...row, quantity:rowQuantity })
      continue
    }
    const current = byProduct.get(match.key) || {
      productKey:match.key,
      nmID:match.product.nmID,
      vendorCode:match.product.vendorCode,
      title:match.product.title,
      totalQuantity:0,
      warehouses:{},
      barcodes:{},
      matchMethods:{ barcode:0, nmID:0, vendorCode:0, chrtID:0 },
    }
    current.totalQuantity += rowQuantity
    current.warehouses[row.warehouseName || 'Все склады'] = (current.warehouses[row.warehouseName || 'Все склады'] || 0) + rowQuantity
    if (row.barcode) current.barcodes[row.barcode] = (current.barcodes[row.barcode] || 0) + rowQuantity
    current.matchMethods[match.method] += 1
    methods[match.method] += 1
    matchedQuantity += rowQuantity
    byProduct.set(match.key, current)
  }

  const unmatchedQuantity = unmatched.reduce((sum, row) => sum + quantity(row.quantity), 0)
  if (Math.round(matchedQuantity + unmatchedQuantity) !== Math.round(sourceQuantity)) {
    throw new Error(`Проверка распределения остатков не пройдена: ${matchedQuantity} + ${unmatchedQuantity} != ${sourceQuantity}`)
  }

  return {
    products:[...byProduct.values()].map(item => ({
      ...item,
      totalQuantity:Math.round(item.totalQuantity),
      warehouses:Object.entries(item.warehouses).map(([name, value]) => ({ name, quantity:Math.round(value) })).sort((a,b) => b.quantity-a.quantity),
      barcodes:Object.entries(item.barcodes).map(([barcode, value]) => ({ barcode, quantity:Math.round(value) })).sort((a,b) => b.quantity-a.quantity),
    })),
    unmatched,
    diagnostics:{
      sourceRows:Array.isArray(stockRows) ? stockRows.length : 0,
      sourceQuantity:Math.round(sourceQuantity),
      matchedRows:(Array.isArray(stockRows) ? stockRows.length : 0) - unmatched.length,
      matchedQuantity:Math.round(matchedQuantity),
      unmatchedRows:unmatched.length,
      unmatchedQuantity:Math.round(unmatchedQuantity),
      methods,
      catalogIdentities:identityCounts(catalog),
      reportIdentities:identityCounts(stockRows),
      reconciledAt:new Date().toISOString(),
    },
  }
}

export function applyStockAllocation(catalog = [], allocation = {}) {
  const byNmID = new Map((allocation?.products || []).map(item => [String(item.nmID || ''), item]))
  return (Array.isArray(catalog) ? catalog : []).map(product => {
    const stock = byNmID.get(String(product?.nmID || ''))
    return {
      ...product,
      stock:stock ? stock.totalQuantity : 0,
      stockByWarehouse:stock?.warehouses || [],
      stockByBarcode:stock?.barcodes || [],
      stockMapped:Boolean(stock),
    }
  })
}
