import fs from 'node:fs'

// ELISEI 5.19.24 — advertising search-cluster statistics.
// Enrich the existing advertising snapshot with WB /adv/v1/normquery/stats.
// Base tokens are limited to 2 requests/hour, so one cached batch (<=100
// campaign/nmID pairs) is collected per normal advertising refresh.
const file='src/server.js'
let source=fs.readFileSync(file,'utf8')

function replaceOnce(before,after,label){
  if(source.includes(after)) return
  if(!source.includes(before)) throw new Error(`ELISEI 5.19.24 profitable keywords: ${label} marker not found`)
  source=source.replace(before,after)
}

replaceOnce(
`function buildAdvertisingMeta(value = {}) {`,
`function advertisingKeywordPairs(campaigns = []) {
  const seen=new Set()
  const pairs=[]
  for (const campaign of Array.isArray(campaigns) ? campaigns : []) {
    const advertId=Number(campaign?.advertId)
    if (!Number.isFinite(advertId) || advertId <= 0) continue
    for (const rawNmId of Array.isArray(campaign?.nmIds) ? campaign.nmIds : []) {
      const nmId=Number(rawNmId)
      if (!Number.isFinite(nmId) || nmId <= 0) continue
      const key=advertId+':'+nmId
      if (seen.has(key)) continue
      seen.add(key)
      pairs.push({advertId,nmId})
    }
  }
  return pairs
}

function normalizeKeywordStats(payload = null) {
  const items=Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : []
  const grouped=new Map()
  for (const item of items) {
    const advertId=Number(item?.advertId ?? item?.advert_id)
    const nmId=Number(item?.nmId ?? item?.nmID ?? item?.nm_id)
    if (!Number.isFinite(advertId) || !Number.isFinite(nmId)) continue
    for (const day of Array.isArray(item?.dailyStats) ? item.dailyStats : []) {
      const stat=day?.stat && typeof day.stat === 'object' ? day.stat : day
      const normQuery=String(stat?.normQuery ?? stat?.norm_query ?? '').trim()
      if (!normQuery) continue
      const key=[advertId,nmId,normQuery.toLocaleLowerCase('ru-RU')].join('|')
      const current=grouped.get(key) || {
        advertId,nmId,normQuery,views:0,clicks:0,atbs:0,orders:0,shks:0,spend:0,
        weightedPosition:0,positionWeight:0,dates:0,
      }
      const views=Math.max(0,Number(stat?.views || 0))
      const clicks=Math.max(0,Number(stat?.clicks || 0))
      const avgPos=Number(stat?.avgPos ?? stat?.avg_pos)
      current.views += views
      current.clicks += clicks
      current.atbs += Math.max(0,Number(stat?.atbs || 0))
      current.orders += Math.max(0,Number(stat?.orders || 0))
      current.shks += Math.max(0,Number(stat?.shks || 0))
      current.spend += Math.max(0,Number(stat?.spend || 0))
      if (Number.isFinite(avgPos)) {
        const weight=Math.max(1,views || clicks || 1)
        current.weightedPosition += avgPos*weight
        current.positionWeight += weight
      }
      current.dates += 1
      grouped.set(key,current)
    }
  }
  return [...grouped.values()].map(row=>({
    advertId:row.advertId,nmId:row.nmId,normQuery:row.normQuery,
    views:Math.round(row.views),clicks:Math.round(row.clicks),atbs:Math.round(row.atbs),
    orders:Math.round(row.orders),shks:Math.round(row.shks),
    spend:Math.round(row.spend*100)/100,
    ctr:row.views>0 ? row.clicks/row.views*100 : null,
    cpc:row.clicks>0 ? row.spend/row.clicks : null,
    orderConversion:row.clicks>0 ? row.orders/row.clicks*100 : null,
    avgPos:row.positionWeight>0 ? row.weightedPosition/row.positionWeight : null,
    dates:row.dates,
  }))
}

function mergeKeywordStats(previousRows = [], freshRows = [], requestedPairs = []) {
  const requested=new Set((Array.isArray(requestedPairs) ? requestedPairs : []).map(item=>Number(item.advertId)+':'+Number(item.nmId)))
  const map=new Map()
  for (const row of Array.isArray(previousRows) ? previousRows : []) {
    const pair=Number(row?.advertId)+':'+Number(row?.nmId)
    if (requested.has(pair)) continue
    const key=[row?.advertId,row?.nmId,String(row?.normQuery || '').toLocaleLowerCase('ru-RU')].join('|')
    map.set(key,row)
  }
  for (const row of Array.isArray(freshRows) ? freshRows : []) {
    const key=[row?.advertId,row?.nmId,String(row?.normQuery || '').toLocaleLowerCase('ru-RU')].join('|')
    map.set(key,row)
  }
  return [...map.values()]
}

function buildAdvertisingMeta(value = {}) {`,
'keyword helpers')

