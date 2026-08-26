const PRIORITY = Object.freeze({
  products: 5,
  orders: 10,
  sales: 20,
  sellerStocks: 30,
  stocks: 35,
  finance: 40,
  advertising: 45,
  funnel: 50,
  acquiring: 55,
  paidStorage: 60,
  acceptance: 62,
  tariffs: 65,
  goodsReturns: 70,
  searchQueries: 75,
  stockHistory: 78,
  reviews: 82,
  questions: 84,
  chats: 86,
  documents: 90,
  measurementPenalties: 94,
  deductionsReport: 96,
  warehouseMeasurements: 98,
  antifraudRetention: 100,
  labelingRetention: 102,
  financeReports: 110,
  acquiringReports: 112,
  jamSubscription: 114,
  fbsArchive: 200,
})

const GROUP = Object.freeze({
  products:'content', tariffs:'content',
  // Orders and sales are two ELISEI read models produced from one WB Order
  // Feed snapshot. Keeping them in their own group prevents unrelated Analytics
  // reports from delaying the seller-day operational feed.
  orders:'orderFeed', sales:'orderFeed',
  sellerStocks:'marketplace', fbsArchive:'marketplace',
  stocks:'analytics', paidStorage:'analytics', acceptance:'analytics', measurementPenalties:'analytics',
  deductionsReport:'analytics', warehouseMeasurements:'analytics', antifraudRetention:'analytics',
  labelingRetention:'analytics', goodsReturns:'analytics', funnel:'analytics', searchQueries:'analytics', stockHistory:'analytics',
  advertising:'promotion',
  finance:'finance', acquiring:'finance', financeReports:'finance', acquiringReports:'finance', jamSubscription:'finance',
  documents:'documents',
  reviews:'feedbacks', questions:'feedbacks', chats:'feedbacks',
})

// Dispatch spacing applies only INSIDE one WB API group. Independent groups
// are intentionally allowed to progress in the same scheduler cycle.
const GROUP_GAP_MS = Object.freeze({
  orderFeed: 2500,
  statistics: 2500,
  analytics: 2500,
  finance: 2500,
  documents: 2500,
  marketplace: 1800,
  content: 1800,
  promotion: 1200,
  feedbacks: 1200,
  default: 1800,
})

export const SMART_SCHEDULER_INITIAL_GAP_MS = 5000

export function stagePriority(stage) {
  return Number(PRIORITY[String(stage)] ?? 150)
}

export function schedulerGroup(stage) {
  return GROUP[String(stage)] || 'default'
}

export function schedulerGroupGapMs(stage) {
  return Number(GROUP_GAP_MS[schedulerGroup(stage)] || GROUP_GAP_MS.default)
}

export function schedulerWinnerKey(connectionId, stage) {
  return `${String(connectionId || '')}:${schedulerGroup(stage)}`
}

export function isSchedulerWaitingState(state = {}, now = Date.now()) {
  const status = String(state?.status || '')
  const next = Date.parse(state?.next_allowed_at || state?.nextAllowedAt || '')
  return ['queued','rate_limited','retry_scheduled','pending'].includes(status)
    && Number.isFinite(next)
    && next > now
}

export function schedulerVisualState(state = {}, now = Date.now()) {
  const status = String(state?.status || '')
  const count = Number(state?.last_count ?? state?.lastCount ?? state?.metadata?.persistedCount ?? 0)
  if (status === 'success') return 'ready'
  if (status === 'running' || status === 'pending') return 'loading'
  if (status === 'queued' && count > 0) return 'partial'
  if (isSchedulerWaitingState(state,now)) return status === 'retry_scheduled' ? 'retry' : 'waiting_window'
  if (status === 'queued') return 'queued'
  if (['error','forbidden','missing_token','token_invalid'].includes(status)) return 'error'
  return 'idle'
}

function bootstrapPriority(row = {}) {
  const value = Number(row?.metadata?.bootstrapBusinessPriority)
  return Number.isFinite(value) ? value : null
}

export function compareSchedulerRows(a = {}, b = {}) {
  const explicitA = bootstrapPriority(a)
  const explicitB = bootstrapPriority(b)

  const taskBoostA = a?.task_id || a?.taskId ? -20 : 0
  const taskBoostB = b?.task_id || b?.taskId ? -20 : 0
  const pendingBoostA = String(a?.status || '') === 'pending' ? -10 : 0
  const pendingBoostB = String(b?.status || '') === 'pending' ? -10 : 0
  const pa = (explicitA ?? stagePriority(a?.stage)) + taskBoostA + pendingBoostA
  const pb = (explicitB ?? stagePriority(b?.stage)) + taskBoostB + pendingBoostB
  if (pa !== pb) return pa - pb
  const ta = Date.parse(a?.next_allowed_at || a?.nextAllowedAt || a?.updated_at || '') || 0
  const tb = Date.parse(b?.next_allowed_at || b?.nextAllowedAt || b?.updated_at || '') || 0
  if (ta !== tb) return ta - tb
  return String(a?.stage || '').localeCompare(String(b?.stage || ''))
}

export function chooseCycleWinners(rows = []) {
  const sorted = [...rows].sort(compareSchedulerRows)
  const winners = new Map()
  for (const row of sorted) {
    const connectionId = String(row?.connection_id || row?.connectionId || '')
    const stage = String(row?.stage || '')
    if (!connectionId || !stage) continue
    const key = schedulerWinnerKey(connectionId,stage)
    if (winners.has(key)) continue
    winners.set(key,stage)
  }
  return winners
}

export function initialStageSchedule(stages = [], { now = Date.now(), gapMs = SMART_SCHEDULER_INITIAL_GAP_MS } = {}) {
  const ordered = [...new Set((Array.isArray(stages) ? stages : []).map(String))]
    .sort((a,b) => stagePriority(a) - stagePriority(b))
  const groupNext = new Map()
  const fallbackGap = Math.max(1000,Number(gapMs || SMART_SCHEDULER_INITIAL_GAP_MS))
  return ordered.map((stage,index) => {
    const group = schedulerGroup(stage)
    const scheduledAt = Number(groupNext.get(group) ?? now)
    groupNext.set(group,scheduledAt + Math.max(fallbackGap,schedulerGroupGapMs(stage)))
    return {
      stage,
      priority:stagePriority(stage),
      group,
      sequence:index + 1,
      nextAllowedAt:new Date(scheduledAt).toISOString(),
    }
  })
}
