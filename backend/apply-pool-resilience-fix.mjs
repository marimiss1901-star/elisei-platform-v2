import fs from 'node:fs'

const file = 'src/server.js'
let source = fs.readFileSync(file, 'utf8')

function replaceOnce(oldText, newText, label) {
  if (source.includes(newText)) return
  if (!source.includes(oldText)) throw new Error(`Pool resilience patch: ${label} target not found`)
  source = source.replace(oldText,newText)
}

replaceOnce(
`const pool = databaseUrl ? new Pool({\n  connectionString: databaseUrl,\n  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,\n  max: Math.max(2, Math.min(10, Number(process.env.PG_POOL_MAX || 5))),\n  connectionTimeoutMillis: Math.max(3000, Number(process.env.PG_CONNECT_TIMEOUT_MS || 8000)),\n  idleTimeoutMillis: Math.max(10000, Number(process.env.PG_IDLE_TIMEOUT_MS || 30000)),\n}) : null`,
`const pool = databaseUrl ? new Pool({\n  connectionString: databaseUrl,\n  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,\n  // ELISEI runs many background WB stages. Keep the application pool deliberately\n  // small so a low-tier PostgreSQL instance is never saturated by one browser tab.\n  max: Math.max(1, Math.min(4, Number(process.env.PG_POOL_MAX || 2))),\n  connectionTimeoutMillis: Math.max(3000, Number(process.env.PG_CONNECT_TIMEOUT_MS || 6000)),\n  idleTimeoutMillis: Math.max(10000, Number(process.env.PG_IDLE_TIMEOUT_MS || 20000)),\n}) : null`,
'pool sizing')

replaceOnce(
`if (pool) {\n  pool.on('error', error => {\n    databaseState.ready = false\n    databaseState.status = 'reconnecting'\n    databaseState.lastError = error.message\n    console.warn('PostgreSQL pool error; API stays online and will reconnect:', error.message)\n    scheduleDatabaseInitialization(2000, 'pool-error')\n  })\n}\n`,
`if (pool) {\n  pool.on('error', error => {\n    // node-postgres already removes a broken idle client from the pool. Treat this\n    // as a degraded connection, not as proof that the whole database is down.\n    // Re-running the full schema initializer on every idle-client error used to\n    // create the visible ELISEI \"rollback\" loop.\n    databaseState.status = 'degraded'\n    databaseState.lastError = error.message\n    console.warn('PostgreSQL pool client error; keeping API online and probing:', error.message)\n    let attempt = 0\n    const probe = async () => {\n      attempt += 1\n      try {\n        await pool.query('SELECT 1')\n        databaseState.ready = true\n        databaseState.status = 'ok'\n        databaseState.lastError = null\n        databaseState.lastConnectedAt = new Date().toISOString()\n      } catch (probeError) {\n        databaseState.status = 'degraded'\n        databaseState.lastError = probeError.message\n        if (attempt < 12) {\n          const retry = setTimeout(probe, Math.min(10000, 500 * (2 ** Math.min(4, attempt))))\n          retry.unref?.()\n        }\n      }\n    }\n    const probeTimer = setTimeout(probe, 250)\n    probeTimer.unref?.()\n  })\n}\n`,
'pool error handling')

replaceOnce(
`app.use('/api', (req, res, next) => {\n  if (!pool) return res.status(503).json({ error:'DATABASE_URL не настроен', code:'DATABASE_NOT_CONFIGURED' })\n  if (!databaseState.ready) {\n    const retryAfterSeconds = databaseState.nextRetryAt\n      ? Math.max(1, Math.ceil((new Date(databaseState.nextRetryAt).getTime() - Date.now()) / 1000))\n      : 3\n    res.setHeader('Retry-After', String(retryAfterSeconds))\n    return res.status(503).json({\n      error:'База данных временно переподключается. Backend работает и повторит подключение автоматически.',\n      code:'DATABASE_RECONNECTING',\n      retryAfterSeconds,\n    })\n  }\n  next()\n})`,
`app.use('/api', (req, res, next) => {\n  if (!pool) return res.status(503).json({ error:'DATABASE_URL не настроен', code:'DATABASE_NOT_CONFIGURED' })\n  // databaseState is observability only. Never reject every API request merely\n  // because one background probe is degraded. The route performs the real query;\n  // db-resilience-preload converts an actual transient PostgreSQL failure to 503.\n  next()\n})`,
'global database gate')

// One browser entry used to fan out into dashboard/products/core/advertising/
// diagnostics requests. Every route independently hydrated the same 20+ WB
// streams. Share one canonical hydration between simultaneous/recent readers.
const canonicalSignature = `async function canonicalConnectionData(connection, { repair = true, persistManifest = true, queueMissing = true } = {}) {`
const canonicalImplSignature = `async function canonicalConnectionDataImpl(connection, { repair = true, persistManifest = true, queueMissing = true } = {}) {`
const canonicalMarker = `const canonicalConnectionDataInflight = new Map()`

if (!source.includes(canonicalMarker)) {
  if (!source.includes(canonicalSignature)) throw new Error('Canonical connection dedupe target not found')
  source = source.replace(canonicalSignature,canonicalImplSignature)
  source += `\n\n// ELISEI golden-path stability: collapse concurrent cabinet hydration.\nconst canonicalConnectionDataInflight = new Map()\nconst canonicalConnectionDataRecent = new Map()\nasync function canonicalConnectionData(connection, options = {}) {\n  if (!connection) return canonicalConnectionDataImpl(connection, options)\n  const repair = options?.repair !== false\n  const persistManifest = options?.persistManifest !== false\n  const queueMissing = options?.queueMissing !== false\n  const key = [connection.id || 'none', repair ? 1 : 0, persistManifest ? 1 : 0, queueMissing ? 1 : 0].join(':')\n  const recent = canonicalConnectionDataRecent.get(key)\n  if (recent && recent.expiresAt > Date.now()) return recent.value\n  if (recent) canonicalConnectionDataRecent.delete(key)\n  const existing = canonicalConnectionDataInflight.get(key)\n  if (existing) return existing\n  const task = canonicalConnectionDataImpl(connection,{ repair,persistManifest,queueMissing })\n  canonicalConnectionDataInflight.set(key,task)\n  try {\n    const value = await task\n    canonicalConnectionDataRecent.set(key,{ value,expiresAt:Date.now()+5000 })\n    return value\n  } finally {\n    if (canonicalConnectionDataInflight.get(key) === task) canonicalConnectionDataInflight.delete(key)\n  }\n}\n`
} else {
  source = source.replace('expiresAt:Date.now()+1500','expiresAt:Date.now()+5000')
}

fs.writeFileSync(file, source)
console.log('PostgreSQL golden-path resilience applied')
