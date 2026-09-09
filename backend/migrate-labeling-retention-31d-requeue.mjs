import 'dotenv/config'
import pg from 'pg'

const databaseUrl=String(process.env.DATABASE_URL || '').trim()
if(!databaseUrl){
  console.log('Labeling retention 31-day requeue skipped: DATABASE_URL is not set')
  process.exit(0)
}

const { Pool }=pg
const pool=new Pool({
  connectionString:databaseUrl,
  ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:undefined,
  max:1,
})

try{
  const result=await pool.query(`
    UPDATE wb_sync_states
    SET status='queued',
        next_allowed_at=NOW(),
        last_error='ELISEI повторяет удержания за маркировку с допустимым окном WB до 31 дня.',
        metadata=COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
          'labelingRetention31dRecovery',true,
          'labelingRetention31dRecoveryAt',NOW()
        ),
        updated_at=NOW()
    WHERE stage='labelingRetention'
      AND status='error'
      AND COALESCE(last_error,'') ILIKE '%difference between dateFrom and dateTo should be less or equal 31 days%'
      AND COALESCE(metadata->>'labelingRetention31dRecovery','') <> 'true'
    RETURNING connection_id,stage
  `)
  console.log(`Labeling retention 31-day requeue: ${result.rowCount} stage(s) queued`)
}catch(error){
  if(error?.code==='42P01') console.log('Labeling retention 31-day requeue skipped: wb_sync_states does not exist yet')
  else throw error
}finally{
  await pool.end()
}
