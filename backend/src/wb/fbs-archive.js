import crypto from 'node:crypto'

export const FBS_ARCHIVE_ENDPOINT = 'https://marketplace-api.wildberries.ru/api/marketplace/v3/fbs/orders/archive'

function validMonth(value) {
  const year = Number(value?.year)
  const month = Number(value?.month)
  return Number.isInteger(year) && year >= 2000 && year <= 2200 && Number.isInteger(month) && month >= 1 && month <= 12
}

export function fbsArchiveMonthSequence(totalMonths = 24, now = new Date()) {
  const count = Math.max(1, Math.min(60, Number(totalMonths) || 24))
  const anchor = new Date(now)
  if (Number.isNaN(anchor.getTime())) throw new Error('Некорректная опорная дата архива FBS')
  const cutoff = new Date(anchor)
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 3)
  const cursor = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth(), 1))
  const months = []
  for (let index = 0; index < count; index += 1) {
    months.push({ year:cursor.getUTCFullYear(), month:cursor.getUTCMonth() + 1 })
    cursor.setUTCMonth(cursor.getUTCMonth() - 1)
  }
  return months
}

export function normalizeFbsArchivePlan(metadata = {}, totalMonths = 24, now = new Date()) {
  const savedMonths = Array.isArray(metadata?.archiveMonths) ? metadata.archiveMonths.filter(validMonth).map(row=>({year:Number(row.year),month:Number(row.month)})) : []
  const anchorCandidate = metadata?.archiveAnchor ? new Date(metadata.archiveAnchor) : new Date(now)
  const anchor = Number.isNaN(anchorCandidate.getTime()) ? new Date(now) : anchorCandidate
  let months = savedMonths
  let legacyPlanRecovered = false
  if (!months.length && validMonth(metadata?.currentMonth)) {
    const count = Math.max(1, Math.min(60, Number(totalMonths) || 24))
    const currentIndex = Math.max(0, Math.min(count - 1, Number(metadata?.monthIndex || 0)))
    const first = new Date(Date.UTC(Number(metadata.currentMonth.year), Number(metadata.currentMonth.month) - 1, 1))
    first.setUTCMonth(first.getUTCMonth() + currentIndex)
    months = []
    for (let index = 0; index < count; index += 1) {
      months.push({ year:first.getUTCFullYear(), month:first.getUTCMonth() + 1 })
      first.setUTCMonth(first.getUTCMonth() - 1)
    }
    legacyPlanRecovered = true
  }
  if (!months.length) months = fbsArchiveMonthSequence(totalMonths, anchor)
  const cutoff = new Date(anchor)
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 3)
  return {
    archiveAnchor: anchor.toISOString(),
    archiveCutoff: cutoff.toISOString(),
    archiveMonths: months,
    legacyPlanRecovered,
  }
}

export function buildFbsArchiveUrl(month, next = 0, limit = 1000) {
  if (!validMonth(month)) throw new Error('Некорректный месяц архива FBS')
  const cursor = Math.max(0, Number(next) || 0)
  const pageLimit = Math.max(100, Math.min(1000, Number(limit) || 1000))
  const params = new URLSearchParams({
    year:String(Number(month.year)), month:String(Number(month.month)), next:String(cursor), limit:String(pageLimit),
  })
  return `${FBS_ARCHIVE_ENDPOINT}?${params.toString()}`
}

export function parseFbsArchivePage(payload, currentCursor = 0) {
  const orders = Array.isArray(payload?.orders)
    ? payload.orders
    : Array.isArray(payload?.data?.orders)
      ? payload.data.orders
      : null
  if (!orders) throw Object.assign(new Error('Архив FBS: WB вернул ответ без массива orders'), { status:502, code:'WB_FBS_ARCHIVE_BAD_PAYLOAD' })
  const nextRaw = payload?.next ?? payload?.data?.next ?? 0
  const next = Number(nextRaw)
  if (!Number.isSafeInteger(next) || next < 0) {
    throw Object.assign(new Error('Архив FBS: WB вернул некорректный курсор next'), { status:502, code:'WB_FBS_ARCHIVE_BAD_CURSOR' })
  }
  if (next > 0 && next === Number(currentCursor || 0)) {
    throw Object.assign(new Error('Архив FBS: курсор WB не изменился, загрузка остановлена без потери уже сохранённых данных'), { status:502, code:'WB_FBS_ARCHIVE_CURSOR_LOOP' })
  }
  return { orders, next, complete:next === 0 }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function fbsArchiveOrderKey(row = {}, index = 0) {
  const explicit = row.id ?? row.orderId ?? row.order_id ?? row.rid ?? row.orderUid ?? row.order_uid
  if (explicit != null && String(explicit).trim()) return `fbsArchive:id:${String(explicit).trim()}`
  const digest = crypto.createHash('sha1').update(stableJson(row)).digest('hex')
  return `fbsArchive:sha:${digest || index}`
}

export function fbsArchiveMonthKey(month) {
  return `${Number(month.year)}-${String(Number(month.month)).padStart(2,'0')}`
}
