import 'dotenv/config'
import express from 'express'
import pg from 'pg'

// ELISEI 5.14.0 — Business First Bootstrap.
// New WB shops first load a useful management view for:
//   • yesterday;
//   • the last 7 COMPLETE calendar days ending yesterday.
// Finance is mandatory in this first lane when the connected token exposes it.
// Deep history and secondary streams are released only after the business lane
// is ready (or after a safety timeout if WB itself is unavailable).

const { Pool } = pg
const databaseUrl = String(process.env.DATABASE_URL || '')
const businessTimeZone = String(process.env.ELISEI_BUSINESS_TIMEZONE || 'Europe/Moscow').trim() || 'Europe/Moscow'
const pool = databaseUrl ? new Pool({
  connectionString:databaseUrl,
  ssl:process.env.NODE_ENV === 'production' ? { rejectUnauthorized:false } : undefined,
  max:1,
  connectionTimeoutMillis:Math.max(3000,Number(process.env.PG_CONNECT_TIMEOUT_MS || 8000)),
  idleTimeoutMillis:15000,
}) : null

const BOOTSTRAP_VERSION = 1
const CORE_STAGE_ORDER = Object.freeze([
  'products','orders','sales','finance','advertising','acquiring','paidStorage','acceptance','sellerStocks','stocks',
])
const MANDATORY_BUSINESS_STAGES = Object.freeze([
  'products','orders','sales','finance','advertising','acquiring','paidStorage','acceptance',
])
const PERIOD_STAGES = new Set(['advertising','finance','acquiring'])
const BACKFILL_STAGES = new Set(['orders','sales','advertising','finance','acquiring'])
const CORE_GAP_MS = 2200
const DEFER_MS = 24 * 60 * 60 * 1000
const BACKFILL_DELAY_MS = 10 * 60 * 1000
const SAFETY_RELEASE_MS = 45 * 60 * 1000

function normalizedStatus(value) { return String(value || '').trim().toLowerCase() }

