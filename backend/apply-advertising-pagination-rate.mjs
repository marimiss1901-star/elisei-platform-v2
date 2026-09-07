import fs from 'node:fs'

function replaceOnce(source, oldText, newText, label) {
  if (source.includes(newText)) return source
  if (!source.includes(oldText)) throw new Error(`Advertising pagination guard: ${label} target not found`)
  return source.replace(oldText,newText)
}

const serverFile='src/server.js'
let server=fs.readFileSync(serverFile,'utf8')

const functionStart='async function loadAdvertising(token, { deadlineAt = 0, previous = {}, period = null } = {}) {'
const functionEnd='\n\nfunction reportPeriod(days = 30) {'
const start=server.indexOf(functionStart)
const end=server.indexOf(functionEnd,start)
if(start<0 || end<0) throw new Error('Advertising pagination guard: loadAdvertising block not found')

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

  // WB campaign list has a much stricter rate window than fullstats. A multi-batch
  // statistics sync must fetch the campaign catalogue only once and then reuse the
  // normalized campaign definitions already persisted in the previous partial snapshot.
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
  // fullstats accepts statistics only for campaigns in active/pause/finished
  // statistics statuses. Keep every campaign visible in ELISEI, but never send
  // unsupported status 4/8 ids to fullstats.
  const statsCampaigns=campaigns.filter(item=>[7,9,11].includes(Number(item.status)))

  if (!campaigns.length) {
    const value = mergeAdvertisingSnapshot({ previous:previousForPeriod, campaigns:[], requestedIds:[], period:selectedPeriod })
    value.meta = buildAdvertisingMeta(value)
    return { value, rawPayload:{ campaigns:campaignPayload, stats:[] }, validation:{ campaigns:0, statsRows:0 }, endpoint:campaignEndpoint }
  }

  const batchSize = 50
  const paginationVersion=2
  // Old partial snapshots paginated across all 190 campaigns, including unsupported
  // statuses. Reset their offset once and continue on the eligible-id list only.
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
  const value = mergeAdvertisingSnapshot({
    previous:previousForPeriod,
    campaigns,
    statsByAdvertId,
    requestedIds,
    period:selectedPeriod,
  })
  const nextStatsOffset = offset + batch.length >= statsCampaigns.length ? 0 : offset + batch.length
  value.meta = {
    ...buildAdvertisingMeta(value),
    nextStatsOffset,
    requestedCampaigns:requestedIds.length,
    statsResponseCampaigns:statsByAdvertId.size,
    allCampaigns:campaigns.length,
    statsEligibleCampaigns:statsCampaigns.length,
    statsPaginationVersion:paginationVersion,
    reusedCampaignList:Boolean(reusableCampaigns.length),
  }
  return {
    value,
    rawPayload:{ campaigns:campaignPayload, stats:statsPayload },
    validation:{ campaigns:campaigns.length, statsEligibleCampaigns:statsCampaigns.length, requestedCampaigns:requestedIds.length, statsResponseCampaigns:statsByAdvertId.size, nextStatsOffset, reusedCampaignList:Boolean(reusableCampaigns.length) },
    endpoint:statsEndpoint ? \`\${campaignEndpoint} + \${statsEndpoint}\` : campaignEndpoint,
  }
}`

server=server.slice(0,start)+replacement+server.slice(end)

server=replaceOnce(
  server,
  'nextAllowedAt:new Date(Date.now()+13000).toISOString()',
  'nextAllowedAt:new Date(Date.now()+21000).toISOString()',
  'respect fullstats 20-second interval',
)

fs.writeFileSync(serverFile,server)
console.log('ELISEI 5.19.0 advertising pagination/rate guard applied')
