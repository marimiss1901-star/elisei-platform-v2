import { cleanBarcode, cleanNumericId, cleanVendorCode, cleanVendorLoose, productIdentities } from './identity.js'

const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0
const nullable = value => Number.isFinite(Number(value)) ? Number(value) : null
const text = value => String(value ?? '').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g,'').trim()
const dateKey = value => {
  if (!value) return ''
  const raw = String(value)
  const iso = raw.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
  if (iso) return iso
  const numeric = Number(raw)
  if (Number.isFinite(numeric) && numeric > 1e9) {
    const date = new Date(numeric > 1e12 ? numeric : numeric * 1000)
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0,10)
  }
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0,10)
}

function nestedProduct(row = {}) {
  const details = row?.productDetails || row?.product || row?.details || row?.nm || {}
  return {
    ...details,
    ...row,
    nmID: row?.nmID ?? row?.nmId ?? row?.nm_id ?? details?.nmID ?? details?.nmId ?? details?.nm_id,
    vendorCode: row?.vendorCode ?? row?.supplierArticle ?? row?.supplier_article ?? details?.vendorCode ?? details?.supplierArticle ?? details?.supplier_article,
    barcode: row?.barcode ?? row?.barCode ?? row?.sku ?? details?.barcode ?? details?.barCode ?? details?.sku,
  }
}

export function product360Identities(row = {}) {
  const merged = nestedProduct(row)
  const ids = productIdentities(merged)
  return {
    nmIDs: ids.nmIDs,
    vendorCodes: ids.vendorCodes,
    barcodes: ids.barcodes,
    chrtIDs: ids.chrtIDs,
  }
}

export function product360Matches(row = {}, product = {}) {
  const wanted = product360Identities(product)
  const actual = product360Identities(row)
  if (wanted.nmIDs.length && actual.nmIDs.some(value => wanted.nmIDs.includes(value))) return { matched:true, method:'nmID' }

  const wantedBarcodes = new Set(wanted.barcodes.map(cleanBarcode).filter(Boolean))
  if (wantedBarcodes.size && actual.barcodes.some(value => wantedBarcodes.has(cleanBarcode(value)))) return { matched:true, method:'barcode' }

  const wantedVendors = new Set(wanted.vendorCodes.flatMap(value => [cleanVendorCode(value),cleanVendorLoose(value)]).filter(Boolean))
  if (wantedVendors.size && actual.vendorCodes.some(value => wantedVendors.has(cleanVendorCode(value)) || wantedVendors.has(cleanVendorLoose(value)))) return { matched:true, method:'vendorCode' }

  const wantedChrts = new Set(wanted.chrtIDs.map(cleanNumericId).filter(Boolean))
  if (wantedChrts.size && actual.chrtIDs.some(value => wantedChrts.has(cleanNumericId(value)))) return { matched:true, method:'chrtID' }
  return { matched:false, method:null }
}

export function findProduct360Product(products = [], selector = '') {
  const raw = text(selector)
  if (!raw) return null
  const cleanRawVendor = cleanVendorCode(raw)
  const cleanRawLoose = cleanVendorLoose(raw)
  const cleanRawNumeric = cleanNumericId(raw.replace(/^nm:/i,''))
  const rawKey = raw.toLowerCase()

  for (const product of Array.isArray(products) ? products : []) {
    if (String(product?.key || '').toLowerCase() === rawKey) return product
    if (String(product?.id || '').toLowerCase() === rawKey) return product
    if (cleanRawNumeric && product360Identities(product).nmIDs.includes(cleanRawNumeric)) return product
    const vendors = product360Identities(product).vendorCodes
    if (vendors.some(value => cleanVendorCode(value) === cleanRawVendor || cleanVendorLoose(value) === cleanRawLoose)) return product
    if (product360Identities(product).barcodes.some(value => cleanBarcode(value) === cleanBarcode(raw))) return product
  }
  return null
}

function pick(row = {}, keys = [], fallback = null) {
  for (const key of keys) {
    const value = String(key).split('.').reduce((current,part)=>current?.[part],row)
    if (value !== undefined && value !== null && String(value).trim() !== '') return value
  }
  return fallback
}

function feedbackText(row = {}) {
  const parts = [
    pick(row,['text','feedbackText','question','message.text','message']),
    pick(row,['pros','advantages']),
    pick(row,['cons','disadvantages']),
  ].map(text).filter(Boolean)
  return [...new Set(parts)].join(' · ')
}

