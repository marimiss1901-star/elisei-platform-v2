const text = value => String(value ?? '').trim()
const number = value => {
  const parsed = Number(String(value ?? '').replace(',','.'))
  return Number.isFinite(parsed) ? parsed : 0
}

export const FINANCE_METHOD_LIMITS = Object.freeze({
  // Current POST /api/finance/v1/sales-reports/detailed period endpoint:
  // official WB documentation exposes one request per minute. The previous
  // 12-hour Base-token cooldown belonged to the older throttling model and
  // must not be carried into this endpoint.
  baseDetailIntervalMs: 61 * 1000,
  baseBalanceIntervalMs: 24 * 60 * 60 * 1000,
  // Documents remain a separate endpoint with their own token-dependent rules.
  baseDocumentsIntervalMs: 24 * 60 * 60 * 1000,
  fastDetailIntervalMs: 61 * 1000,
  documentsFastIntervalMs: 11 * 1000,
})

export function isPrivilegedFinanceToken(tokenInfo = {}) {
  return [3,4].includes(Number(tokenInfo?.typeId || 0))
}

export function hasFastFinanceRate(tokenInfo = {}) {
  const typeId = Number(tokenInfo?.typeId || 0)
  return [3,4].includes(typeId) || (typeId === 1 && Boolean(tokenInfo?.hasServiceSecret))
}

export function financePageCooldownMs(tokenInfo = {}) {
  // The period-detail endpoint itself is one request/minute in current WB docs.
  // Keep tokenInfo in the signature because other finance methods still differ
  // by token type and callers already provide it.
  void tokenInfo
  return FINANCE_METHOD_LIMITS.fastDetailIntervalMs
}

export function financeBalanceCooldownMs(tokenInfo = {}) {
  return hasFastFinanceRate(tokenInfo)
    ? FINANCE_METHOD_LIMITS.fastDetailIntervalMs
    : FINANCE_METHOD_LIMITS.baseBalanceIntervalMs
}

export function documentsPageCooldownMs(tokenInfo = {}) {
  return hasFastFinanceRate(tokenInfo)
    ? FINANCE_METHOD_LIMITS.documentsFastIntervalMs
    : FINANCE_METHOD_LIMITS.baseDocumentsIntervalMs
}

export function financeContinuation({ incomingRows = [], previousRrdId = '0' } = {}) {
  const rows = Array.isArray(incomingRows) ? incomingRows : []
  const previous = text(previousRrdId || '0') || '0'
  if (!rows.length) return { complete:true, nextRrdId:previous, reason:'wb_204_or_empty' }
  const last = rows.at(-1) || {}
  const nextRrdId = text(last.rrdId ?? last.rrd_id ?? '')
  if (!/^\d+$/.test(nextRrdId) || nextRrdId === previous) {
    return { complete:true, nextRrdId:previous, reason:'cursor_missing_or_repeated' }
  }
  // WB explicitly recommends continuing until a 204 response. A short page is not
  // treated as proof of completion because rows can be streamed in uneven chunks.
  return { complete:false, nextRrdId, reason:'continue_until_204' }
}

export function financeProgressCopy({ tokenInfo = {}, rows = 0, page = 0, nextAllowedAt = null, pageLimit = 100000 } = {}) {
  const typeId = Number(tokenInfo?.typeId || 0)
  return {
    tokenMode:[3,4].includes(typeId) ? 'personal_or_service' : 'single_token',
    rows:Number(rows || 0),
    page:Number(page || 0),
    nextAllowedAt:nextAllowedAt || null,
    pageLimit:Number(pageLimit || 100000),
    limitNote:'Финансовая детализация WB за период: до 100 000 строк за запрос; следующий запрос — не раньше чем через минуту. Второй пользовательский токен не требуется.',
  }
}

export function normalizeDocumentCategories(payload) {
  const rows = payload?.data?.categories ?? payload?.categories ?? (Array.isArray(payload?.data) ? payload.data : [])
  return (Array.isArray(rows) ? rows : []).map(item => ({
    name:text(item?.name),
    title:text(item?.title || item?.name),
  })).filter(item => item.name)
}

