import fs from 'node:fs'

function replaceOnce(source, from, to, label) {
  if (source.includes(to)) return source
  const count = source.split(from).length - 1
  if (count !== 1) throw new Error(`${label}: expected one marker, found ${count}`)
  return source.replace(from, to)
}

// 1) Finance ledger: classify WB services robustly and backfill by source stream,
// not by the mere existence of any ledger movement in the cabinet.
{
  const path='backend/src/wb/finance-ledger.js'
  let source=fs.readFileSync(path,'utf8')

  source=replaceOnce(source,
`    text(row,['bonusTypeName','bonus_type_name']),
    text(row,['paymentProcessing','payment_processing']),
  ].join(' ').toLowerCase()`,
`    text(row,['bonusTypeName','bonus_type_name']),
    text(row,['paymentProcessing','payment_processing']),
    text(row,['serviceName','service_name']),
    text(row,['name','title','subjectName','subject_name']),
  ].join(' ').toLowerCase()`,
  'WB service aliases')

  source=replaceOnce(source,
`export async function backfillFinanceLedgerFromStreamItems(db,{ connectionId,limitPerStream=100000 }) {
  const countResult = await db.query('SELECT COUNT(*)::int AS count FROM wb_finance_ledger WHERE connection_id=$1',[connectionId])
  if (Number(countResult.rows[0]?.count || 0) > 0) return { skipped:true,movements:Number(countResult.rows[0]?.count || 0) }
  const syncs = await db.query(\`
    SELECT DISTINCT ON (stream) stream,sync_id
    FROM wb_stream_items
    WHERE connection_id=$1 AND stream=ANY($2::text[])
    ORDER BY stream,updated_at DESC
  \`,[connectionId,STREAMS])
  let movements = 0
  for (const sync of syncs.rows) {
    let afterKey = ''
    let seen = 0
    while (seen < limitPerStream) {
      const page = await db.query(\`
        SELECT row_key,payload FROM wb_stream_items
        WHERE connection_id=$1 AND stream=$2 AND sync_id=$3::uuid AND row_key>$4
        ORDER BY row_key LIMIT 1000
      \`,[connectionId,sync.stream,sync.sync_id,afterKey])
      if (!page.rows.length) break
      const result = await persistFinanceLedgerBatch(db,{connectionId,stream:sync.stream,rows:page.rows.map(item=>item.payload),keyOf:(_row,index)=>page.rows[index].row_key,batchSize:250})
      movements += result.movements
      seen += page.rows.length
      afterKey = page.rows.at(-1).row_key
      if (page.rows.length < 1000) break
    }
  }
  return { skipped:false,movements }
}`,
`export async function backfillFinanceLedgerFromStreamItems(db,{ connectionId,limitPerStream=100000 }) {
  const syncs = await db.query(\`
    SELECT DISTINCT ON (stream) stream,sync_id,updated_at AS source_updated_at
    FROM wb_stream_items
    WHERE connection_id=$1 AND stream=ANY($2::text[])
    ORDER BY stream,updated_at DESC
  \`,[connectionId,STREAMS])
  let movements = 0
  let processedStreams = 0
  let skippedStreams = 0
  for (const sync of syncs.rows) {
    const ledgerFreshness = await db.query(\`
      SELECT MAX(updated_at) AS ledger_updated_at
      FROM wb_finance_ledger
      WHERE connection_id=$1 AND source_stream=$2
    \`,[connectionId,sync.stream])
    const ledgerUpdatedAt = ledgerFreshness.rows[0]?.ledger_updated_at ? new Date(ledgerFreshness.rows[0].ledger_updated_at).getTime() : 0
    const sourceUpdatedAt = sync.source_updated_at ? new Date(sync.source_updated_at).getTime() : 0
    if (ledgerUpdatedAt && sourceUpdatedAt && ledgerUpdatedAt >= sourceUpdatedAt) {
      skippedStreams += 1
      continue
    }

    let afterKey = ''
    let seen = 0
    while (seen < limitPerStream) {
      const page = await db.query(\`
        SELECT row_key,payload FROM wb_stream_items
        WHERE connection_id=$1 AND stream=$2 AND sync_id=$3::uuid AND row_key>$4
        ORDER BY row_key LIMIT 1000
      \`,[connectionId,sync.stream,sync.sync_id,afterKey])
      if (!page.rows.length) break
      const result = await persistFinanceLedgerBatch(db,{connectionId,stream:sync.stream,rows:page.rows.map(item=>item.payload),keyOf:(_row,index)=>page.rows[index].row_key,batchSize:250})
      movements += result.movements
      seen += page.rows.length
      afterKey = page.rows.at(-1).row_key
      if (page.rows.length < 1000) break
    }
    processedStreams += 1
  }
  return { skipped:processedStreams===0,movements,processedStreams,skippedStreams }
}`,
  'per-stream finance ledger backfill')

  fs.writeFileSync(path,source)
}

