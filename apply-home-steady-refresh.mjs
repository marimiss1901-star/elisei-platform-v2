import fs from 'node:fs'

const file='src/pages/DashboardPage.jsx'
let source=fs.readFileSync(file,'utf8')
if (source.includes('ELISEI_CANONICAL_FRONTEND_PATCHES')) process.exit(0)

function replaceOnce(oldText,newText,label){
  if(source.includes(newText)) return
  if(!source.includes(oldText)) throw new Error(`Steady Home patch: ${label} target not found`)
  source=source.replace(oldText,newText)
}

// A 15-second status poll is allowed to refresh the lightweight Daily Ready
// snapshot only. Re-running products + dashboard + history + advertising +
// diagnostics on every worker revision creates a permanent request carousel on
// the Main page and competes with the selected-period core for the tiny Render
// PostgreSQL pool.
replaceOnce(
"        if (shouldReload) await Promise.allSettled([loadDailyReady(connectionId),loadConnectionData(connectionId)])",
"        if (shouldReload) await loadDailyReady(connectionId)",
'background status refresh')

// lastSync changes whenever the worker finishes another stream. It is not a
// user request to recalculate the selected analytics period. The period core is
// loaded on entry / period change / comparison change and can be refreshed
// explicitly; background sync must keep the last confirmed figures on screen.
replaceOnce(
"  }, [active, connection.connected, connection.connectionId, connection.lastSync, analyticsPeriod.from, analyticsPeriod.to, analyticsCompare])",
"  }, [active, connection.connected, connection.connectionId, analyticsPeriod.from, analyticsPeriod.to, analyticsCompare])",
'analytics effect must ignore worker heartbeat')

fs.writeFileSync(file,source)
console.log('Steady Home background refresh applied')
