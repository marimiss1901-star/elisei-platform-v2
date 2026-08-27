const DEFAULT_TIME_ZONE = 'Europe/Moscow'

// Seller-day policy: use the proven Statistics API readers for orders and sales
// until WB Order Feed is verified against a real ELISEI cabinet. Operational
// seller-day data is intentionally calm: orders, sales and both stock contours
// refresh no more often than once every two hours.
const STAGE_DEFAULTS = Object.freeze({
  orders: 7200,
  sales: 7200,
  stocks: 7200,
  sellerStocks: 7200,
})

// Existing cabinets are migrated upward automatically: old 30/60-minute
// settings cannot keep polling WB too aggressively.
const MIN_INTERVALS = Object.freeze({
  orders: 7200,
  sales: 7200,
  stocks: 7200,
  sellerStocks: 7200,
})

const OVERNIGHT_MULTIPLIERS = Object.freeze({
  orders: 2,
  sales: 2,
  stocks: 2,
  sellerStocks: 2,
})

const WEBHOOK_FALLBACK_MULTIPLIERS = Object.freeze({})

const LIVE_PRIORITY = Object.freeze({
  orders: 10,
  sales: 20,
  sellerStocks: 30,
  stocks: 40,
})

export const LIVE_SYNC_STAGES = Object.freeze(Object.keys(STAGE_DEFAULTS))

export function defaultLiveSyncSettings() {
  return {
    enabled: true,
    mode: 'polling',
    intervals: { ...STAGE_DEFAULTS },
    webhooksEnabled: false,
  }
}

export function normalizeLiveSyncSettings(value = {}) {
  const defaults = defaultLiveSyncSettings()
  const intervals = { ...defaults.intervals }
  const inputIntervals = value?.intervals && typeof value.intervals === 'object' ? value.intervals : {}
  for (const stage of LIVE_SYNC_STAGES) {
    const raw = Number(inputIntervals[stage] ?? intervals[stage])
    const minimum = MIN_INTERVALS[stage]
    intervals[stage] = Math.max(minimum, Math.min(86400, Number.isFinite(raw) ? Math.round(raw) : STAGE_DEFAULTS[stage]))
  }
  return {
    enabled: value?.enabled === undefined ? defaults.enabled : Boolean(value.enabled),
    mode: ['polling','hybrid'].includes(String(value?.mode || '')) ? String(value.mode) : defaults.mode,
    intervals,
    webhooksEnabled: Boolean(value?.webhooksEnabled),
  }
}

function toTimestamp(value) {
  const timestamp = value ? new Date(value).getTime() : 0
  return Number.isFinite(timestamp) ? timestamp : 0
}

function hourInTimeZone(now = Date.now(), timeZone = DEFAULT_TIME_ZONE) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB',{
      timeZone:String(timeZone || DEFAULT_TIME_ZONE),hour:'2-digit',hourCycle:'h23',
    }).formatToParts(new Date(now))
    return Number(parts.find(part=>part.type==='hour')?.value ?? 12)
  } catch {
    return 12
  }
}

export function liveCadenceWindow(now = Date.now(), timeZone = DEFAULT_TIME_ZONE) {
  const hour = hourInTimeZone(now,timeZone)
  return hour >= 7 && hour < 23 ? 'active' : 'overnight'
}

export function effectiveLiveIntervalSeconds(stage,{ settings = {}, now = Date.now(), timeZone = DEFAULT_TIME_ZONE } = {}) {
  const normalized = normalizeLiveSyncSettings(settings)
  const name = String(stage || '')
  const configured = Number(normalized.intervals[name] || STAGE_DEFAULTS[name] || 7200)
  const base = Math.min(configured,Number(STAGE_DEFAULTS[name] || configured))
  let multiplier = liveCadenceWindow(now,timeZone) === 'overnight'
    ? Number(OVERNIGHT_MULTIPLIERS[name] || 1)
    : 1
  if (normalized.webhooksEnabled) multiplier *= Number(WEBHOOK_FALLBACK_MULTIPLIERS[name] || 1)
  return Math.max(Number(MIN_INTERVALS[name] || 1),Math.round(base*multiplier))
}