// 2) Startup migration: old persisted finance pages must be re-normalized into
// the ledger even if another finance-related stream already created movements.
{
  const path='backend/src/server.js'
  let source=fs.readFileSync(path,'utf8')
  source=replaceOnce(source,
`  await ensureFinanceLedgerSchema(pool)
  await ensureDailyReadySchema()`,
`  await ensureFinanceLedgerSchema(pool)
  const ledgerBackfillConnections = await pool.query(\`SELECT id FROM marketplace_connections WHERE marketplace='wildberries' AND status='connected' ORDER BY updated_at DESC LIMIT 100\`)
  for (const connection of ledgerBackfillConnections.rows) {
    try {
      const repaired = await backfillFinanceLedgerFromStreamItems(pool,{connectionId:connection.id,limitPerStream:100000})
      if (repaired.processedStreams || repaired.movements) {
        console.log('[ELISEI 5.15.6] Finance ledger backfill:',{connectionId:connection.id,...repaired})
      }
    } catch (error) {
      console.warn('[ELISEI 5.15.6] Finance ledger backfill skipped:',connection.id,error.message)
    }
  }
  await ensureDailyReadySchema()`,
  'startup finance ledger backfill')
  fs.writeFileSync(path,source)
}

// 3) Finance UI: a missing ledger category is not zero. In periods with sales,
// no ledger movements means finance is not confirmed yet.
{
  const path='src/pages/DashboardPage.jsx'
  let source=fs.readFileSync(path,'utf8')
  source=replaceOnce(source,
`    const financeReady = Boolean(ledger.coverage?.financeReady || coreData?.availability?.finance)
    const financePartial = Boolean(ledger.coverage?.financePartial)
    const financeComplete = financeReady && !financePartial
    const ledgerHasMovements = Number(ledgerSummary.movements || 0) > 0`,
`    const financeReady = Boolean(ledger.coverage?.financeReady || coreData?.availability?.finance)
    const financePartial = Boolean(ledger.coverage?.financePartial)
    const ledgerHasMovements = Number(ledgerSummary.movements || 0) > 0
    const financeEvidenceMissing = Number(basePeriodFinanceSummary?.revenue || 0) > 0 && !ledgerHasMovements
    const financeComplete = financeReady && !financePartial && !financeEvidenceMissing`,
  'finance evidence guard')

  source=replaceOnce(source,
`[['Выручка',periodFinanceSummary.revenue],['Себестоимость',periodFinanceSummary.cogs],['Комиссия WB',periodFinanceSummary.commission],['Логистика',periodFinanceSummary.logistics],['Хранение',periodFinanceSummary.storage],['Платная приёмка',periodFinanceSummary.acceptance],['Эквайринг',periodFinanceSummary.acquiring],['Штрафы',periodFinanceSummary.penalties],['Удержания',periodFinanceSummary.deductions],['Подписки / сервисы WB',periodFinanceSummary.subscriptions],['Прочие списания WB',periodFinanceSummary.otherWbExpenses],['Корректировки / доплаты',periodFinanceSummary.additionalPayment],['Реклама',periodFinanceSummary.advertising],['Постоянные расходы',periodFinanceSummary.fixed],['Налог',periodFinanceSummary.tax]].map(([label,value]) => <div className="pnl-line" key={label}><span>{label}</span><strong>{formatMoney(value)}</strong></div>)`,
`[['Выручка',periodFinanceSummary.revenue],['Себестоимость',periodFinanceSummary.cogs],['Комиссия WB',periodFinanceSummary.commission],['Логистика',periodFinanceSummary.logistics],['Хранение',periodFinanceSummary.storage],['Платная приёмка',periodFinanceSummary.acceptance],['Эквайринг',periodFinanceSummary.acquiring],['Штрафы',periodFinanceSummary.penalties],['Удержания',periodFinanceSummary.deductions],['Подписки / сервисы WB',periodFinanceSummary.subscriptions],['Прочие списания WB',periodFinanceSummary.otherWbExpenses],['Корректировки / доплаты',periodFinanceSummary.additionalPayment],['Реклама',periodFinanceSummary.advertising],['Постоянные расходы',periodFinanceSummary.fixed],['Налог',periodFinanceSummary.tax]].map(([label,value]) => <div className="pnl-line" key={label}><span>{label}</span><strong>{value == null ? 'Не загружено' : formatMoney(value)}</strong></div>)`,
  'P&L missing value copy')
  fs.writeFileSync(path,source)
}

// 4) Release markers.
for (const [path,version] of [['package.json','5.15.6'],['backend/package.json','2.27.6']]) {
  const data=JSON.parse(fs.readFileSync(path,'utf8'))
  data.version=version
  fs.writeFileSync(path,JSON.stringify(data,null,2)+'\n')
}

for (const name of fs.readdirSync('backend/tests')) {
  if (!name.endsWith('.test.mjs')) continue
  const path=`backend/tests/${name}`
  let source=fs.readFileSync(path,'utf8')
  source=source.replaceAll("frontendPackage.version, '5.15.5'","frontendPackage.version, '5.15.6'")
  source=source.replaceAll("backendPackage.version, '2.27.5'","backendPackage.version, '2.27.6'")
  fs.writeFileSync(path,source)
}

console.log('ELISEI 5.15.6 finance ledger repair applied')