function localDateKey(value = new Date()) {
  const formatter=new Intl.DateTimeFormat('en-CA',{
    timeZone:businessTimeZone,year:'numeric',month:'2-digit',day:'2-digit',hourCycle:'h23',
  })
  const parts=Object.fromEntries(formatter.formatToParts(value).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

function shiftDate(value,days=0) {
  const date=new Date(`${String(value).slice(0,10)}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate()+Number(days || 0))
  return date.toISOString().slice(0,10)
}

function bootstrapRange(now = new Date()) {
  const today=localDateKey(now)
  const yesterday=shiftDate(today,-1)
  return {today,yesterday,weekFrom:shiftDate(yesterday,-6),weekTo:yesterday}
}

function periodPayload(from,to) {
  const days=Math.max(1,Math.round((new Date(`${to}T12:00:00.000Z`)-new Date(`${from}T12:00:00.000Z`))/86400000)+1)
  return {dateFrom:from,dateTo:to,requestedFrom:from,requestedTo:to,requestedDays:days,limited:false}
}

async function ensureSchema() {
  if (!pool) return false
  await pool.query(`
    CREATE TABLE IF NOT EXISTS elisei_bootstrap_sync (
      connection_id UUID PRIMARY KEY,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'business_core',
      yesterday DATE NOT NULL,
      week_from DATE NOT NULL,
      week_to DATE NOT NULL,
      required_stages JSONB NOT NULL DEFAULT '[]'::jsonb,
      finance_available BOOLEAN NOT NULL DEFAULT FALSE,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      core_ready_at TIMESTAMPTZ,
      released_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  return true
}

async function connectionLooksNew(connectionId) {
  const result=await pool.query(`
    SELECT c.created_at,c.last_sync_at,
           COUNT(s.*) FILTER (WHERE s.last_success_at IS NOT NULL)::int AS successes
    FROM marketplace_connections c
    LEFT JOIN wb_sync_states s ON s.connection_id=c.id
    WHERE c.id=$1
    GROUP BY c.id,c.created_at,c.last_sync_at
  `,[connectionId])
  const row=result.rows[0]
  if (!row) return false
  const age=Date.now()-new Date(row.created_at).getTime()
  return age>=0 && age<15*60*1000 && !row.last_sync_at && Number(row.successes || 0)===0
}

async function loadStates(connectionId) {
  const result=await pool.query(`
    SELECT stage,status,last_success_at,next_allowed_at,last_count,metadata
    FROM wb_sync_states WHERE connection_id=$1
  `,[connectionId])
  return result.rows
}

function businessPriority(stage) {
  const index=CORE_STAGE_ORDER.indexOf(String(stage))
  return index<0 ? 1000 : index
}

async function applyBusinessFirst(connectionId) {
  if (!pool || !connectionId) return null
  await ensureSchema()
  const already=await pool.query('SELECT status FROM elisei_bootstrap_sync WHERE connection_id=$1',[connectionId])
  if (already.rowCount) return already.rows[0]
  if (!(await connectionLooksNew(connectionId))) return null

  const states=await loadStates(connectionId)
  const stageSet=new Set(states.map(row=>String(row.stage)))
  const core=CORE_STAGE_ORDER.filter(stage=>stageSet.has(stage))
  const required=MANDATORY_BUSINESS_STAGES.filter(stage=>stageSet.has(stage))
  const financeAvailable=stageSet.has('finance')
  const range=bootstrapRange()
  const weekPeriod=periodPayload(range.weekFrom,range.weekTo)
  const now=Date.now()

  for (let index=0; index<core.length; index+=1) {
    const stage=core[index]
    const scheduledAt=new Date(now+index*CORE_GAP_MS).toISOString()
    const additions={
      bootstrapBusinessFirst:true,
      bootstrapVersion:BOOTSTRAP_VERSION,
      bootstrapPhase:'business_core',
      bootstrapBusinessPriority:businessPriority(stage),
      bootstrapYesterday:range.yesterday,
      bootstrapWeekFrom:range.weekFrom,
      bootstrapWeekTo:range.weekTo,
      bootstrapGoal:'yesterday_and_7_complete_days',
    }
    if (stage==='orders' || stage==='sales') additions.dateFrom=range.weekFrom
    if (PERIOD_STAGES.has(stage)) additions.period=weekPeriod
    await pool.query(`
      UPDATE wb_sync_states
      SET next_allowed_at=CASE WHEN status='queued' THEN $3::timestamptz ELSE next_allowed_at END,
          metadata=COALESCE(metadata,'{}'::jsonb) || $4::jsonb,
          updated_at=NOW()
      WHERE connection_id=$1 AND stage=$2
    `,[connectionId,stage,scheduledAt,JSON.stringify(additions)])
  }

  const deferUntil=new Date(now+DEFER_MS).toISOString()
  await pool.query(`
    UPDATE wb_sync_states
    SET next_allowed_at=CASE
          WHEN status='queued' THEN GREATEST(COALESCE(next_allowed_at,NOW()),$2::timestamptz)
          ELSE next_allowed_at
        END,
        metadata=COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
          'bootstrapDeferred',true,
          'bootstrapVersion',$3::int,
          'bootstrapPhase','waiting_business_core',
          'bootstrapBusinessPriority',1000
        ),
        updated_at=NOW()
    WHERE connection_id=$1
      AND NOT(stage=ANY($4::text[]))
  `,[connectionId,deferUntil,BOOTSTRAP_VERSION,core])

  const initialStatus=financeAvailable ? 'business_core' : 'business_core_finance_unavailable'
  await pool.query(`
    INSERT INTO elisei_bootstrap_sync(connection_id,version,status,yesterday,week_from,week_to,required_stages,finance_available,started_at,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,NOW(),NOW())
  `,[connectionId,BOOTSTRAP_VERSION,initialStatus,range.yesterday,range.weekFrom,range.weekTo,JSON.stringify(required),financeAvailable])

  console.log('[ELISEI 5.14.0 BOOTSTRAP] Business-first lane queued:',{
    connectionId,
    yesterday:range.yesterday,
    week:`${range.weekFrom}..${range.weekTo}`,
    core,
    financeAvailable,
  })
  return {status:initialStatus,yesterday:range.yesterday,weekFrom:range.weekFrom,weekTo:range.weekTo,financeAvailable}
}

function stageIsReady(row) {
  return normalizedStatus(row?.status)==='success' && Boolean(row?.last_success_at)
}

async function releaseAfterBusinessCore(bootstrap,states,{timedOut=false}={}) {
  const connectionId=bootstrap.connection_id
  const range={
    yesterday:String(bootstrap.yesterday).slice(0,10),
    weekFrom:String(bootstrap.week_from).slice(0,10),
    weekTo:String(bootstrap.week_to).slice(0,10),
  }
  const deepFrom=shiftDate(range.yesterday,-29)
  const deepPeriod=periodPayload(deepFrom,range.yesterday)
  const releaseAt=Date.now()

  for (const row of states) {
    const stage=String(row.stage)
    const metadata={...(row.metadata || {})}
    if (metadata.bootstrapDeferred) {
      await pool.query(`
        UPDATE wb_sync_states
        SET next_allowed_at=CASE
              WHEN status='queued' THEN $3::timestamptz
              ELSE next_allowed_at
            END,
            metadata=(COALESCE(metadata,'{}'::jsonb) - 'bootstrapBusinessPriority') || jsonb_build_object(
              'bootstrapDeferred',false,
              'bootstrapPhase','released_after_business_core',
              'bootstrapReleasedAt',NOW()
            ),
            updated_at=NOW()
        WHERE connection_id=$1 AND stage=$2
      `,[connectionId,stage,new Date(releaseAt+businessPriority(stage)*1000).toISOString()])
      continue
    }

    if (!BACKFILL_STAGES.has(stage) || !stageIsReady(row)) continue
    const additions={
      ...metadata,
      bootstrapBusinessFirst:true,
      bootstrapPhase:'history_backfill',
      bootstrapCoreReadyAt:new Date().toISOString(),
      bootstrapBackfillFrom:deepFrom,
      bootstrapBackfillTo:range.yesterday,
    }
    delete additions.bootstrapBusinessPriority
    if (stage==='orders' || stage==='sales') additions.dateFrom=deepFrom
    if (PERIOD_STAGES.has(stage)) additions.period=deepPeriod
    await pool.query(`
      UPDATE wb_sync_states
      SET status='queued',
          next_allowed_at=$3::timestamptz,
          last_error=NULL,
          metadata=$4::jsonb,
          updated_at=NOW()
      WHERE connection_id=$1 AND stage=$2
    `,[connectionId,stage,new Date(releaseAt+BACKFILL_DELAY_MS).toISOString(),JSON.stringify(additions)])
  }

  await pool.query(`
    UPDATE elisei_bootstrap_sync
    SET status=$2,
        core_ready_at=CASE WHEN $3::boolean THEN core_ready_at ELSE COALESCE(core_ready_at,NOW()) END,
        released_at=NOW(),
        updated_at=NOW()
    WHERE connection_id=$1
  `,[connectionId,timedOut ? 'business_core_partial_released' : (bootstrap.finance_available ? 'business_core_ready' : 'business_core_ready_finance_unavailable'),timedOut])

  console.log('[ELISEI 5.14.0 BOOTSTRAP] Secondary streams released:',{connectionId,timedOut,deepFrom,deepTo:range.yesterday})
}

async function monitorBootstrapRows() {
  if (!pool) return
  await ensureSchema()
  const result=await pool.query(`
    SELECT * FROM elisei_bootstrap_sync
    WHERE released_at IS NULL
    ORDER BY started_at
    LIMIT 50
  `)
  for (const bootstrap of result.rows) {
    try {
      const states=await loadStates(bootstrap.connection_id)
      const map=new Map(states.map(row=>[String(row.stage),row]))
      const required=Array.isArray(bootstrap.required_stages) ? bootstrap.required_stages.map(String) : []
      const ready=required.filter(stage=>stageIsReady(map.get(stage)))
      const missing=required.filter(stage=>!stageIsReady(map.get(stage)))
      const age=Date.now()-new Date(bootstrap.started_at).getTime()
      const timedOut=age>=SAFETY_RELEASE_MS

      await pool.query(`
        UPDATE elisei_bootstrap_sync
        SET status=$2,updated_at=NOW()
        WHERE connection_id=$1
      `,[bootstrap.connection_id,
        missing.length
          ? (timedOut ? 'business_core_partial_timeout' : (bootstrap.finance_available ? 'business_core' : 'business_core_finance_unavailable'))
          : (bootstrap.finance_available ? 'business_core_ready' : 'business_core_ready_finance_unavailable')
      ])

      if (!missing.length || timedOut) await releaseAfterBusinessCore(bootstrap,states,{timedOut})
      else if (ready.length) {
        console.log('[ELISEI 5.14.0 BOOTSTRAP] Core progress:',{connectionId:bootstrap.connection_id,ready,waiting:missing})
      }
    } catch (error) {
      console.warn('[ELISEI 5.14.0 BOOTSTRAP] Monitor row failed:',error.message)
    }
  }
}

const inheritedPost=express.application.post
express.application.post=function bootstrapAwarePost(path,...handlers) {
  if (String(path)!=='/api/wb/connect') return inheritedPost.call(this,path,...handlers)

  const captureConnection=async (req,res,next) => {
    const originalJson=res.json.bind(res)
    let sent=false
    res.json=payload => {
      if (sent) return res
      sent=true
      const connectionId=String(payload?.connectionId || '')
      const shouldApply=res.statusCode<400 && connectionId && payload?.autoSyncStarted
      if (!shouldApply) return originalJson(payload)
      ;(async()=>{
        const bootstrap=await applyBusinessFirst(connectionId)
        if (!bootstrap) return originalJson(payload)
        return originalJson({
          ...payload,
          bootstrap:{
            mode:'business_first',
            yesterday:bootstrap.yesterday,
            weekFrom:bootstrap.weekFrom,
            weekTo:bootstrap.weekTo,
            financeAvailable:bootstrap.financeAvailable,
          },
          autoSyncMessage:bootstrap.financeAvailable
            ? 'ELISEI сначала готовит вчера и 7 завершённых дней вместе с финансами. Глубокая история загрузится после готовности этой картины.'
            : 'ELISEI готовит вчера и 7 завершённых дней. В подключённом токене не найден финансовый поток, поэтому прибыль останется неполной до добавления финансового доступа.',
        })
      })().catch(error=>{
        console.warn('[ELISEI 5.14.0 BOOTSTRAP] Connect hook failed:',error.message)
        originalJson(payload)
      })
      return res
    }
    next()
  }
  return inheritedPost.call(this,path,captureConnection,...handlers)
}

if (pool) {
  setTimeout(()=>monitorBootstrapRows().catch(error=>console.warn('[ELISEI 5.14.0 BOOTSTRAP] startup monitor:',error.message)),5000).unref?.()
  setInterval(()=>monitorBootstrapRows().catch(error=>console.warn('[ELISEI 5.14.0 BOOTSTRAP] monitor:',error.message)),15000).unref?.()
}

console.log('[ELISEI 5.14.0] New-shop bootstrap: yesterday + 7 complete days + finance first')
