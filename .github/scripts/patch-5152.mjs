import fs from 'node:fs'

function replaceOnce(source,from,to,label){
  if(source.includes(to)) return source
  const count=source.split(from).length-1
  if(count!==1) throw new Error(`${label}: expected one marker, found ${count}`)
  return source.replace(from,to)
}

const path='backend/src/server.js'
let source=fs.readFileSync(path,'utf8')

source=replaceOnce(source,
  "import {\n  LIVE_SYNC_STAGES, defaultLiveSyncSettings, normalizeLiveSyncSettings, dueLiveStages, eventStages, safeEqualSecret, publicLiveSyncStatus,\n} from './wb/live-sync.js'",
  "import {\n  LIVE_SYNC_STAGES, defaultLiveSyncSettings, normalizeLiveSyncSettings, dueLiveStages, eventStages, safeEqualSecret, publicLiveSyncStatus,\n} from './wb/live-sync.js'\nimport { wbRateWindowDelaySeconds } from './wb/rate-window.js'",
  'rate-window import')

const oldRemember=`function rememberWbRateWindow(url, response) {
  if (!response?.headers) return null
  const remaining = Number(response.headers.get('x-ratelimit-remaining'))
  const reset = Number(response.headers.get('x-ratelimit-reset'))
  const retry = Number(response.headers.get('x-ratelimit-retry') || response.headers.get('retry-after'))
  const seconds = Number.isFinite(retry) && retry > 0
    ? retry
    : Number.isFinite(remaining) && remaining <= 0 && Number.isFinite(reset) && reset > 0
      ? reset
      : 0
  if (!(seconds > 0)) return null
  const key = wbRateWindowKey(url)
  const nextAllowedAt = Date.now() + Math.ceil(seconds * 1000) + 350
  const current = Number(wbRuntimeRateWindows.get(key) || 0)
  if (nextAllowedAt > current) wbRuntimeRateWindows.set(key,nextAllowedAt)
  return new Date(nextAllowedAt).toISOString()
}`
const newRemember=`function rememberWbRateWindow(url, response) {
  const seconds = wbRateWindowDelaySeconds(response)
  if (!(seconds > 0)) return null
  const key = wbRateWindowKey(url)
  const nextAllowedAt = Date.now() + Math.ceil(seconds * 1000) + 350
  const current = Number(wbRuntimeRateWindows.get(key) || 0)
  if (nextAllowedAt > current) wbRuntimeRateWindows.set(key,nextAllowedAt)
  return new Date(nextAllowedAt).toISOString()
}`
source=replaceOnce(source,oldRemember,newRemember,'rememberWbRateWindow')

const financeMarker=`async function recoverLegacyFinanceCooldowns({ connectionId = null } = {}) {
  // 5.10.4: длинная пауза finance больше не считается ошибкой сама по себе.
  // Для Базового токена без X-Client-Secret официальный интервал WB между
  // запросами детализации — 12 часов. Настоящие queued/rate_limited состояния
  // сохраняем и никогда не сбрасываем искусственно.
  return []
}`
const financeWithRecovery=`async function recoverLegacyFinanceCooldowns({ connectionId = null } = {}) {
  // 5.10.4: legacy compatibility hook; current finance period pagination is
  // paced separately by financePageCooldownMs and is not reset here.
  return []
}

async function recoverLegacyRuntimeRateWindows({ connectionId = null } = {}) {
  if (!pool) return []
  const params=[]
  let connectionFilter=''
  if(connectionId){
    params.push(connectionId)
    connectionFilter=' AND connection_id=$1'
  }
  const result=await pool.query(
    \`UPDATE wb_sync_states
     SET status='queued',
         next_allowed_at=NOW(),
         last_error='ELISEI 5.15.2 снял устаревшее внутреннее окно ожидания. Поток будет проверен по актуальному лимиту WB.',
         metadata=COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
           'runtimeWindowMigration',true,
           'runtimeWindowMigratedAt',NOW()
         ),
         updated_at=NOW()
     WHERE status='queued'
       AND COALESCE(metadata->'scheduler'->>'reason','')='preflight_window'
       AND COALESCE(metadata->'scheduler'->>'requestSent','false')='false'
       AND next_allowed_at IS NOT NULL
       AND next_allowed_at>NOW()
       \${connectionFilter}
     RETURNING connection_id,stage\`,params)
  if(result.rows.length) console.log(\`[ELISEI 5.15.2] Released \${result.rows.length} stale runtime rate-window wait(s).\`)
  return result.rows
}`
source=replaceOnce(source,financeMarker,financeWithRecovery,'legacy runtime recovery')

source=replaceOnce(source,
  "  await recoverLegacyFinanceCooldowns()\n  await recoverLegacySearchQueryBindings()",
  "  await recoverLegacyFinanceCooldowns()\n  await recoverLegacyRuntimeRateWindows()\n  await recoverLegacySearchQueryBindings()",
  'startup runtime recovery')

source=replaceOnce(source,
  "  await recoverLegacyFinanceCooldowns({ connectionId:connection.id })\n  await recoverLegacySearchQueryBindings({ connectionId:connection.id })",
  "  await recoverLegacyFinanceCooldowns({ connectionId:connection.id })\n  await recoverLegacyRuntimeRateWindows({ connectionId:connection.id })\n  await recoverLegacySearchQueryBindings({ connectionId:connection.id })",
  'connection runtime recovery')

if(!source.includes("wbRateWindowDelaySeconds(response)")) throw new Error('rate-window helper not wired')
if(!source.includes('recoverLegacyRuntimeRateWindows()')) throw new Error('runtime-window startup recovery not wired')
fs.writeFileSync(path,source)
console.log('ELISEI 5.15.2 runtime-window source patch applied')
