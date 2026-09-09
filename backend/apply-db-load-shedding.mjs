import fs from 'node:fs'

// ELISEI 5.19.12 — the current Render Postgres is CPU/memory constrained.
// Keep automatic sync, but avoid waking the heavy scheduler every 30 seconds.
const serverUrl=new URL('./src/server.js',import.meta.url)
let source=fs.readFileSync(serverUrl,'utf8')

const before=`setInterval(() => {\n  if (databaseState.ready) kickBackgroundWorkers('interval')\n  else if (!databaseInitPromise && !databaseRetryTimer) scheduleDatabaseInitialization(0, 'interval-retry')\n}, 30000)`
const after=`setInterval(() => {\n  if (databaseState.ready) kickBackgroundWorkers('interval')\n  else if (!databaseInitPromise && !databaseRetryTimer) scheduleDatabaseInitialization(0, 'interval-retry')\n}, 60000)`

if(!source.includes(after)){
  if(!source.includes(before)) throw new Error('ELISEI 5.19.12 background interval marker not found')
  source=source.replace(before,after)
}

fs.writeFileSync(serverUrl,source)
console.log('ELISEI 5.19.12 DB load shedding applied: background interval 60s')
