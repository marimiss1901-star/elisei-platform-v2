import fs from 'node:fs'

function replaceOnce(source, oldText, newText, label) {
  if (source.includes(newText)) return source
  if (!source.includes(oldText)) throw new Error(`Nightly memory guard: ${label} target not found`)
  return source.replace(oldText, newText)
}

const serverFile = 'src/server.js'
let server = fs.readFileSync(serverFile, 'utf8')

server = replaceOnce(
  server,
  `      const repairedHeavyStages=new Set()\n      const financeCurrent=states.find(item=>item.stage==='finance') || null`,
  `      const repairedHeavyStages=new Set()\n      const cabinetHash=[...String(row.id || '')].reduce((sum,char)=>((sum*31)+char.charCodeAt(0))>>>0,7)\n      const financeCurrent=states.find(item=>item.stage==='finance') || null`,
  'define cabinet spread before finance repair',
)

server = replaceOnce(
  server,
  `      const financeStale=Boolean(financeCurrent)\n        && (!financePeriodTo || financePeriodTo<targetDate || financePayload?.complete!==true)\n      if(financeStale && !financeHardBlocked.has(financeStatus) && !financeContinuationActive){\n        const period=syncPeriodForStage('finance',taxQuarterRange)\n        await updateSyncState(row.id,'finance',{\n          status:'queued',nextAllowedAt:new Date(now+2*60*1000).toISOString(),lastError:null,lastCount:0,taskId:null,`,
  `      const financeStale=Boolean(financeCurrent)\n        && (!financePeriodTo || financePeriodTo<targetDate || financePayload?.complete!==true)\n      const financeRepairWindow=['overnight','preopen'].includes(slot)\n      if(financeRepairWindow && financeStale && !financeHardBlocked.has(financeStatus) && !financeContinuationActive){\n        const period=syncPeriodForStage('finance',taxQuarterRange)\n        // Do not stampede all connected cabinets at 00:00 Moscow. Heavy finance\n        // repair belongs to the 01:30-07:30 business-night lane and is spread\n        // deterministically across the window.\n        const financeSpreadSeconds=2*60+(cabinetHash%(45*60))\n        await updateSyncState(row.id,'finance',{\n          status:'queued',nextAllowedAt:new Date(now+financeSpreadSeconds*1000).toISOString(),lastError:null,lastCount:0,taskId:null,`,
  'gate and spread finance freshness repair',
)

server = replaceOnce(
  server,
  `      const heavyPlan=dailyHeavyStagePlan({states,now,timeZone:dailyReadyTimezone})\n        .filter(stage=>!repairedHeavyStages.has(stage))\n      const cabinetHash=[...String(row.id || '')].reduce((sum,char)=>((sum*31)+char.charCodeAt(0))>>>0,7)\n      const cabinetSpreadSeconds=slot==='overnight' ? cabinetHash%(30*60) : cabinetHash%(5*60)`,
  `      // Keep at most one heavy continuation per cabinet. The old scheduler\n      // could queue finance + reports + analytics for the same cabinet within\n      // consecutive 30-second passes, making a 512 MB Render instance retain\n      // several large canonical snapshots at once.\n      const heavyBusy=repairedHeavyStages.size>0 || states.some(item=>\n        Object.prototype.hasOwnProperty.call(DAILY_READY_HEAVY_INTERVALS_SECONDS,String(item?.stage || ''))\n        && ['running','pending','queued','rate_limited','retry_scheduled'].includes(String(item?.status || ''))\n      )\n      const heavyPlan=heavyBusy ? [] : dailyHeavyStagePlan({states,now,timeZone:dailyReadyTimezone})\n        .filter(stage=>!repairedHeavyStages.has(stage))\n        .slice(0,1)\n      const cabinetSpreadSeconds=slot==='overnight' ? cabinetHash%(30*60) : cabinetHash%(5*60)`,
  'serialize heavy stages per cabinet',
)

server = replaceOnce(
  server,
  `\n  for (const row of due) {\n    if (!smartSchedulerAllows(row.connection_id,row.stage)) continue\n    const syncKey = \`${'${row.user_id}:${row.connection_id}'}\``,
  `\n  let memoryHeavyProcessed=false\n  for (const row of due) {\n    if (!smartSchedulerAllows(row.connection_id,row.stage)) continue\n    const memoryHeavy=Object.prototype.hasOwnProperty.call(DAILY_READY_HEAVY_INTERVALS_SECONDS,String(row.stage || ''))\n    if (memoryHeavy && memoryHeavyProcessed) continue\n    const syncKey = \`${'${row.user_id}:${row.connection_id}'}\``,
  'add global heavy-stage cycle guard',
)

server = replaceOnce(
  server,
  `    if (deferredStageLocks.has(row.connection_id) || activeSyncs.has(syncKey)) continue\n    deferredStageLocks.add(row.connection_id)\n    try {`,
  `    if (deferredStageLocks.has(row.connection_id) || activeSyncs.has(syncKey)) continue\n    deferredStageLocks.add(row.connection_id)\n    if (memoryHeavy) memoryHeavyProcessed=true\n    try {`,
  'mark one heavy stage per worker cycle',
)

server = replaceOnce(
  server,
  `    const value = await task\n    canonicalConnectionDataRecent.set(key,{ value,expiresAt:Date.now()+5000 })\n    return value`,
  `    const value = await task\n    const cacheEntry={ value,expiresAt:Date.now()+5000 }\n    canonicalConnectionDataRecent.set(key,cacheEntry)\n    // Expired canonical snapshots used to remain strongly referenced forever\n    // until the exact same cache key was requested again. On a multi-cabinet\n    // worker that retained several large hydrated datasets and pushed RSS close\n    // to Render's 512 MB limit. Evict actively after the short collapse window.\n    const cacheTimer=setTimeout(()=>{\n      if(canonicalConnectionDataRecent.get(key)===cacheEntry) canonicalConnectionDataRecent.delete(key)\n    },5500)\n    cacheTimer.unref?.()\n    return value`,
  'actively evict canonical hydration cache',
)

fs.writeFileSync(serverFile, server)
console.log('ELISEI 5.18.7 nightly memory guard applied')