function reviewRating(row = {}) {
  const value = pick(row,['productValuation','valuation','rating','stars'])
  const number = nullable(value)
  return number == null ? null : Math.max(0,Math.min(5,number))
}

function isAnswered(row = {}) {
  const value = pick(row,['isAnswered','answered','answer.state'])
  if (typeof value === 'boolean') return value
  return /^(?:1|true|yes|answered)$/i.test(String(value || '')) || Boolean(row?.answer?.text || row?.answerText)
}

function normalizeReview(row = {}) {
  const product = nestedProduct(row)
  return {
    id:String(row?.id ?? row?.feedbackId ?? row?.feedbackID ?? row?.rowKey ?? ''),
    createdAt:pick(row,['createdDate','createdAt','date','updatedDate','updatedAt']),
    rating:reviewRating(row),
    text:feedbackText(row),
    answered:isAnswered(row),
    archived:Boolean(row?.archived),
    nmID:product?.nmID ?? null,
    vendorCode:product?.vendorCode || '',
  }
}

function normalizeQuestion(row = {}) {
  const product = nestedProduct(row)
  return {
    id:String(row?.id ?? row?.questionId ?? row?.questionID ?? row?.rowKey ?? ''),
    createdAt:pick(row,['createdDate','createdAt','date','updatedDate','updatedAt']),
    text:feedbackText(row) || text(pick(row,['questionText','question'])),
    answered:isAnswered(row),
    archived:Boolean(row?.archived),
    nmID:product?.nmID ?? null,
    vendorCode:product?.vendorCode || '',
  }
}

function normalizeSearch(row = {}) {
  const product = nestedProduct(row)
  const phrase = text(pick(row,['searchText','searchQuery','query','keyword','text','name']))
  return {
    id:String(row?.rowKey || `${product?.nmID || product?.vendorCode || 'q'}:${phrase}`),
    rowType:row?.rowType || 'query',
    phrase,
    nmID:product?.nmID ?? null,
    vendorCode:product?.vendorCode || '',
    frequency:nullable(pick(row,['frequency','requestCount','searchCount','count'])),
    avgPosition:nullable(pick(row,['avgPosition','averagePosition','position'])),
    openCard:nullable(pick(row,['openCard','openCardCount','views'])),
    addToCart:nullable(pick(row,['addToCart','addToCartCount','cart'])),
    orders:nullable(pick(row,['orders','orderCount'])),
    revenue:nullable(pick(row,['orderSum','revenue','sum'])),
  }
}

function normalizeStockHistory(row = {}) {
  const product = nestedProduct(row)
  return {
    date:dateKey(pick(row,['date','dt','reportDate'])),
    warehouse:text(pick(row,['warehouse','warehouseName','officeName'],'Все склады')) || 'Все склады',
    quantity:Math.max(0,finite(pick(row,['quantity','stockCount','stocks','stock']))),
    techSize:text(pick(row,['techSize','sizeName','size'])),
    barcode:text(pick(row,['barcode','sku'])),
    nmID:product?.nmID ?? null,
    vendorCode:product?.vendorCode || '',
  }
}

function groupStockHistory(rows = []) {
  const byDate = new Map()
  const latestWarehouse = new Map()
  for (const row of rows) {
    if (row.date) byDate.set(row.date,(byDate.get(row.date)||0)+row.quantity)
    const key = `${row.warehouse}|${row.techSize}|${row.barcode}`
    const current = latestWarehouse.get(key)
    if (!current || String(row.date) > String(current.date)) latestWarehouse.set(key,row)
  }
  return {
    daily:[...byDate.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([date,quantity])=>({date,quantity:Math.round(quantity)})),
    latest:[...latestWarehouse.values()].sort((a,b)=>b.quantity-a.quantity),
  }
}

function summarizeAdvertising(rows = []) {
  const totals = rows.reduce((acc,row)=>{
    acc.spend += finite(row?.spend)
    acc.views += finite(row?.views)
    acc.clicks += finite(row?.clicks)
    acc.orders += finite(row?.orders)
    acc.revenue += finite(row?.revenue)
    return acc
  },{spend:0,views:0,clicks:0,orders:0,revenue:0})
  return {
    ...totals,
    ctr:totals.views>0 ? totals.clicks/totals.views*100 : null,
    cpc:totals.clicks>0 ? totals.spend/totals.clicks : null,
    crr:totals.revenue>0 ? totals.spend/totals.revenue*100 : null,
    romi:totals.spend>0 ? (totals.revenue-totals.spend)/totals.spend*100 : null,
  }
}

