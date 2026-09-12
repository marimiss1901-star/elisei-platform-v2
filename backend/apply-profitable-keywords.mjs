import fs from 'node:fs'

// ELISEI 5.19.24 — profitable advertising search clusters.
// Runs after 5.19.0, therefore it deliberately replaces the final
// loadAdvertising implementation produced by the pagination/rate patch.
const file='src/server.js'
let source=fs.readFileSync(file,'utf8')

if (!source.includes('function advertisingKeywordPairs(campaigns = []) {')) {
  const marker='function buildAdvertisingMeta(value = {}) {'
  if(!source.includes(marker)) throw new Error('ELISEI 5.19.24: advertising meta marker not found')
  const helpers=`function advertisingKeywordPairs(campaigns = []) {
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
      const current=grouped.get(key) || {advertId,nmId,normQuery,views:0,clicks:0,atbs:0,orders:0,shks:0,spend:0,weightedPosition:0,positionWeight:0,dates:0}
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
    views:Math.round(row.views),clicks:Math.round(row.clicks),atbs:Math.round(row.atbs),orders:Math.round(row.orders),shks:Math.round(row.shks),
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

`
  source=source.replace(marker,helpers+marker)
}

const functionStart='async function loadAdvertising(token, { deadlineAt = 0, previous = {}, period = null } = {}) {'
const functionEnd='\n\nfunction reportPeriod(days = 30) {'
const start=source.indexOf(functionStart)
const end=source.indexOf(functionEnd,start)
if(start<0 || end<0) throw new Error('ELISEI 5.19.24: loadAdvertising block not found')