replaceOnce(
`  const value = mergeAdvertisingSnapshot({
    previous:previousForPeriod,
    campaigns,
    statsByAdvertId,
    requestedIds,
    period:selectedPeriod,
  })
  const nextStatsOffset = offset + batch.length >= campaigns.length ? 0 : offset + batch.length`,
`  const value = mergeAdvertisingSnapshot({
    previous:previousForPeriod,
    campaigns,
    statsByAdvertId,
    requestedIds,
    period:selectedPeriod,
  })

  // Search-cluster stats are intentionally piggy-backed on the existing hourly
  // advertising refresh. The current Base token allows only two calls/hour to
  // this method, so ELISEI sends exactly one request with at most 100 pairs and
  // rotates the pair offset between refreshes while preserving prior batches.
  const keywordPairs=advertisingKeywordPairs(campaigns)
  const previousKeywordOffset=Math.max(0,Number(previousForPeriod?.meta?.nextKeywordOffset || period?.nextKeywordOffset || 0))
  const keywordOffset=previousKeywordOffset >= keywordPairs.length ? 0 : previousKeywordOffset
  const keywordBatch=keywordPairs.slice(keywordOffset,keywordOffset+100)
  const keywordEndpoint='https://advert-api.wildberries.ru/adv/v1/normquery/stats'
  let keywordPayload=null
  let freshKeywordRows=[]
  let keywordError=null
  if (keywordBatch.length) {
    try {
      keywordPayload=await wbFetch(keywordEndpoint,token,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({from:beginDate,to:endDate,items:keywordBatch}),
        label:'Поисковые кластеры рекламы WB',timeoutMs:60000,maxAttempts:1,maxRetryDelayMs:0,deadlineAt,
      })
      freshKeywordRows=normalizeKeywordStats(keywordPayload)
    } catch (error) {
      // Keyword statistics enrich the already valid advertising snapshot. A WB
      // cluster-rate/availability error must not discard campaign statistics.
      keywordError=String(error?.message || 'WB не отдал поисковые кластеры')
    }
  }
  const keywordRows=mergeKeywordStats(previousForPeriod?.keywordRows || [],freshKeywordRows,keywordError ? [] : keywordBatch)
  const nextKeywordOffset=keywordPairs.length && !keywordError
    ? (keywordOffset+keywordBatch.length >= keywordPairs.length ? 0 : keywordOffset+keywordBatch.length)
    : keywordOffset
  value.keywordRows=keywordRows
  value.keywordStatsAvailable=keywordRows.length>0
  value.keywordLoadedPairs=Math.min(keywordPairs.length,Math.max(keywordRows.length ? 1 : 0,keywordOffset+(!keywordError ? keywordBatch.length : 0)))
  value.keywordPendingPairs=Math.max(0,keywordPairs.length-value.keywordLoadedPairs)
  value.keywordError=keywordError

  const nextStatsOffset = offset + batch.length >= campaigns.length ? 0 : offset + batch.length`,
'keyword request in advertising loader')

replaceOnce(
`    nextStatsOffset,
    requestedCampaigns:requestedIds.length,
    statsResponseCampaigns:statsByAdvertId.size,
    allCampaigns:campaigns.length,
  }
  return {
    value,
    rawPayload:{ campaigns:campaignPayload, stats:statsPayload },
    validation:{ campaigns:campaigns.length, requestedCampaigns:requestedIds.length, statsResponseCampaigns:statsByAdvertId.size, nextStatsOffset },
    endpoint:\`${campaignEndpoint} + ${statsEndpoint}\`,
  }`,
`    nextStatsOffset,
    nextKeywordOffset,
    requestedCampaigns:requestedIds.length,
    statsResponseCampaigns:statsByAdvertId.size,
    allCampaigns:campaigns.length,
    keywordPairs:keywordPairs.length,
    keywordRows:keywordRows.length,
    keywordRequestedPairs:keywordBatch.length,
    keywordError,
  }
  return {
    value,
    rawPayload:{ campaigns:campaignPayload, stats:statsPayload, keywordStats:keywordPayload },
    validation:{ campaigns:campaigns.length, requestedCampaigns:requestedIds.length, statsResponseCampaigns:statsByAdvertId.size, nextStatsOffset, keywordPairs:keywordPairs.length, keywordRows:keywordRows.length, keywordRequestedPairs:keywordBatch.length, nextKeywordOffset, keywordError },
    endpoint:keywordBatch.length ? \`${campaignEndpoint} + ${statsEndpoint} + ${keywordEndpoint}\` : \`${campaignEndpoint} + ${statsEndpoint}\`,
  }`,
'keyword advertising metadata')

fs.writeFileSync(file,source)
console.log('ELISEI 5.19.24 profitable advertising keywords applied')
