import fs from 'node:fs'

const file='src/server.js'
let source=fs.readFileSync(file,'utf8')

function replaceOnce(oldText,newText,label){
  if(source.includes(newText)) return
  if(!source.includes(oldText)) throw new Error(`Order Feed source-only patch: ${label} target not found`)
  source=source.replace(oldText,newText)
}

// Migration must run from the worker itself. Waiting for a user to open the
// Synchronizations/status endpoint left existing cabinets on a legacy
// next_allowed_at window after deployment.
replaceOnce(
  "    await recoverStaleSyncStates({ reason:`worker:${reason}` })\n    await recoverLegacyFinanceCooldowns()",
  "    await recoverStaleSyncStates({ reason:`worker:${reason}` })\n    await recoverLegacyOrderFeedState()\n    await recoverLegacyFinanceCooldowns()",
  'startup/background migration kick',
)

// The same successful Order Feed query confirms both read models. If Daily
// Ready explicitly checked a closed date and there were legitimately zero
// buyouts on that date, the derived sales stream must still remember that WB
// confirmed the day. Otherwise the UI can fall back into an endless sales gap.
replaceOnce(
`      data.sales=siblingSalesValue
      await updateSyncState(connection.id,'sales',{
        status:'success',lastAttemptAt:new Date().toISOString(),lastSuccessAt:new Date().toISOString(),nextAllowedAt:null,lastError:null,
        lastCount:stageCount('sales',siblingSalesValue),taskId:null,
        metadata:{...(siblingSalesMeta||{}),tokenId:selected.row.id,tokenLabel:selected.row.label,primary:Boolean(selected.row.is_primary),orderFeedPrimaryVersion:ORDER_FEED_PRIMARY_VERSION,derivedFromOrders:true},
      })`,
`      data.sales=siblingSalesValue
      const siblingDailyReadyDate=/^\\d{4}-\\d{2}-\\d{2}$/.test(String(state?.metadata?.dailyReadyDate || ''))
        ? String(state.metadata.dailyReadyDate).slice(0,10)
        : ''
      const siblingDailyReadyConfirmation=siblingDailyReadyDate ? {
        dailyReadyConfirmedFrom:siblingDailyReadyDate,
        dailyReadyConfirmedThrough:siblingDailyReadyDate,
        dailyReadyRecoveryAt:new Date().toISOString(),
      } : {}
      await updateSyncState(connection.id,'sales',{
        status:'success',lastAttemptAt:new Date().toISOString(),lastSuccessAt:new Date().toISOString(),nextAllowedAt:null,lastError:null,
        lastCount:stageCount('sales',siblingSalesValue),taskId:null,
        metadata:{...(siblingSalesMeta||{}),...siblingDailyReadyConfirmation,tokenId:selected.row.id,tokenLabel:selected.row.label,primary:Boolean(selected.row.is_primary),orderFeedPrimaryVersion:ORDER_FEED_PRIMARY_VERSION,derivedFromOrders:true},
      })`,
  'derived sales closed-day confirmation',
)

fs.writeFileSync(file,source)
console.log('WB Order Feed single-source scheduling applied')
