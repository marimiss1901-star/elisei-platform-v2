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

fs.writeFileSync(file,source)
console.log('WB Order Feed single-source scheduling applied')
