import { cleanNumericId, cleanText, unique } from '../identity.js'

export function normalizeCatalogCard(card = {}) {
  const nmID = cleanNumericId(card?.nmID ?? card?.nmId)
  if (!nmID) return null
  const sizes = (Array.isArray(card?.sizes) ? card.sizes : []).map(size => ({
    chrtID: cleanNumericId(size?.chrtID ?? size?.chrtId),
    techSize: cleanText(size?.techSize ?? size?.sizeName),
    wbSize: cleanText(size?.wbSize),
    skus: unique(Array.isArray(size?.skus) ? size.skus : [size?.sku, size?.barcode]),
  }))
  const barcodes = unique(sizes.flatMap(size => size.skus))
  return {
    nmID,
    vendorCode: cleanText(card?.vendorCode),
    title: cleanText(card?.title || card?.subjectName) || 'Товар',
    brand: cleanText(card?.brand),
    subjectName: cleanText(card?.subjectName),
    photo: cleanText(card?.photos?.[0]?.big || card?.photos?.[0]?.square || card?.photos?.[0]?.c246x328),
    sizes,
    barcodes,
    chrtIds: unique(sizes.map(size => size.chrtID), cleanNumericId),
  }
}

export function normalizeCatalogPage(payload = {}) {
  const cards = Array.isArray(payload?.cards) ? payload.cards : []
  const products = cards.map(normalizeCatalogCard).filter(Boolean)
  const cursor = payload?.cursor && typeof payload.cursor === 'object' ? {
    updatedAt: cleanText(payload.cursor.updatedAt),
    nmID: cleanNumericId(payload.cursor.nmID ?? payload.cursor.nmId),
    total: Number(payload.cursor.total || 0),
  } : { updatedAt:'', nmID:'', total:0 }
  return { products, cursor, rawCount:cards.length }
}

export function validateCatalog(products = []) {
  const rows = Array.isArray(products) ? products : []
  const nmIDs = new Set()
  let barcodeCount = 0
  for (const product of rows) {
    if (!product?.nmID) throw new Error('Каталог WB содержит карточку без nmID')
    if (nmIDs.has(product.nmID)) throw new Error(`Каталог WB содержит повторный nmID ${product.nmID}`)
    nmIDs.add(product.nmID)
    barcodeCount += Array.isArray(product.barcodes) ? product.barcodes.length : 0
  }
  return { products:rows.length, nmIDs:nmIDs.size, barcodes:barcodeCount }
}
