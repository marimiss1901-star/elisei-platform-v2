import assert from 'node:assert/strict'
import fs from 'node:fs'

const server = fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
const api = fs.readFileSync(new URL('../../src/lib/api.js',import.meta.url),'utf8')
const dashboard = fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx',import.meta.url),'utf8')
const styles = fs.readFileSync(new URL('../../src/styles/app.css',import.meta.url),'utf8')

for (const marker of [
  "const OPTIONAL_PRIVILEGED_STAGES = new Set(['financeReports','acquiringReports','jamSubscription'])",
  'const GENERAL_SYNC_STAGE_NAMES = Object.keys(WB_SYNC_STAGES).filter',
  'async function probeToken(token)',
  'function tokenEligibleForStage(row, stage)',
  "if (stage === 'financeReports' || stage === 'acquiringReports') return [3,4].includes(rowTokenType(row))",
  "if (stage === 'jamSubscription') return rowTokenType(row) === 4",
  'async function queueInitialCabinetSync',
  'autoSyncStarted:autoSyncStages.length > 0',
  'ELISEI начал автоматическую загрузку доступных данных кабинета.',
  'const RETRYABLE_HTTP_STATUSES = new Set([408,425,500,502,503,504])',
  "s.status IN ('rate_limited','queued','retry_scheduled')",
  'async function processDueArchiveStages',
  'await prepareSmartSchedulerCycle()',
  'await processDueDeferredStages()',
  'await processDueArchiveStages()',
  'automaticRetryAttempt',
  "const oldServiceStatuses = new Set(['service_token_required','service_secret_required','service_token_invalid','service_permission_required'])",
  'const missingCoreStages = GENERAL_SYNC_STAGE_NAMES.filter',
  'уже подключённому кабинету не нужно перевыпускать ключ',
]) assert.ok(server.includes(marker),`server.js must contain ${marker}`)

assert.ok(!server.includes('const SERVICE_TOKEN_STAGES ='), 'core routing must not require a separate service-token lane')
assert.ok(!server.includes('Promise.all([processDueDeferredStages(),processDueArchiveStages()])'), 'background lanes must not fan out in parallel for one seller account')
assert.ok(!server.includes("purpose === 'service' && info.typeId !== 4"), 'connect endpoint must not split the user into general/service token forms')
assert.ok(server.includes('connected: Boolean(row && tokens.length)'), 'any valid connected cabinet key may establish the cabinet connection')
assert.ok(server.includes('taskId:error?.resetTask ? null : state?.task_id'), 'automatic retry must preserve taskId')
assert.ok(server.includes('...(state?.metadata || {})'), 'automatic retry must preserve cursor metadata')

assert.ok(api.includes("connect: (token, label = '')"),'frontend API must expose one WB connect action')
assert.ok(!api.includes('connectService:'),'frontend API must not expose a second service-token form')

for (const marker of [
  'Одно подключение Wildberries',
  'API-ключ Wildberries',
  'Первая загрузка запускается сама',
  'Финансы — часть общего подключения',
  'Нет ложных требований второго токена',
  'Оцифровка кабинета',
  'Весь бизнес на одном экране',
]) assert.ok(dashboard.includes(marker),`DashboardPage must contain ${marker}`)

assert.ok(!dashboard.includes('saveServiceConnection'),'Dashboard must not retain the old service-token submit flow')
assert.ok(!dashboard.includes('serviceTokenDraft'),'Dashboard must not retain a second token input state')
assert.ok(styles.includes('ELISEI 5.10.2 — единая оцифровка кабинета и честные статусы частичных данных'))

// Pure routing check: the normal finance stage works for any key with Finance category.
// Token-type-limited list endpoints remain optional enrichment and never block core finance.
const STAGES = { finance:{scope:'finance'},financeReports:{scope:'finance'},acquiringReports:{scope:'finance'},jamSubscription:{scope:'finance'},documents:{scope:'documents'} }
const eligible = (row,stage) => {
  const definition=STAGES[stage]
  if (!definition || !(row.scopes || []).includes(definition.scope)) return false
  if (stage === 'financeReports' || stage === 'acquiringReports') return [3,4].includes(Number(row.token_type || 0))
  if (stage === 'jamSubscription') return Number(row.token_type || 0) === 4
  return true
}
const base={token_type:1,scopes:['finance','documents']}
const service={token_type:4,scopes:['finance','documents']}
assert.equal(eligible(base,'finance'),true)
assert.equal(eligible(base,'documents'),true)
assert.equal(eligible(base,'financeReports'),false)
assert.equal(eligible(service,'finance'),true)
assert.equal(eligible(service,'documents'),true)
assert.equal(eligible(service,'financeReports'),true)
assert.equal(eligible(service,'acquiringReports'),true)
assert.equal(eligible(service,'jamSubscription'),true)

console.log('WB 5.10.1 single-token routing, autosync and retry tests passed')
