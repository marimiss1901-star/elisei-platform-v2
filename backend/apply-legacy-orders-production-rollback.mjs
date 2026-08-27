import fs from 'node:fs'

const file='src/server.js'
let source=fs.readFileSync(file,'utf8')

function replaceOnce(oldText,newText,label){
  if(source.includes(newText)) return
  if(!source.includes(oldText)) throw new Error(`Legacy orders rollback patch: ${label} target not found`)
  source=source.replace(oldText,newText)
}

const recovery=`const LEGACY_ORDERS_ROLLBACK_VERSION=2\n\nasync function recoverOrderFeedProductionRollback({ connectionId = null } = {}) {\n  if(!pool) return []\n  const params=[String(LEGACY_ORDERS_ROLLBACK_VERSION)]\n  let connectionFilter=''\n  if(connectionId){params.push(connectionId);connectionFilter=' AND connection_id=$2'}\n  const result=await pool.query(\`\n    UPDATE wb_sync_states\n    SET status='queued',next_allowed_at=NOW(),task_id=NULL,\n        last_error='ELISEI повторно запускает проверенный поток заказов/продаж WB. Сохранённые цифры не удалены.',\n        metadata=(COALESCE(metadata,'{}'::jsonb)\n          - 'orderFeedPrimaryVersion' - 'orderFeedSource' - 'orderFeedMigrationQueuedVersion' - 'orderFeedMigrationQueuedAt'\n          - 'derivedFromOrders' - 'snapshotTime' - 'minimumIntervalSeconds' - 'statusCounts')\n          || jsonb_build_object('legacyOrdersRollbackVersion',$1::int,'legacyOrdersRollbackAt',NOW()),\n        updated_at=NOW()\n    WHERE stage IN ('orders','sales')\n      AND COALESCE(metadata->>'legacyOrdersRollbackVersion','')<>$1::text\n      AND (\n        metadata ? 'orderFeedPrimaryVersion' OR metadata ? 'orderFeedSource' OR metadata ? 'orderFeedMigrationQueuedVersion'\n        OR status IN ('queued','rate_limited','retry_scheduled','error')\n        OR COALESCE(metadata->>'legacyOrdersRollbackVersion','')='1'\n      )\n      \${connectionFilter}\n    RETURNING connection_id,stage\n  \`,params)\n  if(result.rows.length) console.warn(\`Legacy orders production rollback queued \${result.rows.length} stage(s).\`)\n  return result.rows\n}\n\n`
if(!source.includes('async function recoverOrderFeedProductionRollback(')){
  const marker='async function recoverLegacySearchQueryBindings({ connectionId = null } = {}) {'
  if(!source.includes(marker)) throw new Error('Legacy orders rollback patch: recovery insertion target not found')
  source=source.replace(marker,recovery+marker)
}

replaceOnce(
  "    await recoverStaleSyncStates({ reason:`worker:${reason}` })\n    await recoverLegacyFinanceCooldowns()",
  "    await recoverStaleSyncStates({ reason:`worker:${reason}` })\n    await recoverOrderFeedProductionRollback()\n    await recoverLegacyFinanceCooldowns()",
  'background rollback kick')

fs.writeFileSync(file,source)
console.log('Legacy orders production rollback applied')
