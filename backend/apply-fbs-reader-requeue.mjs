import fs from 'node:fs'

const file='src/server.js'
let source=fs.readFileSync(file,'utf8')

const functionMarker='async function recoverLegacyFinanceCooldowns'
const functionName='recoverLegacyFbsMarketplaceReaderError'

if(!source.includes(`async function ${functionName}()`)){
  if(!source.includes(functionMarker)) throw new Error('FBS reader requeue patch: recovery insertion point not found')
  const recovery=`async function ${functionName}() {
  if (!pool) return []
  const migrated = await pool.query(\`
    UPDATE wb_sync_states
    SET status='retry_scheduled',
        next_allowed_at=NOW(),
        last_error='ELISEI перепроверяет FBS через Marketplace API после обновления reader.',
        metadata=COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
          'fbsMarketplaceReaderMigration',true,
          'fbsMarketplaceReaderMigrationAt',NOW()
        ),
        updated_at=NOW()
    WHERE stage='sellerStocks'
      AND status='error'
      AND COALESCE(last_error,'') ILIKE '%token does not satisfy additional requirements%'
      AND COALESCE(last_attempt_at,updated_at) < TIMESTAMPTZ '2026-08-26T07:54:09Z'
    RETURNING connection_id,stage
  \`)
  const authCompat = await pool.query(\`
    UPDATE wb_sync_states
    SET status='retry_scheduled',
        next_allowed_at=NOW(),
        last_error='ELISEI повторяет FBS стандартной Marketplace-авторизацией без лишнего сервисного заголовка.',
        metadata=COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
          'marketplaceAuthHeaderCompatRetry',true,
          'marketplaceAuthHeaderCompatRetryAt',NOW()
        ),
        updated_at=NOW()
    WHERE stage='sellerStocks'
      AND status='error'
      AND COALESCE(last_error,'') ILIKE '%token does not satisfy additional requirements%'
      AND COALESCE(metadata->>'marketplaceAuthHeaderCompatRetry','') <> 'true'
    RETURNING connection_id,stage
  \`)
  const rows=[...migrated.rows,...authCompat.rows]
  if(rows.length) console.log('[ELISEI] Requeued '+rows.length+' FBS auth compatibility check(s).')
  return rows
}

`
  source=source.replace(functionMarker,recovery+functionMarker)
}

const callMarker='  await recoverRetryableErrorStates()\n'
if(!source.includes(`  await ${functionName}()`)){
  if(!source.includes(callMarker)) throw new Error('FBS reader requeue patch: startup recovery call point not found')
  source=source.replace(callMarker,callMarker+`  await ${functionName}()\n`)
}

fs.writeFileSync(file,source)
console.log('FBS reader/auth compatibility requeue applied')
