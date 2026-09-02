import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const here=path.dirname(fileURLToPath(import.meta.url))
const backendRoot=path.resolve(here,'..')
const repoRoot=path.resolve(backendRoot,'..')

const server=fs.readFileSync(path.join(backendRoot,'src/server.js'),'utf8')
const dashboard=fs.readFileSync(path.join(repoRoot,'src/pages/DashboardPage.jsx'),'utf8')
const api=fs.readFileSync(path.join(repoRoot,'src/lib/api.js'),'utf8')

// A background pool-health flag must never blank every API endpoint.
assert.ok(server.includes("PG_POOL_MAX || 2"),'PostgreSQL pool must default to two clients for the current Render DB tier')
assert.ok(server.includes("app.use('/api', (req, res, next) =>"),'API database middleware missing')
assert.ok(!server.includes("if (!databaseState.ready) {\n    const retryAfterSeconds"),'Global DATABASE_RECONNECTING gate must stay removed')
assert.ok(server.includes("PostgreSQL pool client error; keeping API online and probing"),'Pool errors must degrade/probe instead of forcing a global outage')
assert.ok(server.includes('expiresAt:Date.now()+5000'),'Canonical WB hydration must be shared across nearby readers')

// One browser entry must preserve last-known-good data and avoid duplicate heavy reads.
assert.ok(dashboard.includes("const raw = localStorage.getItem(key)"),'Workspace last-known-good cache must survive refresh/new tab')
assert.ok(dashboard.includes("safeGetLocalStorage(ANALYTICS_COMPARE_KEY) === 'true'"),'Previous-period comparison must be opt-in')
assert.ok(dashboard.includes("const currentResult = await wbApi.core(connectionId,{ from:period.from,to:period.to })"),'Current period core must be loaded before optional comparison')
assert.ok(dashboard.includes('setCoreData(nextCore)'),'Successful selected-period core must drive the main screen too')
assert.ok(dashboard.includes("if (active !== 'Финансы'"),'Detailed finance ledger must not load during main-screen bootstrap')
assert.ok(!dashboard.includes('setAnalyticsCore(null)\n    setAnalyticsCompareCore(null)'),'Confirmed analytics must never be erased before replacement arrives')

// Critical read models use stale-while-revalidate on transient backend/DB failures.
assert.ok(api.includes("const READ_CACHE_PREFIX = 'elisei_read_cache_v1:'"),'Persistent critical-read cache missing')
assert.ok(api.includes("method === 'GET' ? AbortSignal.timeout(15000)"),'GET requests need a bounded timeout')
assert.ok(api.includes('async function cachedRead('),'Critical read fallback helper missing')
assert.ok(api.includes('transientFallback:true'),'Transient fallback marker missing')
assert.ok(api.includes('cachedRead(`products:${connectionId}`'),'Products must use last-known-good fallback')
assert.ok(api.includes('cachedRead(`core:${connectionId}:'),'Core must use last-known-good fallback')
assert.ok(api.includes('cachedRead(`finance:${connectionId}:'),'Finance ledger must use last-known-good fallback')

console.log('WB golden-path stability regression passed')
