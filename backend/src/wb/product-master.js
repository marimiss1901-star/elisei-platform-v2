import { buildCatalogIdentityIndex, canonicalProductKey, matchCatalogProduct, productIdentities } from './identity.js'

function finite(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

export function buildProductMaster({ catalog = [], stockAllocation = null, advertising = null } = {}) {
  const stockByNmID = new Map((stockAllocation?.products || []).map(item => [String(item.nmID || ''), item]))
  const index = buildCatalogIdentityIndex(catalog)
  const adByProduct = new Map()

  for (const campaign of Array.isArray(advertising?.campaigns) ? advertising.campaigns : []) {
    if (campaign?.statsStatus !== 'loaded') continue
    for (const stat of Array.isArray(campaign?.nmStats) ? campaign.nmStats : []) {
      const match = matchCatalogProduct(index, { nmID:stat.nmID }, ['nmID'])
      if (!match.product) continue
      const current = adByProduct.get(match.key) || { spend:0, views:0, clicks:0, orders:0, revenue:0, campaigns:[] }
      current.spend += finite(stat.spend)
      current.views += finite(stat.views)
      current.clicks += finite(stat.clicks)
      current.orders += finite(stat.orders)
      current.revenue += finite(stat.revenue)
      current.campaigns.push({ advertId:campaign.advertId, name:campaign.name, status:campaign.status })
      adByProduct.set(match.key, current)
    }
  }

  return (Array.isArray(catalog) ? catalog : []).map(product => {
    const key = canonicalProductKey(product)
    const identities = productIdentities(product)
    const stock = stockByNmID.get(String(product?.nmID || ''))
    const ads = adByProduct.get(key)
    return {
      ...product,
      productKey:key,
      nmID:identities.nmIDs[0] || product.nmID || null,
      vendorCode:identities.vendorCodes[0] || product.vendorCode || '',
      barcodes:identities.barcodes,
      barcode:identities.barcodes[0] || '',
      stock:stock ? stock.totalQuantity : null,
      stockByWarehouse:stock?.warehouses || [],
      stockByBarcode:stock?.barcodes || [],
      stockMapped:Boolean(stock),
      advertising:ads ? {
        ...ads,
        ctr:ads.views > 0 ? ads.clicks / ads.views * 100 : null,
        crr:ads.revenue > 0 ? ads.spend / ads.revenue * 100 : null,
      } : null,
    }
  })
}
