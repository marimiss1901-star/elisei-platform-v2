import fs from 'node:fs'

const file = 'src/server.js'
let source = fs.readFileSync(file, 'utf8')

const oldText = `if (pool) {
  pool.on('error', error => {
    databaseState.ready = false
    databaseState.status = 'reconnecting'
    databaseState.lastError = error.message
    console.warn('PostgreSQL pool error; API stays online and will reconnect:', error.message)
    scheduleDatabaseInitialization(2000, 'pool-error')
  })
}
`

const newText = `if (pool) {
  pool.on('error', error => {
    // A pg Pool error can belong to one idle client. pg evicts that client and
    // keeps the rest of the pool usable, so do not announce a global outage
    // until a lightweight probe confirms the database itself is unavailable.
    databaseState.status = databaseState.ready ? 'degraded' : 'reconnecting'
    databaseState.lastError = error.message
    console.warn('PostgreSQL pool client error; probing database before global reconnect:', error.message)
    const probeTimer = setTimeout(async () => {
      try {
        await pool.query('SELECT 1')
        databaseState.ready = true
        databaseState.status = 'ok'
        databaseState.lastError = null
        databaseState.lastConnectedAt = new Date().toISOString()
      } catch (probeError) {
        databaseState.ready = false
        databaseState.status = 'reconnecting'
        databaseState.lastError = probeError.message
        scheduleDatabaseInitialization(2000, 'pool-error-probe')
      }
    }, 250)
    probeTimer.unref?.()
  })
}
`

if (!source.includes(newText)) {
  if (!source.includes(oldText)) throw new Error('Pool resilience patch target not found')
  source = source.replace(oldText,newText)
}

// One browser entry used to fan out into dashboard/products/core/advertising/
// diagnostics requests. Every route independently hydrated the same 20+ WB
// streams, so a pool of five PostgreSQL connections was easy to saturate.
// Share one canonical read between simultaneous read-only requests instead.
const canonicalSignature = `async function canonicalConnectionData(connection, { repair = true, persistManifest = true, queueMissing = true } = {}) {`
const canonicalImplSignature = `async function canonicalConnectionDataImpl(connection, { repair = true, persistManifest = true, queueMissing = true } = {}) {`
const canonicalMarker = `const canonicalConnectionDataInflight = new Map()`

if (!source.includes(canonicalMarker)) {
  if (!source.includes(canonicalSignature)) throw new Error('Canonical connection dedupe target not found')
  source = source.replace(canonicalSignature,canonicalImplSignature)
  source += `\n\n// ELISEI bootstrap resilience: collapse concurrent read-only cabinet hydration.\nconst canonicalConnectionDataInflight = new Map()\nconst canonicalConnectionDataRecent = new Map()\nasync function canonicalConnectionData(connection, options = {}) {\n  if (!connection) return canonicalConnectionDataImpl(connection, options)\n  const repair = options?.repair !== false\n  const persistManifest = options?.persistManifest !== false\n  const queueMissing = options?.queueMissing !== false\n  const key = [connection.id || 'none', repair ? 1 : 0, persistManifest ? 1 : 0, queueMissing ? 1 : 0].join(':')\n  const readOnlyBootstrap = repair && persistManifest && queueMissing\n  if (readOnlyBootstrap) {\n    const recent = canonicalConnectionDataRecent.get(key)\n    if (recent && recent.expiresAt > Date.now()) return recent.value\n    if (recent) canonicalConnectionDataRecent.delete(key)\n  }\n  const existing = canonicalConnectionDataInflight.get(key)\n  if (existing) return existing\n  const task = canonicalConnectionDataImpl(connection,{ repair,persistManifest,queueMissing })\n  canonicalConnectionDataInflight.set(key,task)\n  try {\n    const value = await task\n    if (readOnlyBootstrap) canonicalConnectionDataRecent.set(key,{ value,expiresAt:Date.now()+1500 })\n    return value\n  } finally {\n    if (canonicalConnectionDataInflight.get(key) === task) canonicalConnectionDataInflight.delete(key)\n  }\n}\n`
}

fs.writeFileSync(file, source)
console.log('PostgreSQL pool resilience + canonical bootstrap dedupe applied')
