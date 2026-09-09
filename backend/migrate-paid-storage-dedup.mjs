import 'dotenv/config'
import pg from 'pg'

const databaseUrl=String(process.env.DATABASE_URL || '').trim()
if(!databaseUrl){
  console.log('Paid storage dedup migration skipped: DATABASE_URL is not set')
  process.exit(0)
}

const { Pool }=pg
const pool=new Pool({
  connectionString:databaseUrl,
  ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:undefined,
  max:1,
})

try{
  const streamResult=await pool.query(`
    WITH ranked AS (
      SELECT ctid,
        ROW_NUMBER() OVER (
          PARTITION BY connection_id,stream,sync_id,payload
          ORDER BY row_key
        ) AS rn
      FROM wb_stream_items
      WHERE stream='paidStorage'
    )
    DELETE FROM wb_stream_items target
    USING ranked r
    WHERE target.ctid=r.ctid AND r.rn>1
    RETURNING 1
  `)

  const ledgerResult=await pool.query(`
    WITH ranked AS (
      SELECT ctid,
        ROW_NUMBER() OVER (
          PARTITION BY connection_id,source_stream,operation_group,operation_code,source_field,source_payload
          ORDER BY movement_key
        ) AS rn
      FROM wb_finance_ledger
      WHERE source_stream='paidStorage' AND operation_group='storage'
    )
    DELETE FROM wb_finance_ledger target
    USING ranked r
    WHERE target.ctid=r.ctid AND r.rn>1
    RETURNING 1
  `)

  console.log(`Paid storage dedup migration: removed ${streamResult.rowCount} stream duplicate(s), ${ledgerResult.rowCount} ledger duplicate(s)`)
}catch(error){
  if(error?.code==='42P01') console.log('Paid storage dedup migration skipped: storage tables do not exist yet')
  else throw error
}finally{
  await pool.end()
}
