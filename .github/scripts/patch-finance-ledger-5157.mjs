import fs from 'node:fs'

function replaceOnce(source, from, to, label) {
  if (source.includes(to)) return source
  const count = source.split(from).length - 1
  if (count !== 1) throw new Error(`${label}: expected one marker, found ${count}`)
  return source.replace(from, to)
}

// Finance ledger normalization v3: rebuild from every stored WB finance row,
// support current v1 date fields, and mark migrated movements explicitly.
{
  const path='backend/src/wb/finance-ledger.js'
  let source=fs.readFileSync(path,'utf8')

  source=replaceOnce(source,
`  operationDate:compactDate(text(row,['rrDate','rr_dt','saleDt','sale_dt','orderDt','order_dt','date','dateFrom','date_from','dtBonus','originalDate','shkCreateDate','giCreateDate'])),`,
`  operationDate:compactDate(text(row,['operationDate','rrDate','rr_dt','saleDt','sale_dt','saleDate','acqDate','orderDt','order_dt','orderDate','date','dateFrom','date_from','dtBonus','originalDate','shkCreateDate','giCreateDate','createDate'])),`,
  'current WB finance date aliases')

  source=replaceOnce(source,
`    CREATE INDEX IF NOT EXISTS wb_finance_ledger_mode_idx ON wb_finance_ledger(connection_id,fulfillment_mode,operation_date DESC);
  \`)
}`,
`    CREATE INDEX IF NOT EXISTS wb_finance_ledger_mode_idx ON wb_finance_ledger(connection_id,fulfillment_mode,operation_date DESC);
    ALTER TABLE wb_finance_ledger ADD COLUMN IF NOT EXISTS normalization_version INTEGER NOT NULL DEFAULT 1;
  \`)
}`,
  'ledger normalization version column')

  source=replaceOnce(source,
`        warehouse,document_type,seller_operation,bonus_type,payment_processing,source_field,note,source_payload,updated_at
      )
      SELECT $1,`,
`        warehouse,document_type,seller_operation,bonus_type,payment_processing,source_field,note,source_payload,normalization_version,updated_at
      )
      SELECT $1,`,
  'insert normalization version column')

  source=replaceOnce(source,
`        NULLIF(item->>'paymentProcessing',''),NULLIF(item->>'sourceField',''),NULLIF(item->>'note',''),COALESCE(item->'sourcePayload','{}'::jsonb),NOW()
      FROM jsonb_array_elements($2::jsonb) item`,
`        NULLIF(item->>'paymentProcessing',''),NULLIF(item->>'sourceField',''),NULLIF(item->>'note',''),COALESCE(item->'sourcePayload','{}'::jsonb),3,NOW()
      FROM jsonb_array_elements($2::jsonb) item`,
  'insert normalization version value')

  source=replaceOnce(source,
`        note=EXCLUDED.note,source_payload=EXCLUDED.source_payload,updated_at=NOW()`,
`        note=EXCLUDED.note,source_payload=EXCLUDED.source_payload,normalization_version=3,updated_at=NOW()`,
  'upsert normalization version')

  const start=source.indexOf('export async function backfillFinanceLedgerFromStreamItems')
  const end=source.indexOf('\nfunction addFilter(',start)
  if(start<0 || end<0) throw new Error('finance ledger backfill block not found')
  const replacement=`export async function backfillFinanceLedgerFromStreamItems(db,{ connectionId,limitPerStream=150000 } = {}) {
  const streamResult = await db.query(\`
    SELECT stream,
           COUNT(DISTINCT row_key)::int AS source_rows,
           MAX(updated_at) AS source_updated_at
    FROM wb_stream_items
    WHERE connection_id=$1 AND stream=ANY($2::text[])
    GROUP BY stream
    ORDER BY stream
  \`,[connectionId,STREAMS])
  let movements=0
  let processedStreams=0
  let skippedStreams=0

  for(const sourceStats of streamResult.rows){
    const stream=String(sourceStats.stream)
    const sourceRows=Number(sourceStats.source_rows || 0)
    const ledgerStats=await db.query(\`
      SELECT COUNT(DISTINCT source_row_key)::int AS ledger_source_rows,
             COALESCE(MIN(normalization_version),1)::int AS min_version,
             MAX(updated_at) AS ledger_updated_at
      FROM wb_finance_ledger
      WHERE connection_id=$1 AND source_stream=$2
    \`,[connectionId,stream])
    const ledgerSourceRows=Number(ledgerStats.rows[0]?.ledger_source_rows || 0)
    const minVersion=Number(ledgerStats.rows[0]?.min_version || 1)
    const sourceUpdatedAt=sourceStats.source_updated_at ? new Date(sourceStats.source_updated_at).getTime() : 0
    const ledgerUpdatedAt=ledgerStats.rows[0]?.ledger_updated_at ? new Date(ledgerStats.rows[0].ledger_updated_at).getTime() : 0
    const needsRebuild=minVersion < 3 || ledgerSourceRows < sourceRows || (sourceUpdatedAt && sourceUpdatedAt > ledgerUpdatedAt)
    if(!needsRebuild){ skippedStreams += 1; continue }

    let afterKey=''
    let seen=0
    while(seen < limitPerStream){
      const page=await db.query(\`
        SELECT DISTINCT ON (row_key) row_key,payload
        FROM wb_stream_items
        WHERE connection_id=$1 AND stream=$2 AND row_key>$3
        ORDER BY row_key,updated_at DESC
        LIMIT 1000
      \`,[connectionId,stream,afterKey])
      if(!page.rows.length) break
      const result=await persistFinanceLedgerBatch(db,{
        connectionId,stream,rows:page.rows.map(item=>item.payload),
        keyOf:(_row,index)=>page.rows[index].row_key,batchSize:250,
      })
      movements += result.movements
      seen += page.rows.length
      afterKey=page.rows.at(-1).row_key
      if(page.rows.length < 1000) break
    }
    processedStreams += 1
  }

  return { skipped:processedStreams===0,movements,processedStreams,skippedStreams,normalizationVersion:3 }
}
`
  source=source.slice(0,start)+replacement+source.slice(end)
  fs.writeFileSync(path,source)
}

// Release versions and legacy regression markers.
for(const [path,version,oldVersion] of [
  ['package.json','5.15.7','5.15.6'],
  ['backend/package.json','2.27.7','2.27.6'],
]){
  const data=JSON.parse(fs.readFileSync(path,'utf8'))
  if(data.version===oldVersion || data.version!==version) data.version=version
  fs.writeFileSync(path,JSON.stringify(data,null,2)+'\n')
}
for(const name of fs.readdirSync('backend/tests')){
  if(!name.endsWith('.test.mjs')) continue
  const path=`backend/tests/${name}`
  let s=fs.readFileSync(path,'utf8')
  s=s.replaceAll("frontendPackage.version, '5.15.6'","frontendPackage.version, '5.15.7'")
  s=s.replaceAll("backendPackage.version, '2.27.6'","backendPackage.version, '2.27.7'")
  fs.writeFileSync(path,s)
}
console.log('ELISEI 5.15.7 finance normalization v3 patch applied')
