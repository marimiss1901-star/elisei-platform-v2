import { cleanNumericId, cleanText, unique } from '../identity.js'

function arrayPayload(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.adverts)) return payload.adverts
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload?.result)) return payload.result
  return []
}

function numberOrNull(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function metric(row, keys) {
  for (const key of keys) {
    const value = numberOrNull(row?.[key])
    if (value != null) return value
  }
  return 0
}

const METRICS = {
  views:['views'],
  clicks:['clicks'],
  spend:['sum','spend'],
  orders:['orders'],
  revenue:['orders_price','ordersPrice','sum_price','sumPrice'],
}

function collectDailyStats(campaign = {}) {
  const byDate = new Map()
  const add = (date, row = {}) => {
    if (!date) return
    const key = String(date).slice(0,10)
    const current = byDate.get(key) || { date:key,views:0,clicks:0,spend:0,orders:0,revenue:0 }
    current.views += metric(row,METRICS.views)
    current.clicks += metric(row,METRICS.clicks)
    current.spend += metric(row,METRICS.spend)
    current.orders += metric(row,METRICS.orders)
    current.revenue += metric(row,METRICS.revenue)
    byDate.set(key,current)
  }
  for (const day of Array.isArray(campaign?.days) ? campaign.days : []) {
    const date = day?.date || day?.day || day?.dt
    const apps = Array.isArray(day?.apps) ? day.apps : []
    const hasDayMetrics = Object.values(METRICS).some(keys => keys.some(key => numberOrNull(day?.[key]) != null))
    if (hasDayMetrics || !apps.length) add(date,day)
    else apps.forEach(app=>add(date,app))
  }
  return [...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(row=>({
    ...row,
    ctr:row.views > 0 ? row.clicks / row.views * 100 : null,
    cpc:row.clicks > 0 ? row.spend / row.clicks : null,
    crr:row.revenue > 0 ? row.spend / row.revenue * 100 : null,
    romi:row.spend > 0 ? (row.revenue-row.spend)/row.spend*100 : null,
  }))
}

function collectProductStats(campaign = {}) {
  const result = []
  const push = row => {
    const nmID = cleanNumericId(row?.nmId ?? row?.nmID ?? row?.nm)
    if (!nmID) return
    result.push({
      nmID,
      name:cleanText(row?.name || row?.title),
      views:metric(row, METRICS.views),
      clicks:metric(row, METRICS.clicks),
      spend:metric(row, METRICS.spend),
      orders:metric(row, METRICS.orders),
      revenue:metric(row, METRICS.revenue),
    })
  }

  const directArrays = [campaign?.nms, campaign?.nmStats, campaign?.nm]
  directArrays.forEach(value => { if (Array.isArray(value)) value.forEach(push) })
  for (const day of Array.isArray(campaign?.days) ? campaign.days : []) {
    if (Array.isArray(day?.nms)) day.nms.forEach(push)
    if (Array.isArray(day?.nm)) day.nm.forEach(push)
    for (const app of Array.isArray(day?.apps) ? day.apps : []) {
      if (Array.isArray(app?.nms)) app.nms.forEach(push)
      if (Array.isArray(app?.nm)) app.nm.forEach(push)
    }
  }

  const byNmID = new Map()
  for (const item of result) {
    const current = byNmID.get(item.nmID) || { ...item, views:0, clicks:0, spend:0, orders:0, revenue:0 }
    current.name ||= item.name
    current.views += item.views
    current.clicks += item.clicks
    current.spend += item.spend
    current.orders += item.orders
    current.revenue += item.revenue
    byNmID.set(item.nmID, current)
  }
  return [...byNmID.values()]
}

export function normalizeCampaignList(payload) {
  const rows = []
  const seen = new Set()
  const push = (row, inherited = {}) => {
    const advertId = cleanNumericId(row?.advertId ?? row?.advert_id ?? row?.id)
    if (!advertId || seen.has(advertId)) return
    seen.add(advertId)
    const nmIds = unique([
      ...(Array.isArray(row?.nmIds) ? row.nmIds : []),
      ...(Array.isArray(row?.nms) ? row.nms.map(item => typeof item === 'object' ? item?.nmId ?? item?.nmID ?? item?.nm : item) : []),
    ], cleanNumericId)
    rows.push({
      advertId,
      name:cleanText(row?.name || row?.advertName || row?.campaignName) || `Кампания ${advertId}`,
      status:Number(row?.status ?? inherited.status ?? 0),
      type:Number(row?.type ?? inherited.type ?? 0),
      paymentType:cleanText(row?.payment_type || row?.paymentType || inherited.paymentType),
      changeTime:cleanText(row?.changeTime || row?.change_time) || null,
      nmIds,
    })
  }

  for (const node of arrayPayload(payload)) {
    if (!node || typeof node !== 'object') continue
    if (Array.isArray(node?.advert_list)) {
      node.advert_list.forEach(item => push(item, node))
    } else {
      push(node)
    }
  }
  return rows
}

export function normalizeFullStats(payload) {
  const rows = arrayPayload(payload)
  const byAdvertId = new Map()
  for (const row of rows) {
    const advertId = cleanNumericId(row?.advertId ?? row?.advert_id ?? row?.id)
    if (!advertId) continue
    const nmStats = collectProductStats(row)
    const dailyStats = collectDailyStats(row)
    const hasTopLevelMetrics = Object.values(METRICS).some(keys => keys.some(key => numberOrNull(row?.[key]) != null))
    const totals = {
      views:hasTopLevelMetrics ? metric(row, METRICS.views) : nmStats.reduce((sum,item) => sum+item.views,0),
      clicks:hasTopLevelMetrics ? metric(row, METRICS.clicks) : nmStats.reduce((sum,item) => sum+item.clicks,0),
      spend:hasTopLevelMetrics ? metric(row, METRICS.spend) : nmStats.reduce((sum,item) => sum+item.spend,0),
      orders:hasTopLevelMetrics ? metric(row, METRICS.orders) : nmStats.reduce((sum,item) => sum+item.orders,0),
      revenue:hasTopLevelMetrics ? metric(row, METRICS.revenue) : nmStats.reduce((sum,item) => sum+item.revenue,0),
    }
    byAdvertId.set(advertId, { advertId, ...totals, nmStats, dailyStats, statsAvailable:true })
  }
  return byAdvertId
}

function totalsFor(campaigns = []) {
  const loaded = campaigns.filter(item => item.statsStatus === 'loaded')
  const totals = loaded.reduce((acc, item) => {
    acc.views += Number(item.views || 0)
    acc.clicks += Number(item.clicks || 0)
    acc.spend += Number(item.spend || 0)
    acc.orders += Number(item.orders || 0)
    acc.revenue += Number(item.revenue || 0)
    return acc
  }, { views:0, clicks:0, spend:0, orders:0, revenue:0 })
  totals.ctr = totals.views > 0 ? totals.clicks / totals.views * 100 : null
  totals.cpc = totals.clicks > 0 ? totals.spend / totals.clicks : null
  totals.crr = totals.revenue > 0 ? totals.spend / totals.revenue * 100 : null
  totals.romi = totals.spend > 0 ? (totals.revenue - totals.spend) / totals.spend * 100 : null
  totals.orderConversion = totals.clicks > 0 ? totals.orders / totals.clicks * 100 : null
  return totals
}

function dailyTotalsFor(campaigns = []) {
  const byDate = new Map()
  for (const campaign of campaigns) {
    if (campaign.statsStatus !== 'loaded') continue
    for (const row of Array.isArray(campaign.dailyStats) ? campaign.dailyStats : []) {
      const current = byDate.get(row.date) || { date:row.date,views:0,clicks:0,spend:0,orders:0,revenue:0 }
      current.views += Number(row.views || 0)
      current.clicks += Number(row.clicks || 0)
      current.spend += Number(row.spend || 0)
      current.orders += Number(row.orders || 0)
      current.revenue += Number(row.revenue || 0)
      byDate.set(row.date,current)
    }
  }
  return [...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(row=>({
    ...row,
    ctr:row.views > 0 ? row.clicks / row.views * 100 : null,
    cpc:row.clicks > 0 ? row.spend / row.clicks : null,
    crr:row.revenue > 0 ? row.spend / row.revenue * 100 : null,
    romi:row.spend > 0 ? (row.revenue-row.spend)/row.spend*100 : null,
  }))
}

export function mergeAdvertisingSnapshot({ previous = {}, campaigns = [], statsByAdvertId = new Map(), requestedIds = [], period = null }) {
  const previousById = new Map((Array.isArray(previous?.campaigns) ? previous.campaigns : []).map(item => [String(item.advertId), item]))
  const requested = new Set(requestedIds.map(String))
  const merged = campaigns.map(campaign => {
    const id = String(campaign.advertId)
    const stats = statsByAdvertId.get(id)
    const old = previousById.get(id)
    if (stats) {
      return {
        ...campaign,
        ...stats,
        nmIds:unique([...(campaign.nmIds || []), ...(stats.nmStats || []).map(item => item.nmID)], cleanNumericId),
        statsStatus:'loaded',
        statsLoadedAt:new Date().toISOString(),
      }
    }
    if (old?.statsStatus === 'loaded') return { ...old, ...campaign, nmIds:unique([...(old.nmIds || []), ...(campaign.nmIds || [])], cleanNumericId) }
    return {
      ...campaign,
      views:null, clicks:null, spend:null, orders:null, revenue:null,
      ctr:null, cpc:null, crr:null, romi:null, orderConversion:null, nmStats:[], dailyStats:[],
      statsStatus:requested.has(id) ? 'empty_response' : 'not_requested',
      statsLoadedAt:null,
    }
  })
  for (const campaign of merged) {
    if (campaign.statsStatus !== 'loaded') continue
    campaign.ctr = campaign.views > 0 ? campaign.clicks / campaign.views * 100 : null
    campaign.cpc = campaign.clicks > 0 ? campaign.spend / campaign.clicks : null
    campaign.crr = campaign.revenue > 0 ? campaign.spend / campaign.revenue * 100 : null
    campaign.romi = campaign.spend > 0 ? (campaign.revenue-campaign.spend)/campaign.spend*100 : null
    campaign.orderConversion = campaign.clicks > 0 ? campaign.orders/campaign.clicks*100 : null
  }
  return {
    campaigns:merged,
    totals:totalsFor(merged),
    daily:dailyTotalsFor(merged),
    period,
    totalCampaigns:merged.length,
    statsLoadedCampaigns:merged.filter(item => item.statsStatus === 'loaded').length,
    statsPendingCampaigns:merged.filter(item => item.statsStatus !== 'loaded').length,
  }
}
