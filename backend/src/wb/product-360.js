import { cleanBarcode, cleanNumericId, cleanVendorCode, cleanVendorLoose, productIdentities } from './identity.js'

const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0
const nullable = value => Number.isFinite(Number(value)) ? Number(value) : null
const text = value => String(value ?? '').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g,'').trim()
const WAITING_STATUSES = new Set(['queued','pending','rate_limited','running','retry_scheduled'])

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
  if (!usable(state) || value === undefined || value === null || !Number.isFinite(Number(value))) return null
  const number = Number(value)
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
  const readiness = product360Readiness(coverage)
  const reviews = reviewRows.filter(row=>product360Matches(row,product).matched).map(normalizeReview)
  const questions = questionRows.filter(row=>product360Matches(row,product).matched).map(normalizeQuestion)
  const searches = searchRows
    .filter(row=>product360Matches(row,product).matched)
    .map(normalizeSearch)
    .filter(row=>row.rowType === 'query' || row.phrase)
    .sort((a,b)=>finite(b.orders)-finite(a.orders) || finite(b.revenue)-finite(a.revenue) || finite(b.frequency)-finite(a.frequency))
  const stockHistory = groupStockHistory(stockHistoryRows.filter(row=>product360Matches(row,product).matched).map(normalizeStockHistory))
  const ads = advertisingRows.filter(row=>product360Matches(row,product).matched)
  const adSummary = summarizeAdvertising(ads,readiness.advertising)
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
      advertising:adMetric(product?.advertising ?? product?.adSpend),
      averagePrice:salesMetric(product?.averagePrice),
    },
    economics:{
      state:economicsState,
      revenue:salesMetric(product?.revenue),
      sellerPayable:financeMetric(product?.sellerPayable),
      unitCost:usable(readiness.sales) ? nullable(product?.unitCost) : null,
      cogs:salesMetric(product?.cogs),
      commission:financeMetric(product?.commission),
      logistics:financeMetric(product?.logistics),
      storage:usable(readiness.finance) ? financeMetric(product?.storage) : safeMetric(product?.storage,syncReadiness(coverage?.stages?.paidStorage,Boolean(coverage?.core?.paidStorage)),{zeroUnsafe:true}),
      acceptance:usable(readiness.finance) ? financeMetric(product?.acceptance) : safeMetric(product?.acceptance,syncReadiness(coverage?.stages?.acceptance,Boolean(coverage?.core?.acceptance)),{zeroUnsafe:true}),
      acquiring:usable(readiness.finance) ? financeMetric(product?.acquiring) : safeMetric(product?.acquiring,syncReadiness(coverage?.stages?.acquiring,Boolean(coverage?.core?.acquiring)),{zeroUnsafe:true}),
      penalties:financeMetric(product?.penalties),
      deductions:financeMetric(product?.deductions),
      additionalPayment:financeMetric(product?.additionalPayment),
      advertising:adMetric(product?.advertising),
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
      advertising:{ rows:usable(readiness.advertising) ? ads.slice(0,80) : [],summary:adSummary,state:readiness.advertising },
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
