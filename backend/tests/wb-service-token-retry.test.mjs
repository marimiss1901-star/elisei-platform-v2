import assert from 'node:assert/strict'
import fs from 'node:fs'

const server = fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
const api = fs.readFileSync(new URL('../../src/lib/api.js',import.meta.url),'utf8')
const dashboard = fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx',import.meta.url),'utf8')
const styles = fs.readFileSync(new URL('../../src/styles/app.css',import.meta.url),'utf8')

for (const marker of [
  "const SERVICE_TOKEN_STAGES = new Set(['financeReports','acquiringReports'])",
  'function selectTokenRowForStage',
  "if (SERVICE_TOKEN_STAGES.has(stage)) return isServiceTokenRow(row)",
  "return !isServiceTokenRow(row)",
  "purpose === 'service' && info.typeId !== 4",
  "purpose !== 'service' && info.typeId === 4",
  "purpose === 'service' && !info.scopes.includes('finance')",
  "Сервисный токен закреплён только за финансовыми сводками",
  "status = serviceOnly ? 'service_token_required' : 'missing_token'",
  "status:'service_secret_required'",
  "? 'retry_scheduled'",
  "const RETRYABLE_HTTP_STATUSES = new Set([408,425,500,502,503,504])",
  "s.status IN ('rate_limited','queued','retry_scheduled')",
  "async function processDueArchiveStages",
  "Promise.all([processDueDeferredStages(),processDueArchiveStages()])",
  "Архив FBS вынесен в отдельную фоновую полосу",
  "automaticRetryAttempt",
]) assert.ok(server.includes(marker),`server.js must contain ${marker}`)

assert.ok(server.includes("connected: Boolean(row && tokens.some(token => !isServiceTokenRow(token)))"),'service token alone must not mark a cabinet connected')
assert.ok(server.includes("if (purpose === 'general') await recomputePrimaryToken(connection.id)"),'service token must not be promoted to primary')
assert.ok(server.includes("taskId:error?.resetTask ? null : state?.task_id"),'automatic retry must preserve taskId')
assert.ok(server.includes("...(state?.metadata || {})"),'automatic retry must preserve cursor metadata')

for (const marker of [
  "connectService: (token, label = '')",
  "purpose:'service'",
]) assert.ok(api.includes(marker),`frontend api must contain ${marker}`)

for (const marker of [
  'saveServiceConnection',
  'serviceTokenDraft',
  'Сервисный токен для финансовых сводок',
  "item.isServiceToken?'service-token-card':''",
  "state.status === 'retry_scheduled'",
  "state.status === 'service_token_required'",
  "Открыть подключения",
]) assert.ok(dashboard.includes(marker),`DashboardPage must contain ${marker}`)

assert.ok(styles.includes('ELISEI 5.6.4 — раздельный сервисный токен и устойчивые автоповторы'))

// Pure routing check: finance reports are service-only, ordinary finance stays on a non-service token.
const WB_SYNC_STAGES = { finance:{scope:'finance'},financeReports:{scope:'finance'},acquiringReports:{scope:'finance'},documents:{scope:'documents'} }
const SERVICE_TOKEN_STAGES = new Set(['financeReports','acquiringReports'])
const rowScopes = row => row.scopes || []
const rowTokenType = row => Number(row.token_type || 0)
const isServiceTokenRow = row => rowTokenType(row) === 4
const tokenEligibleForStage = (row,stage) => {
  const definition=WB_SYNC_STAGES[stage]
  if (!definition || !rowScopes(row).includes(definition.scope)) return false
  if (SERVICE_TOKEN_STAGES.has(stage)) return isServiceTokenRow(row)
  return !isServiceTokenRow(row)
}
const basic={token_type:1,scopes:['finance','documents']}
const service={token_type:4,scopes:['finance']}
assert.equal(tokenEligibleForStage(basic,'finance'),true)
assert.equal(tokenEligibleForStage(basic,'financeReports'),false)
assert.equal(tokenEligibleForStage(service,'financeReports'),true)
assert.equal(tokenEligibleForStage(service,'acquiringReports'),true)
assert.equal(tokenEligibleForStage(service,'finance'),false)
assert.equal(tokenEligibleForStage(service,'documents'),false)

console.log('WB service token routing and automatic retry tests passed')