const replacement=`async function loadAdvertising(token, { deadlineAt = 0, previous = {}, period = null } = {}) {
  const campaignEndpoint = 'https://advert-api.wildberries.ru/api/advert/v2/adverts?statuses=4,7,8,9,11'
  const defaultPeriod = reportPeriod(30)
  const selectedPeriod = period && (period.dateFrom || period.from) && (period.dateTo || period.to)
    ? {
        beginDate:dateKey(period.dateFrom || period.from),
        endDate:dateKey(period.dateTo || period.to),
        days:Number(period.days || 30),
        requestedFrom:period.requestedFrom || null,
        requestedTo:period.requestedTo || null,
        limited:Boolean(period.limited),
      }
    : { beginDate:defaultPeriod.dateFrom,endDate:defaultPeriod.dateTo,days:defaultPeriod.days }
  const previousFrom=dateKey(previous?.period?.beginDate || previous?.period?.from || previous?.period?.dateFrom)
  const previousTo=dateKey(previous?.period?.endDate || previous?.period?.to || previous?.period?.dateTo)
  const previousForPeriod=previousFrom===selectedPeriod.beginDate && previousTo===selectedPeriod.endDate ? previous : {}

  const previousRawOffset=Math.max(0,Number(previousForPeriod?.meta?.nextStatsOffset || period?.nextStatsOffset || 0))
  const reusableCampaigns=previousRawOffset>0 && Array.isArray(previousForPeriod?.campaigns) && previousForPeriod.campaigns.length
    ? previousForPeriod.campaigns
    : []
  let campaignPayload
  let allCampaigns
  if(reusableCampaigns.length){
    campaignPayload={reusedPreviousCampaigns:true,count:reusableCampaigns.length}
    allCampaigns=normalizeCampaignListStrict(reusableCampaigns)
  }else{
    campaignPayload=await wbFetch(campaignEndpoint,token,{
      label:'Кампании WB',timeoutMs:45000,maxAttempts:1,maxRetryDelayMs:0,deadlineAt,
    })
    allCampaigns=normalizeCampaignListStrict(campaignPayload)
  }

  const statusPriority = status => ({ 9:0, 11:1, 7:2, 4:3, 8:4 }[Number(status)] ?? 9)
  const campaigns = [...allCampaigns].sort((a,b) => statusPriority(a.status)-statusPriority(b.status) || Date.parse(b.changeTime || 0)-Date.parse(a.changeTime || 0))
  const statsCampaigns=campaigns.filter(item=>[7,9,11].includes(Number(item.status)))

  if (!campaigns.length) {
    const value = mergeAdvertisingSnapshot({ previous:previousForPeriod, campaigns:[], requestedIds:[], period:selectedPeriod })
    value.keywordRows=[]
    value.keywordStatsAvailable=false
    value.meta = {...buildAdvertisingMeta(value),nextKeywordOffset:0,keywordPairs:0,keywordRows:0,keywordRequestedPairs:0}
    return { value, rawPayload:{ campaigns:campaignPayload, stats:[], keywordStats:null }, validation:{ campaigns:0, statsRows:0, keywordRows:0 }, endpoint:campaignEndpoint }
  }

  const batchSize = 50
  const paginationVersion=2
  const previousOffset = Number(previousForPeriod?.meta?.statsPaginationVersion)===paginationVersion
    ? Math.max(0,Number(previousForPeriod?.meta?.nextStatsOffset || period?.nextStatsOffset || 0))
    : 0
  const offset = previousOffset >= statsCampaigns.length ? 0 : previousOffset
  const batch = statsCampaigns.slice(offset, offset + batchSize)
  const requestedIds = batch.map(item => String(item.advertId))
  const endDate = selectedPeriod.endDate
  const beginDate = selectedPeriod.beginDate
  const statsEndpoint = requestedIds.length
    ? \`https://advert-api.wildberries.ru/adv/v3/fullstats?ids=\${encodeURIComponent(requestedIds.join(','))}&beginDate=\${beginDate}&endDate=\${endDate}\`
    : ''
  const statsPayload = requestedIds.length ? await wbFetch(statsEndpoint, token, {
    label:'Статистика рекламы WB', timeoutMs:60000, maxAttempts:1, maxRetryDelayMs:0, deadlineAt,
  }) : []
  const statsByAdvertId = normalizeFullStatsStrict(statsPayload)
  const value = mergeAdvertisingSnapshot({previous:previousForPeriod,campaigns,statsByAdvertId,requestedIds,period:selectedPeriod})

  const keywordPairs=advertisingKeywordPairs(statsCampaigns)
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
      keywordError=String(error?.message || 'WB не отдал поисковые кластеры')
    }
  }
  const keywordRows=mergeKeywordStats(previousForPeriod?.keywordRows || [],freshKeywordRows,keywordError ? [] : keywordBatch)
  const nextKeywordOffset=keywordPairs.length && !keywordError
    ? (keywordOffset+keywordBatch.length >= keywordPairs.length ? 0 : keywordOffset+keywordBatch.length)
    : keywordOffset
  value.keywordRows=keywordRows
  value.keywordStatsAvailable=keywordRows.length>0
  value.keywordLoadedPairs=Math.min(keywordPairs.length,keywordOffset+(!keywordError ? keywordBatch.length : 0))
  value.keywordPendingPairs=Math.max(0,keywordPairs.length-value.keywordLoadedPairs)
  value.keywordError=keywordError

  const nextStatsOffset = offset + batch.length >= statsCampaigns.length ? 0 : offset + batch.length
  value.meta = {
    ...buildAdvertisingMeta(value),nextStatsOffset,nextKeywordOffset,
    requestedCampaigns:requestedIds.length,statsResponseCampaigns:statsByAdvertId.size,
    allCampaigns:campaigns.length,statsEligibleCampaigns:statsCampaigns.length,
    statsPaginationVersion:paginationVersion,reusedCampaignList:Boolean(reusableCampaigns.length),
    keywordPairs:keywordPairs.length,keywordRows:keywordRows.length,keywordRequestedPairs:keywordBatch.length,keywordError,
  }
  return {
    value,
    rawPayload:{ campaigns:campaignPayload, stats:statsPayload, keywordStats:keywordPayload },
    validation:{ campaigns:campaigns.length,statsEligibleCampaigns:statsCampaigns.length,requestedCampaigns:requestedIds.length,statsResponseCampaigns:statsByAdvertId.size,nextStatsOffset,reusedCampaignList:Boolean(reusableCampaigns.length),keywordPairs:keywordPairs.length,keywordRows:keywordRows.length,keywordRequestedPairs:keywordBatch.length,nextKeywordOffset,keywordError },
    endpoint:keywordBatch.length ? keywordEndpoint : (statsEndpoint || campaignEndpoint),
  }
}`

source=source.slice(0,start)+replacement+source.slice(end)

