import 'dotenv/config'
import pg from 'pg'
import { saveStreamData } from './src/wb/stream-store.js'

const databaseUrl=String(process.env.DATABASE_URL || '').trim()
if(!databaseUrl){
  console.log('Signed paid-storage migration skipped: DATABASE_URL is not set')
  process.exit(0)
}

const { Pool }=pg
const pool=new Pool({
  connectionString:databaseUrl,
  ssl:process.env.NODE_ENV==='production'?{rejectUnauthorized:false}:undefined,
  max:1,
  connectionTimeoutMillis:15000,
})

const numberValue=value=>Number.isFinite(Number(value))?Number(value):0

try{
  const candidates=await pool.query(`
    SELECT DISTINCT i.connection_id
    FROM wb_stream_items i
    LEFT JOIN wb_stream_data d
      ON d.connection_id=i.connection_id AND d.stream='paidStorage'
    WHERE i.stream='paidStorage'
      AND COALESCE(d.metadata->>'signedStorageVersion','0') <> '2'
  `)

  let rebuilt=0
  let correctedLedgerRows=0
  for(const candidate of candidates.rows){
    const connectionId=candidate.connection_id
    const latest=await pool.query(`
      SELECT sync_id
      FROM wb_stream_items
      WHERE connection_id=$1 AND stream='paidStorage'
      GROUP BY sync_id
      ORDER BY MAX(updated_at) DESC
      LIMIT 1
    `,[connectionId])
    const syncId=latest.rows[0]?.sync_id
    if(!syncId) continue

    const compact=await pool.query(`
      SELECT
        COALESCE(NULLIF(payload->>'date',''),NULLIF(payload->>'originalDate','')) AS "operationDate",
        COALESCE(NULLIF(payload->>'nmId',''),NULLIF(payload->>'nmID',''),NULLIF(payload->>'nm_id','')) AS "nmId",
        COALESCE(NULLIF(payload->>'vendorCode',''),NULLIF(payload->>'vendor_code','')) AS "vendorCode",
        COALESCE(NULLIF(payload->>'barcode',''),NULLIF(payload->>'sku','')) AS barcode,
        'FBO'::text AS "fulfillmentMode",
        SUM(CASE
          WHEN jsonb_typeof(payload->'warehousePrice')='number'
            THEN (payload->>'warehousePrice')::numeric
          ELSE 0::numeric
        END)::float8 AS "warehousePrice",
        COUNT(*)::int AS "rowCount"
      FROM wb_stream_items
      WHERE connection_id=$1 AND stream='paidStorage' AND sync_id=$2::uuid
      GROUP BY 1,2,3,4
      ORDER BY 1,2,3,4
    `,[connectionId,syncId])

    const rows=compact.rows.map(row=>({
      __aggregated:true,
      operationDate:String(row.operationDate || '').slice(0,10),
      nmId:row.nmId || '',
      vendorCode:row.vendorCode || '',
      barcode:row.barcode || '',
      fulfillmentMode:'FBO',
      warehousePrice:numberValue(row.warehousePrice),
      rowCount:Number(row.rowCount || 0),
    }))

    const existing=await pool.query(`
      SELECT metadata
      FROM wb_stream_data
      WHERE connection_id=$1 AND stream='paidStorage'
      LIMIT 1
    `,[connectionId])
    const metadata={
      ...(existing.rows[0]?.metadata || {}),
      signedStorageVersion:2,
      signedStorageRebuiltAt:new Date().toISOString(),
      signedStorageSyncId:String(syncId),
      signedStorageRows:rows.length,
    }
    await saveStreamData(pool,{
      connectionId,stream:'paidStorage',payload:rows,metadata,source:'signed_storage_migration',
    })

    const ledger=await pool.query(`
      UPDATE wb_finance_ledger
      SET amount = -((source_payload->>'warehousePrice')::numeric),
          direction = CASE
            WHEN ((source_payload->>'warehousePrice')::numeric) > 0 THEN 'expense'
            WHEN ((source_payload->>'warehousePrice')::numeric) < 0 THEN 'income'
            ELSE 'info'
          END,
          note = CASE
            WHEN ((source_payload->>'warehousePrice')::numeric) < 0
              THEN 'Сторнирование хранения WB: знак сохранён, сумма уменьшает расход.'
            ELSE note
          END,
          updated_at=NOW()
      WHERE connection_id=$1
        AND source_stream='paidStorage'
        AND operation_code='paid_storage_detail'
        AND jsonb_typeof(source_payload->'warehousePrice')='number'
    `,[connectionId])
    correctedLedgerRows += Number(ledger.rowCount || 0)

    try {
      await pool.query('DELETE FROM wb_core_marts WHERE connection_id=$1',[connectionId])
    } catch(error){
      if(error?.code !== '42P01') throw error
    }
    try {
      await pool.query(`
        UPDATE wb_sync_states
        SET metadata=COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
          'signedStorageVersion',2,
          'signedStorageRebuiltAt',NOW()
        ),updated_at=NOW()
        WHERE connection_id=$1 AND stage='paidStorage'
      `,[connectionId])
    } catch(error){
      if(error?.code !== '42P01') throw error
    }
    rebuilt += 1
  }
  console.log(`Signed paid-storage migration: rebuilt ${rebuilt} connection(s), corrected ${correctedLedgerRows} ledger row(s)`)
}catch(error){
  if(error?.code==='42P01') console.log('Signed paid-storage migration skipped: storage tables do not exist yet')
  else throw error
}finally{
  await pool.end()
}