export function dueLiveStages({ settings = {}, states = [], now = Date.now(), timeZone = DEFAULT_TIME_ZONE } = {}) {
  const normalized = normalizeLiveSyncSettings(settings)
  if (!normalized.enabled) return []
  const stateMap = new Map((Array.isArray(states) ? states : []).map(state => [String(state?.stage || ''), state]))
  const due = []
  for (const stage of LIVE_SYNC_STAGES) {
    const state = stateMap.get(stage) || {}
    if (['running','pending','queued','rate_limited','retry_scheduled'].includes(String(state.status || ''))) continue
    const nextAllowedAt = toTimestamp(state.next_allowed_at || state.nextAllowedAt)
    if (nextAllowedAt > now) continue
    const lastSuccessAt = toTimestamp(state.last_success_at || state.lastSuccessAt)
    const neverSucceeded = !lastSuccessAt
    const lastAt = Math.max(
      lastSuccessAt,
      toTimestamp(state.last_attempt_at || state.lastAttemptAt),
      toTimestamp(state.updated_at || state.updatedAt),
    )
    const intervalSeconds = effectiveLiveIntervalSeconds(stage,{settings:normalized,now,timeZone})
    const intervalMs = intervalSeconds*1000
    if (!lastAt || now-lastAt >= intervalMs) {
      const elapsed = lastAt ? Math.max(0,now-lastAt) : intervalMs
      const overdueRatio = elapsed/intervalMs
      due.push({stage,neverSucceeded,overdueRatio,priority:Number(LIVE_PRIORITY[stage] || 100)})
    }
  }
  return due
    .sort((a,b) => {
      if (a.neverSucceeded !== b.neverSucceeded) return a.neverSucceeded ? -1 : 1
      if (a.overdueRatio !== b.overdueRatio) return b.overdueRatio-a.overdueRatio
      if (a.priority !== b.priority) return a.priority-b.priority
      return a.stage.localeCompare(b.stage)
    })
    .map(item=>item.stage)
}

export function eventStages(event = {}) {
  const type = String(event?.type || '').trim().toLowerCase()
  const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {}
  const payloadItems = Array.isArray(payload) ? payload : [payload]
  if (type === 'card_changed' || type === 'card_creation_error') return ['products']
  if (type === 'feedback_updated') {
    const entity = payloadItems.map(item=>String(item?.entityType || item?.type || item?.kind || '')).join(' ').toLowerCase()
    if (entity.includes('question')) return ['questions']
    if (entity.includes('feedback') || entity.includes('review')) return ['reviews']
    return ['reviews']
  }
  if (type === 'report_generation_complete') {
    const reportType = payloadItems.map(item=>String(item?.reportType || item?.type || item?.report_type || item?.reportName || '')).join(' ').toUpperCase()
    if (reportType.includes('STOCK_HISTORY')) return ['stockHistory']
    if (reportType.includes('SEARCH_QUER')) return ['searchQueries']
    if (reportType.includes('FUNNEL') || reportType.includes('DETAIL_HISTORY') || reportType.includes('GROUPED_HISTORY')) return ['funnel']
    return []
  }
  return []
}

export function safeEqualSecret(left, right) {
  const a = Buffer.from(String(left || ''))
  const b = Buffer.from(String(right || ''))
  return a.length > 0 && a.length === b.length && cryptoSafeEqual(a,b)
}

function cryptoSafeEqual(a,b) {
  let result = 0
  for (let index=0; index<a.length; index += 1) result |= a[index] ^ b[index]
  return result === 0
}

export function publicLiveSyncStatus(row = null, webhookCount = 0) {
  const settings = normalizeLiveSyncSettings(row?.settings || {})
  const now = Date.now()
  return {
    enabled: settings.enabled,
    mode: settings.webhooksEnabled ? 'hybrid' : settings.mode,
    intervals: settings.intervals,
    effectiveIntervals:Object.fromEntries(LIVE_SYNC_STAGES.map(stage=>[
      stage,effectiveLiveIntervalSeconds(stage,{settings,now,timeZone:DEFAULT_TIME_ZONE}),
    ])),
    cadenceWindow:liveCadenceWindow(now,DEFAULT_TIME_ZONE),
    webhooksEnabled: settings.webhooksEnabled,
    webhookCount: Number(webhookCount || 0),
    lastEventAt: row?.last_event_at || null,
    lastPollAt: row?.last_poll_at || null,
    updatedAt: row?.updated_at || null,
  }
}