if (!source.includes("keywordRows: (advertisingPayload?.keywordRows || []).slice(0, 300)")) {
  source=source.replace(
    '        productRows: (advertisingPayload?.productRows || core.advertising?.productRows || []).slice(0, 100),',
    "        productRows: (advertisingPayload?.productRows || core.advertising?.productRows || []).slice(0, 100),\n        keywordRows: (advertisingPayload?.keywordRows || []).slice(0, 300),\n        keywordStatsAvailable:Boolean(advertisingPayload?.keywordStatsAvailable),\n        keywordError:advertisingPayload?.keywordError || null,"
  )
}
fs.writeFileSync(file,source)

const analystFile='src/services/elAnalystEngine.cjs'
let analyst=fs.readFileSync(analystFile,'utf8')
if (!analyst.includes('const asksKeywords = /(?:поисков|ключ|фраз|запрос)')) {
  analyst=analyst.replace(
    "  const message = String(options.message || tone?.message || '');",
    "  const message = String(options.message || tone?.message || '');\n  const asksKeywords = /(?:поисков|ключ|фраз|запрос).*(?:реклам|добав|запуст|масштаб)|(?:реклам).*(?:поисков|ключ|фраз|запрос)/i.test(message);\n  const paidKeywords = Array.isArray(ads.profitableKeywords) ? ads.profitableKeywords : [];\n  const rawPaidKeywords = Array.isArray(ads.keywordRows) ? ads.keywordRows : [];\n  const organicKeywords = Array.isArray(ads.organicKeywordOpportunities) ? ads.organicKeywordOpportunities : [];"
  )
  analyst=analyst.replace(
    "  if (ads.snapshotFallback) lines.push('Точного рекламного среза за выбранный период пока нет, поэтому беру последний сохранённый снимок кампаний и не выдаю его за полный факт периода.');",
    "  if (asksKeywords) {\n    const organic=organicKeywords.filter(item=>['gem','test'].includes(String(item?.opportunity||''))).slice(0,8);\n    const paid=paidKeywords.filter(item=>Number(item?.attributedProfit)>0&&Number(item?.orders||0)>0).slice(0,8);\n    const observed=rawPaidKeywords.filter(item=>Number(item?.orders||0)>0).slice(0,8);\n    if(organic.length){ lines.push('Новые органические запросы, которые стоит проверить для рекламы:'); organic.forEach(item=>lines.push('• '+(item.phrase||item.normQuery||'Запрос')+' — заказов '+number(item.orders)+', переходов '+number(item.openCard)+', потенциал '+money(item.contributionBeforeAds)+(item.provisional?' (предварительно)':'')+'.')); }\n    if(paid.length){ lines.push('Уже работающие прибыльные рекламные ключи:'); paid.forEach(item=>lines.push('• '+(item.normQuery||item.phrase||'Ключ')+' — заказов '+number(item.orders)+', расход '+money(item.spend)+', атрибутированная прибыль '+money(item.attributedProfit)+(item.provisional?' (предварительно)':'')+'.')); }\n    else if(observed.length){ lines.push('Рекламные ключи с подтверждёнными заказами (прибыль пока не подтверждена):'); observed.forEach(item=>lines.push('• '+(item.normQuery||item.phrase||'Ключ')+' — заказов '+number(item.orders)+', расход '+money(item.spend)+', CTR '+percent(item.ctr)+'.')); }\n    if(!organic.length&&!paid.length&&!observed.length) lines.push(ads.keywordStatsAvailable?'По загруженной части ключей пока нет кандидатов с подтверждёнными заказами.':'Поисковые кластеры рекламы WB ещё не загружены; конкретные ключи без данных не придумываю.');\n  }\n  if (ads.snapshotFallback) lines.push('Точного рекламного среза за выбранный период пока нет, поэтому беру последний сохранённый снимок кампаний и не выдаю его за полный факт периода.');"
  )
  analyst=analyst.replace('  if (!asksWinners) lines.push(`Вывод:', '  if (!asksWinners && !asksKeywords) lines.push(`Вывод:')
  analyst=analyst.replace('            productRows,\n            profitableKeywords:', '            productRows,\n            keywordRows:Array.isArray(advertising.keywordRows) ? advertising.keywordRows : [],\n            profitableKeywords:')
}
fs.writeFileSync(analystFile,analyst)
console.log('ELISEI 5.19.26 advertising keywords and El grounding applied')
