import pg from 'pg'

const databaseUrl=String(process.env.DATABASE_URL || '').trim()
if(!databaseUrl){
  console.log('[ELISEI 5.18.8] Duplicate seller migration skipped: DATABASE_URL is not configured')
  process.exit(0)
}

const { Client }=pg
const client=new Client({
  connectionString:databaseUrl,
  ssl:process.env.NODE_ENV==='production' ? {rejectUnauthorized:false} : undefined,
  connectionTimeoutMillis:8000,
})

try{
  await client.connect()
  await client.query('BEGIN')
  const duplicates=await client.query(`
    WITH ranked AS (
      SELECT id,
        ROW_NUMBER() OVER (
          PARTITION BY marketplace,seller_id
          ORDER BY created_at DESC,updated_at DESC,id DESC
        ) AS rn
      FROM marketplace_connections
      WHERE status='connected' AND seller_id IS NOT NULL AND BTRIM(seller_id)<>''
    )
    UPDATE marketplace_connections connection
    SET status='superseded',updated_at=NOW()
    FROM ranked
    WHERE connection.id=ranked.id AND ranked.rn>1
    RETURNING connection.id
  `)
  const duplicateIds=duplicates.rows.map(item=>item.id)
  if(duplicateIds.length){
    await client.query(`
      UPDATE wb_sync_states
      SET status='superseded',next_allowed_at=NULL,
          last_error='Дублирующее подключение WB отключено: используется более новое подключение этого же кабинета.',
          updated_at=NOW()
      WHERE connection_id=ANY($1::uuid[])
        AND status IN ('running','pending','queued','rate_limited','retry_scheduled','error')
    `,[duplicateIds])
    await client.query(`
      UPDATE wb_webhooks
      SET enabled=FALSE,status='superseded',updated_at=NOW()
      WHERE connection_id=ANY($1::uuid[]) AND enabled=TRUE
    `,[duplicateIds])
  }
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS marketplace_connections_one_active_seller_idx
    ON marketplace_connections(marketplace,seller_id)
    WHERE status='connected' AND seller_id IS NOT NULL AND BTRIM(seller_id)<>''
  `)
  await client.query('COMMIT')
  console.log(`[ELISEI 5.18.8] Duplicate seller migration complete: superseded ${duplicateIds.length}; unique active seller guard enabled`)
}catch(error){
  await client.query('ROLLBACK').catch(()=>{})
  // Do not prevent the API from starting if Render Postgres is still waking up.
  // The in-process initDatabase guard remains as a second line of defense.
  console.warn('[ELISEI 5.18.8] Duplicate seller migration deferred:',error.message)
}finally{
  await client.end().catch(()=>{})
}