function first(row, aliases) {
  for (const key of aliases) {
    const value = row?.[key]
    if (value != null && text(value)) return value
  }
  return ''
}

export function normalizeDocumentRow(row = {}, categoryMap = {}) {
  const serviceName = text(first(row,['serviceName','service_name','id','documentId']))
  const extension = text(first(row,['extension','ext','format'])).replace(/^\./,'').toLowerCase()
  const categoryId = text(first(row,['categoryName','categoryId','category_id','categoryCode','category_code']))
  const categoryText = text(first(row,['category','categoryTitle','category_title']))
  const createdAt = text(first(row,['date','creationTime','createdAt','createDate','created_at','documentDate','document_date']))
  const periodFrom = text(first(row,['periodFrom','dateFrom','beginTime','period_from','date_from']))
  const periodTo = text(first(row,['periodTo','dateTo','endTime','period_to','date_to']))
  const numberValue = text(first(row,['documentNumber','number','docNumber','document_number','doc_number']))
  const resolvedCategory = categoryText || categoryMap[categoryId] || categoryId || 'Документ WB'
  return {
    ...row,
    serviceName,
    extension,
    categoryId,
    category:resolvedCategory,
    createdAt:createdAt || null,
    periodFrom:periodFrom || null,
    periodTo:periodTo || null,
    documentNumber:numberValue || null,
    downloadable:Boolean(serviceName && extension),
  }
}

export function summarizeDocuments(rows = [], categories = []) {
  const byCategory = new Map()
  let latestDate = null
  let downloadable = 0
  let jamDocuments = 0
  for (const row of Array.isArray(rows) ? rows : []) {
    const category = text(row?.category || row?.categoryId || 'Без категории')
    byCategory.set(category,(byCategory.get(category) || 0) + 1)
    if (row?.downloadable) downloadable += 1
    const date = text(row?.createdAt || row?.date)
    if (date && (!latestDate || date > latestDate)) latestDate = date
    const source = JSON.stringify(row).toLowerCase()
    if (/(?:^|[^a-zа-яё])(джем|jam)(?:[^a-zа-яё]|$)/i.test(source)) jamDocuments += 1
  }
  return {
    total:Number(rows.length || 0),
    downloadable,
    categories:Number(categories.length || byCategory.size),
    latestDate,
    jamDocuments,
    byCategory:[...byCategory.entries()].map(([category,count])=>({category,count})).sort((a,b)=>b.count-a.count),
  }
}

export function deriveAcquiringFromLedgerRows(rows = []) {
  const result = []
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row?.operationGroup !== 'acquiring' || row?.detailOnly) continue
    result.push({
      rrdId:row.rrdId || null,
      reportId:row.reportId || null,
      operationDate:row.operationDate || null,
      nmId:row.nmId || null,
      vendorCode:row.vendorCode || '',
      srid:row.srid || '',
      fulfillmentMode:row.fulfillmentMode || '',
      acquiringBank:row.paymentProcessing || '',
      acquiringFee:Math.abs(number(row.amount)),
      acquiringFeeVat:null,
      currency:row.currency || 'RUB',
      source:'sales-reports/detailed',
      vatBreakdownAvailable:false,
    })
  }
  return result
}

export function jamEvidenceFromFinanceRows(rows = []) {
  const matches = []
  let amount = 0
  for (const row of Array.isArray(rows) ? rows : []) {
    const code = text(row?.operationCode)
    if (code !== 'jam_subscription') continue
    const value = Math.abs(number(row?.amount))
    amount += value
    matches.push({
      date:row?.operationDate || null,
      amount:value,
      name:row?.operationName || 'Подписка «Джем»',
      reportId:row?.reportId || null,
      rrdId:row?.rrdId || null,
      source:'finance',
    })
  }
  return { confirmed:matches.length > 0, amount:Math.round(amount*100)/100, operations:matches.slice(0,100) }
}
