import { cleanBarcode, cleanNumericId, cleanVendorCode, cleanVendorLoose, productIdentities } from './identity.js'

const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0
const nullable = value => Number.isFinite(Number(value)) ? Number(value) : null
const text = value => String(value ?? '').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g,'').trim()
const WAITING_STATUSES = new Set(['queued','pending','rate_limited','running','retry_scheduled'])
export const SEARCH_BINDING_VERSION = 3
const SEARCH_ORIGIN = 'organic_product_search_texts'

function syncReadiness(state = null, coreAvailable = false) {
  const status = String(state?.status || '').toLowerCase()
  if (status === 'success') return 'ready'
  if (coreAvailable && state?.lastSuccessAt) return 'ready'
  if (coreAvailable && (Number(state?.lastCount || 0) > 0 || WAITING_STATUSES.has(status))) return 'partial'
  if (coreAvailable) return 'ready'
  if (WAITING_STATUSES.has(status)) return 'waiting'
  return 'missing'
}

function extendedReadiness(state = null) {
  const status = String(state?.status || '').toLowerCase()
  // Core SKU 360 may intentionally use only the compact persisted sample.
  // Even if the WB stage itself is complete, a sample is not enough to prove a per-SKU zero.
  if (state?.partial || state?.sampleOnly || state?.truncated) return 'partial'
  if (status === 'success' || state?.lastSuccessAt) return 'ready'
  if (Number(state?.rows || 0) > 0) return 'partial'
  if (WAITING_STATUSES.has(status)) return 'waiting'
  return 'missing'
}

function combinedStockReadiness(coverage = {}) {
  const core = coverage?.core || {}
  const stages = coverage?.stages || {}
  const fbs = syncReadiness(stages.sellerStocks, Boolean(core.sellerStocks))
  const fbo = syncReadiness(stages.stocks, Boolean(core.fboStocks))
  const ready = [fbs,fbo].filter(value=>value === 'ready').length
  const partial = [fbs,fbo].some(value=>value === 'partial')
  const waiting = [fbs,fbo].some(value=>value === 'waiting')
  if (ready === 2) return 'ready'
  if (ready > 0 || partial || Boolean(core.stockDetails)) return 'partial'
  if (waiting) return 'waiting'
  return 'missing'
}

const usable = state => state === 'ready' || state === 'partial'
const safeMetric = (value,state,{ zeroUnsafe = false } = {}) => {
  if (value === undefined || value === null || !Number.isFinite(Number(value))) return null
  const number = Number(value)
  if (!usable(state)) return number === 0 ? null : number
  if (state === 'partial' && zeroUnsafe && number === 0) return null
  return number
}

function product360Readiness(coverage = {}) {
  const core = coverage?.core || {}
  const stages = coverage?.stages || {}
  const streams = coverage?.streams || {}
  return {
    orders:syncReadiness(stages.orders,Boolean(core.orders)),
    sales:syncReadiness(stages.sales,Boolean(core.sales)),
    fbsStocks:syncReadiness(stages.sellerStocks,Boolean(core.sellerStocks)),
    fboStocks:syncReadiness(stages.stocks,Boolean(core.fboStocks)),
    stocks:combinedStockReadiness(coverage),
    finance:syncReadiness(coverage?.finance || stages.finance,Boolean(core.finance)),
    advertising:syncReadiness(stages.advertising,Boolean(core.advertising)),
    search:extendedReadiness(streams.searchQueries),
    reviews:extendedReadiness(streams.reviews),
    questions:extendedReadiness(streams.questions),
    stockHistory:extendedReadiness(streams.stockHistory),
  }
}

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


export function bindWbSearchRowsToNmId(sourceRows = [], requestedNmIds = []) {
  const requested = new Set((requestedNmIds || []).map(cleanNumericId).filter(Boolean))
  const rows = []
  let droppedUnbound = 0
  let droppedOutsideRequest = 0

  const pushBound = (row, parentNmID = null) => {
    if (!row || typeof row !== 'object') return
    const explicit = product360Identities(row).nmIDs[0] || cleanNumericId(parentNmID)
    if (!explicit) { droppedUnbound += 1; return }
    if (requested.size && !requested.has(explicit)) { droppedOutsideRequest += 1; return }
    rows.push({ ...row, nmId:explicit, sourceNmID:explicit, rowType:'query', searchBindingVersion:SEARCH_BINDING_VERSION, searchOrigin:SEARCH_ORIGIN, isSubstitutedSKU:false })
  }

  for (const source of Array.isArray(sourceRows) ? sourceRows : []) {
    if (!source || typeof source !== 'object') continue
    const parentNmID = product360Identities(source).nmIDs[0] || null
    const nested = Array.isArray(source.searchTexts) ? source.searchTexts : null
    if (nested) {
      for (const item of nested) {
        if (typeof item === 'string') pushBound({ searchText:item }, parentNmID)
        else pushBound(item, parentNmID)
      }
      continue
    }
    pushBound(source, parentNmID)
  }
  return { rows, droppedUnbound, droppedOutsideRequest }
}


