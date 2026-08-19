const DAY_MS = 86400000

export const DAILY_READY_VERSION = 1
export const DEFAULT_DAILY_READY_TIMEZONE = 'Europe/Moscow'

export const AUTOMATIC_REFRESH_INTERVALS_SECONDS = Object.freeze({
  orders: 30 * 60,
  sales: 30 * 60,
  stocks: 60 * 60,
  sellerStocks: 60 * 60,
  products: 6 * 60 * 60,
  advertising: 60 * 60,
  reviews: 3 * 60 * 60,
  questions: 3 * 60 * 60,
  chats: 60 * 60,
})

export const DAILY_READY_CORE_STAGES = Object.freeze([
  'orders','sales','advertising','finance','paidStorage','acceptance','acquiring','stocks','sellerStocks',
])

export const DAILY_READY_HEAVY_INTERVALS_SECONDS = Object.freeze({
  finance: 12 * 60 * 60,
  paidStorage: 24 * 60 * 60,
  acceptance: 24 * 60 * 60,
  acquiring: 12 * 60 * 60,
})

const formatterCache = new Map()

function dateFormatter(timeZone) {
  const key = String(timeZone || DEFAULT_DAILY_READY_TIMEZONE)
  if (!formatterCache.has(key)) {
    formatterCache.set(key, new Intl.DateTimeFormat('en-CA', {
      timeZone:key,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',
    }))
  }
  return formatterCache.get(key)
}

export function zonedParts(value = new Date(), timeZone = DEFAULT_DAILY_READY_TIMEZONE) {
  const date = value instanceof Date ? value : new Date(value)
  const parts = dateFormatter(timeZone).formatToParts(date)
  const out = {}
  for (const part of parts) if (part.type !== 'literal') out[part.type] = part.value
  return {
    year:Number(out.year),month:Number(out.month),day:Number(out.day),hour:Number(out.hour),minute:Number(out.minute),
  }
}

export function dateKeyFromParts(parts = {}) {
  return `${String(parts.year).padStart(4,'0')}-${String(parts.month).padStart(2,'0')}-${String(parts.day).padStart(2,'0')}`
}

export function businessDateKey(value = new Date(), timeZone = DEFAULT_DAILY_READY_TIMEZONE) {
  return dateKeyFromParts(zonedParts(value,timeZone))
}

