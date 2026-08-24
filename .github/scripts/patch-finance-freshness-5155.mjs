import fs from 'node:fs'

function replaceOnce(source, from, to, label) {
  if (source.includes(to)) return source
  const count = source.split(from).length - 1
  if (count !== 1) throw new Error(`${label}: expected one marker, found ${count}`)
  return source.replace(from, to)
}

// 1) A queued/pending heavy stage already has its own continuation cursor.
// Nightly planning must never treat it as a fresh job and overwrite that cursor.
{
  const path='backend/src/wb/daily-ready.js'
  let source=fs.readFileSync(path,'utf8')
  source=replaceOnce(source,
`export function stageCanBeQueued(state = {}, { now = Date.now(), minimumAgeSeconds = 0 } = {}) {
  const status = String(state?.status || '')
  if (['running','pending','queued','rate_limited','retry_scheduled'].includes(status)) {
    const nextAllowed = millis(state?.next_allowed_at || state?.nextAllowedAt)
    if (!nextAllowed || nextAllowed > now) return false
  }
  const nextAllowed = millis(state?.next_allowed_at || state?.nextAllowedAt)
`,
`export function stageCanBeQueued(state = {}, { now = Date.now(), minimumAgeSeconds = 0 } = {}) {
  const status = String(state?.status || '')
  // A continuation already owned by Smart Scheduler is not a fresh nightly job.
  // It must resume with its existing cursor instead of being reinitialized.
  if (['running','pending','queued','rate_limited','retry_scheduled'].includes(status)) return false
  const nextAllowed = millis(state?.next_allowed_at || state?.nextAllowedAt)
`,
  'nightly fresh-job guard')
  fs.writeFileSync(path,source)
}

// 2) Fresh nightly finance runs must start from rrdId=0 and a new syncId.
// Also repair stale pre-5.15.5 partial states immediately instead of waiting for night.
{
  const path='backend/src/server.js'
  let source=fs.readFileSync(path,'utf8')
  source=replaceOnce(source,
`      const heavyPlan=dailyHeavyStagePlan({states,now,timeZone:dailyReadyTimezone})
      const cabinetHash=[...String(row.id || '')].reduce((sum,char)=>((sum*31)+char.charCodeAt(0))>>>0,7)
`,
`      const repairedHeavyStages=new Set()
      const financeCurrent=states.find(item=>item.stage==='finance') || null
      const financePayload=canonical?.data?.finance && typeof canonical.data.finance==='object' ? canonical.data.finance : null
      const financePeriod=financeCurrent?.metadata?.period || financePayload?.period || null
      const financePeriodTo=dateKey(financePeriod?.dateTo || financePeriod?.to || financePeriod?.end)
      const financeStatus=String(financeCurrent?.status || '')
      const financeHardBlocked=new Set(['running','pending','missing_token','token_invalid','forbidden','subscription_required'])
      const financeContinuationActive=new Set(['queued','rate_limited','retry_scheduled']).has(financeStatus)
        && financePeriodTo && financePeriodTo>=targetDate
      const financeStale=Boolean(financeCurrent)
        && (!financePeriodTo || financePeriodTo<targetDate || financePayload?.complete!==true)
      if(financeStale && !financeHardBlocked.has(financeStatus) && !financeContinuationActive){
        const period=reportPeriod(30)
        await updateSyncState(row.id,'finance',{
          status:'queued',nextAllowedAt:new Date(now+2*60*1000).toISOString(),lastError:null,lastCount:0,taskId:null,
          metadata:{
            trigger:'finance_freshness_repair',dailyReadySlot:slot,dailyReadyDate:targetDate,
            nightlyReady:true,nightlyReadyVersion:2,financeFreshnessRepair:true,
            period,syncId:crypto.randomUUID(),rrdId:'0',pageNumber:0,persistedCount:0,
          },
        })
        repairedHeavyStages.add('finance')
        console.log('[ELISEI 5.15.5] Finance freshness repair queued:',{connectionId:row.id,previousPeriodTo:financePeriodTo,targetDate})
      }

      const heavyPlan=dailyHeavyStagePlan({states,now,timeZone:dailyReadyTimezone})
        .filter(stage=>!repairedHeavyStages.has(stage))
      const cabinetHash=[...String(row.id || '')].reduce((sum,char)=>((sum*31)+char.charCodeAt(0))>>>0,7)
`,
  'finance freshness repair')

  source=replaceOnce(source,
`      for(const [heavyIndex,stage] of heavyPlan.entries()){
        const current=states.find(item=>item.stage===stage) || null
        const metadata={
          ...(current?.metadata || {}),
          trigger:'nightly_ready',dailyReadySlot:slot,dailyReadyDate:targetDate,
          nightlyReady:true,nightlyReadyVersion:1,
        }
        if(['finance','acquiring'].includes(stage)) metadata.period=reportPeriod(30)
        const spreadSeconds=cabinetSpreadSeconds+heavyIndex*75
`,
`      for(const [heavyIndex,stage] of heavyPlan.entries()){
        const current=states.find(item=>item.stage===stage) || null
        const pagedFinance=['finance','acquiring'].includes(stage)
        const metadata=pagedFinance
          ? {
              trigger:'nightly_ready',dailyReadySlot:slot,dailyReadyDate:targetDate,
              nightlyReady:true,nightlyReadyVersion:2,
              period:reportPeriod(30),syncId:crypto.randomUUID(),rrdId:'0',pageNumber:0,persistedCount:0,
            }
          : {
              ...(current?.metadata || {}),
              trigger:'nightly_ready',dailyReadySlot:slot,dailyReadyDate:targetDate,
              nightlyReady:true,nightlyReadyVersion:2,
            }
        const spreadSeconds=cabinetSpreadSeconds+heavyIndex*75
`,
  'fresh nightly finance cursor')
  fs.writeFileSync(path,source)
}

// 3) Release markers.
for (const [path,version] of [['package.json','5.15.5'],['backend/package.json','2.27.5']]) {
  const data=JSON.parse(fs.readFileSync(path,'utf8'))
  data.version=version
  fs.writeFileSync(path,JSON.stringify(data,null,2)+'\n')
}

// Existing version assertions should follow the release rather than block an unrelated fix.
for (const name of fs.readdirSync('backend/tests')) {
  if (!name.endsWith('.test.mjs')) continue
  const path=`backend/tests/${name}`
  let source=fs.readFileSync(path,'utf8')
  source=source.replaceAll("frontendPackage.version, '5.15.4'","frontendPackage.version, '5.15.5'")
  source=source.replaceAll("backendPackage.version, '2.27.4'","backendPackage.version, '2.27.5'")
  fs.writeFileSync(path,source)
}

console.log('ELISEI 5.15.5 finance freshness patch applied')