export function trustedWbSearchRowForProduct(row = {}, product = {}) {
  if (String(row?.rowType || '').toLowerCase() !== 'query') return false
  if (isSubstitutedSearch(row)) return false
  if (Number(row?.searchBindingVersion || 0) < SEARCH_BINDING_VERSION) return false
  if (String(row?.searchOrigin || '') !== SEARCH_ORIGIN) return false
  const sourceNmID = cleanNumericId(row?.sourceNmID)
  if (!sourceNmID) return false
  const wanted = product360Identities(product).nmIDs.map(cleanNumericId).filter(Boolean)
  if (!wanted.includes(sourceNmID)) return false
  const actual = product360Identities(row).nmIDs.map(cleanNumericId).filter(Boolean)
  return actual.includes(sourceNmID)
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

function isSubstitutedSearch(row = {}) {
  const value = row?.isSubstitutedSKU ?? row?.isSubstitutedSku ?? row?.isSubstituted ?? false
  if (value === true || value === 1) return true
  return /^(?:1|true|yes)$/i.test(String(value || '').trim())
}

function normalizeSearch(row = {}) {
  const product = nestedProduct(row)
  const phrase = text(pick(row,['searchText','searchQuery','query','keyword','text','name']))
  return {
    id:String(row?.rowKey || `${product?.nmID || product?.vendorCode || 'q'}:${phrase}`),
    rowType:row?.rowType || 'query',
    isSubstitutedSKU:isSubstitutedSearch(row),
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

function summarizeAdvertising(rows = [], readiness = 'missing') {
  if (!usable(readiness)) return {spend:null,views:null,clicks:null,orders:null,revenue:null,ctr:null,cpc:null,crr:null,romi:null}
  const totals = rows.reduce((acc,row)=>{
    acc.spend += finite(row?.spend)
    acc.views += finite(row?.views)
    acc.clicks += finite(row?.clicks)
    acc.orders += finite(row?.orders)
    acc.revenue += finite(row?.revenue)
    return acc
  },{spend:0,views:0,clicks:0,orders:0,revenue:0})
  const value = key => readiness === 'partial' && totals[key] === 0 ? null : totals[key]
  const spend = value('spend')
  const views = value('views')
  const clicks = value('clicks')
  const orders = value('orders')
  const revenue = value('revenue')
  return {
    spend,views,clicks,orders,revenue,
    ctr:views != null && views>0 && clicks != null ? clicks/views*100 : null,
    cpc:clicks != null && clicks>0 && spend != null ? spend/clicks : null,
    crr:revenue != null && revenue>0 && spend != null ? spend/revenue*100 : null,
    romi:spend != null && spend>0 && revenue != null ? (revenue-spend)/spend*100 : null,
  }
}

const compareNullable = (current, previous, available = true) => {
  const a = available && current !== undefined && current !== null && Number.isFinite(Number(current)) ? Number(current) : null
  const b = available && previous !== undefined && previous !== null && Number.isFinite(Number(previous)) ? Number(previous) : null
  if (a == null || b == null) return { current:a, previous:b, delta:null, pct:null, available:false }
  const delta = a - b
  const pct = b === 0 ? (a === 0 ? 0 : null) : delta / Math.abs(b) * 100
  return { current:a, previous:b, delta, pct, available:true }
}

const significantChange = (metric, { abs = 1, pct = 5 } = {}) => {
  if (!metric?.available || metric.delta == null || Math.abs(metric.delta) < abs) return false
  return metric.pct == null || Math.abs(metric.pct) >= pct
}

const exactNmAdvertisingRows = (rows = [], product = {}) => (Array.isArray(rows) ? rows : []).filter(row => {
  const match = product360Matches(row,product)
  return match.matched && match.method === 'nmID'
})

export function buildProduct360Comparison({
  currentProduct = {},
  previousProduct = {},
  currentAdvertisingRows = [],
  previousAdvertisingRows = [],
  currentAvailability = {},
  previousAvailability = {},
  currentPeriod = null,
  previousPeriod = null,
  comparisonCoverage = true,
} = {}) {
  if (!currentPeriod?.from || !currentPeriod?.to || !previousPeriod?.from || !previousPeriod?.to) {
    return { available:false, warning:'Для сравнения нужен выбранный период и предыдущий период той же длины.' }
  }

  const salesAvailable = Boolean(currentAvailability?.sales && previousAvailability?.sales && comparisonCoverage !== false)
  const ordersAvailable = Boolean(currentAvailability?.orders && previousAvailability?.orders && comparisonCoverage !== false)
  const financeAvailable = Boolean(currentAvailability?.finance && previousAvailability?.finance && salesAvailable)
  const adsAvailable = Boolean(currentAvailability?.advertising && previousAvailability?.advertising)

  const currentAds = summarizeAdvertising(exactNmAdvertisingRows(currentAdvertisingRows,currentProduct), adsAvailable ? 'ready' : 'missing')
  const previousAds = summarizeAdvertising(exactNmAdvertisingRows(previousAdvertisingRows,currentProduct), adsAvailable ? 'ready' : 'missing')

  const metrics = {
    revenue:compareNullable(currentProduct?.revenue,previousProduct?.revenue,salesAvailable),
    orders:compareNullable(currentProduct?.ordersCount,previousProduct?.ordersCount,ordersAvailable),
    sales:compareNullable(currentProduct?.salesCount,previousProduct?.salesCount,salesAvailable),
    returns:compareNullable(currentProduct?.returnsCount,previousProduct?.returnsCount,salesAvailable),
    returnRate:compareNullable(currentProduct?.returnRate,previousProduct?.returnRate,salesAvailable),
    averagePrice:compareNullable(currentProduct?.averagePrice,previousProduct?.averagePrice,salesAvailable),
    profit:compareNullable(currentProduct?.profit,previousProduct?.profit,financeAvailable),
    margin:compareNullable(currentProduct?.margin,previousProduct?.margin,financeAvailable),
    commission:compareNullable(currentProduct?.commission,previousProduct?.commission,financeAvailable),
    logistics:compareNullable(currentProduct?.logistics,previousProduct?.logistics,financeAvailable),
    advertising:compareNullable(currentAds?.spend,previousAds?.spend,adsAvailable),
    adOrders:compareNullable(currentAds?.orders,previousAds?.orders,adsAvailable),
    crr:compareNullable(currentAds?.crr,previousAds?.crr,adsAvailable),
  }

  const headlineMetric = metrics.profit.available ? 'profit' : 'revenue'
  const headline = metrics[headlineMetric]
  let state = 'stable'
  if (significantChange(headline,{abs:headlineMetric === 'profit' ? 300 : 500,pct:3})) state = headline.delta < 0 ? 'down' : 'up'

  const factors = []
  const addFactor = (priority,type,title,evidence,impact = null,action = '',confidence='medium') => {
    factors.push({priority,type,title,evidence,impact:impact == null ? null : Math.max(0,Math.round(Math.abs(Number(impact)||0))),action,confidence})
  }

  if (metrics.profit.available && metrics.profit.delta < 0 && significantChange(metrics.profit,{abs:300,pct:3})) {
    addFactor(1,'profit','Прибыль снизилась',
      `Операционная прибыль изменилась на ${Math.round(metrics.profit.delta)} ₽ к предыдущему сопоставимому периоду.`,
      metrics.profit.delta,
      'Проверь, какой из прямых расходов вырос, и не меняй цену/рекламу одновременно до проверки.',
      'high')
  }

  if (metrics.revenue.available && metrics.revenue.delta < 0 && significantChange(metrics.revenue,{abs:500,pct:3})) {
    const salesText = metrics.sales.available ? ` Продажи: ${metrics.sales.delta >= 0 ? '+' : ''}${Math.round(metrics.sales.delta)} шт.` : ''
    addFactor(2,'sales','Просела выручка',
      `Выручка изменилась на ${Math.round(metrics.revenue.delta)} ₽.${salesText}`,
      metrics.revenue.delta,
      'Проверь динамику продаж по дням, наличие товара и изменение конверсии до корректировки цены.',
      'high')
  }

  if (metrics.advertising.available && metrics.advertising.delta > 0 && significantChange(metrics.advertising,{abs:300,pct:8})) {
    const revenueWeak = !metrics.revenue.available || Number(metrics.revenue.delta || 0) <= 0
    addFactor(revenueWeak ? 1 : 3,'advertising',revenueWeak ? 'Реклама подорожала без роста выручки' : 'Рекламный расход вырос',
      `Расход на рекламу вырос на ${Math.round(metrics.advertising.delta)} ₽${metrics.crr.available ? `, ДРР изменился на ${metrics.crr.delta >= 0 ? '+' : ''}${metrics.crr.delta.toFixed(1)} п.п.` : ''}.`,
      metrics.advertising.delta,
      'Открой кампании этого SKU и сначала проверь расход без заказов и рост ДРР.',
      revenueWeak ? 'high' : 'medium')
  }

  const returnRateWorse = metrics.returnRate.available && metrics.returnRate.delta >= 3
  const returnsMore = metrics.returns.available && metrics.returns.delta >= 2
  if (returnRateWorse || returnsMore) {
    const averagePrice = Number(currentProduct?.averagePrice || 0)
    const estimated = returnsMore && averagePrice > 0 ? metrics.returns.delta * averagePrice : null
    addFactor(2,'returns','Возвраты ухудшились',
      `${returnsMore ? `Возвратов стало на ${Math.round(metrics.returns.delta)} шт. больше.` : ''}${returnRateWorse ? ` Доля возвратов выросла на ${metrics.returnRate.delta.toFixed(1)} п.п.` : ''}`.trim(),
      estimated,
      'Свяжи возвраты с отзывами по этому SKU и проверь описание, ожидания покупателя и качество партии.',
      'medium')
  }

  if (metrics.averagePrice.available && metrics.averagePrice.delta < 0 && significantChange(metrics.averagePrice,{abs:50,pct:5})) {
    addFactor(4,'price','Средняя цена снизилась',
      `Средняя цена продажи изменилась на ${Math.round(metrics.averagePrice.delta)} ₽ (${metrics.averagePrice.pct == null ? '—' : `${metrics.averagePrice.pct.toFixed(1)}%`}).`,
      null,
      'Проверь, компенсировал ли рост количества продаж снижение цены и сохранилась ли маржа.',
      'medium')
  }

  if (metrics.logistics.available && metrics.logistics.delta > 0 && significantChange(metrics.logistics,{abs:200,pct:8})) {
    addFactor(3,'logistics','Логистика стала дороже',
      `Расход на логистику вырос на ${Math.round(metrics.logistics.delta)} ₽.`,
      metrics.logistics.delta,
      'Проверь FBS/FBO, возвратную логистику и распределение продаж по схемам.',
      'high')
  }

  if (metrics.commission.available && metrics.commission.delta > 0 && significantChange(metrics.commission,{abs:200,pct:8})) {
    addFactor(4,'commission','Комиссия WB выросла',
      `Комиссия выросла на ${Math.round(metrics.commission.delta)} ₽.`,
      metrics.commission.delta,
      'Сверь изменение комиссии с выручкой, ценой и категорией товара.',
      'high')
  }

  factors.sort((a,b)=>a.priority-b.priority || Number(b.impact || 0)-Number(a.impact || 0))
  const unique = []
  const seen = new Set()
  for (const factor of factors) {
    if (seen.has(factor.type)) continue
    seen.add(factor.type)
    unique.push(factor)
    if (unique.length >= 4) break
  }

  let action
  if (unique[0]) {
    action = {
      title:'Сначала проверь главный фактор',
      text:unique[0].action,
      reason:unique[0].title,
      estimatedImpact:unique[0].impact,
      confidence:unique[0].confidence,
    }
  } else if (state === 'up') {
    action = {
      title:'Зафиксируй источник роста',
      text:'Период лучше предыдущего. Не меняй несколько параметров сразу: зафиксируй цену, рекламу и остаток, чтобы понять, что именно дало рост.',
      reason:'Положительная динамика',
      estimatedImpact:null,
      confidence:'medium',
    }
  } else {
    action = {
      title:'Не менять товар без сигнала',
      text:'Существенного ухудшения относительно предыдущего равного периода не видно. Продолжай наблюдение и меняй только один фактор за раз.',
      reason:'Стабильная динамика',
      estimatedImpact:null,
      confidence:'medium',
    }
  }

  const confidence = comparisonCoverage === false || !salesAvailable ? 'low'
    : financeAvailable && adsAvailable ? 'high'
      : 'medium'
  const warnings = []
  if (!salesAvailable) warnings.push('Продажи предыдущего периода покрыты не полностью; сравнение продаж недоступно.')
  if (!financeAvailable) warnings.push('Финансы не подтверждены в обоих периодах; прибыль и расходы могут быть недоступны.')
  if (!adsAvailable) warnings.push('Реклама не подтверждена в обоих периодах; рекламные изменения не используются как фактор.')
  if (comparisonCoverage === false) warnings.push('Предыдущий период покрыт данными не полностью; выводы предварительные.')

  return {
    available:Boolean(salesAvailable || ordersAvailable || financeAvailable || adsAvailable),
    period:currentPeriod,
    comparePeriod:previousPeriod,
    state,
    headlineMetric,
    headline,
    metrics,
    factors:unique,
    action,
    confidence,
    warnings,
    note:'Факторы показывают совпадающие изменения и денежный масштаб, но не объявляются доказанной причинностью без подтверждающих данных.',
  }
}

function buildSignals(product = {}, reviewSummary = {}, searchSummary = {}, adSummary = {}, readiness = {}) {
  const signals = []
  const push = (priority,type,title,textValue,effect='') => signals.push({priority,type,title,text:textValue,effect})
  if (usable(readiness.finance) && usable(readiness.sales) && product?.profit != null && Number(product.profit) < 0) push(1,'economics','Товар убыточен',`Операционная прибыль за выбранный период: ${Math.round(product.profit)} ₽.`,product?.breakevenPrice ? `Цена в ноль ≈ ${Math.round(product.breakevenPrice)} ₽` : '')
  if (usable(readiness.sales) && product?.returnRate != null && Number(product.returnRate) >= 20 && Number(product?.salesCount || 0) >= 3) push(1,'quality','Высокая доля возвратов',`${Number(product.returnRate).toFixed(1)}% возвратов при ${Math.round(product.salesCount || 0)} продажах.`,reviewSummary.lowRated ? `${reviewSummary.lowRated} низких отзывов в выборке` : '')
  if (usable(readiness.stocks) && usable(readiness.sales) && product?.stock != null && Number(product.stock) <= 0 && Number(product?.salesCount || 0) > 0) push(1,'stock','Товар закончился',`За период было ${Math.round(product.salesCount || 0)} продаж, текущий подтверждённый остаток — 0.`,'Риск упущенных продаж')
  else if (usable(readiness.stocks) && product?.stockCoverDays != null && Number(product.stockCoverDays) < 14) push(2,'stock','Запас заканчивается',`Остатка примерно на ${Math.round(product.stockCoverDays)} дней.`,`${Math.round(product.stock || 0)} шт. сейчас`)
  if (usable(readiness.advertising) && adSummary.spend != null && adSummary.spend > 0 && adSummary.orders != null && adSummary.orders <= 0) push(2,'advertising','Реклама тратит без заказов',`Расход ${Math.round(adSummary.spend)} ₽, рекламных заказов в доступной статистике нет.`,'Проверить кампании и запросы')
  else if (usable(readiness.advertising) && adSummary.crr != null && adSummary.crr > 30) push(3,'advertising','Высокий ДРР',`ДРР по товару ≈ ${adSummary.crr.toFixed(1)}%.`,'Проверить ставки и запросы')
  if (usable(readiness.reviews) && reviewSummary.unanswered > 0) push(3,'quality','Есть отзывы без ответа',`${reviewSummary.unanswered} отзывов в выбранной выборке ждут ответа.`,'Закрыть коммуникации')
  if (usable(readiness.search) && searchSummary.topPosition != null && searchSummary.topPosition > 30 && searchSummary.orders > 0) push(4,'search','Есть спрос, но слабая позиция',`По запросам с заказами средняя лучшая видимая позиция около ${Math.round(searchSummary.topPosition)}.`,'Проверить SEO и рекламу')
  if (!signals.length) {
    const states = Object.values(readiness || {})
    const incomplete = states.some(value=>value !== 'ready')
    if (incomplete) {
      const readyCount = states.filter(value=>value === 'ready').length
      const partialCount = states.filter(value=>value === 'partial').length
      push(5,'waiting','Данные по товару ещё собираются',`Подтверждено ${readyCount} потоков${partialCount ? `, ещё ${partialCount} загружены частично` : ''}. ELISEI не делает выводов по нулевым или неполным данным.`,'Дождаться подтверждения ключевых потоков')
    } else push(5,'ok','Критичных сигналов не найдено',product?.recommendation || 'Контролировать динамику и не менять настройки без причины.','')
  }
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
  const baseReadiness = product360Readiness(coverage)
  const hasSavedMetric = keys => keys.some(key => {
    const value = product?.[key]
    return value !== undefined && value !== null && Number.isFinite(Number(value)) && Number(value) !== 0
  })
  const readiness = {
    ...baseReadiness,
    orders:usable(baseReadiness.orders) || hasSavedMetric(['ordersCount']) ? (usable(baseReadiness.orders) ? baseReadiness.orders : 'partial') : baseReadiness.orders,
    sales:usable(baseReadiness.sales) || hasSavedMetric(['revenue','salesCount','returnsCount','returnRate','averagePrice']) ? (usable(baseReadiness.sales) ? baseReadiness.sales : 'partial') : baseReadiness.sales,
    finance:usable(baseReadiness.finance) || hasSavedMetric(['sellerPayable','commission','logistics','storage','acceptance','acquiring','penalties','deductions','additionalPayment','expenses','profit','margin']) ? (usable(baseReadiness.finance) ? baseReadiness.finance : 'partial') : baseReadiness.finance,
    advertising:usable(baseReadiness.advertising) || hasSavedMetric(['advertising','adSpend']) ? (usable(baseReadiness.advertising) ? baseReadiness.advertising : 'partial') : baseReadiness.advertising,
    stocks:usable(baseReadiness.stocks) || hasSavedMetric(['stock','fbsStock','fboStock','stockCoverDays']) ? (usable(baseReadiness.stocks) ? baseReadiness.stocks : 'partial') : baseReadiness.stocks,
    fbsStocks:usable(baseReadiness.fbsStocks) || hasSavedMetric(['fbsStock']) ? (usable(baseReadiness.fbsStocks) ? baseReadiness.fbsStocks : 'partial') : baseReadiness.fbsStocks,
    fboStocks:usable(baseReadiness.fboStocks) || hasSavedMetric(['fboStock']) ? (usable(baseReadiness.fboStocks) ? baseReadiness.fboStocks : 'partial') : baseReadiness.fboStocks,
  }
  const reviews = reviewRows.filter(row=>product360Matches(row,product).matched).map(normalizeReview)
  const questions = questionRows.filter(row=>product360Matches(row,product).matched).map(normalizeQuestion)
  const searches = searchRows
    // Organic SKU search visibility: exact nmID only. WB substitute-SKU placements can be
    // semantically unrelated (the item may be injected into another query), so they are excluded.
    .filter(row=>trustedWbSearchRowForProduct(row,product))
    .map(normalizeSearch)
    .filter(row=>row.phrase)
    .sort((a,b)=>finite(b.orders)-finite(a.orders) || finite(b.revenue)-finite(a.revenue) || finite(b.frequency)-finite(a.frequency))
  const stockHistory = groupStockHistory(stockHistoryRows.filter(row=>product360Matches(row,product).matched).map(normalizeStockHistory))
  const ads = advertisingRows.filter(row=>{
    const match = product360Matches(row,product)
    // Advertising in ELISEI is attributed to SKU only by exact WB nmID.
    // Do not use vendor/barcode fallbacks for campaign money.
    return match.matched && match.method === 'nmID'
  })
  const rawAdSummary = summarizeAdvertising(ads,readiness.advertising)
  const savedProductAdSpend = nullable(product?.advertising)
  const adSummary = {
    ...rawAdSummary,
    spend:rawAdSummary.spend ?? (savedProductAdSpend != null && savedProductAdSpend > 0 ? savedProductAdSpend : null),
    source:rawAdSummary.spend != null ? 'campaign_nm_stats' : (savedProductAdSpend != null && savedProductAdSpend > 0 ? 'product_analytics_saved' : 'none'),
  }
  const reviewRatings = reviews.map(row=>row.rating).filter(value=>value != null)
  const reviewReady = usable(readiness.reviews)
  const reviewSummary = {
    total:reviewReady ? (readiness.reviews === 'partial' && !reviews.length ? null : reviews.length) : null,
    averageRating:reviewRatings.length ? reviewRatings.reduce((sum,value)=>sum+value,0)/reviewRatings.length : null,
    lowRated:reviewReady ? (readiness.reviews === 'partial' && !reviews.length ? null : reviews.filter(row=>row.rating != null && row.rating<=3).length) : null,
    unanswered:reviewReady ? (readiness.reviews === 'partial' && !reviews.length ? null : reviews.filter(row=>!row.answered && !row.archived).length) : null,
  }
  const questionReady = usable(readiness.questions)
  const questionSummary = {
    total:questionReady ? (readiness.questions === 'partial' && !questions.length ? null : questions.length) : null,
    unanswered:questionReady ? (readiness.questions === 'partial' && !questions.length ? null : questions.filter(row=>!row.answered && !row.archived).length) : null,
  }
  const searchReady = usable(readiness.search)
  const rawSearchOrders = searches.reduce((sum,row)=>sum+finite(row.orders),0)
  const rawSearchRevenue = searches.reduce((sum,row)=>sum+finite(row.revenue),0)
  const searchSummary = {
    rows:searchReady ? (readiness.search === 'partial' && !searches.length ? null : searches.length) : null,
    orders:searchReady ? (readiness.search === 'partial' && rawSearchOrders === 0 ? null : rawSearchOrders) : null,
    revenue:searchReady ? (readiness.search === 'partial' && rawSearchRevenue === 0 ? null : rawSearchRevenue) : null,
    topPosition:searchReady && searches.filter(row=>row.avgPosition!=null).length ? Math.min(...searches.filter(row=>row.avgPosition!=null).map(row=>Number(row.avgPosition))) : null,
  }
  const daily = []
  const dates = usable(readiness.sales) ? new Set([
    ...Object.keys(product?.dailyRevenue || {}),
    ...Object.keys(product?.dailySales || {}),
    ...Object.keys(product?.dailyReturns || {}),
    ...Object.keys(product?.dailyOrders || {}),
  ]) : new Set()
  for (const date of [...dates].sort()) daily.push({
    date,
    revenue:Math.round(finite(product?.dailyRevenue?.[date])),
    orders:Math.round(finite(product?.dailyOrders?.[date])),
    sales:Math.round(finite(product?.dailySales?.[date])),
    returns:Math.round(finite(product?.dailyReturns?.[date])),
  })

  const safeStockDetails = (Array.isArray(stockDetails) ? stockDetails : []).filter(row=>product360Matches(row,product).matched)
  const safeFinanceMovements = (Array.isArray(financeMovements) ? financeMovements : []).filter(row=>product360Matches(row,product).matched)
  const salesMetric = value => safeMetric(value,readiness.sales,{zeroUnsafe:true})
  const ordersMetric = value => safeMetric(value,readiness.orders,{zeroUnsafe:true})
  const stockMetric = value => safeMetric(value,readiness.stocks,{zeroUnsafe:true})
  const financeMetric = value => safeMetric(value,readiness.finance,{zeroUnsafe:true})
  const adMetric = value => safeMetric(value,readiness.advertising,{zeroUnsafe:true})
  const fbsStockMetric = value => safeMetric(value,readiness.fbsStocks,{zeroUnsafe:true})
  const fboStockMetric = value => safeMetric(value,readiness.fboStocks,{zeroUnsafe:true})
  const storageState = syncReadiness(coverage?.stages?.paidStorage,Boolean(coverage?.core?.paidStorage))
  const acceptanceState = syncReadiness(coverage?.stages?.acceptance,Boolean(coverage?.core?.acceptance))
  const acquiringState = syncReadiness(coverage?.stages?.acquiring,Boolean(coverage?.core?.acquiring))
  const economicsState = usable(readiness.sales) && usable(readiness.finance)
    ? (readiness.sales === 'ready' && readiness.finance === 'ready' ? 'ready' : 'partial')
    : (readiness.sales === 'waiting' || readiness.finance === 'waiting' ? 'waiting' : 'missing')
  const economicsMetric = value => safeMetric(value,economicsState,{zeroUnsafe:true})
  const signals = buildSignals({
    ...product,
    revenue:salesMetric(product?.revenue),
    salesCount:salesMetric(product?.salesCount),
    returnsCount:salesMetric(product?.returnsCount),
    returnRate:salesMetric(product?.returnRate),
    stock:stockMetric(product?.stock),
    stockCoverDays:usable(readiness.sales) && usable(readiness.stocks) ? safeMetric(product?.stockCoverDays,readiness.stocks,{zeroUnsafe:true}) : null,
    profit:economicsMetric(product?.profit),
  },reviewSummary,searchSummary,adSummary,readiness)
  const states = Object.values(readiness)
  const readinessSummary = {
    total:states.length,
    ready:states.filter(value=>value === 'ready').length,
    partial:states.filter(value=>value === 'partial').length,
    waiting:states.filter(value=>value === 'waiting').length,
    missing:states.filter(value=>value === 'missing').length,
  }
  return {
    generatedAt:new Date().toISOString(),
    period,
    product:{
      ...product,
      identifiers:product360Identities(product),
    },
    readiness,
    readinessSummary,
    overview:{
      revenue:salesMetric(product?.revenue),
      profit:economicsMetric(product?.profit),
      margin:economicsMetric(product?.margin),
      orders:ordersMetric(product?.ordersCount),
      sales:salesMetric(product?.salesCount),
      returns:salesMetric(product?.returnsCount),
      returnRate:salesMetric(product?.returnRate),
      stock:stockMetric(product?.stock),
      stockCoverDays:usable(readiness.sales) && usable(readiness.stocks) ? safeMetric(product?.stockCoverDays,readiness.stocks,{zeroUnsafe:true}) : null,
      advertising:adMetric(adSummary.spend),
      averagePrice:salesMetric(product?.averagePrice),
    },
    economics:{
      state:economicsState,
      metricStates:{
        revenue:readiness.sales,
        sellerPayable:readiness.finance,
        cogs:readiness.sales,
        commission:readiness.finance,
        logistics:readiness.finance,
        storage:usable(readiness.finance) ? readiness.finance : storageState,
        acceptance:usable(readiness.finance) ? readiness.finance : acceptanceState,
        acquiring:usable(readiness.finance) ? readiness.finance : acquiringState,
        advertising:readiness.advertising,
        penalties:readiness.finance,
        tax:readiness.sales,
        fixedExpenses:readiness.sales,
        profit:economicsState,
      },
      revenue:salesMetric(product?.revenue),
      sellerPayable:financeMetric(product?.sellerPayable),
      unitCost:usable(readiness.sales) ? nullable(product?.unitCost) : null,
      cogs:salesMetric(product?.cogs),
      commission:financeMetric(product?.commission),
      logistics:financeMetric(product?.logistics),
      storage:usable(readiness.finance) ? financeMetric(product?.storage) : safeMetric(product?.storage,storageState,{zeroUnsafe:true}),
      acceptance:usable(readiness.finance) ? financeMetric(product?.acceptance) : safeMetric(product?.acceptance,acceptanceState,{zeroUnsafe:true}),
      acquiring:usable(readiness.finance) ? financeMetric(product?.acquiring) : safeMetric(product?.acquiring,acquiringState,{zeroUnsafe:true}),
      penalties:financeMetric(product?.penalties),
      deductions:financeMetric(product?.deductions),
      additionalPayment:financeMetric(product?.additionalPayment),
      advertising:adMetric(adSummary.spend),
      tax:salesMetric(product?.tax),
      fixedExpenses:salesMetric(product?.fixedExpenses),
      expenses:economicsMetric(product?.expenses),
      profit:economicsMetric(product?.profit),
      margin:economicsMetric(product?.margin),
      modeBreakdown:usable(readiness.sales) ? (product?.modeBreakdown || null) : null,
      financeMovements:usable(readiness.finance) ? safeFinanceMovements.slice(0,60) : [],
    },
    pricing:{
      state:readiness.sales,
      averagePrice:salesMetric(product?.averagePrice),
      breakevenPrice:economicsMetric(product?.breakevenPrice),
      targetPrice:economicsMetric(product?.targetPrice),
      peakPrice:economicsMetric(product?.peakPrice),
      note:usable(readiness.sales)
        ? 'Средняя цена рассчитана по продажам выбранного периода. Live-цена WB появится после отдельного потока цен.'
        : 'Продажи за выбранный период ещё не подтверждены. ELISEI не подставляет нулевую цену.',
    },
    demand:{
      daily,
      advertising:{ rows:usable(readiness.advertising) ? ads.slice(0,80) : [],summary:adSummary,state:readiness.advertising,matching:'nmID_exact' },
      search:{ rows:usable(readiness.search) ? searches.slice(0,80) : [],summary:searchSummary,state:readiness.search },
    },
    quality:{
      reviews:usable(readiness.reviews) ? reviews.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,80) : [],
      questions:usable(readiness.questions) ? questions.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,80) : [],
      reviewSummary,
      questionSummary,
      lowRatedTexts:usable(readiness.reviews) ? reviews.filter(row=>row.rating!=null && row.rating<=3 && row.text).slice(0,8).map(row=>row.text) : [],
    },
    stock:{
      state:readiness.stocks,
      current:usable(readiness.stocks) ? safeStockDetails.slice(0,300) : [],
      history:usable(readiness.stockHistory) ? stockHistory : {daily:[],latest:[]},
      fulfillmentMode:product?.fulfillmentMode || null,
      fbsStock:fbsStockMetric(product?.fbsStock),
      fboStock:fboStockMetric(product?.fboStock),
    },
    signals,
    coverage,
    sources,
    matchingPolicy:'nmID → barcode → vendorCode → chrtID. Название товара не используется как ключ, чтобы не смешивать SKU.',
  }
}