export function shiftIsoDate(value, days = 0) {
  const date = new Date(`${String(value).slice(0,10)}T12:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return ''
  date.setUTCDate(date.getUTCDate()+Number(days || 0))
  return date.toISOString().slice(0,10)
}

export function yesterdayDateKey(value = new Date(), timeZone = DEFAULT_DAILY_READY_TIMEZONE) {
  return shiftIsoDate(businessDateKey(value,timeZone),-1)
}

export function dailyReadySlot(value = new Date(), timeZone = DEFAULT_DAILY_READY_TIMEZONE) {
  const parts = zonedParts(value,timeZone)
  const minutes = parts.hour*60+parts.minute
  if (minutes >= 11*60+30) return 'late-check'
  if (minutes >= 7*60+30) return 'morning-ready'
  if (minutes >= 5*60) return 'preopen'
  if (minutes >= 1*60+30) return 'overnight'
  return 'after-midnight'
}

function millis(value) {
  const parsed = value ? new Date(value).getTime() : 0
  return Number.isFinite(parsed) ? parsed : 0
}

export function stageCanBeQueued(state = {}, { now = Date.now(), minimumAgeSeconds = 0 } = {}) {
  const status = String(state?.status || '')
  if (['running','pending','queued','rate_limited','retry_scheduled'].includes(status)) {
    const nextAllowed = millis(state?.next_allowed_at || state?.nextAllowedAt)
    if (!nextAllowed || nextAllowed > now) return false
  }
  const nextAllowed = millis(state?.next_allowed_at || state?.nextAllowedAt)
  if (nextAllowed > now) return false
  const lastSuccess = millis(state?.last_success_at || state?.lastSuccessAt)
  return !lastSuccess || now-lastSuccess >= Math.max(0,Number(minimumAgeSeconds || 0))*1000
}

export function dailyHeavyStagePlan({ states = [], now = Date.now(), timeZone = DEFAULT_DAILY_READY_TIMEZONE } = {}) {
  const slot = dailyReadySlot(new Date(now),timeZone)
  if (!['preopen','morning-ready','late-check'].includes(slot)) return []
  const map = new Map((Array.isArray(states) ? states : []).map(item=>[String(item?.stage || ''),item]))
  const plan = []
  for (const [stage,seconds] of Object.entries(DAILY_READY_HEAVY_INTERVALS_SECONDS)) {
    if (stageCanBeQueued(map.get(stage) || {},{now,minimumAgeSeconds:seconds})) plan.push(stage)
  }
  return plan
}

function coverageIncludes(coverage = {}, date = '') {
  const from = String(coverage?.from || '').slice(0,10)
  const to = String(coverage?.to || '').slice(0,10)
  if (!date || !from || !to) return false
  return from <= date && date <= to
}

function streamState(state = {}, { hasRows = false, coverage = null, date = '', allowConfirmedEmpty = true } = {}) {
  const status = String(state?.status || '')
  const running = ['running','pending','queued','rate_limited','retry_scheduled'].includes(status)
  const failed = ['error','forbidden','missing_token','token_invalid','subscription_required'].includes(status)
  const covered = coverageIncludes(coverage,date)
  if (covered && (!running || hasRows || allowConfirmedEmpty)) return { state:running ? 'partial' : 'ready', covered:true }
  if (hasRows) return { state:running ? 'partial' : 'partial', covered:false }
  if (failed) return { state:'missing', covered:false }
  return { state:'waiting', covered:false }
}

export function buildDailyMetricStates({ core = {}, states = [], date = '', financeLedger = null } = {}) {
  const stateMap = new Map((Array.isArray(states) ? states : []).map(item=>[String(item?.stage || ''),item]))
  const coverage = core?.periodCoverage || {}
  const financeSummary = financeLedger?.summary || financeLedger || {}
  const financeRows = Number(financeSummary?.movements || 0)
  const financeCoverage = {
    from:String(financeSummary?.dateFrom || financeSummary?.date_from || '').slice(0,10),
    to:String(financeSummary?.dateTo || financeSummary?.date_to || '').slice(0,10),
  }

  const orders = streamState(stateMap.get('orders') || {},{
    hasRows:Number(coverage?.orders?.selectedRows || 0)>0,coverage:coverage?.orders,date,
  })
  const sales = streamState(stateMap.get('sales') || {},{
    hasRows:Number(coverage?.sales?.selectedRows || 0)>0,coverage:coverage?.sales,date,
  })
  const advertising = streamState(stateMap.get('advertising') || {},{
    hasRows:Number(coverage?.advertising?.selectedRows || 0)>0,coverage:coverage?.advertising,date,
  })
  const finance = streamState(stateMap.get('finance') || {},{
    hasRows:financeRows>0,coverage:financeCoverage,date,allowConfirmedEmpty:false,
  })
  if (financeRows > 0 && finance.state === 'waiting') finance.state = 'partial'
  if (financeRows > 0 && coverageIncludes(financeCoverage,date) && core?.finance?.complete === true && !['running','pending','queued','rate_limited','retry_scheduled'].includes(String(stateMap.get('finance')?.status || ''))) finance.state='ready'

  const stockState = (() => {
    const fbo = stateMap.get('stocks') || {}
    const fbs = stateMap.get('sellerStocks') || {}
    const anyRunning = [fbo,fbs].some(item=>['running','pending','queued','rate_limited','retry_scheduled'].includes(String(item?.status || '')))
    const anySuccess = [fbo,fbs].some(item=>String(item?.status || '')==='success' || item?.available === true || item?.last_success_at || item?.lastSuccessAt)
    if (anySuccess && anyRunning) return { state:'partial',covered:true }
    if (anySuccess) return { state:'ready',covered:true }
    return { state:'waiting',covered:false }
  })()

  return { orders,sales,advertising,finance,stocks:stockState }
}

export function dailyReadinessSummary(metricStates = {}) {
  const coreDomains = ['orders','sales','advertising','finance']
  const counts = { ready:0,partial:0,waiting:0,missing:0,total:coreDomains.length }
  for (const key of coreDomains) {
    const state = String(metricStates?.[key]?.state || 'waiting')
    if (Object.prototype.hasOwnProperty.call(counts,state)) counts[state] += 1
    else counts.waiting += 1
  }
  const operationalReady = ['orders','sales'].every(key=>metricStates?.[key]?.state==='ready')
  const status = operationalReady && counts.waiting===0 && counts.missing===0 && counts.partial===0
    ? 'ready'
    : operationalReady ? 'partial' : 'waiting'
  return { ...counts,status,operationalReady }
}

export function compactDailyCore(core = {}, financeLedger = null) {
  const financeSummary = financeLedger?.summary || financeLedger || {}
  const summary = {
    ...(core?.summary || {}),
    sellerPayable:Number.isFinite(Number(financeSummary?.sellerPayable)) ? Number(financeSummary.sellerPayable) : null,
  }
  const topProducts = Array.isArray(core?.products)
    ? [...core.products].sort((a,b)=>Number(b?.revenue || 0)-Number(a?.revenue || 0)).slice(0,10)
    : []
  return {
    generatedAt:core?.generatedAt || new Date().toISOString(),
    period:core?.period || null,
    periodCoverage:core?.periodCoverage || null,
    summary,
    availability:core?.availability || {},
    finance:{ summary:financeSummary, complete:core?.finance?.complete === true },
    advertising:{ totals:core?.advertising?.totals || {},statsAvailable:Boolean(core?.advertising?.statsAvailable) },
    fulfillment:core?.fulfillment || null,
    topProducts,
    recommendations:Array.isArray(core?.recommendations) ? core.recommendations.slice(0,10) : [],
    dailyTrend:Array.isArray(core?.dailyTrend) ? core.dailyTrend.slice(-7) : [],
    stockMeta:core?.stockMeta || null,
  }
}

export function dailySnapshotSourceRevision(states = [], date = '') {
  const relevant = new Set(DAILY_READY_CORE_STAGES)
  const parts = (Array.isArray(states) ? states : [])
    .filter(item=>relevant.has(String(item?.stage || '')))
    .map(item=>[
      String(item.stage),String(item.last_success_at || item.lastSuccessAt || ''),String(item.last_count || item.lastCount || 0),
    ].join(':'))
    .sort()
  return `${DAILY_READY_VERSION}|${date}|${parts.join('|')}`
}

export function snapshotNeedsRefresh(snapshot = null, revision = '', { maxAgeMs = 30*60*1000, now = Date.now() } = {}) {
  if (!snapshot) return true
  if (String(snapshot?.source_revision || snapshot?.sourceRevision || '') !== String(revision || '')) return true
  const generated = millis(snapshot?.generated_at || snapshot?.generatedAt)
  return !generated || now-generated > maxAgeMs
}
