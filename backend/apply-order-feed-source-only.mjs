import fs from 'node:fs'

function patchFile(path, mutate) {
  const before = fs.readFileSync(path,'utf8')
  const after = mutate(before)
  fs.writeFileSync(path,after)
}

function replaceOnce(source, oldText, newText, label) {
  if (source.includes(newText)) return source
  if (!source.includes(oldText)) throw new Error(`Order Feed source-only patch: ${label} target not found`)
  return source.replace(oldText,newText)
}

patchFile('src/server.js', source => {
  // Migration must run from the worker itself. Waiting for a user to open the
  // Synchronizations/status endpoint left existing cabinets on a legacy
  // next_allowed_at window after deployment.
  source = replaceOnce(
    source,
    "    await recoverStaleSyncStates({ reason:`worker:${reason}` })\n    await recoverLegacyFinanceCooldowns()",
    "    await recoverStaleSyncStates({ reason:`worker:${reason}` })\n    await recoverLegacyOrderFeedState()\n    await recoverLegacyFinanceCooldowns()",
    'startup/background migration kick',
  )
  return source
})

patchFile('src/wb/daily-ready.js', source => {
  // Sales are a read model derived from the exact same Order Feed response.
  // A missing sales day must be repaired by the orders source, not by scheduling
  // a second independent `sales` job that can only re-read stale order-feed rows.
  source = replaceOnce(
    source,
    "export const DAILY_READY_OPERATIONAL_RECOVERY_STAGES = Object.freeze(['orders','sales','advertising'])",
    "export const DAILY_READY_OPERATIONAL_RECOVERY_STAGES = Object.freeze(['orders','advertising'])",
    'Daily Ready single Order Feed source',
  )
  return source
})

console.log('WB Order Feed single-source scheduling applied')