function buildSignals(product = {}, reviewSummary = {}, searchSummary = {}, adSummary = {}) {
  const signals = []
  const push = (priority,type,title,textValue,effect='') => signals.push({priority,type,title,text:textValue,effect})
  if (product?.profit != null && Number(product.profit) < 0) push(1,'economics','Товар убыточен',`Операционная прибыль за выбранный период: ${Math.round(product.profit)} ₽.`,product?.breakevenPrice ? `Цена в ноль ≈ ${Math.round(product.breakevenPrice)} ₽` : '')
  if (Number(product?.returnRate || 0) >= 20 && Number(product?.salesCount || 0) >= 3) push(1,'quality','Высокая доля возвратов',`${Number(product.returnRate).toFixed(1)}% возвратов при ${Math.round(product.salesCount || 0)} продажах.`,reviewSummary.lowRated ? `${reviewSummary.lowRated} низких отзывов в выборке` : '')
  if (product?.stock != null && Number(product.stock) <= 0 && Number(product?.salesCount || 0) > 0) push(1,'stock','Товар закончился',`За период было ${Math.round(product.salesCount || 0)} продаж, текущий подтверждённый остаток — 0.`,'Риск упущенных продаж')
  else if (product?.stockCoverDays != null && Number(product.stockCoverDays) < 14) push(2,'stock','Запас заканчивается',`Остатка примерно на ${Math.round(product.stockCoverDays)} дней.`,`${Math.round(product.stock || 0)} шт. сейчас`)
  if (adSummary.spend > 0 && adSummary.orders <= 0) push(2,'advertising','Реклама тратит без заказов',`Расход ${Math.round(adSummary.spend)} ₽, рекламных заказов в доступной статистике нет.`,'Проверить кампании и запросы')
  else if (adSummary.crr != null && adSummary.crr > 30) push(3,'advertising','Высокий ДРР',`ДРР по товару ≈ ${adSummary.crr.toFixed(1)}%.`,'Проверить ставки и запросы')
  if (reviewSummary.unanswered > 0) push(3,'quality','Есть отзывы без ответа',`${reviewSummary.unanswered} отзывов в выбранной выборке ждут ответа.`,'Закрыть коммуникации')
  if (searchSummary.topPosition != null && searchSummary.topPosition > 30 && searchSummary.orders > 0) push(4,'search','Есть спрос, но слабая позиция',`По запросам с заказами средняя лучшая видимая позиция около ${Math.round(searchSummary.topPosition)}.`,'Проверить SEO и рекламу')
  if (!signals.length) push(5,'ok','Критичных сигналов не найдено',product?.recommendation || 'Контролировать динамику и не менять настройки без причины.','')
  return signals.sort((a,b)=>a.priority-b.priority)
}

