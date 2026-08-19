const STAGE_DEFAULTS = Object.freeze({
  // 5.13.0: business-ready cadence. ELISEI refreshes before the user opens the cabinet;
  // it no longer polls operational WB streams every 2–5 minutes.
  orders: 1800,
  sales: 1800,
  stocks: 3600,
  sellerStocks: 3600,
  products: 21600,
  advertising: 3600,
  reviews: 10800,
  questions: 10800,
  chats: 3600,
})

const MIN_INTERVALS = Object.freeze({
  orders: 900,
  sales: 900,
  stocks: 1800,
  sellerStocks: 1800,
  products: 3600,
  advertising: 1800,
  reviews: 3600,
  questions: 3600,
  chats: 1800,
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

export function dueLiveStages({ settings = {}, states = [], now = Date.now() } = {}) {
  const normalized = normalizeLiveSyncSettings(settings)
  if (!normalized.enabled) return []
  const stateMap = new Map((Array.isArray(states) ? states : []).map(state => [String(state?.stage || ''), state]))
  const due = []
  for (const stage of LIVE_SYNC_STAGES) {
    const state = stateMap.get(stage) || {}
    if (['running','pending','queued','rate_limited','retry_scheduled'].includes(String(state.status || ''))) continue
    const nextAllowedAt = toTimestamp(state.next_allowed_at || state.nextAllowedAt)
    if (nextAllowedAt > now) continue
    const lastAt = Math.max(
      toTimestamp(state.last_success_at || state.lastSuccessAt),
      toTimestamp(state.last_attempt_at || state.lastAttemptAt),
      toTimestamp(state.updated_at || state.updatedAt),
    )
    const intervalMs = normalized.intervals[stage] * 1000
    if (!lastAt || now - lastAt >= intervalMs) due.push(stage)
  }
  return due
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
    // Текущий официальный feedback_updated относится к отзывам; questions
    // оставляем как совместимый fallback для будущего расширения payload.
    return ['reviews']
  }
  if (type === 'report_generation_complete') {
    const reportType = payloadItems.map(item=>String(item?.reportType || item?.type || item?.report_type || item?.reportName || '')).join(' ').toUpperCase()
    if (reportType.includes('STOCK_HISTORY')) return ['stockHistory']
    if (reportType.includes('SEARCH_QUER')) return ['searchQueries']
    if (reportType.includes('FUNNEL') || reportType.includes('DETAIL_HISTORY') || reportType.includes('GROUPED_HISTORY')) return ['funnel']
    // Если WB не передал тип, receiver только будит processors уже созданных
    // заданий и не ставит новый отчёт в очередь.
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
  return {
    enabled: settings.enabled,
    mode: settings.webhooksEnabled ? 'hybrid' : settings.mode,
    intervals: settings.intervals,
    webhooksEnabled: settings.webhooksEnabled,
    webhookCount: Number(webhookCount || 0),
    lastEventAt: row?.last_event_at || null,
    lastPollAt: row?.last_poll_at || null,
    updatedAt: row?.updated_at || null,
  }
}
