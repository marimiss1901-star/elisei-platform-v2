const ORDER_FEED_ENDPOINT = 'https://seller-analytics-api.wildberries.ru/api/analytics/v1/order-feed'
const MAX_PERIOD_DAYS = 31

function asIso(value, fallback) {
  const date = value ? new Date(value) : new Date(fallback)
  if (!Number.isFinite(date.getTime())) throw Object.assign(new Error('Некорректная дата для WB Order Feed'), { status:400 })
  return date.toISOString()
}

export function orderFeedWindow({ start, end = new Date() } = {}) {
  const endIso = asIso(end, Date.now())
  const endMs = Date.parse(endIso)
  const defaultStart = new Date(endMs - 30 * 86400000)
  const startIso = asIso(start, defaultStart)
  const startMs = Date.parse(startIso)
  if (startMs > endMs) throw Object.assign(new Error('Начало периода WB Order Feed позже конца периода'), { status:400 })
  if (endMs - startMs > MAX_PERIOD_DAYS * 86400000) {
    throw Object.assign(new Error('WB Order Feed отдаёт максимум 31 день за запрос'), {
      status:400, code:'WB_ORDER_FEED_PERIOD_TOO_LONG', maxPeriodDays:MAX_PERIOD_DAYS,
    })
  }
  return { start:startIso, end:endIso }
}

export function buildOrderFeedRequest({ start, end, offset = 0, limit = 1000, snapshotTime = null, brandNames = [], subjectIds = [], tagIds = [], nmIds = [] } = {}) {
  const selectedPeriod = orderFeedWindow({ start, end })
  const pagination = {
    offset:Math.max(0,Number(offset) || 0),
    limit:Math.max(1,Math.min(1000,Number(limit) || 1000)),
  }
  if (snapshotTime) pagination.snapshotTime = asIso(snapshotTime, snapshotTime)
  return {
    url:ORDER_FEED_ENDPOINT,
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify({
      selectedPeriod,
      brandNames:Array.isArray(brandNames) ? brandNames : [],
      subjectIds:Array.isArray(subjectIds) ? subjectIds.map(Number).filter(Number.isFinite) : [],
      tagIds:Array.isArray(tagIds) ? tagIds.map(Number).filter(Number.isFinite) : [],
      nmIds:Array.isArray(nmIds) ? nmIds.map(Number).filter(Number.isFinite) : [],
      pagination,
    }),
  }
}

export function orderFeedRateLimitSeconds(tokenType = 'unknown') {
  const normalized = String(tokenType || '').trim().toLowerCase()
  if (['basic','base','базовый'].includes(normalized)) return 3 * 60 * 60
  return 60
}

export function orderFeedMigrationPolicy() {
  return {
    endpoint:ORDER_FEED_ENDPOINT,
    maxPeriodDays:MAX_PERIOD_DAYS,
    replaces:['GET /api/v1/supplier/orders','GET /api/v1/supplier/sales'],
    legacyStatus:'active-until-wb-announces-cutoff',
    strategy:'shadow-then-primary',
    historyStrategy:'keep-legacy-and-saved-history-for-periods-older-than-31-days',
  }
}

export { ORDER_FEED_ENDPOINT, MAX_PERIOD_DAYS }