export function buildProduct360({
  product = {},
  advertisingRows = [],
  searchRows = [],
  reviewRows = [],
  questionRows = [],
  stockHistoryRows = [],
  stockDetails = [],
  financeMovements = [],
  period = null,
  coverage = {},
  sources = {},
} = {}) {
  const reviews = reviewRows.filter(row=>product360Matches(row,product).matched).map(normalizeReview)
  const questions = questionRows.filter(row=>product360Matches(row,product).matched).map(normalizeQuestion)
  const searches = searchRows
    .filter(row=>product360Matches(row,product).matched)
    .map(normalizeSearch)
    .filter(row=>row.rowType === 'query' || row.phrase)
    .sort((a,b)=>finite(b.orders)-finite(a.orders) || finite(b.revenue)-finite(a.revenue) || finite(b.frequency)-finite(a.frequency))
  const stockHistory = groupStockHistory(stockHistoryRows.filter(row=>product360Matches(row,product).matched).map(normalizeStockHistory))
  const ads = advertisingRows.filter(row=>product360Matches(row,product).matched)
  const adSummary = summarizeAdvertising(ads)
  const reviewRatings = reviews.map(row=>row.rating).filter(value=>value != null)
  const reviewSummary = {
    total:reviews.length,
    averageRating:reviewRatings.length ? reviewRatings.reduce((sum,value)=>sum+value,0)/reviewRatings.length : null,
    lowRated:reviews.filter(row=>row.rating != null && row.rating<=3).length,
    unanswered:reviews.filter(row=>!row.answered && !row.archived).length,
  }
  const questionSummary = {
    total:questions.length,
    unanswered:questions.filter(row=>!row.answered && !row.archived).length,
  }
  const searchSummary = {
    rows:searches.length,
    orders:searches.reduce((sum,row)=>sum+finite(row.orders),0),
    revenue:searches.reduce((sum,row)=>sum+finite(row.revenue),0),
    topPosition:searches.filter(row=>row.avgPosition!=null).length ? Math.min(...searches.filter(row=>row.avgPosition!=null).map(row=>Number(row.avgPosition))) : null,
  }
  const daily = []
  const dates = new Set([
    ...Object.keys(product?.dailyRevenue || {}),
    ...Object.keys(product?.dailySales || {}),
    ...Object.keys(product?.dailyReturns || {}),
    ...Object.keys(product?.dailyOrders || {}),
  ])
  for (const date of [...dates].sort()) daily.push({
    date,
    revenue:Math.round(finite(product?.dailyRevenue?.[date])),
    orders:Math.round(finite(product?.dailyOrders?.[date])),
    sales:Math.round(finite(product?.dailySales?.[date])),
    returns:Math.round(finite(product?.dailyReturns?.[date])),
  })

  const safeStockDetails = (Array.isArray(stockDetails) ? stockDetails : []).filter(row=>product360Matches(row,product).matched)
  const safeFinanceMovements = (Array.isArray(financeMovements) ? financeMovements : []).filter(row=>product360Matches(row,product).matched)
  const signals = buildSignals(product,reviewSummary,searchSummary,adSummary)
  return {
    generatedAt:new Date().toISOString(),
    period,
    product:{
      ...product,
      identifiers:product360Identities(product),
    },
    overview:{
      revenue:product?.revenue ?? null,
      profit:product?.profit ?? null,
      margin:product?.margin ?? null,
      orders:product?.ordersCount ?? null,
      sales:product?.salesCount ?? null,
      returns:product?.returnsCount ?? null,
      returnRate:product?.returnRate ?? null,
      stock:product?.stock ?? null,
      stockCoverDays:product?.stockCoverDays ?? null,
      advertising:product?.advertising ?? product?.adSpend ?? null,
      averagePrice:product?.averagePrice ?? null,
    },
    economics:{
      revenue:product?.revenue ?? null,
      sellerPayable:product?.sellerPayable ?? null,
      unitCost:product?.unitCost ?? null,
      cogs:product?.cogs ?? null,
      commission:product?.commission ?? null,
      logistics:product?.logistics ?? null,
      storage:product?.storage ?? null,
      acceptance:product?.acceptance ?? null,
      acquiring:product?.acquiring ?? null,
      penalties:product?.penalties ?? null,
      deductions:product?.deductions ?? null,
      additionalPayment:product?.additionalPayment ?? null,
      advertising:product?.advertising ?? null,
      tax:product?.tax ?? null,
      fixedExpenses:product?.fixedExpenses ?? null,
      expenses:product?.expenses ?? null,
      profit:product?.profit ?? null,
      margin:product?.margin ?? null,
      modeBreakdown:product?.modeBreakdown || null,
      financeMovements:safeFinanceMovements.slice(0,60),
    },
    pricing:{
      averagePrice:product?.averagePrice ?? null,
      breakevenPrice:product?.breakevenPrice ?? null,
      targetPrice:product?.targetPrice ?? null,
      peakPrice:product?.peakPrice ?? null,
      note:'Средняя цена рассчитана по продажам выбранного периода. Live-цена WB появится после отдельного потока цен.',
    },
    demand:{
      daily,
      advertising:{ rows:ads.slice(0,80),summary:adSummary },
      search:{ rows:searches.slice(0,80),summary:searchSummary },
    },
    quality:{
      reviews:reviews.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,80),
      questions:questions.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,80),
      reviewSummary,
      questionSummary,
      lowRatedTexts:reviews.filter(row=>row.rating!=null && row.rating<=3 && row.text).slice(0,8).map(row=>row.text),
    },
    stock:{
      current:safeStockDetails.slice(0,300),
      history:stockHistory,
      fulfillmentMode:product?.fulfillmentMode || null,
      fbsStock:product?.fbsStock ?? null,
      fboStock:product?.fboStock ?? null,
    },
    signals,
    coverage,
    sources,
    matchingPolicy:'nmID → barcode → vendorCode → chrtID. Название товара не используется как ключ, чтобы не смешивать SKU.',
  }
}
