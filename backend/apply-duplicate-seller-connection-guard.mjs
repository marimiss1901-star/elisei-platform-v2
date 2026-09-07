import fs from 'node:fs'

function replaceOnce(source, oldText, newText, label) {
  if (source.includes(newText)) return source
  if (!source.includes(oldText)) throw new Error(`Duplicate seller connection guard: ${label} target not found`)
  return source.replace(oldText, newText)
}

const serverFile='src/server.js'
let server=fs.readFileSync(serverFile,'utf8')

server=replaceOnce(
  server,
  `  await ensurePrimaryTokens()\n  await migrateAutomaticRefreshSettings()`,
  `  await ensurePrimaryTokens()\n\n  // 5.18.8: one WB seller cabinet must have exactly one active ELISEI\n  // connection globally. Historical duplicates from old/test user accounts are\n  // preserved, but they must never triple-poll the same WB seller or compete\n  // for the 512 MB worker. Team access should share one cabinet connection, not\n  // create another background synchronization pipeline for the same seller_id.\n  const duplicateSellerConnections=await pool.query(\`\n    WITH ranked AS (\n      SELECT id,\n        ROW_NUMBER() OVER (\n          PARTITION BY marketplace,seller_id\n          ORDER BY created_at DESC,updated_at DESC,id DESC\n        ) AS rn\n      FROM marketplace_connections\n      WHERE status='connected' AND seller_id IS NOT NULL AND BTRIM(seller_id)<>''\n    )\n    UPDATE marketplace_connections connection\n    SET status='superseded',updated_at=NOW()\n    FROM ranked\n    WHERE connection.id=ranked.id AND ranked.rn>1\n    RETURNING connection.id\n  \`)\n  if(duplicateSellerConnections.rowCount){\n    const duplicateIds=duplicateSellerConnections.rows.map(item=>item.id)\n    await pool.query(\`\n      UPDATE wb_sync_states\n      SET status='superseded',next_allowed_at=NULL,\n          last_error='Дублирующее подключение WB отключено: используется более новое подключение этого же кабинета.',\n          updated_at=NOW()\n      WHERE connection_id=ANY($1::uuid[])\n        AND status IN ('running','pending','queued','rate_limited','retry_scheduled','error')\n    \`,[duplicateIds])\n    await pool.query(\`\n      UPDATE wb_webhooks\n      SET enabled=FALSE,status='superseded',updated_at=NOW()\n      WHERE connection_id=ANY($1::uuid[]) AND enabled=TRUE\n    \`,[duplicateIds])\n    console.log('[ELISEI 5.18.8] Superseded duplicate WB seller connection(s):',duplicateIds.length)\n  }\n\n  await migrateAutomaticRefreshSettings()`,
  'supersede duplicate WB seller connections at startup',
)

fs.writeFileSync(serverFile,server)
console.log('ELISEI 5.18.8 duplicate seller connection guard applied')
