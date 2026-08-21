import fs from 'node:fs'

function replaceOnce(source,from,to,label){
  if(source.includes(to)) return source
  const count=source.split(from).length-1
  if(count!==1) throw new Error(`${label}: expected one marker, found ${count}`)
  return source.replace(from,to)
}

// 1) Daily Ready: heavy streams run overnight, not through the workday.
{
  const path='backend/src/wb/daily-ready.js'
  let source=fs.readFileSync(path,'utf8')
  source=replaceOnce(source,'export const DAILY_READY_VERSION = 5','export const DAILY_READY_VERSION = 6','daily ready version')
  source=replaceOnce(source,
`export const AUTOMATIC_REFRESH_INTERVALS_SECONDS = Object.freeze({
  orders: 30 * 60,
  sales: 30 * 60,
  stocks: 60 * 60,
  sellerStocks: 60 * 60,
  products: 6 * 60 * 60,
  advertising: 60 * 60,
  reviews: 3 * 60 * 60,
  questions: 3 * 60 * 60,
  chats: 60 * 60,
})`,
`export const AUTOMATIC_REFRESH_INTERVALS_SECONDS = Object.freeze({
  orders: 30 * 60,
  sales: 30 * 60,
  stocks: 60 * 60,
  sellerStocks: 30 * 60,
  products: 6 * 60 * 60,
  advertising: 30 * 60,
  reviews: 60 * 60,
  questions: 60 * 60,
  chats: 15 * 60,
})`,
  'automatic intervals')
  source=replaceOnce(source,
`export const DAILY_READY_HEAVY_INTERVALS_SECONDS = Object.freeze({
  finance: 12 * 60 * 60,
  paidStorage: 24 * 60 * 60,
  acceptance: 24 * 60 * 60,
  acquiring: 12 * 60 * 60,
})`,
`export const DAILY_READY_HEAVY_INTERVALS_SECONDS = Object.freeze({
  // Nightly Ready: one complete heavy pass per business night. 20h for the two
  // financial contours guarantees the next night's pass is eligible even when
  // the previous run finished closer to morning.
  finance: 20 * 60 * 60,
  acquiring: 20 * 60 * 60,
  paidStorage: 24 * 60 * 60,
  acceptance: 24 * 60 * 60,
  documents: 24 * 60 * 60,
})`,
  'heavy intervals')
  source=replaceOnce(source,
`  if (!['preopen','morning-ready','late-check'].includes(slot)) return []`,
`  // Heavy API work starts only in the business-night window 01:30–07:30.
  // Pending WB jobs may finish later, but ELISEI does not start a fresh heavy
  // download during the seller's working day.
  if (!['overnight','preopen'].includes(slot)) return []`,
  'night-only heavy plan')
  fs.writeFileSync(path,source)
}

