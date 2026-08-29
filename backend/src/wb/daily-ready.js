const DAY_MS = 86400000

export const DAILY_READY_VERSION = 7
export const DEFAULT_DAILY_READY_TIMEZONE = 'Europe/Moscow'

export const AUTOMATIC_REFRESH_INTERVALS_SECONDS = Object.freeze({
  orders: 30 * 60,
  sales: 30 * 60,
  stocks: 60 * 60,
  sellerStocks: 30 * 60,
  products: 6 * 60 * 60,
  advertising: 30 * 60,
  reviews: 60 * 60,
  questions: 60 * 60,
  chats: 15 * 60,
})

export const DAILY_READY_CORE_STAGES = Object.freeze([
  'orders','sales','advertising','finance','paidStorage','acceptance','acquiring','stocks','sellerStocks',
])

export const DAILY_READY_OPERATIONAL_RECOVERY_STAGES = Object.freeze(['orders','sales'])

export const DAILY_READY_HEAVY_INTERVALS_SECONDS = Object.freeze({
  // Current WB balance is a light snapshot, but by product policy it belongs
  // to the nightly lane rather than competing with seller-day operations.
  // 20h guarantees it becomes eligible again in the next business-night window.
  balance: 20 * 60 * 60,

  // Nightly Ready: one complete heavy pass per business night. 20h for the two
  // financial contours guarantees the next night's pass is eligible even when
  // the previous run finished closer to morning.
  finance: 20 * 60 * 60,
  acquiring: 20 * 60 * 60,
  paidStorage: 24 * 60 * 60,
  acceptance: 24 * 60 * 60,
  documents: 24 * 60 * 60,

  // Seller-day policy: these streams are useful by the next morning, but do not
  // need to compete with orders/sales or stock refreshes during the day.
  products: 24 * 60 * 60,
  advertising: 24 * 60 * 60,
  reviews: 24 * 60 * 60,
  questions: 24 * 60 * 60,
  chats: 24 * 60 * 60,
  financeReports: 24 * 60 * 60,
  acquiringReports: 24 * 60 * 60,
  jamSubscription: 24 * 60 * 60,

  // Secondary nightly layer. These reports are valuable for morning analytics
  // but do not need to compete with live orders/sales during the seller day.
  // Finance remains first in object order, so P&L readiness is prioritized.
  measurementPenalties: 24 * 60 * 60,
  deductionsReport: 24 * 60 * 60,
  warehouseMeasurements: 24 * 60 * 60,
  antifraudRetention: 24 * 60 * 60,
  labelingRetention: 24 * 60 * 60,
  goodsReturns: 24 * 60 * 60,
  tariffs: 24 * 60 * 60,
  funnel: 24 * 60 * 60,
  searchQueries: 24 * 60 * 60,
  stockHistory: 24 * 60 * 60,
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
  // A continuation already owned by Smart Scheduler is not a fresh nightly job.
  // It must resume with its existing cursor instead of being reinitialized.
  if (['running','pending','queued','rate_limited','retry_scheduled'].includes(status)) return false
  const nextAllowed = millis(state?.next_allowed_at || state?.nextAllowedAt)
  if (nextAllowed > now) return false
  const lastSuccess = millis(state?.last_success_at || state?.lastSuccessAt)
  return !lastSuccess || now-lastSuccess >= Math.max(0,Number(minimumAgeSeconds || 0))*1000
}

export function dailyHeavyStagePlan({ states = [], now = Date.now(), timeZone = DEFAULT_DAILY_READY_TIMEZONE } = {}) {
  const slot = dailyReadySlot(new Date(now),timeZone)
  // Heavy API work starts only in the business-night window 01:30–07:30.
  // Pending WB jobs may finish later, but ELISEI does not start a fresh heavy
  // download during the seller's working day.
  if (!['overnight','preopen'].includes(slot)) return []
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

function stateConfirmsBusinessDate(state = {}, date = '') {
  const metadata = state?.metadata && typeof state.metadata === 'object' ? state.metadata : {}
  const confirmedFrom = String(metadata?.dailyReadyConfirmedFrom || metadata?.dailyReadyDate || '').slice(0,10)
  const confirmedThrough = String(metadata?.dailyReadyConfirmedThrough || '').slice(0,10)
  if (!date || !confirmedThrough) return false
  return (!confirmedFrom || confirmedFrom <= date) && date <= confirmedThrough
}

export function dailyOperationalStageCovered({ stage = '', coverage = {}, state = {}, date = '' } = {}) {
  if (!date) return false
  const normalizedStage = String(stage || '')
  // Для orders/sales диапазон min..max не доказывает, что внутри него нет дырки.
  // Daily Ready работает с одним закрытым днём, поэтому здесь нужен либо хотя бы
  // один реально выбранный ряд за эту дату, либо явное подтверждение успешного
  // recovery-запроса (в том числе подтверждённый ноль).
  if (normalizedStage === 'orders' || normalizedStage === 'sales') {
    return Number(coverage?.selectedRows || 0) > 0 || stateConfirmsBusinessDate(state,date)
  }
  // Рекламный snapshot хранит подтверждённый период целиком; нулевой расход за
  // отдельный день допустим и не обязан иметь daily-row.
  if (normalizedStage === 'advertising') return coverageIncludes(coverage,date)
  return coverageIncludes(coverage,date) || stateConfirmsBusinessDate(state,date)
}

export function dailyOperationalRecoveryPlan({ coverage = {}, states = [], date = '', now = Date.now(), minimumRetryMs = 5*60*1000 } = {}) {
  if (!date) return []
  const map = new Map((Array.isArray(states) ? states : []).map(item=>[String(item?.stage || ''),item]))
  const blocked = new Set(['running','pending','queued','rate_limited','retry_scheduled','missing_token','token_invalid','forbidden','subscription_required','optional_unavailable'])
  const plan = []
  for (const stage of DAILY_READY_OPERATIONAL_RECOVERY_STAGES) {
    const state = map.get(stage) || {}
    if (dailyOperationalStageCovered({stage,coverage:coverage?.[stage] || {},state,date})) continue
    const status = String(state?.status || '')
    if (blocked.has(status)) continue
    const nextAllowed = millis(state?.next_allowed_at || state?.nextAllowedAt)
    if (nextAllowed > now) continue
    const lastAttempt = Math.max(
      millis(state?.last_attempt_at || state?.lastAttemptAt),
      millis(state?.updated_at || state?.updatedAt),
    )
    if (lastAttempt && now-lastAttempt < Math.max(30000,Number(minimumRetryMs || 0))) continue
    plan.push(stage)
  }
  return plan
}

function streamState(state = {}, { hasRows = false, coverage = null, date = '', allowConfirmedEmpty = true, confirmedByState = false, requireSelectedRows = false } = {}) {
  const status = String(state?.status || '')
  const failed = ['error','forbidden','missing_token','token_invalid','subscription_required'].includes(status)
  const covered = coverageIncludes(coverage,date) && (!requireSelectedRows || Number(coverage?.selectedRows || 0) > 0)

  // 5.13.1: состояние текущей очереди не имеет права обнулять уже сохранённый
  // подтверждённый день. canonicalConnectionData читает последний сохранённый
  // успешный поток; если его покрытие включает дату, эти данные уже доступны
  // для Daily Ready независимо от того, что следующий refresh сейчас queued/running.
  if (covered) return { state:'ready', covered:true, evidence:'persisted_coverage' }
  if (confirmedByState) return { state:'ready', covered:true, evidence:'wb_query_confirmed_date' }
  if (hasRows) return { state:'partial', covered:false, evidence:'persisted_rows' }
  if (failed) return { state:'missing', covered:false, evidence:'stream_error' }
  return { state:'waiting', covered:false, evidence:allowConfirmedEmpty ? 'no_persisted_coverage' : 'no_finance_evidence' }
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

  const orderState = stateMap.get('orders') || {}
  const saleState = stateMap.get('sales') || {}
  const orders = streamState(orderState,{
    hasRows:Number(coverage?.orders?.selectedRows || 0)>0,coverage:coverage?.orders,date,
    confirmedByState:stateConfirmsBusinessDate(orderState,date),requireSelectedRows:true,
  })
  const sales = streamState(saleState,{
    hasRows:Number(coverage?.sales?.selectedRows || 0)>0,coverage:coverage?.sales,date,
    confirmedByState:stateConfirmsBusinessDate(saleState,date),requireSelectedRows:true,
  })
  const advertising = streamState(stateMap.get('advertising') || {},{
    hasRows:Number(coverage?.advertising?.selectedRows || 0)>0,coverage:coverage?.advertising,date,
  })
  const finance = streamState(stateMap.get('finance') || {},{
    hasRows:financeRows>0,coverage:financeCoverage,date,allowConfirmedEmpty:false,
  })
  if (financeRows > 0 && finance.state === 'waiting') finance.state = 'partial'
  // Финансовые движения за дату можно показывать сразу, но итог считается
  // полностью подтверждённым только когда сам финансовый набор помечен complete.
  if (financeRows > 0 && coverageIncludes(financeCoverage,date)) {
    finance.state = core?.finance?.complete === true ? 'ready' : 'partial'
    finance.covered = true
    finance.evidence = core?.finance?.complete === true ? 'persisted_finance_complete' : 'persisted_finance_partial'
  }

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


const SNAPSHOT_DOMAIN_FIELDS = Object.freeze({
  orders:['orders'],
  sales:['revenue','sales','returns','returnRate'],
  advertising:['advertising','advertisingSource'],
  finance:[
    'sellerPayable','commission','commissionSource','logistics','logisticsSource','storage','storageSource',
    'acceptance','acceptanceSource','acquiring','acquiringSource','penalties','deductions','additionalPayment',
    'sellerBalance','fixed','tax','cogs','operatingProfit','margin',
  ],
  stocks:['stockUnits','zeroStock','lowStock','slowStock','stockCoverDays'],
})

function copyFields(target = {}, source = {}, fields = []) {
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(source || {},field)) target[field]=source[field]
  }
}

export function mergeDailyReadySnapshots(previous = null, current = null) {
  if (!previous || !current || String(previous?.date || '') !== String(current?.date || '')) return current
  const merged = {
    ...current,
    core:{ ...(current.core || {}),summary:{ ...(current?.core?.summary || {}) } },
    metricStates:{ ...(current.metricStates || {}) },
    stability:{ carriedDomains:[],previousGeneratedAt:previous.generatedAt || null },
  }
  const previousStates=previous?.metricStates || {}
  const currentStates=current?.metricStates || {}

  for (const domain of Object.keys(SNAPSHOT_DOMAIN_FIELDS)) {
    const oldState=String(previousStates?.[domain]?.state || '')
    const nextState=String(currentStates?.[domain]?.state || '')
    // Last-known-good: уже подтверждённая цифра за закрытый день не исчезает
    // из-за нового фонового цикла, временной очереди или частичного refresh.
    if (oldState !== 'ready' || nextState === 'ready') continue
    merged.metricStates[domain]={ ...previousStates[domain],carriedForward:true }
    copyFields(merged.core.summary,previous?.core?.summary || {},SNAPSHOT_DOMAIN_FIELDS[domain])
    merged.stability.carriedDomains.push(domain)

    if (domain === 'sales') {
      merged.core.topProducts=previous?.core?.topProducts || merged.core.topProducts
      merged.core.dailyTrend=previous?.core?.dailyTrend || merged.core.dailyTrend
    }
    if (domain === 'advertising') merged.core.advertising=previous?.core?.advertising || merged.core.advertising
    if (domain === 'finance') merged.core.finance=previous?.core?.finance || merged.core.finance
    if (domain === 'stocks') merged.core.stockMeta=previous?.core?.stockMeta || merged.core.stockMeta
  }

  const readiness=dailyReadinessSummary(merged.metricStates)
  merged.readiness=readiness
  merged.status=readiness.status
  merged.stability.lastKnownGood=merged.stability.carriedDomains.length>0
  return merged
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
