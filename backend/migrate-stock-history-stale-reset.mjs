import 'dotenv/config'
import crypto from 'node:crypto'
import pg from 'pg'

const databaseUrl=String(process.env.DATABASE_URL || '').trim()
if(!databaseUrl){
  console.log('Stock-history stale reset skipped: DATABASE_URL is not set')
  process.exit(0)
}

function moscowDateKey(value=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{
    timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit',
  }).formatToParts(value)
  const map=Object.fromEntries(parts.filter(item=>item.type!=='literal').map(item=>[item.type,item.value]))
  return `${map.year}-${map.month}-${map.day}`
}
function shiftDate(dateKey,days){
  const date=new Date(`${dateKey}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate()+Number(days||0))
  return date.toISOString().slice(0,10)
}

const today=moscowDateKey()
const dateTo=shiftDate(today,-1)
const dateFrom=shiftDate(dateTo,-89)
const period={dateFrom,dateTo,days:90,rolling:true,purpose:'stock_history_recovery'}

const { Pool }=pg
const pool=new Pool({
  connectionString:databaseUrl,
  ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:undefined,
  max:1,
})

try{
  const stale=await pool.query(`
    SELECT connection_id,task_id,status,next_allowed_at,metadata
    FROM wb_sync_states
    WHERE stage='stockHistory'
      AND status IN ('pending','queued','rate_limited','retry_scheduled')
      AND COALESCE(metadata->>'phase','')='poll'
      AND COALESCE((metadata->>'pollAttempts')::int,0) >= 24
  `)
  let reset=0
  for(const row of stale.rows){
    const reportId=crypto.randomUUID()
    const syncId=crypto.randomUUID()
    const previousId=String(row.task_id || row.metadata?.reportId || '') || null
    const previousStatus=String(row.metadata?.reportStatus || 'PROCESSING')
    const previousPollAttempts=Math.max(0,Number(row.metadata?.pollAttempts || 0))
    const resetCount=Math.max(0,Number(row.metadata?.staleReportResetCount || 0))+1
    await pool.query(`
      UPDATE wb_sync_states
      SET status='queued',
          task_id=$2,
          next_allowed_at=GREATEST(COALESCE(next_allowed_at,NOW()),NOW()+INTERVAL '2 seconds'),
          last_error='История остатков: старый отчёт WB слишком долго оставался PROCESSING. ELISEI создаёт свежий 90-дневный отчёт после разрешённого окна WB.',
          metadata=COALESCE(metadata,'{}'::jsonb) || $3::jsonb,
          updated_at=NOW()
      WHERE connection_id=$1 AND stage='stockHistory'
    `,[row.connection_id,reportId,JSON.stringify({
      period,syncId,reportId,phase:'create',pollAttempts:0,persistedCount:0,
      reportType:'STOCK_HISTORY_DAILY_CSV',createAttempted:false,
      staleReportResetCount:resetCount,staleReportResetAt:new Date().toISOString(),
      staleReportPreviousId:previousId,staleReportPreviousStatus:previousStatus,
      staleReportPreviousPollAttempts:previousPollAttempts,
      staleReportStartupRecovery:true,
    })])
    reset+=1
  }
  console.log(`Stock-history stale reset: ${reset} stage(s) requeued for ${dateFrom}..${dateTo}`)
}catch(error){
  if(error?.code==='42P01') console.log('Stock-history stale reset skipped: wb_sync_states does not exist yet')
  else throw error
}finally{
  await pool.end()
}
