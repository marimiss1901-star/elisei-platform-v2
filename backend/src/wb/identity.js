export function cleanText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
}

export function cleanNumericId(value) {
  const text = cleanText(value)
  if (!text) return ''
  const numeric = Number(text)
  return Number.isFinite(numeric) && numeric > 0 ? String(Math.trunc(numeric)) : ''
}

export function cleanBarcode(value) {
  return cleanText(value).replace(/\s+/g, '')
}

export function cleanVendorCode(value) {
  return cleanText(value).toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ')
}

export function cleanVendorLoose(value) {
  return cleanVendorCode(value).replace(/[\s._/\\-]+/g, '')
}

export function unique(values, cleaner = cleanText) {
  const seen = new Set()
  const result = []
  for (const value of Array.isArray(values) ? values : [values]) {
    const normalized = cleaner(value)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

export function productIdentities(row = {}) {
  const sizes = Array.isArray(row?.sizes) ? row.sizes : []
  const nmIDs = unique([
    row?.nmID, row?.nmId, row?.nm_id, row?.nm,
    ...(Array.isArray(row?.nmIDs) ? row.nmIDs : []),
    ...(Array.isArray(row?.nmIds) ? row.nmIds : []),
  ], cleanNumericId)
  const vendorCodes = unique([
    row?.vendorCode, row?.vendor_code, row?.supplierArticle, row?.supplier_article,
    row?.article, row?.sellerArticle, row?.seller_article,
    ...(Array.isArray(row?.vendorCodes) ? row.vendorCodes : []),
  ], cleanText)
  const barcodes = unique([
    row?.barcode, row?.barCode, row?.bar_code, row?.sku,
    ...(Array.isArray(row?.barcodes) ? row.barcodes : []),
    ...sizes.flatMap(size => [
      size?.sku, size?.barcode,
      ...(Array.isArray(size?.skus) ? size.skus : []),
      ...(Array.isArray(size?.barcodes) ? size.barcodes : []),
    ]),
  ], cleanBarcode)
  const chrtIDs = unique([
    row?.chrtID, row?.chrtId, row?.chrt_id,
    ...(Array.isArray(row?.chrtIDs) ? row.chrtIDs : []),
    ...(Array.isArray(row?.chrtIds) ? row.chrtIds : []),
    ...sizes.flatMap(size => [size?.chrtID, size?.chrtId, size?.chrt_id]),
  ], cleanNumericId)
  return { nmIDs, vendorCodes, barcodes, chrtIDs }
}

export function canonicalProductKey(row = {}) {
  const ids = productIdentities(row)
  if (ids.nmIDs[0]) return `nm:${ids.nmIDs[0]}`
  if (ids.vendorCodes[0]) return `vendor:${cleanVendorCode(ids.vendorCodes[0])}`
  if (ids.barcodes[0]) return `barcode:${ids.barcodes[0]}`
  return ''
}

function addIndex(map, key, productKey) {
  if (!key) return
  const current = map.get(key)
  if (!current) map.set(key, productKey)
  else if (current !== productKey) map.set(key, null)
}

export function buildCatalogIdentityIndex(products = []) {
  const byKey = new Map()
  const byNmID = new Map()
  const byBarcode = new Map()
  const byVendor = new Map()
  const byVendorLoose = new Map()
  const byChrtID = new Map()

  for (const product of Array.isArray(products) ? products : []) {
    const key = canonicalProductKey(product)
    if (!key) continue
    byKey.set(key, product)
    const ids = productIdentities(product)
    ids.nmIDs.forEach(value => addIndex(byNmID, value, key))
    ids.barcodes.forEach(value => addIndex(byBarcode, value, key))
    ids.vendorCodes.forEach(value => {
      addIndex(byVendor, cleanVendorCode(value), key)
      addIndex(byVendorLoose, cleanVendorLoose(value), key)
    })
    ids.chrtIDs.forEach(value => addIndex(byChrtID, value, key))
  }

  return { byKey, byNmID, byBarcode, byVendor, byVendorLoose, byChrtID }
}

function resolveUnique(map, values) {
  for (const value of values) {
    if (!value || !map.has(value)) continue
    const key = map.get(value)
    if (key) return key
  }
  return ''
}

export function matchCatalogProduct(index, row = {}, priority = ['barcode', 'nmID', 'vendorCode', 'chrtID']) {
  const ids = productIdentities(row)
  for (const method of priority) {
    let key = ''
    if (method === 'barcode') key = resolveUnique(index.byBarcode, ids.barcodes)
    if (method === 'nmID') key = resolveUnique(index.byNmID, ids.nmIDs)
    if (method === 'vendorCode') {
      key = resolveUnique(index.byVendor, ids.vendorCodes.map(cleanVendorCode))
      if (!key) key = resolveUnique(index.byVendorLoose, ids.vendorCodes.map(cleanVendorLoose))
    }
    if (method === 'chrtID') key = resolveUnique(index.byChrtID, ids.chrtIDs)
    if (key) return { key, product:index.byKey.get(key) || null, method }
  }
  return { key:'', product:null, method:null }
}

export function identityCounts(rows = []) {
  const nmIDs = new Set()
  const vendorCodes = new Set()
  const barcodes = new Set()
  const chrtIDs = new Set()
  for (const row of Array.isArray(rows) ? rows : []) {
    const ids = productIdentities(row)
    ids.nmIDs.forEach(value => nmIDs.add(value))
    ids.vendorCodes.forEach(value => vendorCodes.add(cleanVendorCode(value)))
    ids.barcodes.forEach(value => barcodes.add(value))
    ids.chrtIDs.forEach(value => chrtIDs.add(value))
  }
  return { nmIDs:nmIDs.size, vendorCodes:vendorCodes.size, barcodes:barcodes.size, chrtIDs:chrtIDs.size }
}