// 2) Server: cap transient operational backoff and spread nightly work by shop.
{
  const path='backend/src/server.js'
  let source=fs.readFileSync(path,'utf8')

  const oldRetry=`function transientRetryPlan(state, stage, error) {
  const previous = Math.max(0,Number(state?.metadata?.automaticRetryAttempt || 0))
  const attempt = Math.min(MAX_AUTOMATIC_RETRY_ATTEMPTS,previous + 1)
  const baseSeconds = stage === 'fbsArchive' ? 90 : 60
  const seconds = Math.min(6 * 3600,baseSeconds * (2 ** Math.max(0,attempt - 1)))
  const jitter = 0.85 + Math.random() * 0.3
  const delaySeconds = Math.max(30,Math.round(seconds * jitter))`
  const newRetry=`const OPERATIONAL_RETRY_CAP_SECONDS = Object.freeze({
  chats:10*60,
  orders:15*60,
  sales:15*60,
  advertising:15*60,
  sellerStocks:15*60,
  stocks:20*60,
  products:30*60,
  reviews:30*60,
  questions:30*60,
})

function transientRetryPlan(state, stage, error) {
  const previous = Math.max(0,Number(state?.metadata?.automaticRetryAttempt || 0))
  const attempt = Math.min(MAX_AUTOMATIC_RETRY_ATTEMPTS,previous + 1)
  const baseSeconds = stage === 'fbsArchive' ? 90 : 60
  const capSeconds = Number(OPERATIONAL_RETRY_CAP_SECONDS[String(stage)] || (stage === 'fbsArchive' ? 6*3600 : 2*3600))
  const seconds = Math.min(capSeconds,baseSeconds * (2 ** Math.max(0,attempt - 1)))
  const jitter = 0.85 + Math.random() * 0.3
  const delaySeconds = Math.max(30,Math.min(capSeconds,Math.round(seconds * jitter)))`
  source=replaceOnce(source,oldRetry,newRetry,'operational retry cap')

  const recoveryAnchor=`async function recoverLegacyFinanceCooldowns({ connectionId = null } = {}) {
  // 5.10.4: legacy compatibility hook; current finance period pagination is
  // paced separately by financePageCooldownMs and is not reset here.
  return []
}`
  const recoveryBlock=`async function recoverLegacyFinanceCooldowns({ connectionId = null } = {}) {
  // 5.10.4: legacy compatibility hook; current finance period pagination is
  // paced separately by financePageCooldownMs and is not reset here.
  return []
}

async function recoverExcessiveOperationalBackoffs({ connectionId = null } = {}) {
  if (!pool) return []
  const stages=['orders','sales','advertising','sellerStocks','stocks','chats','reviews','questions','products']
  const params=[stages]
  let connectionFilter=''
  if(connectionId){
    params.push(connectionId)
    connectionFilter=' AND connection_id=$2'
  }
  const result=await pool.query(
    \`UPDATE wb_sync_states
     SET status='retry_scheduled',
         next_allowed_at=NOW() + INTERVAL '2 minutes',
         last_error=CASE
           WHEN COALESCE(last_error,'')='' THEN 'ELISEI сократил чрезмерный автоповтор оперативного потока.'
           ELSE last_error
         END,
         metadata=COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
           'operationalBackoffClamped',true,
           'operationalBackoffClampedAt',NOW()
         ),
         updated_at=NOW()
     WHERE stage=ANY($1::text[])
       AND status IN ('queued','retry_scheduled')
       AND metadata ? 'automaticRetryAttempt'
       AND next_allowed_at > NOW() + INTERVAL '30 minutes'
       \${connectionFilter}
     RETURNING connection_id,stage,next_allowed_at\`,params)
  if(result.rows.length) console.log(\`[ELISEI 5.15.3] Clamped \${result.rows.length} excessive operational backoff(s).\`)
  return result.rows
}`
  source=replaceOnce(source,recoveryAnchor,recoveryBlock,'backoff recovery')

  source=replaceOnce(source,
`  await recoverRetryableErrorStates()
  // 5.10.3: миграция старого длинного finance next_allowed_at выполняется`,
`  await recoverRetryableErrorStates()
  await recoverExcessiveOperationalBackoffs()
  // 5.10.3: миграция старого длинного finance next_allowed_at выполняется`,
  'startup backoff recovery')

  source=replaceOnce(source,
`  await recoverLegacyFinanceCooldowns({ connectionId:connection.id })
  await recoverLegacyRuntimeRateWindows({ connectionId:connection.id })`,
`  await recoverLegacyFinanceCooldowns({ connectionId:connection.id })
  await recoverExcessiveOperationalBackoffs({ connectionId:connection.id })
  await recoverLegacyRuntimeRateWindows({ connectionId:connection.id })`,
  'connection backoff recovery')

  const oldHeavy=`      const heavyPlan=dailyHeavyStagePlan({states,now,timeZone:dailyReadyTimezone})
      for(const stage of heavyPlan){
        const current=states.find(item=>item.stage===stage) || null
        const metadata={...(current?.metadata || {}),trigger:'daily_ready',dailyReadySlot:slot,dailyReadyDate:targetDate}
        if(['finance','acquiring'].includes(stage)) metadata.period=reportPeriod(30)
        await updateSyncState(row.id,stage,{status:'queued',nextAllowedAt:new Date().toISOString(),lastError:null,metadata})
      }`
  const newHeavy=`      const heavyPlan=dailyHeavyStagePlan({states,now,timeZone:dailyReadyTimezone})
      const cabinetHash=[...String(row.id || '')].reduce((sum,char)=>((sum*31)+char.charCodeAt(0))>>>0,7)
      const cabinetSpreadSeconds=slot==='overnight' ? cabinetHash%(30*60) : cabinetHash%(5*60)
      for(const [heavyIndex,stage] of heavyPlan.entries()){
        const current=states.find(item=>item.stage===stage) || null
        const metadata={
          ...(current?.metadata || {}),
          trigger:'nightly_ready',dailyReadySlot:slot,dailyReadyDate:targetDate,
          nightlyReady:true,nightlyReadyVersion:1,
        }
        if(['finance','acquiring'].includes(stage)) metadata.period=reportPeriod(30)
        const spreadSeconds=cabinetSpreadSeconds+heavyIndex*75
        const nextAllowedAt=new Date(now+spreadSeconds*1000).toISOString()
        await updateSyncState(row.id,stage,{status:'queued',nextAllowedAt,lastError:null,metadata})
      }`
  source=replaceOnce(source,oldHeavy,newHeavy,'nightly cabinet spread')

  if(!source.includes('OPERATIONAL_RETRY_CAP_SECONDS')) throw new Error('retry cap not applied')
  if(!source.includes("trigger:'nightly_ready'")) throw new Error('Nightly Ready scheduling not applied')
  fs.writeFileSync(path,source)
}

console.log('ELISEI 5.15.3 Nightly Ready source patch applied')
