import 'dotenv/config'
import pg from 'pg'

const databaseUrl = String(process.env.DATABASE_URL || '').trim()
if (!databaseUrl) {
  console.log('ELISEI 5.19.5 goodsReturns migration skipped: DATABASE_URL is not configured')
  process.exit(0)
}

const pool = new pg.Pool({
  connectionString:databaseUrl,
  ssl:process.env.NODE_ENV === 'production' ? { rejectUnauthorized:false } : undefined,
  max:1,
})

function dateKey(value) {
  const parsed = new Date(String(value || ''))
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0,10)
}

function shiftIsoDate(value, days) {
  const d = new Date(`${value}T12:00:00.000Z`)
  d.setUTCDate(d.getUTCDate()+days)
  return d.toISOString().slice(0,10)
}

try {
  const result = await pool.query(`
    SELECT connection_id,metadata,last_error
    FROM wb_sync_states
    WHERE stage='goodsReturns'
      AND status='error'
      AND COALESCE(last_error,'') ILIKE '%difference between dateFrom and dateTo should be less or equal 31 days%'
  `)

  let migrated = 0
  for (const row of result.rows) {
    const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {}
    const period = metadata.period && typeof metadata.period === 'object' ? metadata.period : {}
    const dateTo = dateKey(period.dateTo || period.to) || new Date().toISOString().slice(0,10)
    const dateFrom = shiftIsoDate(dateTo,-30)
    const nextMetadata = {
      ...metadata,
      period:{
        ...period,
        dateFrom,
        dateTo,
        from:undefined,
        to:undefined,
        days:31,
        limited:true,
        requestedFrom:period.requestedFrom || period.dateFrom || period.from || dateFrom,
        requestedTo:period.requestedTo || period.dateTo || period.to || dateTo,
        requestedDays:Number(period.requestedDays || period.days || 31),
      },
      goodsReturns31dMigration:true,
      goodsReturns31dMigrationAt:new Date().toISOString(),
    }
    delete nextMetadata.period.from
    delete nextMetadata.period.to
    await pool.query(`
      UPDATE wb_sync_states
      SET status='retry_scheduled',
          next_allowed_at=NOW(),
          last_error='ELISEI повторит «Возвраты и перемещения» допустимым окном 31 день.',
          metadata=$2::jsonb,
          updated_at=NOW()
      WHERE connection_id=$1 AND stage='goodsReturns'
    `,[row.connection_id,JSON.stringify(nextMetadata)])
    migrated += 1
  }
  console.log(`ELISEI 5.19.5 goodsReturns migration requeued ${migrated} state(s)`)
} finally {
  await pool.end().catch(()=>{})
}
