import 'dotenv/config'
import crypto from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import pg from 'pg'
import { normalizeCatalogPage as normalizeCatalogPageStrict, validateCatalog as validateCatalogStrict } from './wb/adapters/catalog.js'
import {
  normalizeWarehouseRemains as normalizeWarehouseRemainsStrict,
  buildWarehouseMeta as buildWarehouseMetaStrict,
  validateWarehouseRemains as validateWarehouseRemainsStrict,
  reconcileWarehouseRemains as reconcileWarehouseRemainsStrict,
} from './wb/adapters/warehouse-remains.js'
import {
  normalizeCampaignList as normalizeCampaignListStrict,
  normalizeFullStats as normalizeFullStatsStrict,
  mergeAdvertisingSnapshot,
} from './wb/adapters/promotion.js'
import { buildProductMaster } from './wb/product-master.js'
import { ensureSnapshotSchema, saveSnapshot, latestSnapshot } from './wb/snapshot-store.js'
import {
  ensureStreamSchema, saveStreamData, hydrateStreamData, streamCount as persistedStreamCount, WB_STREAMS,
  saveStreamItemBatch, loadStreamItemPage, countStreamItems, finalizeStreamItems,
} from './wb/stream-store.js'
import elRouter from './routes/el.js'
import {
  ensureFinanceLedgerSchema, persistFinanceLedgerBatch, backfillFinanceLedgerFromStreamItems, queryFinanceLedger,
} from './wb/finance-ledger.js'
import {
  WB_API_POLICY, assertWbApiRequestAllowed, sellerWarehouseReadSummary,
} from './wb/api-policy.js'
import {
  buildFbsArchiveUrl, fbsArchiveMonthKey, fbsArchiveOrderKey, normalizeFbsArchivePlan, parseFbsArchivePage,
} from './wb/fbs-archive.js'
import { splitOrdersByFulfillment } from './services/elFulfillment.js'
import {
  financePageCooldownMs, documentsPageCooldownMs, financeContinuation, financeProgressCopy,
  normalizeDocumentCategories, normalizeDocumentRow, summarizeDocuments, deriveAcquiringFromLedgerRows, jamEvidenceFromFinanceRows,
  isPrivilegedFinanceToken,
} from './wb/finance-core.js'
import {
  LIVE_SYNC_STAGES, defaultLiveSyncSettings, normalizeLiveSyncSettings, dueLiveStages, eventStages, safeEqualSecret, publicLiveSyncStatus,
} from './wb/live-sync.js'
import { buildDataQualityReport } from './wb/data-quality.js'
import { buildProduct360, buildProduct360Comparison, findProduct360Product, product360Matches, product360Identities, bindWbSearchRowsToNmId, trustedWbSearchRowForProduct, SEARCH_BINDING_VERSION } from './wb/product-360.js'
import {
  stagePriority, schedulerGroup, chooseCycleWinners, initialStageSchedule, schedulerVisualState,
} from './wb/smart-scheduler.js'
import {
  AUTOMATIC_REFRESH_INTERVALS_SECONDS, DEFAULT_DAILY_READY_TIMEZONE,
  yesterdayDateKey, shiftIsoDate, dailyReadySlot, dailyHeavyStagePlan, dailyOperationalRecoveryPlan,
  buildDailyMetricStates, dailyReadinessSummary, compactDailyCore, dailySnapshotSourceRevision, snapshotNeedsRefresh,
  mergeDailyReadySnapshots,
} from './wb/daily-ready.js'
import { buildElEngagementData } from './services/elEngagement.js'
import elDecisionEngine from './services/elDecisionEngine.cjs'

const { buildDecisionAnalysis, previousEqualPeriod } = elDecisionEngine

const { Pool } = pg
const app = express()
const port = Number(process.env.PORT || 10000)
const allowedOrigins = (process.env.FRONTEND_ORIGIN || '').split(',').map(v => v.trim()).filter(Boolean)
const ttlMs = Number(process.env.CONNECTION_TTL_HOURS || 12) * 60 * 60 * 1000
const jwtSecret = process.env.JWT_SECRET || ''
const databaseUrl = process.env.DATABASE_URL || ''
const pool = databaseUrl ? new Pool({
  connectionString: databaseUrl,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
  max: Math.max(2, Math.min(10, Number(process.env.PG_POOL_MAX || 5))),
  connectionTimeoutMillis: Math.max(3000, Number(process.env.PG_CONNECT_TIMEOUT_MS || 8000)),
  idleTimeoutMillis: Math.max(10000, Number(process.env.PG_IDLE_TIMEOUT_MS || 30000)),
}) : null
const encryptionSecret = process.env.ENCRYPTION_KEY || jwtSecret
const encryptionKey = encryptionSecret ? crypto.createHash('sha256').update(encryptionSecret).digest() : null
const staleRunningMinutes = Math.max(2, Math.min(30, Number(process.env.WB_STALE_RUNNING_MINUTES || 3)))
const publicBackendUrl = String(process.env.PUBLIC_BACKEND_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/$/,'')
const wbOauthConnectUrl = String(process.env.WB_OAUTH_CONNECT_URL || '').trim()
const wbServiceCatalogUrl = String(process.env.WB_SERVICE_CATALOG_URL || 'https://seller.wildberries.ru/auth-services/application').trim()
const wbCatalogServiceEnabled = /^(?:1|true|yes)$/i.test(String(process.env.WB_CATALOG_SERVICE_ENABLED || '').trim())
const liveSyncBatchLimit = Math.max(1,Math.min(6,Number(process.env.WB_LIVE_SYNC_BATCH_LIMIT || 3)))
const dailyReadyTimezone = String(process.env.ELISEI_BUSINESS_TIMEZONE || DEFAULT_DAILY_READY_TIMEZONE).trim() || DEFAULT_DAILY_READY_TIMEZONE

const databaseState = {
  ready: !pool,
  status: pool ? 'connecting' : 'not-configured',
  attempts: 0,
  lastError: null,
  lastConnectedAt: null,
  nextRetryAt: null,
}
let databaseInitPromise = null
let databaseRetryTimer = null

function databaseRetryDelayMs(attempt) {
  return Math.min(60000, 3000 * (2 ** Math.min(5, Math.max(0, attempt - 1))))
}

function scheduleDatabaseInitialization(delayMs = 0, reason = 'retry') {
  if (!pool) return
  if (databaseRetryTimer) clearTimeout(databaseRetryTimer)
  databaseState.nextRetryAt = new Date(Date.now() + Math.max(0, delayMs)).toISOString()
  databaseRetryTimer = setTimeout(() => {
    databaseRetryTimer = null
    initializeDatabaseWithRetry(reason).catch(error => {
      console.warn('Database reconnect loop error:', error.message)
    })
  }, Math.max(0, delayMs))
  databaseRetryTimer.unref?.()
}

async function initializeDatabaseWithRetry(reason = 'startup') {
  if (!pool) {
    databaseState.ready = true
    databaseState.status = 'not-configured'
    return true
  }
  if (databaseInitPromise) return databaseInitPromise
  databaseInitPromise = (async () => {
    databaseState.ready = false
    databaseState.status = 'connecting'
    databaseState.attempts += 1
    databaseState.nextRetryAt = null
    try {
      await initDatabase()
      databaseState.ready = true
      databaseState.status = 'ok'
      databaseState.lastError = null
      databaseState.lastConnectedAt = new Date().toISOString()
      databaseState.attempts = 0
      console.log(`Database initialized (${reason})`)
      setTimeout(() => kickBackgroundWorkers('database-ready'), 1500).unref?.()
      return true
    } catch (error) {
      databaseState.ready = false
      databaseState.status = 'reconnecting'
      databaseState.lastError = error.message
      const delayMs = databaseRetryDelayMs(databaseState.attempts)
      console.error(`Database initialization failed (${reason}); retry in ${Math.round(delayMs / 1000)}s:`, error.message)
      scheduleDatabaseInitialization(delayMs, 'automatic-retry')
      return false
    }
  })()
  try {
    return await databaseInitPromise
  } finally {
    databaseInitPromise = null
  }
}

if (pool) {
  pool.on('error', error => {
    databaseState.ready = false
    databaseState.status = 'reconnecting'
    databaseState.lastError = error.message
    console.warn('PostgreSQL pool error; API stays online and will reconnect:', error.message)
    scheduleDatabaseInitialization(2000, 'pool-error')
  })
}

async function recoverStaleSyncStates({ connectionId = null, reason = 'watchdog' } = {}) {
  if (!pool) return []
  const params = [staleRunningMinutes, reason]
  let connectionFilter = ''
  if (connectionId) {
    params.push(connectionId)
    connectionFilter = ' AND connection_id=$3'
  }
  const result = await pool.query(`
    UPDATE wb_sync_states
    SET status='queued',
        next_allowed_at=NOW(),
        last_error=CASE
          WHEN COALESCE(last_error,'') LIKE '%автоматически восстановлен%' THEN last_error
          ELSE CONCAT('Этап автоматически восстановлен после прерывания процесса (', $1::text, ' мин.).')
        END,
        metadata=COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
          'recoveredFromStaleRunning', true,
          'recoveredAt', NOW(),
          'recoveryReason', $2::text
        ),
        updated_at=NOW()
    WHERE status='running'
      AND updated_at < NOW() - ($1::double precision * INTERVAL '1 minute')
      ${connectionFilter}
    RETURNING connection_id, stage
  `, params)
  if (result.rows.length) {
    console.warn(`WB sync watchdog recovered ${result.rows.length} stale stage(s):`, result.rows.map(row => `${row.connection_id}:${row.stage}`).join(', '))
  }
  return result.rows
}

async function recoverRetryableErrorStates() {
  if (!pool) return []
  const result = await pool.query(`
    UPDATE wb_sync_states
    SET status='retry_scheduled',next_allowed_at=NOW(),
        last_error=CASE WHEN COALESCE(last_error,'')='' THEN 'Временная ошибка WB. Автоповтор восстановлен после обновления ELISEI.' ELSE last_error END,
        metadata=COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('automaticRetryRecovered',true,'automaticRetryRecoveredAt',NOW()),
        updated_at=NOW()
    WHERE status='error'
      AND (
        COALESCE(last_error,'') ILIKE '%504%'
        OR COALESCE(last_error,'') ILIKE '%таймаут%'
        OR COALESCE(last_error,'') ILIKE '%временно недоступ%'
        OR COALESCE(last_error,'') ILIKE '%gateway%'
      )
    RETURNING connection_id,stage
  `)
  return result.rows
}


async function recoverLegacyFinanceCooldowns({ connectionId = null } = {}) {
  // 5.10.4: длинная пауза finance больше не считается ошибкой сама по себе.
  // Для Базового токена без X-Client-Secret официальный интервал WB между
  // запросами детализации — 12 часов. Настоящие queued/rate_limited состояния
  // сохраняем и никогда не сбрасываем искусственно.
  return []
}


async function recoverLegacySearchQueryBindings({ connectionId = null } = {}) {
  if (!pool) return []
  const params = [String(SEARCH_BINDING_VERSION)]
  let connectionFilter = ''
  if (connectionId) {
    params.push(connectionId)
    connectionFilter = ` AND connection_id=$${params.length}`
  }
  const result = await pool.query(`
    UPDATE wb_sync_states
    SET status=CASE
          WHEN status='rate_limited' AND next_allowed_at IS NOT NULL AND next_allowed_at > NOW() THEN 'rate_limited'
          ELSE 'queued'
        END,
        next_allowed_at=CASE
          WHEN status='rate_limited' AND next_allowed_at IS NOT NULL AND next_allowed_at > NOW() THEN next_allowed_at
          ELSE NOW()
        END,
        task_id=NULL,
        last_error='ELISEI перепроверяет поисковые фразы по строгой привязке nmID. Старые непроверенные строки скрыты.',
        metadata=(COALESCE(metadata,'{}'::jsonb)
          - 'syncId' - 'offset' - 'pageNumber' - 'productOffset' - 'persistedCount' - 'summary' - 'binding')
          || jsonb_build_object(
            'phase','overview',
            'searchBindingVersion',$1::int,
            'searchBindingMigration',true,
            'searchBindingMigratedAt',NOW()
          ),
        updated_at=NOW()
    WHERE stage='searchQueries'
      AND COALESCE(metadata->>'searchBindingVersion','') <> $1::text
      ${connectionFilter}
    RETURNING connection_id,stage,status,next_allowed_at
  `,params)
  if (result.rows.length) {
    console.warn(`Search binding migration queued ${result.rows.length} stage(s) for verified nmID refresh.`)
  }
  return result.rows
}



let smartSchedulerWinners = new Map()
let smartSchedulerPreparedAt = null

async function prepareSmartSchedulerCycle() {
  if (!pool) {
    smartSchedulerWinners = new Map()
    return smartSchedulerWinners
  }
  const result = await pool.query(`
    SELECT s.connection_id,s.stage,s.status,s.task_id,s.next_allowed_at,s.updated_at,s.metadata
    FROM wb_sync_states s
    JOIN marketplace_connections c ON c.id=s.connection_id
    WHERE s.status IN ('pending','queued','rate_limited','retry_scheduled')
      AND (s.next_allowed_at IS NULL OR s.next_allowed_at <= NOW())
      AND c.status='connected'
    ORDER BY s.updated_at
    LIMIT 250
  `)
  const dueRows = result.rows
  smartSchedulerWinners = chooseCycleWinners(dueRows)

  // 5.13.3: закрытие вчерашнего дня получает отдельную последовательную lane.
  // Раньше orders/sales/advertising могли одновременно стать due и визуально
  // застревать среди остальных фоновых потоков. Для каждого кабинета выбираем
  // ровно один due recovery-stage; созданный WB taskId всегда имеет приоритет.
  const recoveryOrder = new Map([['orders',0],['sales',1],['advertising',2]])
  const byConnection = new Map()
  for (const row of dueRows) {
    const key = String(row.connection_id || '')
    if (!byConnection.has(key)) byConnection.set(key,[])
    byConnection.get(key).push(row)
  }
  for (const [connectionId, rows] of byConnection) {
    if (rows.some(row => row.task_id)) continue
    const recoveryRows = rows
      .filter(row => row?.metadata?.trigger === 'daily_ready_recovery' && recoveryOrder.has(String(row.stage)))
      .sort((a,b) => recoveryOrder.get(String(a.stage)) - recoveryOrder.get(String(b.stage)))
    if (!recoveryRows.length) continue
    const winner = recoveryRows[0]
    smartSchedulerWinners.set(connectionId,String(winner.stage))
    const deferredStages = recoveryRows.slice(1).map(row=>String(row.stage))
    if (deferredStages.length) {
      await pool.query(`
        UPDATE wb_sync_states
        SET next_allowed_at=GREATEST(COALESCE(next_allowed_at,NOW()), NOW() + INTERVAL '70 seconds'),
            updated_at=NOW()
        WHERE connection_id=$1
          AND stage=ANY($2::text[])
          AND status IN ('queued','rate_limited','retry_scheduled')
          AND (next_allowed_at IS NULL OR next_allowed_at <= NOW())
      `,[connectionId,deferredStages])
    }
  }

  smartSchedulerPreparedAt = new Date().toISOString()
  return smartSchedulerWinners
}

function smartSchedulerAllows(connectionId, stage) {
  if (!smartSchedulerPreparedAt) return true
  const winner = smartSchedulerWinners.get(String(connectionId))
  return winner === String(stage)
}

function smartSchedulerMeta(stage, extra = {}) {
  return {
    scheduler:{
      mode:'smart_wb_scheduler_v1',
      priority:stagePriority(stage),
      group:schedulerGroup(stage),
      preparedAt:smartSchedulerPreparedAt,
      ...extra,
    },
  }
}

const backgroundWorkerState = {
  running: false,
  promise: null,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastReason: null,
  lastError: null,
}

function kickBackgroundWorkers(reason = 'timer') {
  if (backgroundWorkerState.running && backgroundWorkerState.promise) return backgroundWorkerState.promise
  backgroundWorkerState.running = true
  backgroundWorkerState.lastStartedAt = new Date().toISOString()
  backgroundWorkerState.lastReason = reason
  backgroundWorkerState.lastError = null
  const promise = (async () => {
    await recoverStaleSyncStates({ reason:`worker:${reason}` })
    await recoverLegacyFinanceCooldowns()
    // 5.10.5 Smart WB Scheduler: сначала добавляем живые задачи в очередь,
    // затем выбираем ровно один приоритетный due-этап на каждый кабинет.
    // Это исключает cold-start burst: разные lanes больше не стреляют по WB
    // одновременно от имени одного продавца.
    await scheduleDueLiveSyncStages()
    await scheduleDailyReadyStages()
    await prepareSmartSchedulerCycle()
    await processDueDeferredStages()
    await processPendingStockReports()
    await processPendingGeneratedReports()
    await processDueArchiveStages()
    await refreshDailyReadySnapshots()
  })().catch(error => {
    backgroundWorkerState.lastError = error.message
    console.warn('WB background worker kick failed:', error.message)
  }).finally(() => {
    backgroundWorkerState.running = false
    backgroundWorkerState.promise = null
    backgroundWorkerState.lastFinishedAt = new Date().toISOString()
  })
  backgroundWorkerState.promise = promise
  return promise
}

app.use(helmet())
app.use(cors({ origin(origin, cb) { if (!origin || !allowedOrigins.length || allowedOrigins.includes(origin)) return cb(null, true); cb(new Error('Origin is not allowed')) }, exposedHeaders:['Content-Disposition'] }))
app.use(express.json({ limit: '2mb' }))
app.use('/api', (req, res, next) => {
  if (!pool) return res.status(503).json({ error:'DATABASE_URL не настроен', code:'DATABASE_NOT_CONFIGURED' })
  if (!databaseState.ready) {
    const retryAfterSeconds = databaseState.nextRetryAt
      ? Math.max(1, Math.ceil((new Date(databaseState.nextRetryAt).getTime() - Date.now()) / 1000))
      : 3
    res.setHeader('Retry-After', String(retryAfterSeconds))
    return res.status(503).json({
      error:'База данных временно переподключается. Backend работает и повторит подключение автоматически.',
      code:'DATABASE_RECONNECTING',
      retryAfterSeconds,
    })
  }
  next()
})

async function ensureDailyReadySchema() {
  if (!pool) return
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wb_daily_snapshots (
      connection_id UUID NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,
      snapshot_date DATE NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
      source_revision TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'waiting',
      snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(connection_id,snapshot_date)
    );
    CREATE INDEX IF NOT EXISTS wb_daily_snapshots_updated_idx ON wb_daily_snapshots(updated_at DESC);
  `)
}

async function migrateAutomaticRefreshSettings() {
  if (!pool) return
  const defaults = defaultLiveSyncSettings()
  await pool.query(`
    INSERT INTO wb_live_sync_settings(connection_id,settings,updated_at)
    SELECT id,$1::jsonb,NOW() FROM marketplace_connections WHERE status='connected'
    ON CONFLICT(connection_id) DO NOTHING
  `,[JSON.stringify(defaults)])
  await pool.query(`
    UPDATE wb_live_sync_settings
    SET settings=COALESCE(settings,'{}'::jsonb) || jsonb_build_object(
          'enabled',TRUE,
          'automaticPolicyVersion',1,
          'intervals',$1::jsonb
        ),
        updated_at=NOW()
  `,[JSON.stringify(AUTOMATIC_REFRESH_INTERVALS_SECONDS)])
}

async function initDatabase() {
  if (!pool) return
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      company TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS marketplace_connections (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      marketplace TEXT NOT NULL,
      token_encrypted TEXT NOT NULL,
      scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'connected',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_sync_at TIMESTAMPTZ,
      data JSONB,
      sync_history JSONB NOT NULL DEFAULT '[]'::jsonb,
      UNIQUE(user_id, marketplace)
    );
    CREATE INDEX IF NOT EXISTS marketplace_connections_user_idx ON marketplace_connections(user_id);
    CREATE TABLE IF NOT EXISTS business_settings (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE marketplace_connections ADD COLUMN IF NOT EXISTS seller_id TEXT;
    CREATE TABLE IF NOT EXISTS wb_tokens (
      id UUID PRIMARY KEY,
      connection_id UUID NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label TEXT NOT NULL DEFAULT 'API-токен',
      token_encrypted TEXT NOT NULL,
      token_fingerprint TEXT NOT NULL,
      seller_id TEXT,
      token_type INTEGER NOT NULL DEFAULT 0,
      token_type_label TEXT NOT NULL DEFAULT 'Неизвестный',
      scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
      read_only BOOLEAN NOT NULL DEFAULT TRUE,
      expires_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'active',
      last_checked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, token_fingerprint)
    );
    ALTER TABLE wb_tokens ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE INDEX IF NOT EXISTS wb_tokens_connection_idx ON wb_tokens(connection_id);
    CREATE UNIQUE INDEX IF NOT EXISTS wb_tokens_one_primary_idx ON wb_tokens(connection_id) WHERE is_primary = TRUE AND status = 'active';
    CREATE TABLE IF NOT EXISTS wb_sync_states (
      connection_id UUID NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,
      stage TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      last_attempt_at TIMESTAMPTZ,
      last_success_at TIMESTAMPTZ,
      next_allowed_at TIMESTAMPTZ,
      last_error TEXT,
      last_count INTEGER NOT NULL DEFAULT 0,
      task_id TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(connection_id, stage)
    );
    CREATE TABLE IF NOT EXISTS wb_live_sync_settings (
      connection_id UUID PRIMARY KEY REFERENCES marketplace_connections(id) ON DELETE CASCADE,
      settings JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_event_at TIMESTAMPTZ,
      last_poll_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS wb_webhooks (
      id UUID PRIMARY KEY,
      connection_id UUID NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,
      wb_webhook_id TEXT,
      name TEXT NOT NULL,
      receiver_key_hash TEXT NOT NULL UNIQUE,
      secret_encrypted TEXT,
      subscriptions JSONB NOT NULL DEFAULT '[]'::jsonb,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      status TEXT NOT NULL DEFAULT 'local_ready',
      last_event_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS wb_webhooks_connection_idx ON wb_webhooks(connection_id);
    CREATE TABLE IF NOT EXISTS wb_webhook_events (
      id UUID PRIMARY KEY,
      connection_id UUID NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,
      webhook_id UUID REFERENCES wb_webhooks(id) ON DELETE SET NULL,
      wb_event_id TEXT,
      idempotency_key TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_scope TEXT,
      event_time TIMESTAMPTZ,
      is_test BOOLEAN NOT NULL DEFAULT FALSE,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      processed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(connection_id,idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS wb_webhook_events_pending_idx ON wb_webhook_events(processed_at,created_at);
    CREATE TABLE IF NOT EXISTS el_conversations (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      cabinet_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      messages JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(user_id, cabinet_id, conversation_id)
    );
    CREATE INDEX IF NOT EXISTS el_conversations_updated_idx ON el_conversations(user_id, cabinet_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS el_memories (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      cabinet_id TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'preference',
      text TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS el_memories_user_idx ON el_memories(user_id, cabinet_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS el_profiles (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      cabinet_id TEXT NOT NULL,
      profile JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(user_id, cabinet_id)
    );
    CREATE INDEX IF NOT EXISTS el_profiles_updated_idx ON el_profiles(user_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS el_entitlements (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      tier TEXT NOT NULL DEFAULT 'analyst' CHECK (tier IN ('analyst','gpt','pro')),
      status TEXT NOT NULL DEFAULT 'active',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS el_entitlements_status_idx ON el_entitlements(status, tier);
  `)
  await ensureSnapshotSchema(pool)
  await ensureStreamSchema(pool)
  await ensureFinanceLedgerSchema(pool)
  await ensureDailyReadySchema()
  await migrateLegacyWbTokens()
  await ensurePrimaryTokens()
  await migrateAutomaticRefreshSettings()
  await recoverStaleSyncStates({ reason:'startup' })
  await recoverRetryableErrorStates()
  // 5.10.3: миграция старого длинного finance next_allowed_at выполняется
  // сразу при старте backend, ещё до первого открытия пользователем страницы.
  await recoverLegacyFinanceCooldowns()
  await recoverLegacySearchQueryBindings()
}

function requireBackendConfig() {
  if (!pool) throw Object.assign(new Error('DATABASE_URL не настроен'), { status: 503 })
  if (!jwtSecret) throw Object.assign(new Error('JWT_SECRET не настроен'), { status: 503 })
  if (!encryptionKey) throw Object.assign(new Error('ENCRYPTION_KEY не настроен'), { status: 503 })
}

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, jwtSecret, { expiresIn: '7d' })
}

function publicUser(user) {
  return { id: user.id, name: user.name, company: user.company, email: user.email, createdAt: user.created_at }
}

function authRequired(req, res, next) {
  try {
    requireBackendConfig()
    const value = String(req.headers.authorization || '')
    const token = value.startsWith('Bearer ') ? value.slice(7) : ''
    if (!token) return res.status(401).json({ error: 'Требуется авторизация' })
    req.auth = jwt.verify(token, jwtSecret)
    next()
  } catch (error) {
    res.status(error.status || 401).json({ error: error.status ? error.message : 'Сессия истекла. Войдите снова.' })
  }
}

const isoDaysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString()
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const wbClientSecret = String(process.env.WB_CLIENT_SECRET || '').trim()
const activeSyncs = new Set()

const WB_SCOPE_BITS = {
  content: { bit: 1, label: 'Контент' },
  analytics: { bit: 2, label: 'Аналитика' },
  prices: { bit: 3, label: 'Цены и скидки' },
  marketplace: { bit: 4, label: 'Маркетплейс' },
  statistics: { bit: 5, label: 'Статистика' },
  promotion: { bit: 6, label: 'Продвижение' },
  feedbacks: { bit: 7, label: 'Вопросы и отзывы' },
  chat: { bit: 9, label: 'Чат с покупателями' },
  supplies: { bit: 10, label: 'Поставки' },
  returns: { bit: 11, label: 'Возвраты' },
  documents: { bit: 12, label: 'Документы' },
  finance: { bit: 13, label: 'Финансы' },
  users: { bit: 16, label: 'Пользователи' },
}
const WB_TOKEN_TYPES = { 1: 'Базовый', 2: 'Тестовый', 3: 'Персональный', 4: 'Сервисный' }
const WB_SYNC_STAGES = Object.freeze({
  products: { label: 'Товары', scope: 'content' },
  orders: { label: 'Заказы', scope: 'statistics' },
  sales: { label: 'Продажи', scope: 'statistics' },
  stocks: { label: 'Остатки FBO', scope: 'analytics' },
  sellerStocks: { label: 'Остатки FBS', scope: 'marketplace' },
  advertising: { label: 'Реклама', scope: 'promotion' },
  finance: { label: 'Финансы WB', scope: 'finance' },
  paidStorage: { label: 'Платное хранение', scope: 'analytics' },
  acceptance: { label: 'Платная приёмка', scope: 'analytics' },
  acquiring: { label: 'Эквайринг', scope: 'finance' },
  financeReports: { label: 'Сводки отчётов реализации', scope: 'finance' },
  acquiringReports: { label: 'Сводки отчётов эквайринга', scope: 'finance' },
  fbsArchive: { label: 'Архив заказов FBS', scope: 'marketplace' },
  measurementPenalties: { label: 'Штрафы за габариты', scope: 'analytics' },
  deductionsReport: { label: 'Подмены и неверные вложения', scope: 'analytics' },
  warehouseMeasurements: { label: 'Замеры склада', scope: 'analytics' },
  antifraudRetention: { label: 'Удержания за самовыкупы', scope: 'analytics' },
  labelingRetention: { label: 'Штрафы за маркировку', scope: 'analytics' },
  goodsReturns: { label: 'Возвраты и перемещения', scope: 'analytics' },
  tariffs: { label: 'Тарифы и комиссии', scope: 'content' },
  funnel: { label: 'Воронка карточек', scope: 'analytics' },
  documents: { label: 'Документы WB', scope: 'documents' },
  jamSubscription: { label: 'Подписка «Джем»', scope: 'finance' },
  searchQueries: { label: 'Поисковые запросы', scope: 'analytics' },
  stockHistory: { label: 'История остатков', scope: 'analytics' },
  reviews: { label: 'Отзывы покупателей', scope: 'feedbacks' },
  questions: { label: 'Вопросы покупателей', scope: 'feedbacks' },
  chats: { label: 'Чаты с покупателями', scope: 'chat' },
})
const OPTIONAL_PRIVILEGED_STAGES = new Set(['financeReports','acquiringReports','jamSubscription'])
// 5.10.1: продавцу достаточно одного подключения WB. Эти три метода — только
// дополнительное обогащение для поддерживаемых типов токенов и не входят в
// обязательное ядро кабинета/готовность финансов.
const GENERAL_SYNC_STAGE_NAMES = Object.keys(WB_SYNC_STAGES).filter(stage => !OPTIONAL_PRIVILEGED_STAGES.has(stage))
const CORE_SYNC_SCOPES = [...new Set(GENERAL_SYNC_STAGE_NAMES.map(stage => WB_SYNC_STAGES[stage].scope))]
const STOCK_DATA_SCHEMA_VERSION = 5
const STOCK_DATA_SOURCE = 'wb_warehouse_remains'
const STOCK_REPORT_PROFILE = 'article_barcode_size_v1'
const ARCHIVE_SYNC_STAGES = Object.freeze(['fbsArchive'])
const HEAVY_SYNC_STAGES = Object.freeze(['finance','paidStorage','acceptance','acquiring','financeReports','acquiringReports','documents','measurementPenalties','deductionsReport','warehouseMeasurements','antifraudRetention','labelingRetention','searchQueries','stockHistory','reviews','questions','chats'])
const RETRYABLE_HTTP_STATUSES = new Set([408,425,500,502,503,504])
const MAX_AUTOMATIC_RETRY_ATTEMPTS = Math.max(3,Math.min(12,Number(process.env.WB_MAX_AUTOMATIC_RETRY_ATTEMPTS || 8)))
const HEAVY_PAGE_LIMIT = Math.max(500, Math.min(5000, Number(process.env.WB_HEAVY_PAGE_LIMIT || 2500)))
const FINANCE_PAGE_LIMIT = Math.max(2500, Math.min(100000, Number(process.env.WB_FINANCE_PAGE_LIMIT || 100000)))
const HEAVY_DB_BATCH_SIZE = Math.max(100, Math.min(500, Number(process.env.WB_HEAVY_DB_BATCH_SIZE || 250)))
const HEAVY_STAGE_COOLDOWN_MS = Math.max(5000, Number(process.env.WB_HEAVY_STAGE_COOLDOWN_MS || 65000))
const FBS_ARCHIVE_MONTHS = Math.max(1, Math.min(60, Number(process.env.WB_FBS_ARCHIVE_MONTHS || 24)))
const EXTENDED_OBJECT_STAGES = new Set(['financeReports','acquiringReports','fbsArchive','measurementPenalties','deductionsReport','warehouseMeasurements','antifraudRetention','labelingRetention','goodsReturns','tariffs','funnel','documents','jamSubscription','searchQueries','stockHistory','reviews','questions','chats'])

function decodeJwtPayload(value, invalidMessage) {
  try {
    const parts = String(value || '').split('.')
    if (parts.length < 2) throw new Error('not jwt')
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    throw Object.assign(new Error(invalidMessage), { status: 401 })
  }
}

function decodeWbToken(token) {
  return decodeJwtPayload(token, 'API-ключ Wildberries имеет неверный формат')
}

function inspectServiceSecret() {
  if (!wbClientSecret) return null
  const payload = decodeJwtPayload(wbClientSecret, 'WB_CLIENT_SECRET имеет неверный формат')
  if (Number(payload.exp || 0) > 0 && Number(payload.exp) * 1000 <= Date.now()) {
    throw Object.assign(new Error('Секрет сервиса Wildberries истёк. Обновите WB_CLIENT_SECRET в Render.'), { status: 401 })
  }
  return {
    serviceId: String(payload.asid || ''),
    expiresAt: Number(payload.exp || 0) > 0 ? new Date(Number(payload.exp) * 1000).toISOString() : null,
  }
}

function publicServiceSecretStatus() {
  if (!wbClientSecret) return { configured:false, valid:false, expiresAt:null, error:'WB_CLIENT_SECRET не настроен в backend Render.' }
  try {
    const info = inspectServiceSecret()
    return { configured:true, valid:true, expiresAt:info?.expiresAt || null, error:null }
  } catch (error) {
    return { configured:true, valid:false, expiresAt:null, error:error.message }
  }
}

function inspectWbToken(token) {
  const payload = decodeWbToken(token)
  const scopeMask = Number(payload.s || 0)
  const typeId = Number(payload.acc || 0)
  const scopes = Object.entries(WB_SCOPE_BITS)
    .filter(([, item]) => (scopeMask & (1 << item.bit)) !== 0)
    .map(([key]) => key)

  if (Number(payload.exp || 0) > 0 && Number(payload.exp) * 1000 <= Date.now()) {
    throw Object.assign(new Error('API-ключ Wildberries истёк. Создайте новый ключ.'), { status: 401 })
  }
  if (Boolean(payload.t) || typeId === 2) {
    throw Object.assign(new Error('Тестовый токен не имеет доступа к реальным данным кабинета'), { status: 403 })
  }
  if (!scopes.length) {
    throw Object.assign(new Error('В API-ключе Wildberries не обнаружены категории доступа'), { status: 403 })
  }
  if (typeId === 3) {
    throw Object.assign(new Error('Персональный токен предназначен только для локальных программ продавца. Для облачного ELISEI используйте Базовый токен, а после регистрации сервиса — Сервисный токен или OAuth 2.0.'), { status: 403 })
  }
  const serviceSecret = typeId === 4 ? inspectServiceSecret() : null
  if (typeId === 4 && !serviceSecret) {
    throw Object.assign(new Error('Сервисный токен WB работает только у зарегистрированного сервиса с WB_CLIENT_SECRET. Для текущей версии ELISEI используйте Базовый токен.'), { status: 403 })
  }
  const tokenServiceId = String(payload.asid || '')
  if (typeId === 4 && serviceSecret?.serviceId && tokenServiceId && serviceSecret.serviceId !== tokenServiceId) {
    throw Object.assign(new Error('Сервисный токен и WB_CLIENT_SECRET принадлежат разным сервисам Wildberries.'), { status: 403 })
  }

  return {
    scopes,
    scopeLabels: scopes.map(scope => WB_SCOPE_BITS[scope]?.label || scope),
    typeId,
    tokenType: WB_TOKEN_TYPES[typeId] || 'Неизвестный',
    readOnly: (scopeMask & (1 << 30)) !== 0,
    sellerId: String(payload.sid || ''),
    tokenId: String(payload.id || ''),
    serviceId: tokenServiceId,
    expiresAt: Number(payload.exp || 0) > 0 ? new Date(Number(payload.exp) * 1000).toISOString() : null,
  }
}

function retryAfterSeconds(response, attempt) {
  const header = response.headers.get('x-ratelimit-retry') || response.headers.get('retry-after')
  const seconds = Number(header)
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : Math.min(20, 2 ** attempt)
}

function retryDelayMs(response, attempt) {
  const explicit = Number(response.headers.get('x-ratelimit-retry') || response.headers.get('retry-after'))
  if (Number.isFinite(explicit) && explicit > 0) {
    // X-Ratelimit-Retry уже является точным указанием WB. Не уменьшаем его
    // случайным jitter: ранний повтор сам создавал повторные 429.
    return Math.max(1000,Math.ceil(explicit * 1000) + 350)
  }
  const base = retryAfterSeconds(response, attempt) * 1000
  const jitter = 0.9 + Math.random() * 0.2
  return Math.max(1000, Math.round(base * jitter))
}

function humanWait(seconds) {
  if (seconds >= 3600) return `${Math.ceil(seconds / 3600)} ч.`
  if (seconds >= 60) return `${Math.ceil(seconds / 60)} мин.`
  return `${Math.max(1, Math.ceil(seconds))} сек.`
}

const wbRuntimeRateWindows = new Map()

function wbRateWindowKey(url) {
  try {
    const parsed = new URL(String(url))
    const normalizedPath = parsed.pathname
      .split('/')
      .map(part => /^\d+$/.test(part) ? ':id' : /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(part) ? ':uuid' : part)
      .join('/')
    return `${parsed.origin}${normalizedPath}`
  } catch {
    return String(url || '').split('?')[0]
  }
}

function rememberWbRateWindow(url, response) {
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
}

async function waitForWbRuntimeWindow(url, label = 'WB API', deadlineAt = 0) {
  const key = wbRateWindowKey(url)
  const next = Number(wbRuntimeRateWindows.get(key) || 0)
  if (!next || next <= Date.now()) {
    if (next) wbRuntimeRateWindows.delete(key)
    return
  }
  const waitMs = Math.max(0,next-Date.now())
  // Tiny intervals are cheaper to wait inside the same stage than to persist a
  // continuation and wake the worker again. Longer windows return to the queue.
  if (waitMs <= 3000 && (!deadlineAt || Date.now()+waitMs+750 < deadlineAt)) {
    await sleep(waitMs)
    wbRuntimeRateWindows.delete(key)
    return
  }
  const seconds = Math.max(1,Math.ceil(waitMs/1000))
  throw Object.assign(new Error(`${label}: Smart Scheduler ждёт разрешённое окно WB (${humanWait(seconds)}).`),{
    code:'WB_SCHEDULER_WAIT',
    nextAllowedAt:new Date(next).toISOString(),
    schedulerWait:true,
  })
}

function transientRetryPlan(state, stage, error) {
  const previous = Math.max(0,Number(state?.metadata?.automaticRetryAttempt || 0))
  const attempt = Math.min(MAX_AUTOMATIC_RETRY_ATTEMPTS,previous + 1)
  const baseSeconds = stage === 'fbsArchive' ? 90 : 60
  const seconds = Math.min(6 * 3600,baseSeconds * (2 ** Math.max(0,attempt - 1)))
  const jitter = 0.85 + Math.random() * 0.3
  const delaySeconds = Math.max(30,Math.round(seconds * jitter))
  return {
    attempt,
    nextAllowedAt:new Date(Date.now()+delaySeconds*1000).toISOString(),
    delaySeconds,
    reason:Number(error?.status) === 504 ? 'timeout_504' : `http_${Number(error?.status || 502)}`,
  }
}

function isRetryableWbError(error) {
  return RETRYABLE_HTTP_STATUSES.has(Number(error?.status || 0))
}

function financeRuntimeTokenInfo(tokenInfo = {}) {
  return { ...(tokenInfo || {}), hasServiceSecret:Boolean(publicServiceSecretStatus().valid) }
}

function authHeaders(token) {
  const info = inspectWbToken(token)
  const headers = {
    Authorization: token,
    Accept: 'application/json',
    'User-Agent': 'ELISEI/2.25.3 (marketplace analytics)',
  }
  // WB требует маркировать секретом запросы зарегистрированного облачного сервиса.
  // Персональные токены облачный ELISEI не принимает; для Базового без секрета действуют сниженные лимиты.
  const serviceSecret = publicServiceSecretStatus()
  if (serviceSecret.valid && (info.typeId === 1 || info.typeId === 4)) headers['X-Client-Secret'] = wbClientSecret
  return headers
}

async function wbFetch(url, token, options = {}) {
  assertWbApiRequestAllowed(url, options)
  const {
    maxAttempts = 3,
    timeoutMs = 45000,
    maxRetryDelayMs = 45000,
    deadlineAt = 0,
    label = 'WB API',
    preserveInt64Fields = [],
    ...fetchOptions
  } = options

  let lastError = null
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await waitForWbRuntimeWindow(url,label,deadlineAt)
    const remainingMs = deadlineAt ? deadlineAt - Date.now() : timeoutMs
    if (remainingMs <= 1000) {
      throw Object.assign(new Error(`${label}: достигнут общий лимит времени синхронизации`), { status: 504 })
    }
    let response
    try {
      response = await fetch(url, {
        ...fetchOptions,
        headers: { ...authHeaders(token), ...(fetchOptions.headers || {}) },
        signal: AbortSignal.timeout(Math.max(1000, Math.min(timeoutMs, remainingMs))),
      })
    } catch (error) {
      lastError = Object.assign(new Error(`${label}: сеть или таймаут запроса`), { status: 502, cause: error })
      if (attempt + 1 >= Math.min(maxAttempts, 3)) throw lastError
      await sleep(1000 * (2 ** attempt))
      continue
    }

    const text = await response.text()
    let payload = null
    try {
      let source = text
      for (const field of Array.isArray(preserveInt64Fields) ? preserveInt64Fields : []) {
        const safeField = String(field).replace(/[^a-zA-Z0-9_]/g,'')
        if (!safeField) continue
        source = source.replace(new RegExp(`(\"${safeField}\"\\s*:\\s*)(-?\\d{16,})(?=\\s*[,}])`,'g'),'$1"$2"')
      }
      payload = source ? JSON.parse(source) : null
    } catch { payload = text }
    const requestId = response.headers.get('x-request-id') || payload?.requestId || ''
    rememberWbRateWindow(url,response)

    if (response.ok) return payload

    const detail = payload?.detail || payload?.message || payload?.title || `Wildberries API: ${response.status}`
    const error = Object.assign(new Error(`${label}: ${detail}${requestId ? ` (requestId: ${requestId})` : ''}`), {
      status: response.status,
      payload,
      requestId,
    })
    lastError = error

    if (response.status === 429) {
      const retrySeconds = retryAfterSeconds(response, attempt)
      const delayMs = retryDelayMs(response, attempt)
      error.retryAfterSeconds = retrySeconds
      error.nextAllowedAt = new Date(Date.now() + retrySeconds * 1000).toISOString()
      if (attempt + 1 >= maxAttempts || delayMs > maxRetryDelayMs) {
        error.message = `${label}: Wildberries установил паузу ${humanWait(retrySeconds)}. ELISEI сохранит предыдущие данные и повторит этап после окончания паузы.`
        throw error
      }
      if (deadlineAt && Date.now() + delayMs >= deadlineAt) {
        error.message = `${label}: лимит WB требует ожидания, но достигнут общий лимит времени синхронизации.`
        throw error
      }
      await sleep(delayMs)
      continue
    }
    if (response.status >= 500 && attempt + 1 < Math.min(maxAttempts, 3)) {
      await sleep(1000 * (2 ** attempt))
      continue
    }
    throw error
  }
  throw lastError || Object.assign(new Error(`${label}: запрос не выполнен`), { status: 502 })
}


async function wbFetchBuffer(url, token, options = {}) {
  assertWbApiRequestAllowed(url, options)
  const {
    timeoutMs = 60000,
    deadlineAt = 0,
    label = 'WB API',
    ...fetchOptions
  } = options
  await waitForWbRuntimeWindow(url,label,deadlineAt)
  const remainingMs = deadlineAt ? deadlineAt - Date.now() : timeoutMs
  if (remainingMs <= 1000) throw Object.assign(new Error(`${label}: достигнут общий лимит времени синхронизации`), { status:504 })
  let response
  try {
    response = await fetch(url, {
      ...fetchOptions,
      headers:{ ...authHeaders(token), Accept:'application/zip,text/csv,*/*', ...(fetchOptions.headers || {}) },
      signal:AbortSignal.timeout(Math.max(1000,Math.min(timeoutMs,remainingMs))),
    })
  } catch (cause) {
    throw Object.assign(new Error(`${label}: сеть или таймаут запроса`), { status:502,cause })
  }
  rememberWbRateWindow(url,response)
  if (response.ok) return Buffer.from(await response.arrayBuffer())
  const text = await response.text()
  let payload = null
  try { payload = text ? JSON.parse(text) : null } catch { payload = text }
  const requestId = response.headers.get('x-request-id') || payload?.requestId || ''
  const detail = payload?.detail || payload?.message || payload?.title || `Wildberries API: ${response.status}`
  const error = Object.assign(new Error(`${label}: ${detail}${requestId ? ` (requestId: ${requestId})` : ''}`), {
    status:response.status,payload,requestId,
  })
  if (response.status === 429) {
    const retrySeconds = retryAfterSeconds(response,0)
    error.retryAfterSeconds = retrySeconds
    error.nextAllowedAt = new Date(Date.now()+retrySeconds*1000).toISOString()
    error.message = `${label}: Wildberries установил паузу ${humanWait(retrySeconds)}. ELISEI повторит загрузку автоматически.`
  }
  throw error
}

function readZipEntries(buffer) {
  const MAX_ZIP_ENTRIES = 32
  const MAX_ZIP_UNCOMPRESSED_BYTES = 180 * 1024 * 1024
  const entries = []
  let eocd = -1
  for (let offset = buffer.length - 22; offset >= Math.max(0,buffer.length - 65557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break }
  }
  if (eocd < 0) return entries
  const totalEntries = buffer.readUInt16LE(eocd + 10)
  if (totalEntries > MAX_ZIP_ENTRIES) throw Object.assign(new Error('История остатков WB: слишком много файлов в ZIP-архиве'), { status:502 })
  let centralOffset = buffer.readUInt32LE(eocd + 16)
  let totalUncompressed = 0
  for (let index = 0; index < totalEntries && centralOffset + 46 <= buffer.length; index += 1) {
    if (buffer.readUInt32LE(centralOffset) !== 0x02014b50) break
    const flags = buffer.readUInt16LE(centralOffset + 8)
    const method = buffer.readUInt16LE(centralOffset + 10)
    const compressedSize = buffer.readUInt32LE(centralOffset + 20)
    const uncompressedSize = buffer.readUInt32LE(centralOffset + 24)
    const fileNameLength = buffer.readUInt16LE(centralOffset + 28)
    const extraLength = buffer.readUInt16LE(centralOffset + 30)
    const commentLength = buffer.readUInt16LE(centralOffset + 32)
    const localOffset = buffer.readUInt32LE(centralOffset + 42)
    const name = buffer.subarray(centralOffset + 46, centralOffset + 46 + fileNameLength).toString('utf8')
    centralOffset += 46 + fileNameLength + extraLength + commentLength
    if ((flags & 1) === 1) throw Object.assign(new Error('История остатков WB: зашифрованный ZIP не поддерживается'), { status:502 })
    totalUncompressed += uncompressedSize
    if (totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) throw Object.assign(new Error('История остатков WB: архив превышает безопасный размер распаковки'), { status:413 })
    if (!name || name.endsWith('/') || localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) continue
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    if (dataStart + compressedSize > buffer.length) throw Object.assign(new Error('История остатков WB: повреждён ZIP-архив'), { status:502 })
    const compressed = buffer.subarray(dataStart,dataStart+compressedSize)
    let data
    if (method === 0) data = compressed
    else if (method === 8) data = inflateRawSync(compressed, { maxOutputLength:MAX_ZIP_UNCOMPRESSED_BYTES })
    else continue
    entries.push({ name,data })
  }
  return entries
}

function detectCsvDelimiter(text) {
  const line = String(text || '').split(/\r?\n/,1)[0] || ''
  const candidates = [',',';','\t']
  return candidates.sort((a,b)=>(line.split(b).length-line.split(a).length))[0]
}

function parseCsvRows(text) {
  const source = String(text || '').replace(/^\uFEFF/,'')
  const delimiter = detectCsvDelimiter(source)
  const matrix = []
  let row = [], value = '', quoted = false
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char === '"' && source[index+1] === '"') { value += '"'; index += 1 }
      else if (char === '"') quoted = false
      else value += char
      continue
    }
    if (char === '"') quoted = true
    else if (char === delimiter) { row.push(value); value = '' }
    else if (char === '\n') { row.push(value.replace(/\r$/,'')); matrix.push(row); row=[]; value='' }
    else value += char
  }
  if (value || row.length) { row.push(value.replace(/\r$/,'')); matrix.push(row) }
  const headers = (matrix.shift() || []).map((header,index)=>String(header || `column_${index+1}`).trim())
  return matrix.filter(values=>values.some(cell=>String(cell).trim())).map(values=>Object.fromEntries(headers.map((header,index)=>{
    const raw = String(values[index] ?? '').trim()
    const numeric = /^-?\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : raw
    return [header,numeric]
  })))
}

function parseZipCsvRows(buffer) {
  const entries = readZipEntries(buffer)
  if (!entries.length) throw Object.assign(new Error('История остатков WB: ZIP-архив не содержит CSV-файл'), { status:502 })
  return entries
    .filter(entry=>/\.csv$/i.test(entry.name) || entries.length === 1)
    .flatMap(entry=>parseCsvRows(entry.data.toString('utf8')).map(row=>({ sourceFile:entry.name,...row })))
}

async function probeToken(token) {
  const info = inspectWbToken(token)
  // 5.10.1: в интерфейсе одно поле подключения. Тип и категории ключа
  // определяются автоматически; дальше каждый поток использует только тот
  // доступ, который реально есть у этого ключа.
  await wbFetch('https://common-api.wildberries.ru/ping', token, {
    label: 'Проверка токена WB',
    timeoutMs: 15000,
    maxAttempts: 2,
  })
  return info
}

function encryptToken(value) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, tag, encrypted].map(part => part.toString('base64url')).join('.')
}

function decryptToken(value) {
  const [ivPart, tagPart, encryptedPart] = String(value || '').split('.')
  if (!ivPart || !tagPart || !encryptedPart) throw new Error('Повреждён сохранённый API-ключ')
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(ivPart, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(encryptedPart, 'base64url')), decipher.final()]).toString('utf8')
}

function tokenFingerprint(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex')
}

function rowScopes(row) {
  if (Array.isArray(row?.scopes)) return row.scopes
  if (typeof row?.scopes === 'string') {
    try { const parsed = JSON.parse(row.scopes); return Array.isArray(parsed) ? parsed : [] } catch { return [] }
  }
  return []
}

function rowTokenType(row) {
  return Number(row?.token_type || 0)
}

function isServiceTokenRow(row) {
  return rowTokenType(row) === 4
}

function tokenEligibleForStage(row, stage) {
  const definition = WB_SYNC_STAGES[stage]
  if (!definition || !rowScopes(row).includes(definition.scope)) return false
  // Основное ядро WB работает с одним ключом по его категориям. Методы
  // списков финансовых отчётов и статуса «Джем» остаются необязательным
  // обогащением: WB ограничивает их типом токена.
  if (stage === 'financeReports' || stage === 'acquiringReports') return [3,4].includes(rowTokenType(row))
  if (stage === 'jamSubscription') return rowTokenType(row) === 4
  return true
}

function tokenStageCoverage(row) {
  return Object.entries(WB_SYNC_STAGES)
    .filter(([stage]) => tokenEligibleForStage(row,stage))
    .map(([stage, definition]) => ({ stage, label: definition.label }))
}

function tokenCoreCoverage(row) {
  return GENERAL_SYNC_STAGE_NAMES.filter(stage => tokenEligibleForStage(row,stage)).length
}

function coversAllCoreFlows(row) {
  return GENERAL_SYNC_STAGE_NAMES.every(stage => tokenEligibleForStage(row,stage))
}

function publicWbToken(row) {
  const scopes = rowScopes(row)
  const stageCoverage = tokenStageCoverage(row)
  return {
    id: row.id,
    label: row.label,
    scopes,
    scopeLabels: scopes.map(scope => WB_SCOPE_BITS[scope]?.label || scope),
    tokenType: row.token_type_label,
    tokenTypeId: rowTokenType(row),
    isServiceToken: isServiceTokenRow(row),
    purpose: 'general',
    readOnly: Boolean(row.read_only),
    isPrimary: Boolean(row.is_primary),
    coversAllCoreFlows: coversAllCoreFlows(row),
    stageCoverage,
    stageCoverageCount: tokenCoreCoverage(row),
    stageTotal: GENERAL_SYNC_STAGE_NAMES.length,
    expiresAt: row.expires_at || null,
    status: row.status,
    lastCheckedAt: row.last_checked_at || null,
    fingerprint: String(row.token_fingerprint || '').slice(0, 8),
  }
}

function publicSyncState(row) {
  return {
    stage: row.stage,
    label: WB_SYNC_STAGES[row.stage]?.label || row.stage,
    status: row.status,
    lastAttemptAt: row.last_attempt_at || null,
    lastSuccessAt: row.last_success_at || null,
    nextAllowedAt: row.next_allowed_at || null,
    lastError: row.last_error || null,
    lastCount: Number(row.last_count || 0),
    taskId: row.task_id || null,
    metadata: row.metadata || {},
    visualState:schedulerVisualState(row),
    scheduler:{
      priority:stagePriority(row.stage),
      group:schedulerGroup(row.stage),
      mode:'smart_wb_scheduler_v1',
    },
  }
}

async function getWbTokens(userId, connectionId) {
  const result = await pool.query(`SELECT * FROM wb_tokens WHERE user_id=$1 AND connection_id=$2 AND status='active' ORDER BY is_primary DESC, created_at`, [userId, connectionId])
  return result.rows
}

async function getSyncStates(connectionId) {
  const result = await pool.query('SELECT * FROM wb_sync_states WHERE connection_id=$1 ORDER BY stage', [connectionId])
  return result.rows
}

async function updateSyncState(connectionId, stage, patch = {}) {
  const current = await pool.query('SELECT * FROM wb_sync_states WHERE connection_id=$1 AND stage=$2', [connectionId, stage])
  const row = current.rows[0] || {}
  const value = {
    status: patch.status ?? row.status ?? 'idle',
    lastAttemptAt: patch.lastAttemptAt === undefined ? row.last_attempt_at : patch.lastAttemptAt,
    lastSuccessAt: patch.lastSuccessAt === undefined ? row.last_success_at : patch.lastSuccessAt,
    nextAllowedAt: patch.nextAllowedAt === undefined ? row.next_allowed_at : patch.nextAllowedAt,
    lastError: patch.lastError === undefined ? row.last_error : patch.lastError,
    lastCount: patch.lastCount === undefined ? Number(row.last_count || 0) : Number(patch.lastCount || 0),
    taskId: patch.taskId === undefined ? row.task_id : patch.taskId,
    metadata: patch.metadata === undefined ? (row.metadata || {}) : patch.metadata,
  }
  const result = await pool.query(`
    INSERT INTO wb_sync_states (connection_id,stage,status,last_attempt_at,last_success_at,next_allowed_at,last_error,last_count,task_id,metadata,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,NOW())
    ON CONFLICT (connection_id,stage) DO UPDATE SET
      status=EXCLUDED.status,last_attempt_at=EXCLUDED.last_attempt_at,last_success_at=EXCLUDED.last_success_at,
      next_allowed_at=EXCLUDED.next_allowed_at,last_error=EXCLUDED.last_error,last_count=EXCLUDED.last_count,
      task_id=EXCLUDED.task_id,metadata=EXCLUDED.metadata,updated_at=NOW()
    RETURNING *
  `, [connectionId, stage, value.status, value.lastAttemptAt, value.lastSuccessAt, value.nextAllowedAt, value.lastError, value.lastCount, value.taskId, JSON.stringify(value.metadata || {})])
  return result.rows[0]
}

function unionTokenScopes(tokens) {
  return [...new Set(tokens.flatMap(row => rowScopes(row)))]
}

function tokenSort(a,b) {
  const primaryDiff = Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary))
  if (primaryDiff) return primaryDiff
  const coreDiff = tokenCoreCoverage(b) - tokenCoreCoverage(a)
  if (coreDiff) return coreDiff
  const scopeDiff = rowScopes(b).length - rowScopes(a).length
  if (scopeDiff) return scopeDiff
  return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
}

function selectTokenRow(tokens, scope) {
  return [...tokens]
    .filter(item => rowScopes(item).includes(scope))
    .sort(tokenSort)[0] || null
}

function selectTokenRowForStage(tokens, stage) {
  return [...tokens].filter(item => tokenEligibleForStage(item,stage)).sort(tokenSort)[0] || null
}

function chooseToken(tokens, scope) {
  const row = selectTokenRow(tokens, scope)
  if (!row) return null
  const token = decryptToken(row.token_encrypted)
  return { row, token, info: inspectWbToken(token) }
}

function chooseTokenForStage(tokens, stage) {
  const row = selectTokenRowForStage(tokens,stage)
  if (!row) return null
  const token = decryptToken(row.token_encrypted)
  return { row, token, info: inspectWbToken(token) }
}

async function recomputePrimaryToken(connectionId) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(`SELECT * FROM wb_tokens WHERE connection_id=$1 AND status='active' ORDER BY created_at`, [connectionId])
    const usableTokens = result.rows
    if (!usableTokens.length) {
      await client.query('UPDATE wb_tokens SET is_primary=FALSE,updated_at=NOW() WHERE connection_id=$1 AND is_primary=TRUE', [connectionId])
      await client.query('COMMIT')
      return null
    }
    const selected = [...usableTokens].sort(tokenSort)[0]
    await client.query('UPDATE wb_tokens SET is_primary=FALSE,updated_at=NOW() WHERE connection_id=$1 AND is_primary=TRUE', [connectionId])
    await client.query('UPDATE wb_tokens SET is_primary=TRUE,updated_at=NOW() WHERE id=$1 AND connection_id=$2', [selected.id, connectionId])
    await client.query('UPDATE marketplace_connections SET token_encrypted=$1,updated_at=NOW() WHERE id=$2', [selected.token_encrypted, connectionId])
    await client.query('COMMIT')
    return { ...selected, is_primary: true }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function ensurePrimaryTokens() {
  const result = await pool.query(`
    SELECT DISTINCT wt.connection_id
    FROM wb_tokens wt
    WHERE wt.status='active'
      AND NOT EXISTS (
        SELECT 1 FROM wb_tokens primary_token
        WHERE primary_token.connection_id=wt.connection_id
          AND primary_token.status='active'
          AND primary_token.is_primary=TRUE
      )
  `)
  for (const row of result.rows) await recomputePrimaryToken(row.connection_id)
}

async function migrateLegacyWbTokens() {
  if (!pool || !encryptionKey) return
  const result = await pool.query(`
    SELECT mc.* FROM marketplace_connections mc
    WHERE mc.marketplace='wildberries'
      AND NOT EXISTS (SELECT 1 FROM wb_tokens wt WHERE wt.connection_id=mc.id)
  `)
  for (const row of result.rows) {
    try {
      const token = decryptToken(row.token_encrypted)
      const info = inspectWbToken(token)
      await pool.query(`
        INSERT INTO wb_tokens (id,connection_id,user_id,label,token_encrypted,token_fingerprint,seller_id,token_type,token_type_label,scopes,read_only,expires_at,status,last_checked_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,'active',NOW())
        ON CONFLICT (user_id,token_fingerprint) DO NOTHING
      `, [crypto.randomUUID(), row.id, row.user_id, 'Основной токен', row.token_encrypted, tokenFingerprint(token), info.sellerId || null, info.typeId, info.tokenType, JSON.stringify(info.scopes), info.readOnly, info.expiresAt])
      await pool.query('UPDATE marketplace_connections SET seller_id=COALESCE(seller_id,$1), scopes=$2::jsonb WHERE id=$3', [info.sellerId || null, JSON.stringify(info.scopes), row.id])
    } catch (error) {
      console.warn('Legacy WB token migration skipped:', row.id, error.message)
    }
  }
}

async function getConnection(userId, id = null) {
  const params = [userId]
  let sql = `SELECT * FROM marketplace_connections WHERE user_id = $1 AND marketplace = 'wildberries'`
  if (id) { params.push(id); sql += ' AND id = $2' }
  const result = await pool.query(sql, params)
  return result.rows[0] || null
}

const WEBHOOK_GROUPS = Object.freeze([
  { key:'content', stage:'products', name:'ELISEI карточки', subscriptions:[{scope:'content',event:'card_changed'},{scope:'content',event:'card_creation_error'}] },
  { key:'feedbacks', stage:'reviews', name:'ELISEI отзывы', subscriptions:[{scope:'questionsandfeedback',event:'feedback_updated'}] },
  { key:'analytics', stage:'stockHistory', name:'ELISEI отчёты', subscriptions:[{scope:'contentanalytics',event:'report_generation_complete'}] },
])

function receiverKeyHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex')
}

function oauthReadiness() {
  const secret = publicServiceSecretStatus()
  const callbackUrl = publicBackendUrl ? `${publicBackendUrl}/api/wb/oauth/callback` : null
  const configurationPrepared = Boolean(wbCatalogServiceEnabled && secret.valid && wbOauthConnectUrl && callbackUrl)
  // Обмен OAuth-кода намеренно не включается до получения и проверки
  // окончательного контракта конкретного зарегистрированного сервиса WB.
  // Наличие URL в env само по себе не означает, что авторизация готова.
  const oauthActive = false
  let message = 'До регистрации ELISEI в Каталоге решений WB живой режим работает через текущий API-токен и безопасную фоновую синхронизацию.'
  if (wbCatalogServiceEnabled && !secret.valid) message = 'Регистрация сервиса отмечена, но для OAuth и вебхуков не настроен корректный WB_CLIENT_SECRET.'
  else if (wbCatalogServiceEnabled && !callbackUrl) message = 'Регистрация сервиса отмечена, но не указан публичный PUBLIC_BACKEND_URL для callback и вебхуков.'
  else if (wbCatalogServiceEnabled && secret.valid && callbackUrl && !wbOauthConnectUrl) message = 'Вебхуки можно подключить, а OAuth останется выключенным до получения официальных параметров подключения WB.'
  else if (configurationPrepared) message = 'Параметры OAuth сохранены, но кнопка подключения будет включена только после финальной проверки callback-контракта WB.'
  return {
    configured:false,
    oauthActive,
    configurationPrepared,
    catalogRegistered:wbCatalogServiceEnabled,
    serviceSecretReady:Boolean(secret.valid),
    connectUrl:null,
    catalogUrl:wbServiceCatalogUrl || null,
    callbackPrepared:Boolean(callbackUrl),
    callbackActive:false,
    callbackUrl,
    message,
  }
}

async function liveSyncRow(connectionId) {
  const result = await pool.query('SELECT * FROM wb_live_sync_settings WHERE connection_id=$1',[connectionId])
  return result.rows[0] || null
}

async function liveSyncStatus(connectionId) {
  const [rowResult,webhookResult] = await Promise.all([
    pool.query('SELECT * FROM wb_live_sync_settings WHERE connection_id=$1',[connectionId]),
    pool.query("SELECT COUNT(*)::int AS count FROM wb_webhooks WHERE connection_id=$1 AND enabled=TRUE AND status IN ('active','local_ready')",[connectionId]),
  ])
  return {
    ...publicLiveSyncStatus(rowResult.rows[0] || null,webhookResult.rows[0]?.count || 0),
    oauth:oauthReadiness(),
    webhookSetupReady:Boolean(wbCatalogServiceEnabled && publicServiceSecretStatus().valid && publicBackendUrl),
  }
}

async function saveLiveSyncSettings(connectionId, patch = {}) {
  const current = await liveSyncRow(connectionId)
  const settings = normalizeLiveSyncSettings({ ...(current?.settings || defaultLiveSyncSettings()), ...(patch || {}), intervals:{...((current?.settings || {}).intervals || {}),...((patch || {}).intervals || {})} })
  const result = await pool.query(`
    INSERT INTO wb_live_sync_settings(connection_id,settings,updated_at)
    VALUES($1,$2::jsonb,NOW())
    ON CONFLICT(connection_id) DO UPDATE SET settings=EXCLUDED.settings,updated_at=NOW()
    RETURNING *
  `,[connectionId,JSON.stringify(settings)])
  const webhookCount = await pool.query("SELECT COUNT(*)::int AS count FROM wb_webhooks WHERE connection_id=$1 AND enabled=TRUE AND status IN ('active','local_ready')",[connectionId])
  return { ...publicLiveSyncStatus(result.rows[0],webhookCount.rows[0]?.count || 0),oauth:oauthReadiness(),webhookSetupReady:Boolean(wbCatalogServiceEnabled && publicServiceSecretStatus().valid && publicBackendUrl) }
}

async function publicWebhookRows(connectionId) {
  const result = await pool.query(`
    SELECT id,wb_webhook_id,name,subscriptions,enabled,status,last_event_at,created_at,updated_at
    FROM wb_webhooks WHERE connection_id=$1 ORDER BY created_at
  `,[connectionId])
  return result.rows.map(row=>({
    id:row.id,wbWebhookId:row.wb_webhook_id,name:row.name,subscriptions:row.subscriptions || [],enabled:row.enabled,
    status:row.status,lastEventAt:row.last_event_at,createdAt:row.created_at,updatedAt:row.updated_at,
  }))
}

async function createWbWebhook(connection, tokens, group) {
  const selected = chooseTokenForStage(tokens,group.stage)
  const receiverKey = crypto.randomBytes(24).toString('base64url')
  const localId = crypto.randomUUID()
  const callbackUrl = `${publicBackendUrl}/api/wb/webhooks/inbound/${connection.id}/${receiverKey}`
  const payload = await wbFetch('https://webhooks-api.wildberries.ru/api/v1/webhooks',selected.token,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:true,url:callbackUrl,name:group.name,subscriptions:group.subscriptions}),
    label:`Создание вебхука WB «${group.name}»`,timeoutMs:30000,maxAttempts:1,maxRetryDelayMs:0,
  })
  const wbWebhookId = String(payload?.id || payload?.webhookId || '')
  const secret = String(payload?.secret || '')
  if (!wbWebhookId || !secret) throw Object.assign(new Error(`WB не вернул id или секрет вебхука «${group.name}».`),{status:502})
  await pool.query(`
    INSERT INTO wb_webhooks(id,connection_id,wb_webhook_id,name,receiver_key_hash,secret_encrypted,subscriptions,enabled,status,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,TRUE,'active',NOW())
  `,[localId,connection.id,wbWebhookId,group.name,receiverKeyHash(receiverKey),encryptToken(secret),JSON.stringify(group.subscriptions)])
  return { id:localId,wbWebhookId,name:group.name,subscriptions:group.subscriptions,status:'active' }
}

function publicConnection(row, tokens = [], syncStates = []) {
  const scopes = tokens.length ? unionTokenScopes(tokens) : rowScopes(row)
  const primaryRow = tokens.find(item => item.is_primary) || [...tokens].sort((a,b) => tokenCoreCoverage(b) - tokenCoreCoverage(a))[0] || null
  const primaryToken = primaryRow ? publicWbToken(primaryRow) : null
  const allCoreCovered = GENERAL_SYNC_STAGE_NAMES.every(stage => Boolean(selectTokenRowForStage(tokens,stage)))
  const universal = Boolean(primaryRow && coversAllCoreFlows(primaryRow))
  const coverageByStage = Object.fromEntries(Object.entries(WB_SYNC_STAGES).map(([stage]) => {
    const selected = selectTokenRowForStage(tokens,stage)
    return [stage, selected ? { tokenId:selected.id, label:selected.label, isPrimary:Boolean(selected.is_primary), isServiceToken:isServiceTokenRow(selected) } : null]
  }))
  const serviceSecret = publicServiceSecretStatus()
  return {
    connected: Boolean(row && tokens.length),
    hasConnection: Boolean(row),
    connectionId: row?.id || null,
    sellerId: row?.seller_id || null,
    scopes,
    scopeLabels: scopes.map(scope => WB_SCOPE_BITS[scope]?.label || scope),
    tokens: tokens.map(publicWbToken),
    primaryToken,
    primaryTokenId: primaryToken?.id || null,
    tokenMode: universal ? 'universal' : allCoreCovered ? 'combined' : tokens.length ? 'partial' : 'none',
    coverageByStage,
    serviceSecret,
    stageTotal:GENERAL_SYNC_STAGE_NAMES.length,
    syncStates: syncStates.map(publicSyncState),
    status: row?.status || 'disconnected',
    connectedAt: row?.created_at || null,
    lastSync: row?.last_sync_at || null,
    syncHistory: row?.sync_history || [],
  }
}

const DEFAULT_BUSINESS_SETTINGS = Object.freeze({
  commissionPercent: 20,
  logisticsPerSale: 0,
  storageMonthly: 0,
  advertisingMonthly: 0,
  fixedMonthly: 0,
  taxPercent: 0,
  defaultCostPercent: 0,
  targetMarginPercent: 20,
  productCosts: {},
})

function finiteNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function sanitizeBusinessSettings(value = {}) {
  const productCosts = value?.productCosts && typeof value.productCosts === 'object' && !Array.isArray(value.productCosts)
    ? Object.fromEntries(Object.entries(value.productCosts).map(([key, amount]) => [String(key), Math.max(0, finiteNumber(amount, 0))]))
    : {}
  return {
    commissionPercent: Math.min(100, Math.max(0, finiteNumber(value.commissionPercent, DEFAULT_BUSINESS_SETTINGS.commissionPercent))),
    logisticsPerSale: Math.max(0, finiteNumber(value.logisticsPerSale, 0)),
    storageMonthly: Math.max(0, finiteNumber(value.storageMonthly, 0)),
    advertisingMonthly: Math.max(0, finiteNumber(value.advertisingMonthly, 0)),
    fixedMonthly: Math.max(0, finiteNumber(value.fixedMonthly, 0)),
    taxPercent: Math.min(100, Math.max(0, finiteNumber(value.taxPercent, 0))),
    defaultCostPercent: Math.min(100, Math.max(0, finiteNumber(value.defaultCostPercent, 0))),
    targetMarginPercent: Math.min(90, Math.max(0, finiteNumber(value.targetMarginPercent, 20))),
    productCosts,
  }
}

async function getBusinessSettings(userId) {
  const result = await pool.query('SELECT settings FROM business_settings WHERE user_id=$1', [userId])
  return sanitizeBusinessSettings({ ...DEFAULT_BUSINESS_SETTINGS, ...(result.rows[0]?.settings || {}) })
}

async function saveBusinessSettings(userId, settings) {
  const clean = sanitizeBusinessSettings(settings)
  await pool.query(`
    INSERT INTO business_settings (user_id, settings, updated_at)
    VALUES ($1,$2::jsonb,NOW())
    ON CONFLICT (user_id) DO UPDATE SET settings=EXCLUDED.settings, updated_at=NOW()
  `, [userId, JSON.stringify(clean)])
  return clean
}

function dateKey(value) {
  if (!value) return ''
  const raw = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10)
  const unix = /^\d{10}$/.test(raw) ? Number(raw) * 1000 : /^\d{13}$/.test(raw) ? Number(raw) : null
  const parsed = new Date(unix ?? value)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10)
}

function firstNumber(row, keys, fallback = 0) {
  for (const key of keys) {
    const value = Number(row?.[key])
    if (Number.isFinite(value)) return value
  }
  return fallback
}

function cleanIdentity(value) {
  if (value == null) return ''
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value))
  return String(value)
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim()
}

function cleanNumericIdentity(value) {
  const raw = cleanIdentity(value)
  if (!raw) return ''
  const digits = raw.replace(/\D+/g, '')
  return digits || raw
}

function cleanVendorIdentity(value) {
  return cleanIdentity(value).toLocaleLowerCase('ru-RU')
}

function cleanVendorLooseIdentity(value) {
  return cleanVendorIdentity(value).replace(/[^0-9a-zа-яё]+/giu, '')
}

function uniqueIdentities(values = [], cleaner = cleanIdentity) {
  return [...new Set(values.map(cleaner).filter(Boolean))]
}

function productNmIds(row = {}) {
  return uniqueIdentities([row?.nmId, row?.nmID, row?.nm_id, row?.nm, ...(Array.isArray(row?.nmIds) ? row.nmIds : [])], cleanNumericIdentity)
}

function productVendorCodes(row = {}) {
  return uniqueIdentities([row?.vendorCode, row?.supplierArticle, row?.article, ...(Array.isArray(row?.vendorCodes) ? row.vendorCodes : [])], cleanIdentity)
}

function productChrtIds(row = {}) {
  const nested = Array.isArray(row?.sizes)
    ? row.sizes.flatMap(size => [size?.chrtId, size?.chrtID, size?.chrt_id, size?.chrtid, size?.id])
    : []
  return uniqueIdentities([
    row?.chrtId, row?.chrtID, row?.chrt_id, row?.chrtid, row?.sizeId,
    ...(Array.isArray(row?.chrtIds) ? row.chrtIds : []),
    ...nested,
  ])
}

function productBarcodes(row = {}) {
  const nested = Array.isArray(row?.sizes)
    ? row.sizes.flatMap(size => [
      ...(Array.isArray(size?.skus) ? size.skus : []),
      ...(Array.isArray(size?.barcodes) ? size.barcodes : []),
      size?.sku, size?.barcode,
    ])
    : []
  return uniqueIdentities([
    row?.barcode, row?.sku,
    ...(Array.isArray(row?.barcodes) ? row.barcodes : []),
    ...(Array.isArray(row?.skus) ? row.skus : []),
    ...nested,
  ], cleanNumericIdentity)
}

function identityAliases(row = {}) {
  const vendorCodes = productVendorCodes(row)
  return [
    // В официальном warehouse_remains chrtID не является обязательным полем.
    // Основной ключ — nmID, затем баркод размера и артикул продавца.
    ...productNmIds(row).map(value => `nm:${value}`),
    ...productBarcodes(row).map(value => `barcode:${value}`),
    ...vendorCodes.map(value => `vendor:${cleanVendorIdentity(value)}`),
    ...vendorCodes.map(value => `vendor-loose:${cleanVendorLooseIdentity(value)}`).filter(value => !value.endsWith(':')),
    ...productChrtIds(row).map(value => `chrt:${value}`),
  ]
}

function aliasType(alias = '') {
  return String(alias).split(':', 1)[0] || 'unknown'
}

function productKey(row) {
  return productNmIds(row)[0] || productVendorCodes(row)[0] || productChrtIds(row)[0] || productBarcodes(row)[0] || ''
}

function isTrustedStockSnapshot(data = {}) {
  const meta = data?.stockMeta && typeof data.stockMeta === 'object' ? data.stockMeta : {}
  const schemaVersion = Number(meta.schemaVersion || 0)
  return schemaVersion === STOCK_DATA_SCHEMA_VERSION && meta.source === STOCK_DATA_SOURCE
}

function buildStockMeta(rows = [], extra = {}) {
  const normalized = Array.isArray(rows) ? rows : []
  const totalQuantity = normalized.reduce((sum, row) => sum + Math.max(0, Number(row?.quantity || 0) || 0), 0)
  const productIds = new Set(normalized.flatMap(productNmIds))
  const chrtIds = new Set(normalized.flatMap(productChrtIds))
  const barcodes = new Set(normalized.flatMap(productBarcodes))
  const vendorCodes = new Set(normalized.flatMap(productVendorCodes).map(cleanVendorIdentity).filter(Boolean))
  const warehouses = new Set(normalized.map(row => String(row?.warehouseName || '').trim()).filter(Boolean))
  return {
    schemaVersion: STOCK_DATA_SCHEMA_VERSION,
    source: STOCK_DATA_SOURCE,
    rows: normalized.length,
    totalQuantity: Math.round(totalQuantity),
    nonZeroRows: normalized.filter(row => Number(row?.quantity || 0) > 0).length,
    zeroRows: normalized.filter(row => Number(row?.quantity || 0) <= 0).length,
    products: productIds.size,
    chrtIds: chrtIds.size,
    barcodes: barcodes.size,
    vendorCodes: vendorCodes.size,
    warehouses: warehouses.size,
    receivedAt: new Date().toISOString(),
    ...extra,
  }
}

function rebuildUnifiedProductData(data = {}) {
  const catalog = Array.isArray(data.products) ? data.products : []
  let stockAllocation = null
  if (isTrustedStockSnapshot(data) && Array.isArray(data.stocks)) {
    stockAllocation = reconcileWarehouseRemainsStrict(catalog, data.stocks)
    data.stockAllocation = stockAllocation
    data.stockMeta = {
      ...(data.stockMeta || buildWarehouseMetaStrict(data.stocks)),
      reconciliation:stockAllocation.diagnostics,
      mappedQuantity:stockAllocation.diagnostics.matchedQuantity,
      unmatchedQuantity:stockAllocation.diagnostics.unmatchedQuantity,
      mappedRows:stockAllocation.diagnostics.matchedRows,
      unmatchedRows:stockAllocation.diagnostics.unmatchedRows,
    }
  } else {
    data.stockAllocation = null
  }
  data.productMaster = buildProductMaster({
    catalog,
    stockAllocation,
    advertising:data.advertising || null,
  })
  data.products = data.productMaster
  return data
}


function compactConnectionData(data = {}, streamSources = {}) {
  const compact = { ...(data && typeof data === 'object' ? data : {}) }
  for (const stream of WB_STREAMS) delete compact[stream]
  delete compact.productMaster
  delete compact.stockAllocation
  compact.dataManifest = {
    schemaVersion: 2,
    storage: 'wb_stream_data',
    updatedAt: new Date().toISOString(),
    streams: Object.fromEntries(WB_STREAMS.map(stream => [stream, {
      count: Number(streamSources?.[stream]?.count || 0),
      source: streamSources?.[stream]?.source || 'stream_store',
      updatedAt: streamSources?.[stream]?.updatedAt || null,
      checksum: streamSources?.[stream]?.checksum || null,
    }])),
  }
  return compact
}

function streamSourcesFromData(data = {}, source = 'sync') {
  return Object.fromEntries(WB_STREAMS.map(stream => [stream, {
    source,
    count: persistedStreamCount(stream, data?.[stream]),
    updatedAt: new Date().toISOString(),
    checksum: null,
  }]))
}

function nestedArrays(node, output = [], depth = 0) {
  if (depth > 8 || node == null) return output
  if (Array.isArray(node)) {
    output.push(node)
    for (const item of node.slice(0, 12)) nestedArrays(item, output, depth + 1)
    return output
  }
  if (typeof node !== 'object') return output
  for (const value of Object.values(node)) nestedArrays(value, output, depth + 1)
  return output
}

function bestSnapshotRows(stream, payload) {
  const candidates = nestedArrays(payload)
  const rowScore = row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return 0
    if (stream === 'products') return Number(row.nmID != null || row.nmId != null) * 5 + Number(Array.isArray(row.sizes)) * 2
    if (stream === 'orders' || stream === 'sales') return Number(Boolean(row.srid)) * 5 + Number(Boolean(row.lastChangeDate || row.date)) * 2 + Number(row.nmId != null || row.nmID != null)
    if (stream === 'stocks') return Number(row.nmId != null || row.nmID != null || row.barcode || row.vendorCode) * 4 + Number(Array.isArray(row.warehouses)) * 3 + Number(row.quantity != null)
    return 0
  }
  return candidates
    .map(rows => ({ rows, score: rows.slice(0, 30).reduce((sum, row) => sum + rowScore(row), 0) }))
    .filter(item => item.rows.length && item.score > 0)
    .sort((a, b) => b.score - a.score || b.rows.length - a.rows.length)[0]?.rows || []
}

async function recoverStreamFromSnapshotStrict(connectionId, stream) {
  const snapshot = await latestSnapshot(pool, connectionId, stream)
  if (!snapshot) return null
  const normalized = snapshot.normalized_payload
  try {
    if (stream === 'products') {
      if (Array.isArray(normalized) && normalized.length) return { payload:normalized, meta:{ snapshotId:snapshot.id, endpoint:snapshot.endpoint } }
      const pages = Array.isArray(snapshot.raw_payload) ? snapshot.raw_payload : [snapshot.raw_payload]
      const products = pages.flatMap(page => {
        try { return normalizeCatalogPageStrict(page).products } catch { return [] }
      })
      if (products.length) return { payload:products, meta:{ snapshotId:snapshot.id, endpoint:snapshot.endpoint } }
      const rawCards = bestSnapshotRows(stream, snapshot.raw_payload)
      const fallback = rawCards.map(card => {
        try { return normalizeCatalogPageStrict({ cards:[card] }).products[0] || null } catch { return null }
      }).filter(Boolean)
      return fallback.length ? { payload:fallback, meta:{ snapshotId:snapshot.id, endpoint:snapshot.endpoint } } : null
    }
    if (stream === 'orders' || stream === 'sales') {
      const rows = Array.isArray(normalized) && normalized.length ? normalized
        : Array.isArray(snapshot.raw_payload) ? snapshot.raw_payload
          : bestSnapshotRows(stream, snapshot.raw_payload)
      return rows.length ? { payload:rows, meta:{ snapshotId:snapshot.id, endpoint:snapshot.endpoint } } : null
    }
    if (stream === 'stocks') {
      if (Array.isArray(normalized) && normalized.length) {
        return { payload:normalized, stockMeta:buildWarehouseMetaStrict(normalized, { recoveredFromSnapshot:true }), meta:{ snapshotId:snapshot.id, endpoint:snapshot.endpoint } }
      }
      const raw = snapshot.raw_payload
      try {
        const parsed = normalizeWarehouseRemainsStrict(raw)
        if (parsed.rows.length) return { payload:parsed.rows, stockMeta:{ ...parsed.meta, recoveredFromSnapshot:true }, meta:{ snapshotId:snapshot.id, endpoint:snapshot.endpoint } }
      } catch {}
      const candidates = bestSnapshotRows(stream, raw)
      try {
        const parsed = normalizeWarehouseRemainsStrict(candidates)
        if (parsed.rows.length) return { payload:parsed.rows, stockMeta:{ ...parsed.meta, recoveredFromSnapshot:true }, meta:{ snapshotId:snapshot.id, endpoint:snapshot.endpoint } }
      } catch {}
      return null
    }
    if (stream === 'advertising') {
      if (normalized && typeof normalized === 'object' && !Array.isArray(normalized) && Array.isArray(normalized.campaigns)) {
        return { payload:normalized, meta:{ snapshotId:snapshot.id, endpoint:snapshot.endpoint } }
      }
      const raw = snapshot.raw_payload || {}
      const campaigns = normalizeCampaignListStrict(raw.campaigns ?? raw)
      const statsByAdvertId = normalizeFullStatsStrict(raw.stats ?? [])
      if (!campaigns.length && !statsByAdvertId.size) return null
      const payload = mergeAdvertisingSnapshot({ campaigns, statsByAdvertId, requestedIds:campaigns.map(item => String(item.advertId)), period:{ days:30 } })
      payload.meta = buildAdvertisingMeta(payload)
      return { payload, meta:{ snapshotId:snapshot.id, endpoint:snapshot.endpoint } }
    }
    if (stream === 'finance' || stream === 'acquiring') {
      if (normalized && typeof normalized === 'object' && !Array.isArray(normalized)) return { payload:normalized, meta:{ snapshotId:snapshot.id, endpoint:snapshot.endpoint } }
      return null
    }
    if (['sellerStocks','paidStorage','acceptance'].includes(stream)) {
      const rows = Array.isArray(normalized) ? normalized : Array.isArray(snapshot.raw_payload) ? snapshot.raw_payload : []
      return rows.length ? { payload:rows, meta:{ snapshotId:snapshot.id, endpoint:snapshot.endpoint } } : null
    }
  } catch (error) {
    console.warn(`WB snapshot strict recovery failed for ${stream}:`, error.message)
  }
  return null
}

async function queueMissingStreamsForRecovery(connection, data, sources) {
  const states = await getSyncStates(connection.id)
  const byStage = new Map(states.map(row => [row.stage, row]))
  const queued = []
  for (const stream of WB_STREAMS) {
    if (persistedStreamCount(stream, data?.[stream]) > 0) continue
    const state = byStage.get(stream)
    if (!state || Number(state.last_count || 0) <= 0) continue
    if (['running','pending','queued'].includes(String(state.status || ''))) continue
    const nextAllowed = state.next_allowed_at ? new Date(state.next_allowed_at).getTime() : 0
    if (nextAllowed > Date.now()) continue
    await updateSyncState(connection.id, stream, {
      status:'queued',
      nextAllowedAt:new Date().toISOString(),
      taskId:['stocks','paidStorage','acceptance'].includes(stream) ? null : state.task_id,
      lastError:`Сохранён счётчик ${Number(state.last_count || 0)}, но сами строки отсутствуют. ELISEI автоматически восстанавливает поток.`,
      metadata:{ ...(state.metadata || {}), recoveryReason:'payload_missing', expectedCount:Number(state.last_count || 0) },
    })
    queued.push(stream)
    sources[stream] = { ...(sources[stream] || {}), source:'automatic_resync_queued', expectedCount:Number(state.last_count || 0) }
  }
  if (queued.length) kickBackgroundWorkers(`data-recovery:${connection.id}`)
  return queued
}

async function canonicalConnectionData(connection, { repair = true, persistManifest = true, queueMissing = true } = {}) {
  if (!connection) return { data: {}, sources: {}, recovered: [], recoveryQueued: [] }
  const hydrated = await hydrateStreamData(pool, connection.id, connection.data || {}, { repair })
  const data = hydrated.data
  const recovered = [...hydrated.recovered]

  for (const stream of WB_STREAMS) {
    if (persistedStreamCount(stream, data?.[stream]) > 0) continue
    const strict = await recoverStreamFromSnapshotStrict(connection.id, stream)
    if (!strict) continue
    data[stream] = strict.payload
    if (stream === 'stocks' && strict.stockMeta) data.stockMeta = strict.stockMeta
    const saved = await saveStreamData(pool, {
      connectionId:connection.id,
      stream,
      payload:strict.payload,
      metadata:strict.meta || {},
      source:'snapshot_strict_recovery',
    })
    hydrated.sources[stream] = {
      source:'snapshot_strict_recovery',
      count:Number(saved.row_count || persistedStreamCount(stream, strict.payload)),
      updatedAt:saved.updated_at || null,
      checksum:saved.checksum || null,
    }
    recovered.push({ stream, from:'snapshot_strict', count:Number(saved.row_count || 0) })
  }

  if (Array.isArray(data.stocks) && data.stocks.length && !isTrustedStockSnapshot(data)) {
    data.stockMeta = buildWarehouseMetaStrict(data.stocks, { recovered: true })
  }
  rebuildUnifiedProductData(data)

  // На чтении больше не удаляем legacy-данные. Компактная запись разрешена только
  // после успешной синхронизации, когда wb_stream_data уже подтверждён.
  if (persistManifest && (recovered.length || !connection.data?.dataManifest)) {
    const safeData = { ...(connection.data && typeof connection.data === 'object' ? connection.data : {}) }
    safeData.dataManifest = compactConnectionData(data, hydrated.sources).dataManifest
    await pool.query(`UPDATE marketplace_connections SET data=$1::jsonb,updated_at=NOW() WHERE id=$2`, [JSON.stringify(safeData), connection.id])
  }

  const recoveryQueued = queueMissing ? await queueMissingStreamsForRecovery(connection, data, hydrated.sources) : []
  return { ...hydrated, data, recovered, recoveryQueued }
}

function streamDataAvailable(stageStatus = {}, stage = '', rowCount = 0) {
  // Реально сохранённые строки всегда важнее устаревшего false в stageStatus.
  // После восстановления из wb_stream_data старый флаг подключения может ещё
  // оставаться отрицательным, хотя данные уже доступны аналитике и Элу.
  return Number(rowCount || 0) > 0 || stageStatus?.[stage]?.available === true
}

function buildCoreAnalytics(data = {}, rawSettings = {}) {
  const settings = sanitizeBusinessSettings({ ...DEFAULT_BUSINESS_SETTINGS, ...rawSettings })
  const rawProducts = Array.isArray(data.products) ? data.products : []
  const orders = Array.isArray(data.orders) ? data.orders : []
  const salesRows = Array.isArray(data.sales) ? data.sales : []
  // Старые тестовые/ошибочно разобранные остатки не должны попадать в аналитику.
  // Доверяем только снимку, который прошёл новый нормализатор и имеет метаданные происхождения.
  const trustedStocks = isTrustedStockSnapshot(data)
  const fboStocks = trustedStocks && Array.isArray(data.stocks)
    ? data.stocks.map(row => ({ ...row, fulfillmentMode:row?.fulfillmentMode || 'FBO', stockScheme:'FBO' }))
    : []
  const sellerStocks = Array.isArray(data.sellerStocks)
    ? data.sellerStocks.map(row => ({ ...row, fulfillmentMode:'FBS', stockScheme:'FBS' }))
    : []
  const stocks = [...fboStocks, ...sellerStocks]
  const stockMeta = trustedStocks && data?.stockMeta && typeof data.stockMeta === 'object' ? { ...data.stockMeta } : null
  const advertisingData = data?.advertising && typeof data.advertising === 'object' ? data.advertising : { campaigns: [], totals: {} }
  const financeData = data?.finance && typeof data.finance === 'object' && !Array.isArray(data.finance) ? data.finance : { rows:[], totals:{}, balance:null, period:null }
  const financeRows = Array.isArray(financeData.rows) ? financeData.rows : []
  const paidStorageRows = Array.isArray(data?.paidStorage) ? data.paidStorage : []
  const acceptanceRows = Array.isArray(data?.acceptance) ? data.acceptance : []
  const acquiringData = data?.acquiring && typeof data.acquiring === 'object' && !Array.isArray(data.acquiring) ? data.acquiring : { rows:[], totals:{} }
  const acquiringRows = Array.isArray(acquiringData.rows) ? acquiringData.rows : []
  const stageStatus = data?.stageStatus && typeof data.stageStatus === 'object' ? data.stageStatus : {}
  const availability = {
    products: streamDataAvailable(stageStatus, 'products', rawProducts.length),
    orders: streamDataAvailable(stageStatus, 'orders', orders.length),
    sales: streamDataAvailable(stageStatus, 'sales', salesRows.length),
    stocks: Boolean((trustedStocks && streamDataAvailable(stageStatus, 'stocks', fboStocks.length)) || streamDataAvailable(stageStatus, 'sellerStocks', sellerStocks.length)),
    fboStocks: trustedStocks && streamDataAvailable(stageStatus, 'stocks', fboStocks.length),
    sellerStocks: streamDataAvailable(stageStatus, 'sellerStocks', sellerStocks.length),
    stockDetails: stocks.length > 0,
    advertising: streamDataAvailable(stageStatus, 'advertising', Array.isArray(advertisingData.campaigns) ? advertisingData.campaigns.length : 0),
    finance: streamDataAvailable(stageStatus, 'finance', financeRows.length),
    paidStorage: streamDataAvailable(stageStatus, 'paidStorage', paidStorageRows.length),
    acceptance: streamDataAvailable(stageStatus, 'acceptance', acceptanceRows.length),
    acquiring: streamDataAvailable(stageStatus, 'acquiring', acquiringRows.length),
    searchQueries: streamDataAvailable(stageStatus, 'searchQueries', Number(data?.searchQueries?.totalRows || 0)),
    stockHistory: streamDataAvailable(stageStatus, 'stockHistory', Number(data?.stockHistory?.totalRows || 0)),
    reviews: streamDataAvailable(stageStatus, 'reviews', Number(data?.reviews?.totalRows || 0)),
    questions: streamDataAvailable(stageStatus, 'questions', Number(data?.questions?.totalRows || 0)),
    chats: streamDataAvailable(stageStatus, 'chats', Number(data?.chats?.totalRows || 0)),
  }
  const periodDays = Math.max(1, Math.min(366, Number(data?.__periodDays || 30)))
  const productMap = new Map()
  const productAliases = new Map()
  const modeBySrid = new Map()
  const fulfillmentMode = (row = {}) => {
    const raw = String(row.fulfillmentMode || row.deliveryMethod || row.delivery_method || row.warehouseType || row.warehouse_type || '').toLowerCase()
    if (raw.includes('продав') || raw === 'fbs') return 'FBS'
    if (raw.includes('склад wb') || raw.includes('wildberries') || raw === 'fbo' || raw === 'fbw') return 'FBO'
    if (row.assemblyId != null || row.assembly_id != null || row.stickerId != null || row.sticker_id != null) return 'FBS'
    return 'UNKNOWN'
  }
  const modeStats = () => ({ orders:0, sales:0, returns:0, revenue:0, stock:0, commission:0, logistics:0, storage:0, acceptance:0, acquiring:0, penalties:0, deductions:0, additionalPayment:0, sellerPayable:0, detailStorage:0, detailAcceptance:0, detailAcquiring:0 })
  const touchMode = (item, mode) => {
    if (!item || !['FBS','FBO'].includes(mode)) return null
    item.fulfillmentModes[mode] = true
    return item.modeStats[mode]
  }
  const mergeUnique = (left = [], right = []) => uniqueIdentities([...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])])
  const registerAliases = (item, row = {}) => {
    for (const alias of identityAliases(row)) productAliases.set(alias, item)
    for (const alias of identityAliases(item)) productAliases.set(alias, item)
  }
  const resolveProductDetailed = (row = {}) => {
    for (const alias of identityAliases(row)) {
      const existing = productAliases.get(alias)
      if (existing) return { item: existing, method: aliasType(alias), alias }
    }
    return { item: null, method: null, alias: null }
  }
  const resolveProduct = (row = {}) => resolveProductDetailed(row).item
  const resolveStockProductDetailed = (row = {}) => {
    // Для остатков первичный ключ — ШК размера. Это позволяет корректно
    // суммировать размеры на карточку даже при неполном nmID в отчёте.
    const aliases = [
      ...productBarcodes(row).map(value => `barcode:${value}`),
      ...productNmIds(row).map(value => `nm:${value}`),
      ...productVendorCodes(row).map(value => `vendor:${cleanVendorIdentity(value)}`),
      ...productVendorCodes(row).map(value => `vendor-loose:${cleanVendorLooseIdentity(value)}`).filter(value => !value.endsWith(':')),
      ...productChrtIds(row).map(value => `chrt:${value}`),
    ]
    for (const alias of aliases) {
      const existing = productAliases.get(alias)
      if (existing) return { item: existing, method: aliasType(alias), alias }
    }
    return { item: null, method: null, alias: null }
  }
  const ensure = (row = {}) => {
    const existing = resolveProduct(row)
    if (existing) {
      registerAliases(existing, row)
      return existing
    }
    const key = productKey(row)
    if (!key) return null
    if (!productMap.has(key)) {
      const nmIds = productNmIds(row)
      const vendorCodes = productVendorCodes(row)
      const chrtIds = productChrtIds(row)
      const barcodes = productBarcodes(row)
      productMap.set(key, {
        key,
        nmID: nmIds[0] || null,
        vendorCode: vendorCodes[0] || '',
        barcode: barcodes[0] || '',
        chrtIds,
        barcodes,
        sizes: Array.isArray(row?.sizes) ? row.sizes : [],
        title: row.title || row.subject || row.subjectName || 'Товар',
        brand: row.brand || '',
        category: row.subjectName || row.subject || row.category || row.objectName || row.object || '',
        photo: row.photo || '',
        stock: 0,
        stockRows: 0,
        ordersCount: 0,
        salesCount: 0,
        returnsCount: 0,
        revenue: 0,
        dailyOrders: {},
        dailySales: {},
        dailyReturns: {},
        dailyRevenue: {},
        adSpend: 0,
        adViews: 0,
        adClicks: 0,
        adOrders: 0,
        adRevenue: 0,
        adCampaignIds: [],
        fulfillmentModes:{ FBS:false, FBO:false },
        modeStats:{ FBS:modeStats(), FBO:modeStats() },
        financeCommission:0,
        financeLogistics:0,
        financeStorage:0,
        financeAcceptance:0,
        financeAcquiring:0,
        financePenalties:0,
        financeDeductions:0,
        financeAdditionalPayment:0,
        financeSellerPayable:0,
        detailStorage:0,
        detailAcceptance:0,
        detailAcquiring:0,
      })
    }
    const item = productMap.get(key)
    const nmIds = productNmIds(row)
    const vendorCodes = productVendorCodes(row)
    const chrtIds = productChrtIds(row)
    const barcodes = productBarcodes(row)
    if (!item.nmID && nmIds.length) item.nmID = nmIds[0]
    if (!item.vendorCode && vendorCodes.length) item.vendorCode = vendorCodes[0]
    if (!item.barcode && barcodes.length) item.barcode = barcodes[0]
    item.chrtIds = mergeUnique(item.chrtIds, chrtIds)
    item.barcodes = mergeUnique(item.barcodes, barcodes)
    if ((!item.sizes || !item.sizes.length) && Array.isArray(row?.sizes)) item.sizes = row.sizes
    if ((!item.title || item.title === 'Товар') && (row.title || row.subjectName)) item.title = row.title || row.subjectName
    if (!item.brand && row.brand) item.brand = row.brand
    if (!item.category && (row.subjectName || row.subject || row.category || row.objectName || row.object)) item.category = row.subjectName || row.subject || row.category || row.objectName || row.object
    if (!item.photo && row.photo) item.photo = row.photo
    registerAliases(item, row)
    return item
  }

  rawProducts.forEach(row => ensure(row))

  // Заказы и продажи часто содержат полные nmID/баркоды даже тогда, когда
  // старый снимок каталога был сохранён без размеров. Используем их как
  // безопасный мост идентификаторов до распределения остатков.
  for (const row of [...orders, ...salesRows]) {
    const item = resolveProduct(row)
    if (!item) continue
    const nmIds = productNmIds(row)
    const vendorCodes = productVendorCodes(row)
    const chrtIds = productChrtIds(row)
    const barcodes = productBarcodes(row)
    if (!item.nmID && nmIds.length) item.nmID = nmIds[0]
    if (!item.vendorCode && vendorCodes.length) item.vendorCode = vendorCodes[0]
    if (!item.barcode && barcodes.length) item.barcode = barcodes[0]
    item.chrtIds = mergeUnique(item.chrtIds, chrtIds)
    item.barcodes = mergeUnique(item.barcodes, barcodes)
    registerAliases(item, row)
  }

  const warehouses = new Map()
  const unmatchedStockDetails = []
  const stockMatchMethods = { nm: 0, barcode: 0, vendor: 0, 'vendor-loose': 0, chrt: 0 }
  let rawStockQuantity = 0
  let mappedStockQuantity = 0
  let mappedStockRows = 0
  let unmatchedStockRows = 0
  for (const row of stocks) {
    const quantity = Math.max(0, firstNumber(row, ['quantity', 'quantityFull', 'stock', 'stockCount', 'totalQuantity', 'availableQuantity'], 0))
    rawStockQuantity += quantity
    const name = String(row.warehouseName || row.warehouse || row.officeName || 'Все склады').trim() || 'Все склады'
    warehouses.set(name, (warehouses.get(name) || 0) + quantity)
    const matched = resolveStockProductDetailed(row)
    const item = matched.item
    if (!item) {
      unmatchedStockRows += 1
      unmatchedStockDetails.push({
        key: `unmatched:${unmatchedStockRows}:${productChrtIds(row)[0] || productBarcodes(row)[0] || name}`,
        nmID: productNmIds(row)[0] || null,
        vendorCode: productVendorCodes(row)[0] || '',
        chrtId: productChrtIds(row)[0] || '',
        barcode: productBarcodes(row)[0] || '',
        techSize: row?.techSize || row?.sizeName || row?.size || '',
        warehouseName: name,
        quantity: Math.round(quantity),
      })
      continue
    }
    item.stock += quantity
    item.stockRows += 1
    const stockMode = fulfillmentMode(row) === 'FBS' ? 'FBS' : 'FBO'
    const stockBucket = touchMode(item, stockMode)
    if (stockBucket) stockBucket.stock += quantity
    mappedStockRows += 1
    mappedStockQuantity += quantity
    if (matched.method && Object.prototype.hasOwnProperty.call(stockMatchMethods, matched.method)) stockMatchMethods[matched.method] += 1
  }
  const stockMappingReady = stocks.length > 0 && (rawStockQuantity === 0 || mappedStockRows > 0)
  availability.stockDetails = Boolean(availability.stockDetails && stockMappingReady)
  const metaStockQuantity = Math.max(0, Number(stockMeta?.totalQuantity || 0) || 0)
  const resolvedStockQuantity = availability.stocks
    ? (stocks.length > 0 ? rawStockQuantity : metaStockQuantity)
    : 0

  const dailyMap = new Map()
  const explicitPeriodTo = dateKey(data?.__periodTo)
  const explicitPeriodFrom = dateKey(data?.__periodFrom)
  const periodEnd = explicitPeriodTo ? new Date(`${explicitPeriodTo}T00:00:00.000Z`) : new Date()
  const periodStart = explicitPeriodFrom
    ? new Date(`${explicitPeriodFrom}T00:00:00.000Z`)
    : new Date(periodEnd.getTime() - (periodDays - 1) * 86400000)
  for (let cursor = new Date(periodStart); cursor <= periodEnd; cursor = new Date(cursor.getTime() + 86400000)) {
    const date = cursor.toISOString().slice(0, 10)
    dailyMap.set(date, { date, revenue: 0, orders: 0, sales: 0, returns: 0 })
  }

  for (const row of orders) {
    const item = ensure(row)
    const mode = fulfillmentMode(row)
    const srid = String(row.srid || row.rid || '').trim()
    if (srid && mode !== 'UNKNOWN') modeBySrid.set(srid, mode)
    const day = dateKey(row.date || row.lastChangeDate || row.createdAt)
    if (item) {
      item.ordersCount += 1
      const bucket = touchMode(item, mode)
      if (bucket) bucket.orders += 1
      if (day) item.dailyOrders[day] = (item.dailyOrders[day] || 0) + 1
    }
    if (dailyMap.has(day)) dailyMap.get(day).orders += 1
  }

  for (const row of salesRows) {
    const item = ensure(row)
    const mode = fulfillmentMode(row)
    const srid = String(row.srid || row.rid || '').trim()
    if (srid && mode !== 'UNKNOWN') modeBySrid.set(srid, mode)
    const isReturn = String(row.saleID || row.saleId || '').toUpperCase().startsWith('R') || Boolean(row.isReturn)
    let amount = firstNumber(row, ['forPay', 'finishedPrice', 'priceWithDisc', 'totalPrice'], 0)
    if (isReturn && amount > 0) amount = -amount
    const day = dateKey(row.sale_dt || row.date || row.lastChangeDate || row.createdAt)
    if (item) {
      item.revenue += amount
      const modeBucket = touchMode(item, mode)
      if (isReturn) {
        item.returnsCount += 1
        if (modeBucket) modeBucket.returns += 1
      } else {
        item.salesCount += 1
        if (modeBucket) modeBucket.sales += 1
      }
      if (modeBucket) modeBucket.revenue += amount
      if (day) {
        item.dailyRevenue[day] = (item.dailyRevenue[day] || 0) + amount
        if (isReturn) item.dailyReturns[day] = (item.dailyReturns[day] || 0) + 1
        else item.dailySales[day] = (item.dailySales[day] || 0) + 1
      }
    }
    if (dailyMap.has(day)) {
      const bucket = dailyMap.get(day)
      bucket.revenue += amount
      if (isReturn) bucket.returns += 1
      else bucket.sales += 1
    }
  }

  const unallocatedFinance = { commission:0, logistics:0, storage:0, acceptance:0, acquiring:0, penalties:0, deductions:0, additionalPayment:0 }
  for (const row of financeRows) {
    const item = ensure(row)
    const srid = String(row.srid || '').trim()
    const mode = modeBySrid.get(srid) || fulfillmentMode(row)
    const amounts = financeRowAmounts(row)
    const commission = amounts.commission
    const logistics = amounts.logistics + amounts.logisticsRebill
    const storage = amounts.storage
    const acceptance = amounts.acceptance
    const acquiring = amounts.acquiring
    const penalties = amounts.penalties
    const deductions = amounts.deductions
    const additionalPayment = amounts.additionalPayment
    const sellerPayable = amounts.sellerPayable
    if (item) {
      item.financeCommission += commission
      item.financeLogistics += logistics
      item.financeStorage += storage
      item.financeAcceptance += acceptance
      item.financeAcquiring += acquiring
      item.financePenalties += penalties
      item.financeDeductions += deductions
      item.financeAdditionalPayment += additionalPayment
      item.financeSellerPayable += sellerPayable
      const bucket = touchMode(item, mode)
      if (bucket) {
        bucket.commission += commission
        bucket.logistics += logistics
        bucket.storage += storage
        bucket.acceptance += acceptance
        bucket.acquiring += acquiring
        bucket.penalties += penalties
        bucket.deductions += deductions
        bucket.additionalPayment += additionalPayment
        bucket.sellerPayable += sellerPayable
      }
    } else {
      unallocatedFinance.commission += commission
      unallocatedFinance.logistics += logistics
      unallocatedFinance.storage += storage
      unallocatedFinance.acceptance += acceptance
      unallocatedFinance.acquiring += acquiring
      unallocatedFinance.penalties += penalties
      unallocatedFinance.deductions += deductions
      unallocatedFinance.additionalPayment += additionalPayment
    }
  }

  let unallocatedPaidStorage = 0
  for (const row of paidStorageRows) {
    const amount = Math.abs(fieldNumber(row,['warehousePrice'],0))
    const item = ensure(row)
    if (item) {
      item.detailStorage += amount
      const bucket = touchMode(item,'FBO')
      if (bucket) bucket.detailStorage += amount
    } else unallocatedPaidStorage += amount
  }

  let unallocatedAcceptance = 0
  for (const row of acceptanceRows) {
    const amount = Math.abs(fieldNumber(row,['total'],0))
    const item = ensure(row)
    if (item) {
      item.detailAcceptance += amount
      const bucket = touchMode(item,'FBO')
      if (bucket) bucket.detailAcceptance += amount
    } else unallocatedAcceptance += amount
  }

  let unallocatedAcquiring = 0
  for (const row of acquiringRows) {
    const amount = Math.abs(fieldNumber(row,['acquiringFee','acquiring_fee'],0))
    const item = ensure(row)
    const srid = String(row.srid || '').trim()
    const mode = modeBySrid.get(srid) || fulfillmentMode(row)
    if (item) {
      item.detailAcquiring += amount
      const bucket = touchMode(item,mode)
      if (bucket) bucket.detailAcquiring += amount
    } else unallocatedAcquiring += amount
  }

  // Реклама связывается с товаром по nmID. Кампания может содержать
  // несколько артикулов WB, поэтому метрики агрегируются на карточку товара.
  const campaignProductRows = []
  let mappedAdvertisingSpend = 0
  const rawCampaigns = Array.isArray(advertisingData?.campaigns) ? advertisingData.campaigns : []
  for (const campaign of rawCampaigns) {
    const nmStats = Array.isArray(campaign?.nmStats) ? campaign.nmStats : []
    const campaignNmIds = uniqueIdentities(campaign?.nmIds || [], cleanNumericIdentity)
    for (const stat of nmStats) {
      const item = resolveProduct(stat)
      const nmID = productNmIds(stat)[0] || null
      const spend = Math.max(0, finiteNumber(stat?.spend, 0))
      const views = Math.max(0, finiteNumber(stat?.views, 0))
      const clicks = Math.max(0, finiteNumber(stat?.clicks, 0))
      const adOrders = Math.max(0, finiteNumber(stat?.orders, 0))
      const adRevenue = Math.max(0, finiteNumber(stat?.revenue, 0))
      if (item) {
        item.adSpend += spend
        item.adViews += views
        item.adClicks += clicks
        item.adOrders += adOrders
        item.adRevenue += adRevenue
        item.adCampaignIds = mergeUnique(item.adCampaignIds, [String(campaign.advertId || '')])
        mappedAdvertisingSpend += spend
      }
      campaignProductRows.push({
        key: `${campaign.advertId || 'campaign'}:${nmID || campaignProductRows.length}`,
        advertId: campaign.advertId || null,
        campaignName: campaign.name || `Кампания ${campaign.advertId || ''}`,
        status: campaign.status,
        nmID: item?.nmID || nmID,
        vendorCode: item?.vendorCode || productVendorCodes(stat)[0] || '',
        barcode: item?.barcode || productBarcodes(stat)[0] || '',
        title: item?.title || stat?.name || 'Товар',
        photo: item?.photo || '',
        spend, views, clicks, orders: adOrders, revenue: adRevenue,
        ctr: views > 0 ? clicks / views * 100 : null,
        cpc: clicks > 0 ? spend / clicks : null,
        crr: adRevenue > 0 ? spend / adRevenue * 100 : null,
        romi: spend > 0 ? (adRevenue - spend) / spend * 100 : null,
        orderConversion: clicks > 0 ? adOrders / clicks * 100 : null,
        mapped: Boolean(item),
      })
    }
    if (!nmStats.length && campaignNmIds.length) {
      for (const nmID of campaignNmIds) {
        const item = resolveProduct({ nmId:nmID })
        campaignProductRows.push({
          key: `${campaign.advertId || 'campaign'}:${nmID}`,
          advertId: campaign.advertId || null,
          campaignName: campaign.name || `Кампания ${campaign.advertId || ''}`,
          status: campaign.status,
          nmID: item?.nmID || nmID,
          vendorCode: item?.vendorCode || '',
          barcode: item?.barcode || '',
          title: item?.title || 'Товар',
          photo: item?.photo || '',
          spend:null, views:null, clicks:null, orders:null, revenue:null,
          ctr:null, cpc:null, crr:null, romi:null, orderConversion:null,
          mapped:Boolean(item), statsAvailable:false,
        })
      }
    }
  }

  const actualAdvertisingSpend = Math.max(0, finiteNumber(advertisingData?.totals?.spend, 0))
  // Нулевая статистика — валидный результат. Признак загрузки берём из ответа fullstats,
  // а не из ненулевых расходов/показов.
  const advertisingStatsAvailable = rawCampaigns.some(campaign => campaign?.statsStatus === 'loaded')
  const periodFactor = Math.max(1 / 30, periodDays / 30)
  const manualAdvertisingExpense = Math.max(0, settings.advertisingMonthly * periodFactor)
  const advertisingExpense = availability.advertising && advertisingStatsAvailable ? actualAdvertisingSpend : manualAdvertisingExpense
  const mappedAdvertisingScale = mappedAdvertisingSpend > 0 && advertisingExpense >= 0
    ? Math.min(1, advertisingExpense / mappedAdvertisingSpend)
    : 1
  const resolvedMappedAdvertisingSpend = mappedAdvertisingSpend * mappedAdvertisingScale

  const financeTotals = financeData?.totals && typeof financeData.totals === 'object'
    ? { ...summarizeFinanceRows(financeRows), ...financeData.totals }
    : summarizeFinanceRows(financeRows)
  const dedicatedStorageTotal = paidStorageRows.reduce((sum,row) => sum + Math.abs(fieldNumber(row,['warehousePrice','warehouse_price'],0)),0)
  const dedicatedAcceptanceTotal = acceptanceRows.reduce((sum,row) => sum + Math.abs(fieldNumber(row,['total'],0)),0)
  const dedicatedAcquiringTotal = acquiringRows.reduce((sum,row) => sum + Math.abs(fieldNumber(row,['acquiringFee','acquiring_fee'],0)),0)
  const financeHasRows = availability.finance && financeRows.length > 0
  const financeStorageAvailable = financeHasRows && Math.abs(finiteNumber(financeTotals.storage,0)) > 0
  const financeAcceptanceAvailable = financeHasRows && Math.abs(finiteNumber(financeTotals.acceptance,0)) > 0
  const financeAcquiringAvailable = financeHasRows && Math.abs(finiteNumber(financeTotals.acquiring,0)) > 0
  const storageSource = financeStorageAvailable ? 'finance_report' : availability.paidStorage ? 'paid_storage_report' : 'manual'
  const acceptanceSource = financeAcceptanceAvailable ? 'finance_report' : availability.acceptance ? 'acceptance_report' : 'not_loaded'
  const acquiringSource = financeAcquiringAvailable ? 'finance_report' : availability.acquiring ? 'acquiring_report' : 'not_loaded'
  const manualStorageExpense = Math.max(0, settings.storageMonthly * periodFactor)
  const sharedFixedExpenses = Math.max(0, settings.fixedMonthly * periodFactor)

  let totalRevenue = 0
  let totalSales = 0
  let totalReturns = 0
  let totalOrders = orders.length
  const totalStock = resolvedStockQuantity
  for (const item of productMap.values()) {
    totalRevenue += item.revenue
    totalSales += item.salesCount
    totalReturns += item.returnsCount
  }

  const sortedByRevenue = [...productMap.values()].sort((a, b) => b.revenue - a.revenue)
  let cumulativeRevenue = 0
  const positiveRevenue = Math.max(0, sortedByRevenue.reduce((sum, item) => sum + Math.max(0, item.revenue), 0))
  for (const item of sortedByRevenue) {
    const shareBefore = positiveRevenue > 0 ? cumulativeRevenue / positiveRevenue : 1
    item.abc = item.revenue <= 0 ? 'C' : shareBefore < 0.8 ? 'A' : shareBefore < 0.95 ? 'B' : 'C'
    cumulativeRevenue += Math.max(0, item.revenue)
  }

  const products = sortedByRevenue.map(item => {
    const netUnits = Math.max(0, item.salesCount - item.returnsCount)
    const averagePrice = netUnits > 0 ? Math.max(0, item.revenue) / netUnits : 0
    const costKeyCandidates = [item.key, String(item.nmID || ''), item.vendorCode].filter(Boolean)
    let unitCost = 0
    for (const key of costKeyCandidates) {
      if (settings.productCosts[key] != null) { unitCost = finiteNumber(settings.productCosts[key], 0); break }
    }
    if (!unitCost && settings.defaultCostPercent > 0 && averagePrice > 0) unitCost = averagePrice * settings.defaultCostPercent / 100
    const hasCost = unitCost > 0
    const cogs = unitCost * netUnits
    const revenueShare = positiveRevenue > 0 ? Math.max(0, item.revenue) / positiveRevenue : 0
    const manualCommission = Math.max(0, item.revenue) * settings.commissionPercent / 100
    const manualLogistics = item.salesCount * settings.logisticsPerSale
    const commission = financeHasRows
      ? item.financeCommission + unallocatedFinance.commission * revenueShare
      : manualCommission
    const logistics = financeHasRows
      ? item.financeLogistics + unallocatedFinance.logistics * revenueShare
      : manualLogistics
    const storage = financeStorageAvailable
      ? item.financeStorage + unallocatedFinance.storage * revenueShare
      : availability.paidStorage
        ? item.detailStorage + unallocatedPaidStorage * revenueShare
        : manualStorageExpense * revenueShare
    const acceptance = financeAcceptanceAvailable
      ? item.financeAcceptance + unallocatedFinance.acceptance * revenueShare
      : availability.acceptance
        ? item.detailAcceptance + unallocatedAcceptance * revenueShare
        : 0
    const acquiring = financeAcquiringAvailable
      ? item.financeAcquiring + unallocatedFinance.acquiring * revenueShare
      : availability.acquiring
        ? item.detailAcquiring + unallocatedAcquiring * revenueShare
        : 0
    const penalties = financeHasRows ? item.financePenalties + unallocatedFinance.penalties * revenueShare : 0
    const deductions = financeHasRows ? item.financeDeductions + unallocatedFinance.deductions * revenueShare : 0
    const additionalPayment = financeHasRows ? item.financeAdditionalPayment + unallocatedFinance.additionalPayment * revenueShare : 0
    const sellerPayable = financeHasRows ? item.financeSellerPayable : 0
    const tax = Math.max(0, item.revenue) * settings.taxPercent / 100
    const unallocatedAdvertising = Math.max(0, advertisingExpense - resolvedMappedAdvertisingSpend)
    const allocatedAdvertising = Math.max(0, item.adSpend) * mappedAdvertisingScale + unallocatedAdvertising * revenueShare
    const allocatedFixed = sharedFixedExpenses * revenueShare
    const expenses = cogs + commission + tax + logistics + storage + acceptance + acquiring + penalties + deductions + allocatedAdvertising + allocatedFixed - additionalPayment
    const profit = hasCost ? item.revenue - expenses : null
    const margin = profit != null && item.revenue > 0 ? profit / item.revenue * 100 : null
    const dailyAverage = item.salesCount / periodDays
    const stockCoverDays = availability.stockDetails && dailyAverage > 0 ? item.stock / dailyAverage : null
    const values = [...dailyMap.keys()].map(day => item.dailySales[day] || 0)
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
    const cv = mean > 0 ? Math.sqrt(variance) / mean : null
    const xyz = cv == null ? 'Z' : cv <= 0.5 ? 'X' : cv <= 1 ? 'Y' : 'Z'
    const returnRate = item.salesCount > 0 ? item.returnsCount / item.salesCount * 100 : 0
    const breakevenPrice = hasCost && netUnits > 0 ? expenses / netUnits : null
    const targetDenominator = 1 - settings.targetMarginPercent / 100
    const targetPrice = breakevenPrice != null && targetDenominator > 0 ? breakevenPrice / targetDenominator : null
    const frozenMoney = availability.stockDetails && item.salesCount === 0 && item.stock > 0 ? item.stock * (unitCost || averagePrice * 0.5) : 0

    const activeModeNames = ['FBS','FBO'].filter(mode => {
      const bucket = item.modeStats[mode]
      return item.fulfillmentModes[mode] || bucket.orders || bucket.sales || bucket.returns || bucket.stock || Math.abs(bucket.revenue) > 0
    })
    const fulfillmentLabel = activeModeNames.length === 2 ? 'FBS + FBO' : activeModeNames[0] || 'Не определено'
    const modeWeightTotal = activeModeNames.reduce((sum,mode) => {
      const bucket = item.modeStats[mode]
      return sum + Math.max(0, bucket.revenue) + Math.max(0, bucket.sales) * Math.max(1, averagePrice)
    },0)
    const modeBreakdown = Object.fromEntries(['FBS','FBO'].map(mode => {
      const bucket = item.modeStats[mode]
      const observedWeight = Math.max(0, bucket.revenue) + Math.max(0, bucket.sales) * Math.max(1, averagePrice)
      const share = activeModeNames.includes(mode)
        ? modeWeightTotal > 0 ? observedWeight / modeWeightTotal : 1 / Math.max(1,activeModeNames.length)
        : 0
      const observedFinanceCommission = Math.max(0,bucket.commission)
      const observedFinanceLogistics = Math.max(0,bucket.logistics)
      const observedFinanceStorage = Math.max(0,bucket.storage)
      const observedFinanceAcceptance = Math.max(0,bucket.acceptance)
      const observedFinanceAcquiring = Math.max(0,bucket.acquiring)
      const modeCommission = financeHasRows ? observedFinanceCommission + Math.max(0,commission - item.financeCommission) * share : commission * share
      const modeLogistics = financeHasRows ? observedFinanceLogistics + Math.max(0,logistics - item.financeLogistics) * share : logistics * share
      const modeStorage = financeStorageAvailable
        ? observedFinanceStorage + Math.max(0,storage - item.financeStorage) * share
        : availability.paidStorage ? Math.max(0,bucket.detailStorage) + Math.max(0,storage - item.detailStorage) * share : storage * share
      const modeAcceptance = financeAcceptanceAvailable
        ? observedFinanceAcceptance + Math.max(0,acceptance - item.financeAcceptance) * share
        : availability.acceptance ? Math.max(0,bucket.detailAcceptance) + Math.max(0,acceptance - item.detailAcceptance) * share : acceptance * share
      const modeAcquiring = financeAcquiringAvailable
        ? observedFinanceAcquiring + Math.max(0,acquiring - item.financeAcquiring) * share
        : availability.acquiring ? Math.max(0,bucket.detailAcquiring) + Math.max(0,acquiring - item.detailAcquiring) * share : acquiring * share
      const modePenalties = financeHasRows ? Math.max(0,bucket.penalties) + Math.max(0,penalties - item.financePenalties) * share : 0
      const modeDeductions = financeHasRows ? Math.max(0,bucket.deductions) + Math.max(0,deductions - item.financeDeductions) * share : 0
      const modeAdditional = financeHasRows ? bucket.additionalPayment + (additionalPayment - item.financeAdditionalPayment) * share : 0
      const modeCogs = cogs * share
      const modeTax = tax * share
      const modeAdvertising = allocatedAdvertising * share
      const modeFixed = allocatedFixed * share
      const modeExpenses = modeCogs + modeCommission + modeLogistics + modeStorage + modeAcceptance + modeAcquiring + modePenalties + modeDeductions + modeTax + modeAdvertising + modeFixed - modeAdditional
      const modeRevenue = bucket.revenue || item.revenue * share
      const modeProfit = hasCost && share > 0 ? modeRevenue - modeExpenses : null
      return [mode, {
        mode,
        active:activeModeNames.includes(mode),
        orders:Math.round(bucket.orders || 0), sales:Math.round(bucket.sales || 0), returns:Math.round(bucket.returns || 0), stock:Math.round(bucket.stock || 0),
        revenue:Math.round(modeRevenue || 0), commission:Math.round(modeCommission), logistics:Math.round(modeLogistics), storage:Math.round(modeStorage),
        acceptance:Math.round(modeAcceptance), acquiring:Math.round(modeAcquiring), penalties:Math.round(modePenalties), deductions:Math.round(modeDeductions),
        additionalPayment:Math.round(modeAdditional), expenses:Math.round(modeExpenses), profit:modeProfit == null ? null : Math.round(modeProfit),
        margin:modeProfit != null && modeRevenue > 0 ? Math.round(modeProfit / modeRevenue * 1000) / 10 : null,
      }]
    }))

    let stockStatus = availability.stockDetails ? 'В наличии' : (availability.stocks ? 'Детализация ожидается' : 'Не загружено')
    if (availability.stockDetails && item.stock <= 0) stockStatus = 'Нет остатка'
    else if (availability.stockDetails && stockCoverDays != null && stockCoverDays < 14) stockStatus = 'Заканчивается'
    else if (availability.stockDetails && stockCoverDays != null && stockCoverDays > 120) stockStatus = 'Избыток'
    else if (availability.stockDetails && item.salesCount === 0 && item.stock > 20) stockStatus = 'Без движения'

    let recommendation = availability.stockDetails ? 'Контролировать динамику' : (availability.stocks ? 'Восстановить детализацию остатков WB' : 'Дождаться загрузки остатков WB')
    if (availability.stockDetails && item.stock <= 0 && item.salesCount > 0) recommendation = 'Срочно пополнить остаток'
    else if (availability.stockDetails && stockCoverDays != null && stockCoverDays < 14) recommendation = 'Запланировать поставку'
    else if (availability.stockDetails && item.salesCount === 0 && item.stock > 20) recommendation = 'Проверить цену и запустить распродажу'
    else if (returnRate >= 20 && item.salesCount >= 3) recommendation = 'Проверить карточку и причины возвратов'
    else if (profit != null && profit < 0) recommendation = 'Повысить цену или сократить расходы'
    else if (item.abc === 'A' && stockCoverDays != null && stockCoverDays < 30) recommendation = 'Сохранить цену и пополнить запас'

    return {
      ...item,
      fulfillmentMode:fulfillmentLabel,
      modeBreakdown,
      fbsStock:Math.round(item.modeStats.FBS.stock || 0),
      fboStock:Math.round(item.modeStats.FBO.stock || 0),
      revenue: Math.round(item.revenue),
      stock: availability.stockDetails ? Math.round(item.stock) : null,
      stockAvailable: availability.stockDetails,
      netUnits,
      averagePrice: Math.round(averagePrice),
      unitCost: Math.round(unitCost * 100) / 100,
      cogs: Math.round(cogs),
      commission: Math.round(commission),
      logistics: Math.round(logistics),
      storage: Math.round(storage),
      acceptance: Math.round(acceptance),
      acquiring: Math.round(acquiring),
      penalties: Math.round(penalties),
      deductions: Math.round(deductions),
      additionalPayment: Math.round(additionalPayment),
      sellerPayable: Math.round(sellerPayable),
      tax: Math.round(tax),
      advertising: Math.round(allocatedAdvertising),
      fixedExpenses: Math.round(allocatedFixed),
      sharedExpenses: Math.round(allocatedFixed),
      expenses: Math.round(expenses),
      financeSource:financeHasRows ? 'wb_finance_api' : 'manual_fallback',
      storageSource,
      acceptanceSource,
      acquiringSource,
      adViews: Math.round(item.adViews || 0),
      adClicks: Math.round(item.adClicks || 0),
      adOrders: Math.round(item.adOrders || 0),
      adRevenue: Math.round(item.adRevenue || 0),
      adCampaignIds: Array.isArray(item.adCampaignIds) ? item.adCampaignIds : [],
      profit: profit == null ? null : Math.round(profit),
      margin: margin == null ? null : Math.round(margin * 10) / 10,
      stockCoverDays: stockCoverDays == null ? null : Math.round(stockCoverDays),
      returnRate: Math.round(returnRate * 10) / 10,
      xyz,
      stockStatus,
      recommendation,
      frozenMoney: Math.round(frozenMoney),
      breakevenPrice: breakevenPrice == null ? null : Math.round(breakevenPrice),
      targetPrice: targetPrice == null ? null : Math.round(targetPrice),
      peakPrice: targetPrice == null ? null : Math.round(targetPrice * 1.15),
    }
  })

  const totals = products.reduce((acc, item) => {
    for (const field of ['cogs','commission','logistics','storage','acceptance','acquiring','penalties','deductions','additionalPayment','tax','advertising','fixedExpenses']) {
      acc[field] += Number(item[field] || 0)
    }
    return acc
  }, { cogs:0, commission:0, logistics:0, storage:0, acceptance:0, acquiring:0, penalties:0, deductions:0, additionalPayment:0, tax:0, advertising:0, fixedExpenses:0 })
  const tax = totals.tax
  const costConfigured = products.some(item => item.unitCost > 0)
  const operatingProfit = costConfigured
    ? totalRevenue - totals.cogs - totals.commission - totals.logistics - totals.storage - totals.acceptance - totals.acquiring - totals.penalties - totals.deductions - totals.tax - totals.advertising - totals.fixedExpenses + totals.additionalPayment
    : null
  const margin = operatingProfit != null && totalRevenue > 0 ? operatingProfit / totalRevenue * 100 : null
  const averageDailySales = totalSales / periodDays
  const stockCoverDays = averageDailySales > 0 ? totalStock / averageDailySales : null

  const fulfillment = {
    products:{ FBS:products.filter(item => item.fulfillmentMode === 'FBS').length, FBO:products.filter(item => item.fulfillmentMode === 'FBO').length, both:products.filter(item => item.fulfillmentMode === 'FBS + FBO').length, unknown:products.filter(item => item.fulfillmentMode === 'Не определено').length },
    FBS:{ orders:0,sales:0,returns:0,stock:0,revenue:0,expenses:0,profit:costConfigured?0:null },
    FBO:{ orders:0,sales:0,returns:0,stock:0,revenue:0,expenses:0,profit:costConfigured?0:null },
  }
  for (const item of products) {
    for (const mode of ['FBS','FBO']) {
      const row = item.modeBreakdown?.[mode]
      if (!row?.active) continue
      for (const field of ['orders','sales','returns','stock','revenue','expenses']) fulfillment[mode][field] += Number(row[field] || 0)
      if (costConfigured && row.profit != null) fulfillment[mode].profit += Number(row.profit || 0)
    }
  }

  const recommendations = []
  const pushRecommendation = (priority, type, product, title, text, effect = '') => {
    recommendations.push({ id: `${type}:${product?.key || recommendations.length}`, priority, type, productKey: product?.key || null, title, text, effect })
  }
  for (const item of products) {
    if (availability.stockDetails && item.stock <= 0 && item.salesCount > 0) pushRecommendation(1, 'stock', item, `Пополнить «${item.title}»`, `За выбранные ${periodDays} дн. было ${item.salesCount} продаж, но текущий остаток равен нулю.`, `Риск потерять продажи`)
    else if (availability.stockDetails && item.stockCoverDays != null && item.stockCoverDays < 14) pushRecommendation(2, 'stock', item, `Запланировать поставку «${item.title}»`, `Запаса примерно на ${item.stockCoverDays} дней.`, `${item.stock} шт. на складах`)
    if (availability.stockDetails && item.salesCount === 0 && item.stock > 20) pushRecommendation(3, 'slow', item, `Разобрать неликвид «${item.title}»`, `Нет продаж за выбранные ${periodDays} дн. при остатке ${item.stock} шт.`, item.frozenMoney ? `Заморожено ≈ ${item.frozenMoney} ₽` : '')
    if (item.returnRate >= 20 && item.salesCount >= 3) pushRecommendation(2, 'quality', item, `Проверить качество «${item.title}»`, `Возвраты составляют ${item.returnRate}% от продаж.`, `${item.returnsCount} возвратов`)
    if (item.profit != null && item.profit < 0) pushRecommendation(1, 'price', item, `Исправить экономику «${item.title}»`, `Расчётная прибыль отрицательная: ${item.profit} ₽.`, item.breakevenPrice ? `Цена в 0: ${item.breakevenPrice} ₽` : '')
  }
  recommendations.sort((a, b) => a.priority - b.priority)

  const stockDetailMap = new Map()
  if (availability.stockDetails) {
    for (const row of stocks) {
      const product = resolveProduct(row)
      if (!product) continue
      const warehouseName = String(row?.warehouseName || row?.warehouse || 'Все склады').trim() || 'Все склады'
      const techSize = String(row?.techSize || row?.sizeName || row?.size || '—').trim() || '—'
      const barcode = productBarcodes(row)[0] || ''
      const chrtId = productChrtIds(row)[0] || ''
      const detailKey = [product.key, chrtId, barcode, techSize, warehouseName].join('|')
      const quantity = Math.max(0, firstNumber(row, ['quantity','quantityFull','stock','stockCount','totalQuantity','availableQuantity'], 0))
      const current = stockDetailMap.get(detailKey) || {
        key:detailKey, nmID:product.nmID || productNmIds(row)[0] || null,
        vendorCode:product.vendorCode || productVendorCodes(row)[0] || '', title:product.title || row?.subjectName || 'Товар',
        brand:product.brand || row?.brand || '', chrtId, barcode, techSize, warehouseName, quantity:0,
      }
      current.quantity += quantity
      stockDetailMap.set(detailKey, current)
    }
  }

  const categoryMap = new Map()
  for (const item of products) {
    const key = item.brand || 'Без бренда'
    const current = categoryMap.get(key) || { name: key, revenue: 0, sales: 0, stock: 0, profit: 0 }
    current.revenue += item.revenue
    current.sales += item.salesCount
    current.stock += Number(item.stock || 0)
    if (item.profit != null) current.profit += item.profit
    categoryMap.set(key, current)
  }

  return {
    periodDays,
    period: explicitPeriodFrom && explicitPeriodTo ? { from:explicitPeriodFrom, to:explicitPeriodTo, days:periodDays } : null,
    periodCoverage:data?.__periodCoverage || null,
    generatedAt: new Date().toISOString(),
    summary: {
      revenue: availability.sales ? Math.round(totalRevenue) : null,
      orders: availability.orders ? totalOrders : null,
      sales: availability.sales ? totalSales : null,
      returns: availability.sales ? totalReturns : null,
      returnRate: availability.sales ? (totalSales > 0 ? Math.round(totalReturns / totalSales * 1000) / 10 : 0) : null,
      stockUnits: availability.stocks ? Math.round(totalStock) : null,
      activeProducts: products.length,
      zeroStock: availability.stockDetails ? products.filter(item => item.stock <= 0).length : null,
      lowStock: availability.stockDetails ? products.filter(item => item.stockStatus === 'Заканчивается').length : null,
      slowStock: availability.stockDetails ? products.filter(item => ['Избыток', 'Без движения'].includes(item.stockStatus)).length : null,
      stockCoverDays: stockCoverDays == null ? null : Math.round(stockCoverDays),
      cogs: costConfigured ? Math.round(totals.cogs) : null,
      commission: Math.round(totals.commission),
      commissionSource: financeHasRows ? 'wb_api' : 'manual',
      logistics: Math.round(totals.logistics),
      logisticsSource: financeHasRows ? 'wb_api' : 'manual',
      advertising: Math.round(totals.advertising),
      advertisingSource: availability.advertising && advertisingStatsAvailable ? 'wb_api' : 'manual',
      storage: Math.round(totals.storage),
      storageSource,
      acceptance: Math.round(totals.acceptance),
      acceptanceSource,
      acquiring: Math.round(totals.acquiring),
      acquiringSource,
      penalties: Math.round(totals.penalties),
      deductions: Math.round(totals.deductions),
      additionalPayment: Math.round(totals.additionalPayment),
      sellerBalance: financeData?.balance || null,
      fixed: Math.round(totals.fixedExpenses),
      tax: Math.round(tax),
      operatingProfit: operatingProfit == null ? null : Math.round(operatingProfit),
      margin: margin == null ? null : Math.round(margin * 10) / 10,
    },
    settings,
    availability,
    engagement:{
      searchQueries:data?.searchQueries || {rows:[],totalRows:0,complete:false},
      stockHistory:data?.stockHistory || {rows:[],totalRows:0,complete:false},
      reviews:data?.reviews || {rows:[],totalRows:0,complete:false},
      questions:data?.questions || {rows:[],totalRows:0,complete:false},
      chats:data?.chats || {rows:[],totalRows:0,complete:false},
    },
    stageStatus,
    stockMeta: stockMeta ? {
      ...stockMeta,
      persistedRows: stocks.length,
      calculatedQuantity: Math.round(rawStockQuantity),
      mappedRows: mappedStockRows,
      mappedProducts: products.filter(item => Number(item.stockRows || 0) > 0).length,
      mappedQuantity: Math.round(mappedStockQuantity),
      unmatchedQuantity: Math.max(0, Math.round(rawStockQuantity - mappedStockQuantity)),
      unmatchedRows: unmatchedStockRows,
      mappingCoveragePercent: rawStockQuantity > 0 ? Math.round(mappedStockQuantity / rawStockQuantity * 1000) / 10 : 100,
      matchMethods: stockMatchMethods,
      reportIdentityCounts: {
        nmIds: new Set(stocks.flatMap(productNmIds)).size,
        barcodes: new Set(stocks.flatMap(productBarcodes)).size,
        vendorCodes: new Set(stocks.flatMap(productVendorCodes).map(cleanVendorIdentity)).size,
        chrtIds: new Set(stocks.flatMap(productChrtIds)).size,
      },
      catalogIdentityCounts: {
        nmIds: new Set(rawProducts.flatMap(productNmIds)).size,
        barcodes: new Set(rawProducts.flatMap(productBarcodes)).size,
        vendorCodes: new Set(rawProducts.flatMap(productVendorCodes).map(cleanVendorIdentity)).size,
        chrtIds: new Set(rawProducts.flatMap(productChrtIds)).size,
      },
      fboRows:fboStocks.length,
      sellerRows:sellerStocks.length,
      fboQuantity:Math.round(fboStocks.reduce((sum,row) => sum + Math.max(0,firstNumber(row,['quantity','amount','stock'],0)),0)),
      sellerQuantity:Math.round(sellerStocks.reduce((sum,row) => sum + Math.max(0,firstNumber(row,['quantity','amount','stock'],0)),0)),
      detailsAvailable: availability.stockDetails,
      needsCatalogRefresh: rawStockQuantity > 0 && mappedStockRows === 0,
      needsIdentifierRefresh: false,
      legacySnapshot: Number(stockMeta?.schemaVersion || 0) < STOCK_DATA_SCHEMA_VERSION,
      consistent: stocks.length > 0
        ? Math.round(rawStockQuantity) === Math.round(metaStockQuantity)
        : metaStockQuantity === 0,
    } : null,
    advertising: {
      campaigns: rawCampaigns,
      productRows: campaignProductRows,
      totals: advertisingData.totals || {},
      daily: Array.isArray(advertisingData.daily) ? advertisingData.daily : [],
      period: advertisingData.period || null,
      truncated: Boolean(advertisingData.truncated),
      totalCampaigns: advertisingData.totalCampaigns || rawCampaigns.length,
      statsAvailable: advertisingStatsAvailable,
      statsLoadedCampaigns: Number(advertisingData?.statsLoadedCampaigns || rawCampaigns.filter(item => item?.statsStatus === 'loaded').length),
      statsPendingCampaigns: Number(advertisingData?.statsPendingCampaigns || rawCampaigns.filter(item => item?.statsStatus !== 'loaded').length),
      meta: advertisingData?.meta || null,
      mappedProductRows: campaignProductRows.filter(row => row.mapped).length,
      source: availability.advertising ? 'wb_api' : 'manual',
    },
    finance: {
      rows: financeRows,
      totals: financeTotals,
      balance: financeData?.balance || null,
      period: financeData?.period || null,
      complete: financeData?.complete !== false,
      sources:{ commission:financeHasRows?'finance_report':'manual', logistics:financeHasRows?'finance_report':'manual', storage:storageSource, acceptance:acceptanceSource, acquiring:acquiringSource },
      dedicated:{ paidStorageRows:paidStorageRows.length, acceptanceRows:acceptanceRows.length, acquiringRows:acquiringRows.length },
    },
    fulfillment,
    products,
    dailyTrend: [...dailyMap.values()].map(row => ({ ...row, revenue: Math.round(row.revenue) })),
    warehouses: [...warehouses.entries()].map(([name, quantity]) => ({ name, quantity: Math.round(quantity) })).sort((a, b) => b.quantity - a.quantity),
    stockDetails: [...stockDetailMap.values()].map(item => ({ ...item, quantity:Math.round(item.quantity) })).sort((a,b) => b.quantity - a.quantity),
    unmatchedStockDetails: unmatchedStockDetails.sort((a,b) => b.quantity - a.quantity),
    categories: [...categoryMap.values()].sort((a, b) => b.revenue - a.revenue),
    recommendations: recommendations.slice(0, 30),
    syncWarnings: Array.isArray(data.syncWarnings) ? data.syncWarnings : [],
  }
}

async function loadProducts(token, { limit = 100, maxPages = 300, deadlineAt = 0 } = {}) {
  const endpoint = 'https://content-api.wildberries.ru/content/v2/get/cards/list'
  const products = []
  const rawPages = []
  let cursor = { limit }

  for (let page = 0; page < maxPages; page += 1) {
    const payload = await wbFetch(endpoint, token, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify({ settings:{ cursor, filter:{ withPhoto:-1 } } }),
      label:'Товары WB', timeoutMs:45000, maxAttempts:2, maxRetryDelayMs:10000, deadlineAt,
    })
    rawPages.push(payload)
    const normalized = normalizeCatalogPageStrict(payload)
    products.push(...normalized.products)
    if (normalized.rawCount < limit || !normalized.cursor.updatedAt || !normalized.cursor.nmID) break
    cursor = { limit, updatedAt:normalized.cursor.updatedAt, nmID:Number(normalized.cursor.nmID) }
    await sleep(700)
  }
  const validation = validateCatalogStrict(products)
  return { value:products, rawPayload:rawPages, validation, endpoint }
}

async function loadSellerStocks(token, products = [], { deadlineAt = 0 } = {}) {
  const warehouseEndpoint = 'https://marketplace-api.wildberries.ru/api/v3/warehouses'
  const warehouses = await wbFetch(warehouseEndpoint, token, {
    label:'Склады продавца FBS', timeoutMs:30000, maxAttempts:2, maxRetryDelayMs:3000, deadlineAt,
  })
  const sellerWarehouses = Array.isArray(warehouses) ? warehouses : []
  // С 05.08.2026 уже созданные СГТ-склады (cargoType=2) остаются доступными на чтение.
  // ELISEI не сверяет их со справочником /api/v3/offices и не выполняет POST/PUT управления складами.
  const warehousePolicy = sellerWarehouseReadSummary(sellerWarehouses)
  const chrtIds = uniqueIdentities((Array.isArray(products) ? products : []).flatMap(productChrtIds), cleanNumericIdentity).map(Number).filter(Number.isFinite)
  if (!sellerWarehouses.length || !chrtIds.length) {
    return {
      value:[],
      rawPayload:{ warehouses:sellerWarehouses, stocks:[], warehousePolicy },
      validation:{ warehouses:sellerWarehouses.length, chrtIds:chrtIds.length, rows:0, ...warehousePolicy },
      endpoint:warehouseEndpoint,
    }
  }
  const rows = []
  const rawStocks = []
  for (const warehouse of sellerWarehouses) {
    const warehouseId = Number(warehouse?.id ?? warehouse?.ID ?? warehouse?.warehouseId)
    if (!Number.isFinite(warehouseId)) continue
    for (let offset=0; offset<chrtIds.length; offset+=1000) {
      const batch = chrtIds.slice(offset,offset+1000)
      const endpoint = `https://marketplace-api.wildberries.ru/api/v3/stocks/${warehouseId}`
      const payload = await wbFetch(endpoint, token, {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ chrtIds:batch }),
        label:`Остатки FBS · ${warehouse?.name || warehouseId}`, timeoutMs:30000, maxAttempts:2, maxRetryDelayMs:3000, deadlineAt,
      })
      rawStocks.push({ warehouse, payload })
      for (const stock of Array.isArray(payload?.stocks) ? payload.stocks : []) {
        rows.push({
          ...stock,
          chrtId:stock?.chrtId,
          quantity:Math.max(0,Number(stock?.amount || 0)),
          amount:Math.max(0,Number(stock?.amount || 0)),
          warehouseId,
          warehouseName:String(warehouse?.name || `Склад продавца ${warehouseId}`),
          warehouseCargoType:Number.isFinite(Number(warehouse?.cargoType)) ? Number(warehouse.cargoType) : null,
          warehouseManagement:Number(warehouse?.cargoType) === WB_API_POLICY.sellerWarehouses.sgtCargoType ? 'seller-cabinet-only' : 'api-supported',
          fulfillmentMode:'FBS',
          stockScheme:'FBS',
          source:'marketplace_seller_stock',
        })
      }
      if (offset + 1000 < chrtIds.length) await sleep(250)
    }
  }
  return {
    value:rows,
    rawPayload:{ warehouses:sellerWarehouses, stocks:rawStocks, warehousePolicy },
    validation:{
      warehouses:sellerWarehouses.length, chrtIds:chrtIds.length, rows:rows.length,
      totalQuantity:rows.reduce((sum,row)=>sum+Number(row.quantity||0),0),
      ...warehousePolicy,
    },
    endpoint:'https://marketplace-api.wildberries.ru/api/v3/stocks/{warehouseId}',
  }
}

function firstDefined(sources = [], keys = [], fallback = null) {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue
    for (const key of keys) {
      const value = source?.[key]
      if (value !== undefined && value !== null && String(value).trim() !== '') return value
    }
  }
  return fallback
}

function warehouseIdentitySources(item = {}) {
  return [
    item,
    item?.product,
    item?.nomenclature,
    item?.good,
    item?.card,
    item?.item,
    item?.info,
    item?.productInfo,
  ].filter(value => value && typeof value === 'object' && !Array.isArray(value))
}

function warehouseArrayFrom(item = {}) {
  for (const key of ['warehouses', 'warehouseRemains', 'warehouse_remains', 'stocks', 'offices', 'warehouseStocks']) {
    if (Array.isArray(item?.[key])) return item[key]
  }
  return []
}

function looksLikeWarehouseRemainsItem(node = {}) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false
  const sources = warehouseIdentitySources(node)
  const hasIdentity = firstDefined(sources, [
    'nmId','nmID','nm_id','nmIDValue','vendorCode','vendor_code','supplierArticle','supplier_article',
    'article','barcode','barCode','bar_code','sku',
  ], '') !== ''
  const hasWarehouses = warehouseArrayFrom(node).length > 0 || [
    'warehouses','warehouseRemains','warehouse_remains','stocks','offices','warehouseStocks',
  ].some(key => Array.isArray(node?.[key]))
  const hasFlatQuantity = firstDefined([node], [
    'quantity','quantityFull','quantity_full','stock','stockCount','stock_count','totalQuantity','total_quantity',
    'availableQuantity','available_quantity','readyForSaleQuantity','ready_for_sale_quantity','amount',
  ], null) != null
  return hasIdentity && (hasWarehouses || hasFlatQuantity)
}

function extractWarehouseRemainsItems(payload) {
  const output = []
  const seenObjects = new Set()
  const seenRows = new Set()
  const wrapperKeys = new Set(['data','result','items','rows','report','content','payload','response','products','goods','nomenclatures'])

  const push = row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return
    const sources = warehouseIdentitySources(row)
    const signature = [
      firstDefined(sources, ['nmId','nmID','nm_id'], ''),
      firstDefined(sources, ['vendorCode','vendor_code','supplierArticle','supplier_article','article'], ''),
      firstDefined(sources, ['barcode','barCode','bar_code','sku'], ''),
      firstDefined(sources, ['techSize','tech_size','sizeName','size_name','size','wbSize','wb_size'], ''),
    ].map(cleanIdentity).join('|')
    const key = `${signature}|${output.length}`
    if (seenRows.has(key)) return
    seenRows.add(key)
    output.push(row)
  }

  const walk = node => {
    if (!node) return
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (typeof node !== 'object' || seenObjects.has(node)) return
    seenObjects.add(node)

    if (looksLikeWarehouseRemainsItem(node)) {
      push(node)
      return
    }

    for (const [key, value] of Object.entries(node)) {
      if (!value || typeof value !== 'object') continue
      if (wrapperKeys.has(key) || Array.isArray(value)) walk(value)
    }
  }

  walk(payload)
  return output
}

function describeWarehouseRemainsPayload(payload) {
  const rootType = Array.isArray(payload) ? 'array' : payload === null ? 'null' : typeof payload
  const rootKeys = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? Object.keys(payload).slice(0, 20)
    : []
  const first = Array.isArray(payload) ? payload[0] : payload?.data?.[0] || payload?.result?.[0] || payload?.items?.[0] || null
  return {
    rootType,
    rootKeys,
    firstItemKeys: first && typeof first === 'object' ? Object.keys(first).slice(0, 30) : [],
  }
}

function normalizeWarehouseRemains(report) {
  const rows = []
  const items = extractWarehouseRemainsItems(report)
  const quantityFrom = row => firstNumber(row, [
    'quantity','quantityFull','quantity_full','stock','stockCount','stock_count','totalQuantity','total_quantity',
    'availableQuantity','available_quantity','readyForSaleQuantity','ready_for_sale_quantity','amount',
  ], 0)

  const normalizeRow = (item = {}, warehouse = null) => {
    const sources = warehouseIdentitySources(item)
    const warehouseSources = warehouseIdentitySources(warehouse || {})
    return {
      nmId: firstDefined([...sources, ...warehouseSources], ['nmId','nmID','nm_id','nmIDValue'], null),
      vendorCode: firstDefined([...sources, ...warehouseSources], [
        'vendorCode','vendor_code','supplierArticle','supplier_article','article','sellerArticle','seller_article',
      ], ''),
      chrtId: firstDefined([...sources, ...warehouseSources], [
        'chrtId','chrtID','chrt_id','chrtid','sizeId','size_id',
      ], null),
      barcode: firstDefined([...sources, ...warehouseSources], [
        'barcode','barCode','bar_code','sku','skus',
      ], ''),
      techSize: firstDefined([...sources, ...warehouseSources], [
        'techSize','tech_size','sizeName','size_name','size','wbSize','wb_size',
      ], ''),
      brand: firstDefined(sources, ['brand','brandName','brand_name'], ''),
      subjectName: firstDefined(sources, ['subjectName','subject_name','subject','category'], ''),
      warehouseName: String(firstDefined([warehouse || {}, item], [
        'warehouseName','warehouse_name','warehouse','officeName','office_name','name',
      ], 'Все склады')).trim() || 'Все склады',
      quantity: Math.max(0, Number(quantityFrom(warehouse || item)) || 0),
    }
  }

  for (const item of items) {
    const warehouses = warehouseArrayFrom(item)
    const physical = warehouses.filter(row => {
      const name = String(firstDefined([row], ['warehouseName','warehouse_name','warehouse','officeName','office_name','name'], '')).trim().toLowerCase()
      return name && name !== 'всего находится на складах' && name !== 'итого' && !name.includes('в пути')
    })
    const aggregate = warehouses.filter(row => {
      const name = String(firstDefined([row], ['warehouseName','warehouse_name','warehouse','officeName','office_name','name'], '')).trim().toLowerCase()
      return name === 'всего находится на складах' || name === 'итого'
    })
    const source = physical.length ? physical : aggregate

    if (source.length) {
      for (const warehouse of source) rows.push(normalizeRow(item, warehouse))
      continue
    }

    // Неразмерный товар или плоский вариант отчёта: идентификаторы остаются на строке товара.
    rows.push(normalizeRow(item))
  }
  return rows
}

function stockIdentityCounts(rows = []) {
  const normalized = Array.isArray(rows) ? rows : []
  return {
    nmIds: new Set(normalized.flatMap(productNmIds)).size,
    barcodes: new Set(normalized.flatMap(productBarcodes)).size,
    vendorCodes: new Set(normalized.flatMap(productVendorCodes).map(cleanVendorIdentity).filter(Boolean)).size,
  }
}

function validateWarehouseRemainsSnapshot(rows, meta, rawPayload) {
  const counts = stockIdentityCounts(rows)
  if (Number(meta?.totalQuantity || 0) > 0 && counts.nmIds === 0 && counts.barcodes === 0 && counts.vendorCodes === 0) {
    const error = Object.assign(new Error('Отчёт остатков WB содержит количество, но идентификаторы товаров не распознаны. Снимок не сохранён, чтобы не потерять распределение по артикулам.'), {
      status: 502,
      code: 'WB_STOCK_IDENTIFIERS_MISSING',
      payloadShape: describeWarehouseRemainsPayload(rawPayload),
    })
    throw error
  }
  return counts
}

async function downloadWarehouseRemainsReport(token, taskId, { deadlineAt = 0 } = {}) {
  const base = 'https://seller-analytics-api.wildberries.ru/api/v1/warehouse_remains'
  const endpoint = `${base}/tasks/${encodeURIComponent(taskId)}/download`
  const rawPayload = await wbFetch(endpoint, token, {
    label:'Загрузка отчёта остатков WB', timeoutMs:60000, maxAttempts:1, maxRetryDelayMs:0, deadlineAt,
  })
  const normalized = normalizeWarehouseRemainsStrict(rawPayload)
  const stockMeta = {
    ...normalized.meta,
    taskId,
    parserVersion:5,
  }
  validateWarehouseRemainsStrict(normalized.rows, stockMeta)
  return {
    rows:normalized.rows,
    stockMeta,
    rawPayload,
    endpoint,
    validation:{ identityCounts:stockMeta.identityCounts, totalQuantity:stockMeta.totalQuantity, sourceRows:normalized.sourceRows },
  }
}

function stageDataKey(stage) {
  return stage === 'advertising' ? 'advertising' : stage
}

function previousStageValue(data, stage) {
  const value = data?.[stageDataKey(stage)]
  if (stage === 'advertising') return value && typeof value === 'object' ? value : { campaigns: [], totals: {}, period: null }
  if (stage === 'finance') return value && typeof value === 'object' ? value : { rows:[], totals:{}, period:null, balance:null, complete:true }
  if (stage === 'acquiring') return value && typeof value === 'object' ? value : { rows:[], totals:{}, period:null, complete:true }
  if (EXTENDED_OBJECT_STAGES.has(stage)) return value && typeof value === 'object' && !Array.isArray(value) ? value : { rows:[], totalRows:0, complete:true }
  return Array.isArray(value) ? value : []
}

function stageCount(stage, value) {
  if (stage === 'advertising') return Array.isArray(value?.campaigns) ? value.campaigns.length : 0
  if (stage === 'finance' || stage === 'acquiring') return Array.isArray(value?.rows) ? value.rows.length : 0
  if (EXTENDED_OBJECT_STAGES.has(stage)) return Number(value?.totalRows ?? (Array.isArray(value?.rows) ? value.rows.length : 0)) || 0
  return Array.isArray(value) ? value.length : 0
}

function statisticRowKey(kind, row, index = 0) {
  const explicit = row?.srid ?? row?.rid ?? row?.odid ?? row?.saleID ?? row?.sticker
  if (explicit != null && String(explicit).trim()) return `${kind}:${String(explicit).trim()}`
  return [
    kind,
    row?.gNumber || '',
    row?.nmId ?? row?.nmID ?? '',
    row?.barcode || '',
    row?.date || row?.saleDate || row?.orderDate || '',
    index,
  ].join(':')
}

function mergeStatisticsRows(kind, previousRows, incomingRows) {
  const map = new Map()
  const cutoff = Date.now() - 95 * 86400000
  const add = (row, index) => {
    const eventDate = Date.parse(row?.date || row?.saleDate || row?.orderDate || row?.lastChangeDate || '')
    if (Number.isFinite(eventDate) && eventDate < cutoff) return
    map.set(statisticRowKey(kind, row, index), row)
  }
  ;(Array.isArray(previousRows) ? previousRows : []).forEach(add)
  ;(Array.isArray(incomingRows) ? incomingRows : []).forEach(add)
  return [...map.values()].sort((a, b) => Date.parse(b?.lastChangeDate || b?.date || '') - Date.parse(a?.lastChangeDate || a?.date || ''))
}

function incrementalDateFrom(previousRows) {
  const latest = (Array.isArray(previousRows) ? previousRows : []).reduce((max, row) => {
    const value = Date.parse(row?.lastChangeDate || row?.date || '')
    return Number.isFinite(value) ? Math.max(max, value) : max
  }, 0)
  // Небольшое перекрытие защищает от пограничных обновлений и поздних изменений статуса.
  return latest ? new Date(Math.max(Date.now() - 95 * 86400000, latest - 60 * 60000)).toISOString() : isoDaysAgo(30)
}

async function loadStatisticsRows(kind, token, { deadlineAt = 0, previousRows = [], dateFromOverride = '' } = {}) {
  const endpointName = kind === 'orders' ? 'orders' : 'sales'
  const label = kind === 'orders' ? 'Заказы WB' : 'Продажи WB'
  const overrideDate = /^\d{4}-\d{2}-\d{2}$/.test(String(dateFromOverride || '').slice(0,10))
    ? String(dateFromOverride).slice(0,10)
    : ''
  // Daily Ready может обнаружить дырку именно во вчерашнем дне, хотя более новые
  // строки уже существуют. Обычный incrementalDateFrom тогда начнёт слишком поздно.
  // Берём сутки запаса до целевой даты и восстанавливаем пропущенный диапазон.
  const dateFrom = overrideDate
    ? `${shiftIsoDate(overrideDate,-1)}T00:00:00.000Z`
    : incrementalDateFrom(previousRows)
  const endpoint = `https://statistics-api.wildberries.ru/api/v1/supplier/${endpointName}?dateFrom=${encodeURIComponent(dateFrom)}&flag=0`
  const rawPayload = await wbFetch(endpoint, token, {
    label, timeoutMs:45000, maxAttempts:1, maxRetryDelayMs:0, deadlineAt,
  })
  const incoming = Array.isArray(rawPayload) ? rawPayload : []
  return {
    value:mergeStatisticsRows(kind, previousRows, incoming),
    rawPayload,
    validation:{ incomingRows:incoming.length, dateFrom, dailyReadyRecoveryDate:overrideDate || null },
    endpoint,
  }
}

function collectCampaignNmIds(node, output = []) {
  if (!node) return output
  if (Array.isArray(node)) { node.forEach(item => collectCampaignNmIds(item, output)); return output }
  if (typeof node !== 'object') return output
  for (const [key, value] of Object.entries(node)) {
    if (['nms','nmIds','nm_ids'].includes(key) && Array.isArray(value)) output.push(...value)
    if (['nmId','nmID','nm_id','nm'].includes(key) && (typeof value === 'number' || typeof value === 'string')) output.push(value)
    if (value && typeof value === 'object') collectCampaignNmIds(value, output)
  }
  return uniqueIdentities(output, cleanNumericIdentity)
}

function normalizeCampaignList(payload) {
  const result = []
  const seen = new Set()
  const push = (row, inherited = {}) => {
    const advertId = Number(row?.advertId ?? row?.advert_id ?? row?.id)
    if (!Number.isFinite(advertId) || seen.has(advertId)) return
    seen.add(advertId)
    const nmIds = collectCampaignNmIds(row, [])
    result.push({
      advertId,
      name: row?.name || row?.advertName || row?.campaignName || `Кампания ${advertId}`,
      status: Number(row?.status ?? inherited.status ?? 0),
      type: Number(row?.type ?? inherited.type ?? 0),
      paymentType: row?.payment_type || row?.paymentType || inherited.paymentType || '',
      changeTime: row?.changeTime || row?.change_time || null,
      nmIds,
    })
  }
  const walk = (node, inherited = {}) => {
    if (!node) return
    if (Array.isArray(node)) { node.forEach(item => walk(item, inherited)); return }
    if (typeof node !== 'object') return
    const next = {
      status: node.status ?? inherited.status,
      type: node.type ?? inherited.type,
      paymentType: node.payment_type ?? inherited.paymentType,
    }
    if (node.advertId != null || node.advert_id != null || (node.id != null && (node.status != null || node.name))) push(node, next)
    if (Array.isArray(node.advert_list)) node.advert_list.forEach(item => push(item, next))
    if (Array.isArray(node.adverts)) node.adverts.forEach(item => walk(item, next))
    if (Array.isArray(node.items)) node.items.forEach(item => walk(item, next))
  }
  walk(payload)
  return result
}

const AD_METRIC_ALIASES = {
  views: ['views','view','impressions','shows'],
  clicks: ['clicks','click'],
  sum: ['sum','spend','expense','expenses','cost'],
  atbs: ['atbs','addToBasket','add_to_basket'],
  orders: ['orders','ordersCount','order_count'],
  shks: ['shks','sales','salesCount','sale_count'],
  sum_price: ['sum_price','sumPrice','revenue','salesRevenue'],
  orders_price: ['orders_price','ordersPrice','orderRevenue','order_revenue'],
}
const AD_METRIC_KEYS = Object.keys(AD_METRIC_ALIASES)

function directNumericAlias(row, aliases = []) {
  for (const key of aliases) {
    const value = Number(row?.[key])
    if (Number.isFinite(value)) return value
  }
  return null
}

function deepMetricValue(node, aliases = []) {
  if (!node || typeof node !== 'object') return 0
  const direct = directNumericAlias(node, aliases)
  if (direct != null) return direct
  let total = 0
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) total += value.reduce((sum, child) => sum + deepMetricValue(child, aliases), 0)
    else if (value && typeof value === 'object') total += deepMetricValue(value, aliases)
  }
  return total
}

function numericMetric(row, key) {
  return deepMetricValue(row, AD_METRIC_ALIASES[key] || [key])
}

function collectNmAdStats(node, output = []) {
  if (!node) return output
  if (Array.isArray(node)) { node.forEach(item => collectNmAdStats(item, output)); return output }
  if (typeof node !== 'object') return output
  if (node.nmId != null || node.nmID != null || node.nm_id != null || (node.nm != null && typeof node.nm !== 'object')) output.push(node)
  for (const value of Object.values(node)) if (value && typeof value === 'object') collectNmAdStats(value, output)
  return output
}

function normalizeAdvertisingStats(payload, campaigns) {
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.adverts) ? payload.adverts : Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.result) ? payload.result : []
  const statsById = new Map()
  for (const row of rows) {
    const advertId = Number(row?.advertId ?? row?.advert_id ?? row?.id)
    if (!Number.isFinite(advertId)) continue
    const productRows = collectNmAdStats(row, [])
    const directHasMetrics = AD_METRIC_KEYS.some(key => directNumericAlias(row, AD_METRIC_ALIASES[key]) != null)
    const source = productRows.length ? productRows : directHasMetrics ? [row] : []
    const metrics = source.reduce((acc, item) => {
      for (const key of AD_METRIC_KEYS) acc[key] += numericMetric(item, key)
      return acc
    }, Object.fromEntries(AD_METRIC_KEYS.map(key => [key, 0])))

    const nmMap = new Map()
    for (const item of productRows) {
      const nmId = Number(item.nmId ?? item.nmID ?? item.nm_id ?? item.nm) || null
      if (!nmId) continue
      const current = nmMap.get(nmId) || { nmId, name:item.name || item.title || '', views:0, clicks:0, spend:0, orders:0, revenue:0 }
      current.views += numericMetric(item, 'views')
      current.clicks += numericMetric(item, 'clicks')
      current.spend += numericMetric(item, 'sum')
      current.orders += numericMetric(item, 'orders')
      current.revenue += numericMetric(item, 'orders_price') || numericMetric(item, 'sum_price')
      nmMap.set(nmId, current)
    }
    statsById.set(advertId, { ...metrics, nmStats:[...nmMap.values()] })
  }

  const normalized = campaigns.map(campaign => {
    const stats = statsById.get(campaign.advertId) || Object.fromEntries(AD_METRIC_KEYS.map(key => [key, 0]))
    const spend = Number(stats.sum || 0)
    const views = Number(stats.views || 0)
    const clicks = Number(stats.clicks || 0)
    const orders = Number(stats.orders || 0)
    const revenue = Number(stats.orders_price || stats.sum_price || 0)
    const statNmIds = Array.isArray(stats.nmStats) ? stats.nmStats.map(item => item.nmId).filter(Boolean) : []
    return {
      ...campaign,
      nmIds: uniqueIdentities([...(campaign.nmIds || []), ...statNmIds], cleanNumericIdentity),
      views, clicks, spend, orders, revenue,
      ctr: views > 0 ? clicks / views * 100 : null,
      cpc: clicks > 0 ? spend / clicks : null,
      crr: revenue > 0 ? spend / revenue * 100 : null,
      nmStats: stats.nmStats || [],
    }
  })
  const totals = normalized.reduce((acc, item) => {
    acc.views += item.views; acc.clicks += item.clicks; acc.spend += item.spend; acc.orders += item.orders; acc.revenue += item.revenue
    return acc
  }, { views: 0, clicks: 0, spend: 0, orders: 0, revenue: 0 })
  totals.ctr = totals.views > 0 ? totals.clicks / totals.views * 100 : null
  totals.cpc = totals.clicks > 0 ? totals.spend / totals.clicks : null
  totals.crr = totals.revenue > 0 ? totals.spend / totals.revenue * 100 : null
  return { campaigns: normalized, totals }
}


function buildAdvertisingMeta(value = {}) {
  const campaigns = Array.isArray(value?.campaigns) ? value.campaigns : []
  const campaignsWithStats = campaigns.filter(item => item?.statsStatus === 'loaded').length
  return {
    schemaVersion: 1,
    source: 'wb_promotion_api',
    campaigns: campaigns.length,
    campaignsWithStats,
    totalSpend: Math.round(Number(value?.totals?.spend || 0) * 100) / 100,
    period: value?.period || null,
    receivedAt: new Date().toISOString(),
  }
}

async function loadAdvertising(token, { deadlineAt = 0, previous = {}, period = null } = {}) {
  const campaignEndpoint = 'https://advert-api.wildberries.ru/api/advert/v2/adverts?statuses=4,7,8,9,11'
  const campaignPayload = await wbFetch(campaignEndpoint, token, {
    label:'Кампании WB', timeoutMs:45000, maxAttempts:1, maxRetryDelayMs:0, deadlineAt,
  })
  const allCampaigns = normalizeCampaignListStrict(campaignPayload)
  const statusPriority = status => ({ 9:0, 11:1, 4:2, 7:3, 8:4 }[Number(status)] ?? 9)
  const campaigns = [...allCampaigns].sort((a,b) => statusPriority(a.status)-statusPriority(b.status) || Date.parse(b.changeTime || 0)-Date.parse(a.changeTime || 0))

  const defaultPeriod = reportPeriod(30)
  const selectedPeriod = period && (period.dateFrom || period.from) && (period.dateTo || period.to)
    ? {
        beginDate:dateKey(period.dateFrom || period.from),
        endDate:dateKey(period.dateTo || period.to),
        days:Number(period.days || 30),
        requestedFrom:period.requestedFrom || null,
        requestedTo:period.requestedTo || null,
        limited:Boolean(period.limited),
      }
    : { beginDate:defaultPeriod.dateFrom,endDate:defaultPeriod.dateTo,days:defaultPeriod.days }
  const previousFrom=dateKey(previous?.period?.beginDate || previous?.period?.from || previous?.period?.dateFrom)
  const previousTo=dateKey(previous?.period?.endDate || previous?.period?.to || previous?.period?.dateTo)
  const previousForPeriod=previousFrom===selectedPeriod.beginDate && previousTo===selectedPeriod.endDate ? previous : {}

  if (!campaigns.length) {
    const value = mergeAdvertisingSnapshot({ previous:previousForPeriod, campaigns:[], requestedIds:[], period:selectedPeriod })
    value.meta = buildAdvertisingMeta(value)
    return { value, rawPayload:{ campaigns:campaignPayload, stats:[] }, validation:{ campaigns:0, statsRows:0 }, endpoint:campaignEndpoint }
  }

  const batchSize = 50
  const previousOffset = Math.max(0, Number(previousForPeriod?.meta?.nextStatsOffset || period?.nextStatsOffset || 0))
  const offset = previousOffset >= campaigns.length ? 0 : previousOffset
  const batch = campaigns.slice(offset, offset + batchSize)
  const requestedIds = batch.map(item => String(item.advertId))
  const endDate = selectedPeriod.endDate
  const beginDate = selectedPeriod.beginDate
  const statsEndpoint = `https://advert-api.wildberries.ru/adv/v3/fullstats?ids=${encodeURIComponent(requestedIds.join(','))}&beginDate=${beginDate}&endDate=${endDate}`
  const statsPayload = requestedIds.length ? await wbFetch(statsEndpoint, token, {
    label:'Статистика рекламы WB', timeoutMs:60000, maxAttempts:1, maxRetryDelayMs:0, deadlineAt,
  }) : []
  const statsByAdvertId = normalizeFullStatsStrict(statsPayload)
  const value = mergeAdvertisingSnapshot({
    previous:previousForPeriod,
    campaigns,
    statsByAdvertId,
    requestedIds,
    period:selectedPeriod,
  })
  const nextStatsOffset = offset + batch.length >= campaigns.length ? 0 : offset + batch.length
  value.meta = {
    ...buildAdvertisingMeta(value),
    nextStatsOffset,
    requestedCampaigns:requestedIds.length,
    statsResponseCampaigns:statsByAdvertId.size,
    allCampaigns:campaigns.length,
  }
  return {
    value,
    rawPayload:{ campaigns:campaignPayload, stats:statsPayload },
    validation:{ campaigns:campaigns.length, requestedCampaigns:requestedIds.length, statsResponseCampaigns:statsByAdvertId.size, nextStatsOffset },
    endpoint:`${campaignEndpoint} + ${statsEndpoint}`,
  }
}


function reportPeriod(days = 30) {
  const end = new Date()
  const start = new Date(end.getTime() - (Math.max(1, days) - 1) * 86400000)
  return { dateFrom:start.toISOString().slice(0,10), dateTo:end.toISOString().slice(0,10), days:Math.max(1, days) }
}

function reportRowKey(stream, row = {}, index = 0) {
  if (stream === 'finance' || stream === 'acquiring') {
    const rrd = row.rrdId ?? row.rrd_id
    if (rrd != null && String(rrd).trim()) return `${stream}:rrd:${rrd}`
    return [stream,row.srid || '',row.nmId ?? row.nm_id ?? '',row.docTypeName || row.doc_type_name || '',row.rrDate || row.rr_dt || row.saleDate || row.sale_dt || '',index].join(':')
  }
  if (stream === 'paidStorage') return [stream,row.date || '',row.originalDate || '',row.nmId ?? row.nmID ?? '',row.chrtId ?? '',row.barcode || '',row.warehouse || '',index].join(':')
  if (stream === 'acceptance') return [stream,row.incomeId ?? '',row.nmID ?? row.nmId ?? '',row.shkCreateDate || '',index].join(':')
  return `${stream}:${index}`
}

function mergeReportRows(stream, previousRows = [], incomingRows = []) {
  const map = new Map()
  ;(Array.isArray(previousRows) ? previousRows : []).forEach((row,index) => map.set(reportRowKey(stream,row,index), row))
  ;(Array.isArray(incomingRows) ? incomingRows : []).forEach((row,index) => map.set(reportRowKey(stream,row,index), row))
  return [...map.values()]
}

function fieldNumber(row = {}, aliases = [], fallback = 0) {
  for (const key of aliases) {
    const value = Number(row?.[key])
    if (Number.isFinite(value)) return value
  }
  return fallback
}

function financeSign(row = {}) {
  if (row?.__aggregated) return 1
  const text = String(row.docTypeName || row.doc_type_name || row.sellerOperName || row.supplier_oper_name || '').toLowerCase()
  return text.includes('возврат') || text.includes('сторно') ? -1 : 1
}

function financeCommissionAmount(row = {}) {
  if (row?.__aggregated) return Math.abs(fieldNumber(row,['commissionAmount'],0))
  // В новом Finance API фактическое вознаграждение WB — vw + НДС (vwNds).
  // ppvzSalesCommission оставляем fallback для старых/неполных ответов, чтобы не удваивать комиссию.
  const vw = fieldNumber(row,['vw','ppvzVw','ppvz_vw'],Number.NaN)
  const vat = Math.abs(fieldNumber(row,['vwNds','vw_nds','ppvzVwNds','ppvz_vw_nds'],0))
  if (Number.isFinite(vw)) return Math.abs(vw) + vat
  return Math.abs(fieldNumber(row,['ppvzSalesCommission','ppvz_sales_commission'],0)) + vat
}

function financeRowAmounts(row = {}) {
  if (row?.__aggregated) {
    return {
      grossRevenue: fieldNumber(row,['grossRevenueAmount'],0),
      sellerPayable: fieldNumber(row,['sellerPayableAmount'],0),
      commission: Math.abs(fieldNumber(row,['commissionAmount'],0)),
      logistics: Math.abs(fieldNumber(row,['logisticsAmount'],0)),
      logisticsRebill: Math.abs(fieldNumber(row,['logisticsRebillAmount'],0)),
      storage: Math.abs(fieldNumber(row,['storageAmount'],0)),
      acceptance: Math.abs(fieldNumber(row,['acceptanceAmount'],0)),
      acquiring: Math.abs(fieldNumber(row,['acquiringAmount'],0)),
      penalties: Math.abs(fieldNumber(row,['penaltiesAmount'],0)),
      deductions: Math.abs(fieldNumber(row,['deductionsAmount'],0)),
      additionalPayment: fieldNumber(row,['additionalPaymentAmount'],0),
    }
  }
  const sign = financeSign(row)
  return {
    grossRevenue: sign * Math.abs(fieldNumber(row,['retailPriceWithDiscRub','retail_price_withdisc_rub','retailAmount','retail_amount'],0)),
    sellerPayable: sign * Math.abs(fieldNumber(row,['forPay','for_pay','ppvzForPay','ppvz_for_pay'],0)),
    commission: financeCommissionAmount(row),
    logistics: Math.abs(fieldNumber(row,['deliveryRub','delivery_rub','deliveryService','delivery_service'],0)),
    logisticsRebill: Math.abs(fieldNumber(row,['rebillLogisticCost','rebill_logistic_cost'],0)),
    storage: Math.abs(fieldNumber(row,['paidStorage','paid_storage','storageFee','storage_fee'],0)),
    acceptance: Math.abs(fieldNumber(row,['paidAcceptance','paid_acceptance','acceptance'],0)),
    acquiring: Math.abs(fieldNumber(row,['acquiringFee','acquiring_fee'],0)),
    penalties: Math.abs(fieldNumber(row,['penalty'],0)),
    deductions: Math.abs(fieldNumber(row,['deduction'],0)),
    additionalPayment: fieldNumber(row,['additionalPayment','additional_payment'],0),
  }
}

function summarizeFinanceRows(rows = []) {
  const totals = {
    grossRevenue:0, sellerPayable:0, commission:0, logistics:0, storage:0, acceptance:0,
    acquiring:0, penalties:0, deductions:0, additionalPayment:0, logisticsRebill:0,
  }
  for (const row of Array.isArray(rows) ? rows : []) {
    const amounts = financeRowAmounts(row)
    for (const key of Object.keys(totals)) totals[key] += Number(amounts[key] || 0)
  }
  return Object.fromEntries(Object.entries(totals).map(([key,value]) => [key,Math.round(value*100)/100]))
}

function rawFinanceRowKey(stream, row = {}, index = 0) {
  const rrd = row.rrdId ?? row.rrd_id
  if (rrd != null && String(rrd).trim()) return `${stream}:rrd:${rrd}`
  const stable = [
    stream,
    row.srid || row.rid || '',
    row.nmId ?? row.nm_id ?? row.nmID ?? '',
    row.saName || row.sa_name || row.supplierArticle || row.vendorCode || '',
    row.docTypeName || row.doc_type_name || row.sellerOperName || '',
    row.rrDate || row.rr_dt || row.saleDate || row.sale_dt || row.date || '',
    row.barcode || '',
  ].join(':')
  return `${stable}:${crypto.createHash('sha1').update(JSON.stringify(row)).digest('hex').slice(0,16)}:${index}`
}

function rawGeneratedReportKey(stream, row = {}, index = 0) {
  if (stream === 'paidStorage') {
    return [stream,row.date || '',row.originalDate || '',row.nmId ?? row.nmID ?? '',row.chrtId ?? '',row.barcode || '',row.warehouse || '',index].join(':')
  }
  if (stream === 'acceptance') {
    return [stream,row.incomeId ?? '',row.nmID ?? row.nmId ?? '',row.shkCreateDate || row.date || '',row.barcode || '',index].join(':')
  }
  return rawFinanceRowKey(stream,row,index)
}

function compactIdentity(row = {}) {
  return {
    nmId: row.nmId ?? row.nm_id ?? row.nmID ?? null,
    vendorCode: String(row.saName || row.sa_name || row.supplierArticle || row.vendorCode || row.vendor_code || ''),
    barcode: String(row.barcode || row.sku || ''),
    srid: String(row.srid || row.rid || ''),
    fulfillmentMode: String(row.fulfillmentMode || row.deliveryMethod || row.delivery_method || row.warehouseType || row.warehouse_type || '').toUpperCase(),
  }
}

function compactAggregateKey(stream, row = {}) {
  const id = compactIdentity(row)
  const mode = id.fulfillmentMode.includes('FBS') || id.fulfillmentMode.includes('ПРОДАВ') ? 'FBS'
    : id.fulfillmentMode.includes('FBO') || id.fulfillmentMode.includes('FBW') || id.fulfillmentMode.includes('WB') ? 'FBO'
    : ''
  return [stream,id.nmId || '',id.vendorCode,id.barcode,mode].join('|')
}

async function aggregatePersistedHeavyRows(connectionId, stream, syncId) {
  const aggregates = new Map()
  let afterKey = ''
  while (true) {
    const page = await loadStreamItemPage(pool, { connectionId, stream, syncId, afterKey, limit:1000 })
    if (!page.length) break
    for (const record of page) {
      const row = record.payload || {}
      const key = compactAggregateKey(stream,row)
      const id = compactIdentity(row)
      let target = aggregates.get(key)
      if (!target) {
        target = {
          __aggregated:true,
          nmId:id.nmId,
          vendorCode:id.vendorCode,
          barcode:id.barcode,
          fulfillmentMode:id.fulfillmentMode,
          rowCount:0,
        }
        if (stream === 'finance') Object.assign(target, {
          grossRevenueAmount:0,sellerPayableAmount:0,commissionAmount:0,logisticsAmount:0,
          logisticsRebillAmount:0,storageAmount:0,acceptanceAmount:0,acquiringAmount:0,
          penaltiesAmount:0,deductionsAmount:0,additionalPaymentAmount:0,
        })
        if (stream === 'acquiring') target.acquiringFee = 0
        if (stream === 'paidStorage') target.warehousePrice = 0
        if (stream === 'acceptance') target.total = 0
        aggregates.set(key,target)
      }
      target.rowCount += 1
      if (stream === 'finance') {
        const amounts = financeRowAmounts(row)
        target.grossRevenueAmount += amounts.grossRevenue
        target.sellerPayableAmount += amounts.sellerPayable
        target.commissionAmount += amounts.commission
        target.logisticsAmount += amounts.logistics
        target.logisticsRebillAmount += amounts.logisticsRebill
        target.storageAmount += amounts.storage
        target.acceptanceAmount += amounts.acceptance
        target.acquiringAmount += amounts.acquiring
        target.penaltiesAmount += amounts.penalties
        target.deductionsAmount += amounts.deductions
        target.additionalPaymentAmount += amounts.additionalPayment
      } else if (stream === 'acquiring') {
        target.acquiringFee += Math.abs(fieldNumber(row,['acquiringFee','acquiring_fee'],0))
      } else if (stream === 'paidStorage') {
        target.warehousePrice += Math.abs(fieldNumber(row,['warehousePrice','warehouse_price'],0))
        target.fulfillmentMode = 'FBO'
      } else if (stream === 'acceptance') {
        target.total += Math.abs(fieldNumber(row,['total'],0))
        target.fulfillmentMode = 'FBO'
      }
    }
    afterKey = page.at(-1).row_key
    if (page.length < 1000) break
  }
  return [...aggregates.values()]
}

function financeRequestBody(period, rrdId) {
  const cursor = /^\d+$/.test(String(rrdId || '0')) ? String(rrdId || '0') : '0'
  return `{"dateFrom":${JSON.stringify(period.dateFrom)},"dateTo":${JSON.stringify(period.dateTo)},"limit":${FINANCE_PAGE_LIMIT},"rrdId":${cursor},"period":"daily"}`
}

async function financeCompactSnapshot(connectionId, stage, syncId, period, {
  complete = false,
  cursor = '0',
  persistedCount = 0,
  tokenInfo = null,
  pageNumber = 0,
  balance = null,
} = {}) {
  const compactRows = await aggregatePersistedHeavyRows(connectionId,stage,syncId)
  const totals = stage === 'finance'
    ? summarizeFinanceRows(compactRows)
    : { acquiring:Math.round(compactRows.reduce((sum,row)=>sum+Math.abs(fieldNumber(row,['acquiringFee'],0)),0)*100)/100 }
  const value = {
    rows:compactRows,totalRows:Number(persistedCount || 0),totals,period,balance:stage === 'finance' ? balance : null,complete:Boolean(complete),
    lastRrdId:String(cursor || '0'),rawRowCount:Number(persistedCount || 0),storage:'wb_stream_items',
    progress:financeProgressCopy({ tokenInfo:financeRuntimeTokenInfo(tokenInfo),rows:persistedCount,page:pageNumber,nextAllowedAt:null,pageLimit:FINANCE_PAGE_LIMIT }),
  }
  await saveStreamData(pool,{ connectionId,stream:stage,payload:value,metadata:{period,syncId,cursor:String(cursor || '0'),complete:Boolean(complete)},source:complete?'sync':'partial-sync' })
  return value
}

async function deriveAcquiringSnapshot(connectionId, period) {
  const params=[connectionId,period.dateFrom,period.dateTo]
  const result=await pool.query(`
    SELECT source_report_id AS "reportId",source_rrd_id AS "rrdId",operation_date AS "operationDate",
      nm_id AS "nmId",vendor_code AS "vendorCode",srid,fulfillment_mode AS "fulfillmentMode",
      payment_processing AS "paymentProcessing",currency,operation_group AS "operationGroup",
      detail_only AS "detailOnly",amount::float8 AS amount
    FROM wb_finance_ledger
    WHERE connection_id=$1 AND source_stream='finance' AND operation_group='acquiring'
      AND operation_date >= $2::date AND operation_date <= $3::date
    ORDER BY operation_date DESC NULLS LAST,updated_at DESC
  `,params)
  const derived=deriveAcquiringFromLedgerRows(result.rows)
  const total=derived.reduce((sum,row)=>sum+Math.abs(Number(row.acquiringFee||0)),0)
  const preview=derived.slice(0,500)
  return {
    rows:preview,totalRows:derived.length,totals:{acquiring:Math.round(total*100)/100},period,complete:true,
    derivedFrom:'finance',vatBreakdownAvailable:false,
    note:'Эквайринг подтверждён строками детализации реализации. Отдельная разбивка НДС показывается только если тип текущего ключа поддерживает соответствующий метод WB; для основной экономики второй ключ не требуется.',
  }
}

async function advancePagedFinanceTask(stage, connectionId, token, state, { deadlineAt = 0, tokenInfo = null } = {}) {
  const isFinance = stage === 'finance'
  const period = state?.metadata?.period || reportPeriod(30)

  if (!isFinance && !isPrivilegedFinanceToken(tokenInfo)) {
    const [financeStored,financeState] = await Promise.all([
      pool.query('SELECT payload,row_count FROM wb_stream_data WHERE connection_id=$1 AND stream=\'finance\'',[connectionId]),
      pool.query('SELECT status,last_count,next_allowed_at FROM wb_sync_states WHERE connection_id=$1 AND stage=\'finance\'',[connectionId]),
    ])
    const financePayload=financeStored.rows[0]?.payload || null
    const financeComplete=financePayload?.complete === true || financeState.rows[0]?.status === 'success'
    const value=await deriveAcquiringSnapshot(connectionId,period)
    if (!financeComplete) {
      value.complete=false
      value.note='Эквайринг будет рассчитан из финансовой детализации после завершения потока «Финансы WB». Ноль пока не подтверждён.'
      const nextAllowedAt=financeState.rows[0]?.next_allowed_at || new Date(Date.now()+15*60*1000).toISOString()
      await saveStreamData(pool,{connectionId,stream:'acquiring',payload:value,metadata:{period,derivedFrom:'finance',complete:false,nextAllowedAt},source:'partial-derived-finance'})
      return {pending:true,partialValue:value,nextAllowedAt,metadata:{period,persistedCount:value.totalRows,pageNumber:0,derivedFrom:'finance',waitingForFinance:true}}
    }
    await saveStreamData(pool,{connectionId,stream:'acquiring',payload:value,metadata:{period,derivedFrom:'finance',complete:true},source:'derived-finance'})
    return {
      pending:false,value,
      validation:{derivedFrom:'finance',rows:value.totalRows,period,vatBreakdownAvailable:false,accessConfirmed:true},
      endpoint:'derived://finance-ledger/acquiring',
    }
  }

  const syncId = String(state?.metadata?.syncId || crypto.randomUUID())
  const rrdId = String(state?.metadata?.rrdId || '0')
  const pageNumber = Number(state?.metadata?.pageNumber || 0)
  const endpoint = isFinance
    ? 'https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed'
    : 'https://finance-api.wildberries.ru/api/finance/v1/acquiring/detailed'
  const payload = await wbFetch(endpoint, token, {
    method:'POST',
    body:financeRequestBody(period,rrdId),
    headers:{ 'Content-Type':'application/json' },
    label:isFinance ? 'Финансовая детализация WB' : 'Эквайринг WB',
    timeoutMs:90000,maxAttempts:1,maxRetryDelayMs:0,deadlineAt,
    preserveInt64Fields:['rrdId','reportId','giId','shkId'],
  })
  const incoming = Array.isArray(payload) ? payload : []
  await saveStreamItemBatch(pool, {
    connectionId,stream:stage,syncId,rows:incoming,
    keyOf:(row,index)=>rawFinanceRowKey(stage,row,index),batchSize:HEAVY_DB_BATCH_SIZE,
  })
  await persistFinanceLedgerBatch(pool, {
    connectionId,stream:stage,rows:incoming,
    keyOf:(row,index)=>rawFinanceRowKey(stage,row,index),batchSize:HEAVY_DB_BATCH_SIZE,
  })
  const continuation=financeContinuation({incomingRows:incoming,previousRrdId:rrdId})
  const persistedCount = await countStreamItems(pool,{connectionId,stream:stage,syncId})
  if (!continuation.complete) {
    const nextAllowedAt=new Date(Date.now()+financePageCooldownMs(financeRuntimeTokenInfo(tokenInfo))).toISOString()
    const partialValue=await financeCompactSnapshot(connectionId,stage,syncId,period,{
      complete:false,cursor:continuation.nextRrdId,persistedCount,tokenInfo,pageNumber:pageNumber+1,
    })
    partialValue.progress.nextAllowedAt=nextAllowedAt
    await saveStreamData(pool,{connectionId,stream:stage,payload:partialValue,metadata:{period,syncId,cursor:continuation.nextRrdId,complete:false,nextAllowedAt},source:'partial-sync'})
    return {
      pending:true,
      nextAllowedAt,
      partialValue,
      metadata:{
        period,syncId,rrdId:continuation.nextRrdId,pageNumber:pageNumber+1,persistedCount,lastPageRows:incoming.length,
        accessConfirmed:true,cursorReason:continuation.reason,
        ...financeProgressCopy({tokenInfo:financeRuntimeTokenInfo(tokenInfo),rows:persistedCount,page:pageNumber+1,nextAllowedAt,pageLimit:FINANCE_PAGE_LIMIT}),
      },
    }
  }

  let balance = state?.metadata?.balance || null
  if (isFinance) {
    try {
      balance = await wbFetch('https://finance-api.wildberries.ru/api/v1/account/balance', token, {
        label:'Баланс WB',timeoutMs:20000,maxAttempts:1,maxRetryDelayMs:0,deadlineAt,
      })
    } catch (error) { console.warn('WB balance skipped:',error.message) }
  }
  const value=await financeCompactSnapshot(connectionId,stage,syncId,period,{
    complete:true,cursor:continuation.nextRrdId,persistedCount,tokenInfo,pageNumber:pageNumber+1,balance,
  })
  await finalizeStreamItems(pool,{connectionId,stream:stage,syncId})
  return {
    pending:false,
    value,
    validation:{
      incomingRows:incoming.length,persistedRows:persistedCount,compactRows:value.rows.length,period,pages:pageNumber+1,
      memorySafe:true,cursorComplete:true,cursorReason:continuation.reason,accessConfirmed:true,
      tokenMode:isPrivilegedFinanceToken(tokenInfo)?'privileged':'base',
    },
    endpoint,
  }
}

const FINANCE_REPORT_LISTS = Object.freeze({
  financeReports:{
    endpoint:'https://finance-api.wildberries.ru/api/finance/v1/sales-reports/list',
    label:'Сводки отчётов реализации WB', periodDays:365, pageSize:1000, includePeriod:true,
  },
  acquiringReports:{
    endpoint:'https://finance-api.wildberries.ru/api/finance/v1/acquiring/list',
    label:'Сводки отчётов эквайринга WB', periodDays:365, pageSize:1000, includePeriod:false,
  },
})

async function advanceFinanceReportListTask(stage, connectionId, token, state, { deadlineAt = 0, tokenInfo = null } = {}) {
  const definition = FINANCE_REPORT_LISTS[stage]
  if (!definition) throw new Error(`Неизвестный список финансовых отчётов WB: ${stage}`)
  // Методы списка доступны Персональному/Сервисному токену. Облачный ELISEI
  // принимает Сервисный токен; для других типов оставляем понятный статус вместо ложного нуля.
  if (![3,4].includes(Number(tokenInfo?.typeId || 0))) {
    throw Object.assign(new Error(`${definition.label}: WB разрешает этот метод только Персональному или Сервисному токену. Для облачного ELISEI подключите Сервисный токен после регистрации приложения.`), { status:403, code:'WB_FINANCE_REPORT_TOKEN_TYPE' })
  }
  const period = state?.metadata?.period || reportPeriod(definition.periodDays)
  const syncId = String(state?.metadata?.syncId || crypto.randomUUID())
  const offset = Math.max(0,Number(state?.metadata?.offset || 0))
  const pageNumber = Math.max(0,Number(state?.metadata?.pageNumber || 0))
  const body = { dateFrom:period.dateFrom,dateTo:period.dateTo,limit:definition.pageSize,offset }
  if (definition.includePeriod) body.period = 'daily'
  const payload = await wbFetch(definition.endpoint,token,{
    method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json'},
    label:definition.label,timeoutMs:45000,maxAttempts:1,maxRetryDelayMs:0,deadlineAt,
  })
  const rows = Array.isArray(payload) ? payload : extractExtendedRows(payload,['reports','items'])
  await saveStreamItemBatch(pool,{
    connectionId,stream:stage,syncId,rows,
    keyOf:(row,index)=>extendedRowKey(stage,row,offset+index),batchSize:HEAVY_DB_BATCH_SIZE,
  })
  const persistedCount = await countStreamItems(pool,{connectionId,stream:stage,syncId})
  const hasMore = rows.length >= definition.pageSize
  if (hasMore) {
    return {
      pending:true,nextAllowedAt:new Date(Date.now()+HEAVY_STAGE_COOLDOWN_MS).toISOString(),
      metadata:{period,syncId,offset:offset+rows.length,pageNumber:pageNumber+1,persistedCount,lastPageRows:rows.length},
    }
  }
  await finalizeStreamItems(pool,{connectionId,stream:stage,syncId})
  return {
    pending:false,
    value:compactExtendedValue({rows,totalRows:persistedCount,syncId,period,extra:{pages:pageNumber+1,reportType:stage === 'financeReports' ? 'sales' : 'acquiring'}}),
    validation:{incomingRows:rows.length,persistedRows:persistedCount,pages:pageNumber+1,period,memorySafe:true},
    endpoint:definition.endpoint,
  }
}

const GENERATED_REPORTS = Object.freeze({
  // Используем максимально допустимые интервалы WB, чтобы не создавать лишние задания
  // и не упираться в глобальный лимитер: хранение — до 8 дней, приёмка — до 31 дня.
  paidStorage:{ base:'https://seller-analytics-api.wildberries.ru/api/v1/paid_storage', chunkDays:8, totalDays:30, label:'Платное хранение WB' },
  acceptance:{ base:'https://seller-analytics-api.wildberries.ru/api/v1/acceptance_report', chunkDays:31, totalDays:30, label:'Платная приёмка WB' },
})

function generatedReportPollDelayMs(metadata = {}) {
  const attempt = Math.max(0, Number(metadata.pollAttempts || 0))
  return [7000, 10000, 15000, 20000, 30000][Math.min(attempt, 4)]
}

function generatedReportChunks(definition) {
  const end = new Date()
  const start = new Date(end.getTime() - (definition.totalDays - 1) * 86400000)
  const chunks = []
  let cursor = new Date(start)
  while (cursor <= end) {
    const chunkEnd = new Date(Math.min(end.getTime(), cursor.getTime() + (definition.chunkDays - 1) * 86400000))
    chunks.push({ dateFrom:cursor.toISOString().slice(0,10), dateTo:chunkEnd.toISOString().slice(0,10) })
    cursor = new Date(chunkEnd.getTime() + 86400000)
  }
  return chunks
}

async function advanceGeneratedReportTask(stage, token, state, { deadlineAt = 0 } = {}) {
  const definition = GENERATED_REPORTS[stage]
  if (!definition) throw new Error(`Неизвестный отчёт WB: ${stage}`)
  const previousMetadata = state?.metadata && typeof state.metadata === 'object' ? state.metadata : {}
  const metadata = { ...previousMetadata, syncId:String(previousMetadata.syncId || crypto.randomUUID()) }
  const chunks = Array.isArray(metadata.chunks) && metadata.chunks.length ? metadata.chunks : generatedReportChunks(definition)
  const chunkIndex = Math.max(0, Math.min(chunks.length - 1, Number(metadata.chunkIndex || 0)))
  const chunk = chunks[chunkIndex]
  const taskId = state?.task_id || null
  if (!taskId) {
    const created = await wbFetch(`${definition.base}?dateFrom=${encodeURIComponent(chunk.dateFrom)}&dateTo=${encodeURIComponent(chunk.dateTo)}`, token, {
      label:`Создание отчёта «${definition.label}»`, timeoutMs:30000, maxAttempts:1, maxRetryDelayMs:0, deadlineAt,
    })
    const createdTaskId = created?.data?.taskId
    if (!createdTaskId) throw Object.assign(new Error(`${definition.label}: не получен taskId`), { status:502 })
    return {
      pending:true, taskId:createdTaskId, taskStatus:'new',
      nextAllowedAt:new Date(Date.now()+generatedReportPollDelayMs({ pollAttempts:0 })).toISOString(),
      metadata:{
        ...metadata, chunks, chunkIndex, reportFrom:chunk.dateFrom, reportTo:chunk.dateTo,
        taskCreatedAt:new Date().toISOString(), pollAttempts:0,
      },
    }
  }
  let statusPayload
  try {
    statusPayload = await wbFetch(`${definition.base}/tasks/${encodeURIComponent(taskId)}/status`, token, {
      label:`Проверка отчёта «${definition.label}»`, timeoutMs:20000, maxAttempts:1, maxRetryDelayMs:0, deadlineAt,
    })
  } catch (error) {
    // 404 означает, что taskId уже удалён/истёк. С тем же ID повторять бессмысленно.
    if (Number(error?.status) === 404) {
      error.resetTask = true
      error.message = `${definition.label}: сохранённый taskId больше не существует. ELISEI создаст новый отчёт.`
    }
    throw error
  }
  const taskStatus = String(statusPayload?.data?.status || '').toLowerCase()
  if (taskStatus === 'done') {
    const payload = await wbFetch(`${definition.base}/tasks/${encodeURIComponent(taskId)}/download`, token, {
      label:`Загрузка отчёта «${definition.label}»`, timeoutMs:60000, maxAttempts:1, maxRetryDelayMs:0, deadlineAt,
    })
    const rows = Array.isArray(payload) ? payload : []
    return {
      pending:false, rows, rawPayload:payload,
      endpoint:`${definition.base}/tasks/${taskId}/download`,
      validation:{ rows:rows.length, chunkIndex, chunks:chunks.length, ...chunk },
      moreChunks:chunkIndex + 1 < chunks.length,
      nextChunkIndex:chunkIndex + 1,
      metadata:{
        ...metadata, chunks, chunkIndex, reportFrom:chunk.dateFrom, reportTo:chunk.dateTo,
        taskCompletedAt:new Date().toISOString(), pollAttempts:0,
      },
    }
  }
  if (taskStatus === 'canceled' || taskStatus === 'purged') {
    throw Object.assign(new Error(`${definition.label}: отчёт завершён со статусом ${taskStatus}. Будет создан заново.`), { status:502, resetTask:true })
  }
  const pollAttempts = Math.max(0, Number(metadata.pollAttempts || 0)) + 1
  return {
    pending:true, taskId, taskStatus:taskStatus || 'processing',
    nextAllowedAt:new Date(Date.now()+generatedReportPollDelayMs({ pollAttempts })).toISOString(),
    metadata:{
      ...metadata, chunks, chunkIndex, reportFrom:chunk.dateFrom, reportTo:chunk.dateTo,
      taskCreatedAt:metadata.taskCreatedAt || new Date().toISOString(),
      lastStatusAt:new Date().toISOString(), pollAttempts,
    },
  }
}

async function advanceWarehouseRemainsTask(token, state, { deadlineAt = 0 } = {}) {
  const base = 'https://seller-analytics-api.wildberries.ru/api/v1/warehouse_remains'
  // Отчёт создаём сразу в детализации, необходимой для единой карточки товара.
  // Без этих groupBy WB вправе вернуть агрегат, который невозможно надёжно распределить по ШК/артикулу.
  const reportUrl = `${base}?locale=ru&groupBySa=true&groupByNm=true&groupByBarcode=true&groupBySize=true`
  const stateProfile = String(state?.metadata?.reportProfile || '')
  const taskIdFromState = stateProfile === STOCK_REPORT_PROFILE ? state?.task_id : null
  if (!taskIdFromState) {
    const created = await wbFetch(reportUrl, token, {
      label: 'Создание детального отчёта остатков WB', timeoutMs: 30000, maxAttempts: 1, maxRetryDelayMs: 0, deadlineAt,
    })
    const taskId = created?.data?.taskId
    if (!taskId) throw Object.assign(new Error('Отчёт остатков WB: не получен taskId'), { status: 502 })
    return {
      pending: true,
      taskId,
      taskStatus: 'new',
      reportProfile: STOCK_REPORT_PROFILE,
      nextAllowedAt: new Date(Date.now() + 30000).toISOString(),
    }
  }

  const taskId = taskIdFromState
  const statusPayload = await wbFetch(`${base}/tasks/${encodeURIComponent(taskId)}/status`, token, {
    label: 'Проверка отчёта остатков WB', timeoutMs: 25000, maxAttempts: 1, maxRetryDelayMs: 0, deadlineAt,
  })
  const taskStatus = String(statusPayload?.data?.status || '').toLowerCase()
  if (taskStatus === 'done') {
    const downloaded = await downloadWarehouseRemainsReport(token, taskId, { deadlineAt })
    return {
      pending:false,
      rows:downloaded.rows,
      stockMeta:downloaded.stockMeta,
      rawPayload:downloaded.rawPayload,
      endpoint:downloaded.endpoint,
      validation:downloaded.validation,
      taskId:null,
      taskStatus:'done',
    }
  }
  if (taskStatus === 'canceled' || taskStatus === 'purged') {
    throw Object.assign(new Error(`Отчёт остатков WB завершён со статусом ${taskStatus}. Будет создан новый отчёт.`), { status: 502, resetTask: true })
  }
  return { pending: true, taskId, taskStatus: taskStatus || 'processing', reportProfile:STOCK_REPORT_PROFILE, nextAllowedAt: new Date(Date.now() + 30000).toISOString() }
}

function extractExtendedRows(payload, preferredKeys = []) {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  const keys = [...preferredKeys, 'rows', 'orders', 'reports', 'report', 'documents', 'products', 'items']
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key]
    if (Array.isArray(payload?.data?.[key])) return payload.data[key]
    if (Array.isArray(payload?.result?.[key])) return payload.result[key]
  }
  if (Array.isArray(payload.data)) return payload.data
  if (Array.isArray(payload.result)) return payload.result
  return []
}

function extendedRowKey(stage, row = {}, index = 0) {
  const explicit = row.id ?? row.reportId ?? row.report_id ?? row.dimId ?? row.dim_id ?? row.orderId ?? row.order_id ?? row.rrdId ?? row.rrd_id ?? row.serviceName ?? row.srid ?? row.rid
  if (explicit != null && String(explicit).trim()) return `${stage}:id:${String(explicit).trim()}`
  const identity = [
    row.nmId ?? row.nmID ?? row.nm_id ?? '',
    row.vendorCode ?? row.vendor_code ?? row.oldVendorCode ?? '',
    row.barcode ?? row.sku ?? row.oldSku ?? '',
    row.date ?? row.dtBonus ?? row.creationTime ?? row.orderDt ?? '',
    row.amount ?? row.sum ?? row.bonusSumm ?? '',
    index,
  ].join('|')
  return `${stage}:sha:${crypto.createHash('sha1').update(identity).digest('hex')}`
}

function compactExtendedValue({ rows = [], totalRows = 0, syncId = null, period = null, extra = {} } = {}) {
  return {
    rows: Array.isArray(rows) ? rows.slice(0, 100) : [],
    totalRows: Math.max(0, Number(totalRows || 0)),
    complete: true,
    storage: syncId ? 'wb_stream_items' : 'wb_stream_data',
    syncId: syncId || null,
    period: period || null,
    ...extra,
  }
}

async function advanceFbsArchiveTask(connectionId, token, state, { deadlineAt = 0 } = {}) {
  const syncId = String(state?.metadata?.syncId || crypto.randomUUID())
  const plan = normalizeFbsArchivePlan(state?.metadata || {}, FBS_ARCHIVE_MONTHS)
  const months = plan.archiveMonths
  const monthIndex = Math.max(0, Math.min(months.length - 1, Number(state?.metadata?.monthIndex || 0)))
  const selectedMonth = months[monthIndex]
  const cursor = Math.max(0, Number(state?.metadata?.next || 0))
  const pageNumber = Math.max(0, Number(state?.metadata?.pageNumber || 0))
  const monthPageNumber = Math.max(0, Number(state?.metadata?.monthPageNumber || 0))
  const limit = 1000
  const endpoint = buildFbsArchiveUrl(selectedMonth, cursor, limit)
  const payload = await wbFetch(endpoint, token, {
    label:`Архив заказов FBS · ${String(selectedMonth.month).padStart(2,'0')}.${selectedMonth.year}`,
    timeoutMs:45000,maxAttempts:2,maxRetryDelayMs:5000,deadlineAt,
  })
  const page = parseFbsArchivePage(payload, cursor)
  const rows = page.orders
  await saveStreamItemBatch(pool, {
    connectionId,stream:'fbsArchive',syncId,rows,
    keyOf:(row,index)=>fbsArchiveOrderKey(row,index),batchSize:HEAVY_DB_BATCH_SIZE,
  })
  const persistedCount = await countStreamItems(pool,{connectionId,stream:'fbsArchive',syncId})
  const monthKey = fbsArchiveMonthKey(selectedMonth)
  const oldStats = state?.metadata?.monthStats && typeof state.metadata.monthStats === 'object' ? state.metadata.monthStats : {}
  const previousMonthRows = Math.max(0, Number(oldStats?.[monthKey]?.rows || 0))
  const monthStats = {
    ...oldStats,
    [monthKey]:{
      rows:previousMonthRows + rows.length,
      pages:monthPageNumber + 1,
      complete:page.complete,
    },
  }
  const sharedMetadata = {
    syncId,
    ...plan,
    monthStats,
    persistedCount,
    lastPageRows:rows.length,
    currentMonth:selectedMonth,
  }
  if (!page.complete) {
    return {
      pending:true,
      nextAllowedAt:new Date(Date.now()+500).toISOString(),
      metadata:{ ...sharedMetadata,next:page.next,monthIndex,pageNumber:pageNumber+1,monthPageNumber:monthPageNumber+1 },
    }
  }
  if (monthIndex + 1 < months.length) {
    return {
      pending:true,
      nextAllowedAt:new Date(Date.now()+500).toISOString(),
      metadata:{ ...sharedMetadata,next:0,monthIndex:monthIndex+1,pageNumber:pageNumber+1,monthPageNumber:0,currentMonth:months[monthIndex+1] },
    }
  }
  await finalizeStreamItems(pool,{connectionId,stream:'fbsArchive',syncId})
  const previewPage = await loadStreamItemPage(pool,{connectionId,stream:'fbsArchive',syncId,limit:100})
  const previewRows = previewPage.map(item=>item.payload)
  const completedMonths = Object.values(monthStats).filter(item=>item?.complete).length
  const coverage = {
    archiveOnly:true,
    olderThan:plan.archiveCutoff,
    newestMonth:months[0] || null,
    oldestMonth:months[months.length-1] || null,
    monthsRequested:months.length,
    monthsCompleted:completedMonths,
  }
  return {
    pending:false,
    value:compactExtendedValue({
      rows:previewRows,totalRows:persistedCount,syncId,
      extra:{next:null,pages:pageNumber+1,monthsScanned:months.length,coverage,monthStats},
    }),
    validation:{
      incomingRows:rows.length,persistedRows:persistedCount,pages:pageNumber+1,
      monthsScanned:months.length,monthsCompleted:completedMonths,archiveCutoff:plan.archiveCutoff,
      monthStats,memorySafe:true,cursorComplete:true,
    },
    endpoint,
  }
}

const OFFSET_REPORTS = Object.freeze({
  measurementPenalties:{
    endpoint:'https://seller-analytics-api.wildberries.ru/api/analytics/v1/measurement-penalties',
    label:'Штрафы за занижение габаритов', preferredKeys:['reports','items'], pageSize:1000,
  },
  deductionsReport:{
    endpoint:'https://seller-analytics-api.wildberries.ru/api/analytics/v1/deductions',
    label:'Подмены и неверные вложения', preferredKeys:['reports','items'], pageSize:1000,
  },
  warehouseMeasurements:{
    endpoint:'https://seller-analytics-api.wildberries.ru/api/analytics/v1/warehouse-measurements',
    label:'Замеры склада WB', preferredKeys:['reports','report','items'], pageSize:1000, periodDays:90,
  },
  documents:{
    endpoint:'https://documents-api.wildberries.ru/api/v1/documents/list',
    label:'Список документов WB', preferredKeys:['documents'], pageSize:50,
  },
})

async function documentStreamSnapshot(connectionId, syncId, period, categories, {
  complete = false,
  pages = 0,
  nextAllowedAt = null,
} = {}) {
  const allRows = []
  let afterKey = ''
  while (allRows.length < 10000) {
    const page = await loadStreamItemPage(pool,{connectionId,stream:'documents',syncId,afterKey,limit:1000})
    if (!page.length) break
    allRows.push(...page.map(item=>item.payload))
    afterKey = page.at(-1).row_key
    if (page.length < 1000) break
  }
  const totalRows = await countStreamItems(pool,{connectionId,stream:'documents',syncId})
  const rows = allRows.slice(0,100)
  const summary = summarizeDocuments(allRows,categories)
  summary.total = totalRows
  const value = compactExtendedValue({
    rows,totalRows,syncId,period,
    extra:{complete:Boolean(complete),pages,categories,summary,nextAllowedAt,coverage:{partial:!complete,summaryCapped:totalRows>allRows.length}},
  })
  await saveStreamData(pool,{
    connectionId,stream:'documents',payload:value,
    metadata:{period,syncId,complete:Boolean(complete),pages,categories,nextAllowedAt},
    source:complete?'sync':'partial-sync',
  })
  return value
}

async function advanceOffsetReportTask(stage, connectionId, token, state, { deadlineAt = 0, tokenInfo = null } = {}) {
  const definition = OFFSET_REPORTS[stage]
  if (!definition) throw new Error(`Неизвестный постраничный поток WB: ${stage}`)
  const period = state?.metadata?.period || reportPeriod(stage === 'documents' ? 365 : (definition.periodDays || 30))
  const syncId = String(state?.metadata?.syncId || crypto.randomUUID())
  const offset = Math.max(0, Number(state?.metadata?.offset || 0))
  const pageNumber = Math.max(0, Number(state?.metadata?.pageNumber || 0))
  let categories = Array.isArray(state?.metadata?.categories) ? state.metadata.categories : []
  if (stage === 'documents' && !categories.length) {
    try {
      const categoryPayload = await wbFetch('https://documents-api.wildberries.ru/api/v1/documents/categories?locale=ru', token, {
        label:'Категории документов WB',timeoutMs:30000,maxAttempts:1,maxRetryDelayMs:0,deadlineAt,
      })
      categories = normalizeDocumentCategories(categoryPayload)
    } catch (error) {
      console.warn('WB document categories skipped:',error.message)
    }
  }
  const params = new URLSearchParams()
  if (stage === 'documents') {
    params.set('locale','ru')
    params.set('beginTime',period.dateFrom)
    params.set('endTime',period.dateTo)
    params.set('sort','date')
    params.set('order','desc')
  } else {
    params.set('dateFrom',`${period.dateFrom}T00:00:00Z`)
    params.set('dateTo',`${period.dateTo}T23:59:59Z`)
    if (stage === 'deductionsReport') {
      params.set('sort','dtBonus')
      params.set('order','desc')
    }
  }
  params.set('limit',String(definition.pageSize))
  params.set('offset',String(offset))
  const endpoint = `${definition.endpoint}?${params.toString()}`
  const payload = await wbFetch(endpoint, token, {
    label:definition.label, timeoutMs:45000, maxAttempts:1, maxRetryDelayMs:0, deadlineAt,
  })
  const rawRows = extractExtendedRows(payload, definition.preferredKeys)
  const categoryMap = Object.fromEntries(categories.map(item=>[String(item.name),String(item.title || item.name)]))
  const rows = stage === 'documents'
    ? rawRows.map(row=>normalizeDocumentRow(row,categoryMap))
    : rawRows
  await saveStreamItemBatch(pool, {
    connectionId,stream:stage,syncId,rows,
    keyOf:(row,index)=>extendedRowKey(stage,row,offset+index),batchSize:HEAVY_DB_BATCH_SIZE,
  })
  if (stage === 'measurementPenalties' || stage === 'deductionsReport') {
    await persistFinanceLedgerBatch(pool, {
      connectionId,stream:stage,rows,
      keyOf:(row,index)=>extendedRowKey(stage,row,offset+index),batchSize:HEAVY_DB_BATCH_SIZE,
    })
  }
  const persistedCount = await countStreamItems(pool,{connectionId,stream:stage,syncId})
  const declaredTotal = Number(payload?.data?.total ?? payload?.total ?? 0)
  const hasMore = declaredTotal > 0 ? offset + rows.length < declaredTotal : rows.length >= definition.pageSize
  if (hasMore && rows.length) {
    const waitMs = stage === 'documents' ? documentsPageCooldownMs(financeRuntimeTokenInfo(tokenInfo)) : HEAVY_STAGE_COOLDOWN_MS
    const nextAllowedAt = new Date(Date.now()+waitMs).toISOString()
    const partialValue = stage === 'documents'
      ? await documentStreamSnapshot(connectionId,syncId,period,categories,{complete:false,pages:pageNumber+1,nextAllowedAt})
      : compactExtendedValue({rows,totalRows:persistedCount,syncId,period,extra:{complete:false,pages:pageNumber+1,nextAllowedAt}})
    if (stage !== 'documents') {
      await saveStreamData(pool,{connectionId,stream:stage,payload:partialValue,metadata:{period,syncId,complete:false,pages:pageNumber+1,nextAllowedAt},source:'partial-sync'})
    }
    return {
      pending:true,partialValue,nextAllowedAt,
      metadata:{ period,syncId,offset:offset+rows.length,pageNumber:pageNumber+1,persistedCount,lastPageRows:rows.length,declaredTotal:declaredTotal||null,categories },
    }
  }
  if (stage === 'documents') {
    await finalizeStreamItems(pool,{connectionId,stream:stage,syncId})
    const value = await documentStreamSnapshot(connectionId,syncId,period,categories,{complete:true,pages:pageNumber+1,nextAllowedAt:null})
    return {
      pending:false,value,
      validation:{incomingRows:rows.length,persistedRows:persistedCount,pages:pageNumber+1,period,categories:categories.length,memorySafe:true,accessConfirmed:true},
      endpoint,
    }
  }
  await finalizeStreamItems(pool,{connectionId,stream:stage,syncId})
  return {
    pending:false,
    value:compactExtendedValue({rows,totalRows:persistedCount,syncId,period,extra:{pages:pageNumber+1}}),
    validation:{ incomingRows:rows.length,persistedRows:persistedCount,pages:pageNumber+1,period,memorySafe:true },
    endpoint,
  }
}

const RETENTION_REPORTS = Object.freeze({
  antifraudRetention:{
    endpoint:'https://seller-analytics-api.wildberries.ru/api/v1/analytics/antifraud-details',
    label:'Удержания за самовыкупы WB', preferredKeys:['details','report','items'], periodDays:null,
  },
  labelingRetention:{
    endpoint:'https://seller-analytics-api.wildberries.ru/api/v1/analytics/goods-labeling',
    label:'Удержания за маркировку WB', preferredKeys:['report','items'], periodDays:31,
  },
})

async function loadRetentionReport(stage, connectionId, token, state, { deadlineAt = 0 } = {}) {
  const definition = RETENTION_REPORTS[stage]
  if (!definition) throw new Error(`Неизвестный отчёт удержаний WB: ${stage}`)
  const period = definition.periodDays ? (state?.metadata?.period || reportPeriod(definition.periodDays)) : null
  const syncId = String(state?.metadata?.syncId || crypto.randomUUID())
  const params = new URLSearchParams()
  if (period) { params.set('dateFrom',period.dateFrom); params.set('dateTo',period.dateTo) }
  const endpoint = `${definition.endpoint}${params.size ? `?${params.toString()}` : ''}`
  const payload = await wbFetch(endpoint,token,{
    label:definition.label,timeoutMs:45000,maxAttempts:1,maxRetryDelayMs:0,deadlineAt,
  })
  const rows = extractExtendedRows(payload,definition.preferredKeys)
  await saveStreamItemBatch(pool,{
    connectionId,stream:stage,syncId,rows,
    keyOf:(row,index)=>extendedRowKey(stage,row,index),batchSize:HEAVY_DB_BATCH_SIZE,
  })
  await persistFinanceLedgerBatch(pool,{
    connectionId,stream:stage,rows,
    keyOf:(row,index)=>extendedRowKey(stage,row,index),batchSize:HEAVY_DB_BATCH_SIZE,
  })
  const persistedCount = await countStreamItems(pool,{connectionId,stream:stage,syncId})
  await finalizeStreamItems(pool,{connectionId,stream:stage,syncId})
  return {
    value:compactExtendedValue({rows,totalRows:persistedCount,syncId,period,extra:{reportType:stage === 'antifraudRetention' ? 'self-purchases' : 'labeling'}}),
    validation:{rows:rows.length,persistedRows:persistedCount,period,memorySafe:true},
    endpoint,
  }
}

async function loadGoodsReturns(token, { deadlineAt = 0 } = {}) {
  const period = reportPeriod(30)
  const endpoint = `https://seller-analytics-api.wildberries.ru/api/v1/analytics/goods-return?dateFrom=${period.dateFrom}&dateTo=${period.dateTo}`
  const payload = await wbFetch(endpoint, token, {
    label:'Возвраты и перемещения товаров',timeoutMs:45000,maxAttempts:1,maxRetryDelayMs:0,deadlineAt,
  })
  const rows = extractExtendedRows(payload,['report'])
  return { value:compactExtendedValue({rows,totalRows:rows.length,period}),rawPayload:payload,validation:{rows:rows.length,period},endpoint }
}

function deepArrayCount(value) {
  if (Array.isArray(value)) return value.length
  if (!value || typeof value !== 'object') return 0
  return Object.values(value).reduce((sum,item)=>sum+deepArrayCount(item),0)
}

async function loadTariffs(token, { deadlineAt = 0 } = {}) {
  const date = new Date().toISOString().slice(0,10)
  const endpoints = {
    commission:'https://common-api.wildberries.ru/api/v1/tariffs/commission?locale=ru',
    box:`https://common-api.wildberries.ru/api/v1/tariffs/box?date=${date}`,
    pallet:`https://common-api.wildberries.ru/api/v1/tariffs/pallet?date=${date}`,
    returns:`https://common-api.wildberries.ru/api/v1/tariffs/return?date=${date}`,
  }
  const result = {}
  for (const [key,endpoint] of Object.entries(endpoints)) {
    result[key] = await wbFetch(endpoint, token, {
      label:`Тарифы WB · ${key}`,timeoutMs:30000,maxAttempts:1,maxRetryDelayMs:0,deadlineAt,
    })
    if (key !== 'returns') await sleep(1100)
  }
  const commissionRows = extractExtendedRows(result.commission,['report','data'])
  const totalRows = Math.max(commissionRows.length,deepArrayCount(result))
  return {
    value:compactExtendedValue({rows:commissionRows,totalRows,extra:{date,commission:result.commission,box:result.box,pallet:result.pallet,returns:result.returns}}),
    rawPayload:result,validation:{date,totalRows,commissionRows:commissionRows.length},endpoint:Object.values(endpoints).join(' + '),
  }
}

async function loadJamSubscription(token, { deadlineAt = 0 } = {}) {
  const endpoint = 'https://common-api.wildberries.ru/api/common/v1/subscriptions'
  const payload = await wbFetch(endpoint, token, {
    label:'Статус подписок WB',timeoutMs:30000,maxAttempts:1,maxRetryDelayMs:0,deadlineAt,
  })
  const sourceRows = Array.isArray(payload)
    ? payload
    : extractExtendedRows(payload,['subscriptions','items','data'])
  const rows = sourceRows.map((row,index) => {
    const source = JSON.stringify(row).toLowerCase()
    const name = String(row?.name || row?.title || row?.subscriptionName || row?.subscription || row?.service || '').trim()
    const active = Boolean(row?.active ?? row?.isActive ?? row?.enabled ?? row?.status === 'active')
    const isJam = /(?:^|[^a-zа-яё])(джем|jam)(?:[^a-zа-яё]|$)/i.test(`${name} ${source}`)
    return {
      ...row,
      id:String(row?.id ?? row?.subscriptionId ?? row?.serviceId ?? index),
      name:name || (isJam ? 'Подписка «Джем»' : 'Подписка WB'),
      active,
      isJam,
      startedAt:row?.startedAt || row?.startDate || row?.dateFrom || null,
      expiresAt:row?.expiresAt || row?.endDate || row?.dateTo || null,
    }
  })
  const jam = rows.find(row => row.isJam) || null
  const value = compactExtendedValue({
    rows,totalRows:rows.length,
    extra:{
      checkedAt:new Date().toISOString(),
      jam:jam ? {found:true,active:Boolean(jam.active),name:jam.name,startedAt:jam.startedAt,expiresAt:jam.expiresAt} : {found:false,active:false},
      note:'Статус подписки подтверждает доступ к сервису, но не является подтверждением денежного списания. Списание подтверждается только финансовой операцией или документом WB.',
    },
  })
  return { value,rawPayload:payload,validation:{rows:rows.length,jamFound:Boolean(jam),jamActive:Boolean(jam?.active)},endpoint }
}

async function loadFunnel(token, { deadlineAt = 0 } = {}) {
  const period = reportPeriod(30)
  const endpoint = 'https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products'
  const payload = await wbFetch(endpoint, token, {
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ selectedPeriod:{start:period.dateFrom,end:period.dateTo},nmIds:[],brandNames:[],subjectIds:[],tagIds:[],skipDeletedNm:true,orderBy:{field:'openCard',mode:'desc'},limit:1000,offset:0 }),
    label:'Воронка карточек WB',timeoutMs:60000,maxAttempts:1,maxRetryDelayMs:0,deadlineAt,
  })
  const rows = extractExtendedRows(payload,['products','items'])
  return { value:compactExtendedValue({rows,totalRows:rows.length,period}),rawPayload:payload,validation:{rows:rows.length,period},endpoint }
}




function streamCooldownMs(stage, tokenInfo = null) {
  // Коммуникации WB имеют общий лимит 3 запроса/сек. Не растягиваем
  // загрузку отзывов, вопросов и чатов на часы даже для базового токена.
  if (['reviews','questions','chats'].includes(stage)) return 1200
  const baseWithoutSecret = Number(tokenInfo?.typeId || 0) === 1 && !wbClientSecret
  if (!baseWithoutSecret) {
    if (['searchQueries','stockHistory'].includes(stage)) return 21000
    return 1200
  }
  if (stage === 'searchQueries') return 60 * 60 * 1000
  if (stage === 'stockHistory') return 30 * 60 * 1000
  return 1200
}

function engagementRowKey(stage, row = {}, index = 0) {
  const explicit = row.eventID ?? row.eventId ?? row.feedbackId ?? row.questionId ?? row.id ?? row.chatID ?? row.chatId
  if (explicit != null && String(explicit).trim()) return `${stage}:${String(row.rowType || 'row')}:id:${String(explicit).trim()}`
  const identity = [
    row.rowType || '',
    row.nmId ?? row.nmID ?? row.nm_id ?? '',
    row.searchText ?? row.searchQuery ?? row.query ?? row.text ?? '',
    row.userName ?? row.user_name ?? '',
    row.createdDate ?? row.createdAt ?? row.created_at ?? row.date ?? '',
    row.subjectId ?? row.subjectID ?? '',
    row.brandName ?? row.brand ?? '',
    index,
  ].join('|')
  return `${stage}:sha:${crypto.createHash('sha1').update(identity).digest('hex')}`
}

async function compactPersistedObjectStream(connectionId, stream, syncId, {
  period = null,
  extra = {},
  sampleLimit = 100,
} = {}) {
  const totalRows = await countStreamItems(pool,{connectionId,stream,syncId})
  const sample = await loadStreamItemPage(pool,{connectionId,stream,syncId,afterKey:'',limit:sampleLimit})
  await finalizeStreamItems(pool,{connectionId,stream,syncId})
  return compactExtendedValue({
    rows:sample.map(item=>item.payload),
    totalRows,
    syncId,
    period,
    extra,
  })
}

function searchReportRows(payload) {
  return extractExtendedRows(payload,['groups','products','items','searchTexts'])
}

async function advanceSearchQueriesTask(connectionId, token, state, data, { deadlineAt = 0, tokenInfo = null } = {}) {
  const period = state?.metadata?.period || reportPeriod(30)
  const syncId = String(state?.metadata?.syncId || crypto.randomUUID())
  const phase = String(state?.metadata?.phase || 'overview')
  const offset = Math.max(0,Number(state?.metadata?.offset || 0))
  const pageNumber = Math.max(0,Number(state?.metadata?.pageNumber || 0))
  const summary = state?.metadata?.summary && typeof state.metadata.summary === 'object' ? state.metadata.summary : {}
  // Детальные фразы по товару WB разрешает запрашивать максимум за 7 дней.
  const detailPeriod = state?.metadata?.detailPeriod || reportPeriod(7)

  if (phase === 'overview') {
    const endpoint = 'https://seller-analytics-api.wildberries.ru/api/v2/search-report/report'
    const payload = await wbFetch(endpoint,token,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        currentPeriod:{start:period.dateFrom,end:period.dateTo},
        positionCluster:'all',
        orderBy:{field:'orders',mode:'desc'},
        includeSubstitutedSKUs:false,
        includeSearchTexts:true,
        limit:1000,
        offset,
      }),
      label:'Поисковые запросы WB',timeoutMs:60000,maxAttempts:1,maxRetryDelayMs:0,deadlineAt,
    })
    const rows = searchReportRows(payload).map(row=>({rowType:'group',...row}))
    await saveStreamItemBatch(pool,{
      connectionId,stream:'searchQueries',syncId,rows,
      keyOf:(row,index)=>engagementRowKey('searchQueries',row,offset+index),batchSize:HEAVY_DB_BATCH_SIZE,
    })
    const persistedCount = await countStreamItems(pool,{connectionId,stream:'searchQueries',syncId})
    const nextSummary = {
      ...summary,
      commonInfo:payload?.data?.commonInfo || payload?.commonInfo || null,
      positionInfo:payload?.data?.positionInfo || payload?.positionInfo || null,
      visibilityInfo:payload?.data?.visibilityInfo || payload?.visibilityInfo || null,
      currency:payload?.data?.currency || payload?.currency || null,
    }
    if (rows.length >= 1000) {
      return {pending:true,nextAllowedAt:new Date(Date.now()+streamCooldownMs('searchQueries',tokenInfo)).toISOString(),metadata:{period,syncId,phase,offset:offset+rows.length,pageNumber:pageNumber+1,persistedCount,summary:nextSummary,searchBindingVersion:SEARCH_BINDING_VERSION}}
    }
    return {pending:true,nextAllowedAt:new Date(Date.now()+streamCooldownMs('searchQueries',tokenInfo)).toISOString(),metadata:{period,detailPeriod,syncId,phase:'products',offset:0,pageNumber:pageNumber+1,productOffset:0,persistedCount,summary:nextSummary,searchBindingVersion:SEARCH_BINDING_VERSION}}
  }

  const nmIds = [...new Set((Array.isArray(data?.products) ? data.products : []).flatMap(productNmIds).map(Number).filter(Number.isFinite))]
  const productOffset = Math.max(0,Number(state?.metadata?.productOffset || 0))
  if (!nmIds.length || productOffset >= nmIds.length) {
    const value = await compactPersistedObjectStream(connectionId,'searchQueries',syncId,{period,extra:{summary,detailPeriod,productsScanned:nmIds.length,complete:true,searchBindingVersion:SEARCH_BINDING_VERSION,searchBindingVerified:true}})
    return {pending:false,value,validation:{period,detailPeriod,totalRows:value.totalRows,productsScanned:nmIds.length,pages:pageNumber,memorySafe:true,searchBindingVersion:SEARCH_BINDING_VERSION,searchBindingVerified:true},endpoint:'https://seller-analytics-api.wildberries.ru/api/v2/search-report/report + /product/search-texts'}
  }

  // WB product search-texts accepts at most 20 nmIds per request.
  const batch = nmIds.slice(productOffset,productOffset+20)
  const endpoint = 'https://seller-analytics-api.wildberries.ru/api/v2/search-report/product/search-texts'
  const payload = await wbFetch(endpoint,token,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      currentPeriod:{start:detailPeriod.dateFrom,end:detailPeriod.dateTo},
      nmIds:batch,
      topOrderBy:'orders',
      // SKU 360/search visibility must contain only real search texts for the requested products.
      // WB marks substitute/promo placements separately via isSubstitutedSKU; do not request them
      // in the organic search-text stream because they can be semantically unrelated to the item.
      includeSubstitutedSKUs:false,
      includeSearchTexts:true,
      orderBy:{field:'orders',mode:'desc'},
      limit:30,
    }),
    label:'Поисковые фразы по товарам WB',timeoutMs:60000,maxAttempts:1,maxRetryDelayMs:0,deadlineAt,
  })
  const bound = bindWbSearchRowsToNmId(searchReportRows(payload),batch)
  const rows = bound.rows
  await saveStreamItemBatch(pool,{
    connectionId,stream:'searchQueries',syncId,rows,
    keyOf:(row,index)=>engagementRowKey('searchQueries',row,productOffset*1000+index),batchSize:HEAVY_DB_BATCH_SIZE,
  })
  const persistedCount = await countStreamItems(pool,{connectionId,stream:'searchQueries',syncId})
  const binding = {
    boundRows:Number(state?.metadata?.binding?.boundRows || 0) + rows.length,
    droppedUnbound:Number(state?.metadata?.binding?.droppedUnbound || 0) + bound.droppedUnbound,
    droppedOutsideRequest:Number(state?.metadata?.binding?.droppedOutsideRequest || 0) + bound.droppedOutsideRequest,
  }
  const nextProductOffset = productOffset + batch.length
  if (nextProductOffset < nmIds.length) {
    return {pending:true,nextAllowedAt:new Date(Date.now()+streamCooldownMs('searchQueries',tokenInfo)).toISOString(),metadata:{period,detailPeriod,syncId,phase:'products',offset:0,pageNumber:pageNumber+1,productOffset:nextProductOffset,persistedCount,summary,binding,searchBindingVersion:SEARCH_BINDING_VERSION}}
  }
  const value = await compactPersistedObjectStream(connectionId,'searchQueries',syncId,{period,extra:{summary,detailPeriod,productsScanned:nmIds.length,complete:true,binding,searchBindingVersion:SEARCH_BINDING_VERSION,searchBindingVerified:true}})
  return {pending:false,value,validation:{period,detailPeriod,totalRows:value.totalRows,productsScanned:nmIds.length,pages:pageNumber+1,memorySafe:true,binding,searchBindingVersion:SEARCH_BINDING_VERSION,searchBindingVerified:true},endpoint:'https://seller-analytics-api.wildberries.ru/api/v2/search-report/report + /product/search-texts'}
}

function firstRowValue(row, keys = []) {
  for (const key of keys) {
    const value = row?.[key]
    if (value !== undefined && value !== null && String(value).trim() !== '') return value
  }
  return null
}

function normalizeStockHistoryRow(row = {}) {
  const date = firstRowValue(row,['date','dt','reportDate','Дата','День'])
  const quantity = firstRowValue(row,['quantity','stockCount','stocks','stock','остаток','Остаток','Остаток, шт.'])
  return {
    rowType:'daily',
    sourceFile:row.sourceFile || null,
    date:date == null ? null : String(date).slice(0,10),
    nmID:firstRowValue(row,['nmID','nmId','nm_id','Артикул WB','Номенклатура']),
    vendorCode:firstRowValue(row,['vendorCode','supplierArticle','sa_name','Артикул продавца','Артикул поставщика']),
    title:firstRowValue(row,['title','name','Название','Предмет']),
    warehouse:firstRowValue(row,['warehouseName','warehouse','officeName','Склад','Название склада']),
    quantity:quantity == null || Number.isNaN(Number(quantity)) ? null : Number(quantity),
    inWayToClient:Number(firstRowValue(row,['inWayToClient','in_way_to_client','В пути к клиенту']) || 0),
    inWayFromClient:Number(firstRowValue(row,['inWayFromClient','in_way_from_client','В пути от клиента']) || 0),
    raw:row,
  }
}

function summarizeStockHistory(rows = []) {
  const byDate = new Map()
  const products = new Set()
  const warehouses = new Set()
  for (const row of rows) {
    const date = row.date || 'Без даты'
    const current = byDate.get(date) || { date,quantity:0,rows:0 }
    current.quantity += Number(row.quantity || 0)
    current.rows += 1
    byDate.set(date,current)
    if (row.nmID != null) products.add(String(row.nmID))
    if (row.warehouse) warehouses.add(String(row.warehouse))
  }
  const daily = [...byDate.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date)))
  return {
    dates:daily.length,
    products:products.size,
    warehouses:warehouses.size,
    latestDate:daily.at(-1)?.date || null,
    latestQuantity:daily.at(-1)?.quantity ?? null,
    daily:daily.slice(-100),
  }
}

function mergeEngagementSummary(current = {}, rows = [], phase = '') {
  const next = {
    ...current,
    total:Number(current.total || 0) + rows.length,
    phases:{ ...(current.phases || {}), [phase]:Number(current.phases?.[phase] || 0) + rows.length },
    answered:Number(current.answered || 0),
    unanswered:Number(current.unanswered || 0),
    archived:Number(current.archived || 0),
    ratings:{ ...(current.ratings || {}) },
  }
  for (const row of rows) {
    if (row.archived) next.archived += 1
    else if (row.isAnswered) next.answered += 1
    else next.unanswered += 1
    const rating = Number(row.productValuation ?? row.valuation ?? row.rating ?? 0)
    if (rating >= 1 && rating <= 5) next.ratings[rating] = Number(next.ratings[rating] || 0) + 1
  }
  return next
}

function sanitizeChatObject(value) {
  if (Array.isArray(value)) return value.map(sanitizeChatObject)
  if (!value || typeof value !== 'object') return value
  const safe = {}
  for (const [key,nested] of Object.entries(value)) {
    const normalized = String(key).replace(/[_-]/g,'').toLowerCase()
    if (['replysign','signature'].includes(normalized)) continue
    safe[key] = sanitizeChatObject(nested)
  }
  return safe
}

async function findStockHistoryReport(token, reportId, { deadlineAt = 0 } = {}) {
  if (!reportId) return null
  const filter = new URLSearchParams()
  filter.append('filter[downloadIds]',String(reportId))
  const payload = await wbFetch(`https://seller-analytics-api.wildberries.ru/api/v2/nm-report/downloads?${filter.toString()}`,token,{
    label:'Проверка существующего задания истории остатков WB',timeoutMs:30000,maxAttempts:1,maxRetryDelayMs:0,deadlineAt,
  })
  const reports = extractExtendedRows(payload,['data'])
  return reports.find(item=>String(item?.id || item?.downloadId || '') === String(reportId)) || null
}

function stockHistoryDuplicateIdError(error) {
  return /(?:id\s+is\s+already\s+exists|already\s+exists|уже\s+существ)/i.test(String(error?.message || ''))
}

async function advanceStockHistoryTask(connectionId, token, state, { deadlineAt = 0, tokenInfo = null } = {}) {
  const period = state?.metadata?.period || reportPeriod(90)
  const syncId = String(state?.metadata?.syncId || crypto.randomUUID())
  const reportId = String(state?.metadata?.reportId || state?.task_id || crypto.randomUUID())
  const phase = String(state?.metadata?.phase || 'create')
  const base = 'https://seller-analytics-api.wildberries.ru/api/v2/nm-report/downloads'
  const cooldown = streamCooldownMs('stockHistory',tokenInfo)

  if (phase === 'create') {
    // После deploy WB мог уже принять POST, а локальный state ещё остался в phase=create.
    // Сначала проверяем сохранённый reportId и продолжаем его вместо повторного создания.
    if (state?.task_id || state?.metadata?.createAttempted) {
      const existing = await findStockHistoryReport(token,reportId,{deadlineAt})
      if (existing) {
        return {
          pending:true,status:'pending',taskId:reportId,
          nextAllowedAt:new Date(Date.now()+cooldown).toISOString(),
          metadata:{...(state?.metadata||{}),period,syncId,reportId,phase:'poll',pollAttempts:0,persistedCount:Number(state?.metadata?.persistedCount||0),reportType:'STOCK_HISTORY_DAILY_CSV',recoveredExistingTask:true},
        }
      }
    }
    try {
      await wbFetch(base,token,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          id:reportId,
          reportType:'STOCK_HISTORY_DAILY_CSV',
          userReportName:`ELISEI — история остатков ${period.dateFrom}–${period.dateTo}`,
          params:{
            nmIds:[],subjectIds:[],brandNames:[],tagIds:[],
            currentPeriod:{start:period.dateFrom,end:period.dateTo},
            stockType:'',skipDeletedNm:true,
          },
        }),
        label:'Создание ежедневной истории остатков WB',timeoutMs:45000,maxAttempts:1,maxRetryDelayMs:0,deadlineAt,
      })
    } catch (error) {
      if (!stockHistoryDuplicateIdError(error)) throw error
      const existing = await findStockHistoryReport(token,reportId,{deadlineAt})
      if (existing) {
        return {
          pending:true,status:'pending',taskId:reportId,
          nextAllowedAt:new Date(Date.now()+cooldown).toISOString(),
          metadata:{...(state?.metadata||{}),period,syncId,reportId,phase:'poll',pollAttempts:0,persistedCount:Number(state?.metadata?.persistedCount||0),reportType:'STOCK_HISTORY_DAILY_CSV',recoveredDuplicateId:true},
        }
      }
      const nextReportId = crypto.randomUUID()
      return {
        pending:true,status:'queued',taskId:nextReportId,
        nextAllowedAt:new Date(Date.now()+cooldown).toISOString(),
        metadata:{...(state?.metadata||{}),period,syncId,reportId:nextReportId,phase:'create',pollAttempts:0,persistedCount:Number(state?.metadata?.persistedCount||0),reportType:'STOCK_HISTORY_DAILY_CSV',createAttempted:false,replacedDuplicateReportId:reportId},
      }
    }
    return {
      pending:true,status:'pending',taskId:reportId,
      nextAllowedAt:new Date(Date.now()+cooldown).toISOString(),
      metadata:{period,syncId,reportId,phase:'poll',pollAttempts:0,persistedCount:0,reportType:'STOCK_HISTORY_DAILY_CSV',createAttempted:true},
    }
  }

  const filter = new URLSearchParams()
  filter.append('filter[downloadIds]',reportId)
  const payload = await wbFetch(`${base}?${filter.toString()}`,token,{
    label:'Проверка ежедневной истории остатков WB',timeoutMs:30000,maxAttempts:1,maxRetryDelayMs:0,deadlineAt,
  })
  const reports = extractExtendedRows(payload,['data'])
  const report = reports.find(item=>String(item?.id || item?.downloadId || '') === reportId) || reports[0] || null
  const reportStatus = String(report?.status || '').toUpperCase()
  if (!report || ['NEW','PROCESSING','PENDING','IN_PROGRESS','QUEUED'].includes(reportStatus)) {
    const pollAttempts = Math.max(0,Number(state?.metadata?.pollAttempts || 0))+1
    return {
      pending:true,status:'pending',taskId:reportId,
      nextAllowedAt:new Date(Date.now()+cooldown).toISOString(),
      metadata:{...(state?.metadata||{}),period,syncId,reportId,phase:'poll',pollAttempts,reportStatus:reportStatus||'PROCESSING',persistedCount:Number(state?.metadata?.persistedCount||0)},
    }
  }
  if (reportStatus === 'FAILED') {
    await wbFetch(`${base}/retry`,token,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({downloadId:reportId}),
      label:'Повторная генерация истории остатков WB',timeoutMs:30000,maxAttempts:1,maxRetryDelayMs:0,deadlineAt,
    })
    return {
      pending:true,status:'pending',taskId:reportId,
      nextAllowedAt:new Date(Date.now()+cooldown).toISOString(),
      metadata:{...(state?.metadata||{}),period,syncId,reportId,phase:'poll',pollAttempts:0,reportStatus:'RETRY',persistedCount:Number(state?.metadata?.persistedCount||0)},
    }
  }
  if (!['SUCCESS','DONE','READY'].includes(reportStatus)) {
    throw Object.assign(new Error(`История остатков WB: неизвестный статус отчёта ${reportStatus || 'без статуса'}`), { status:502 })
  }

  const zip = await wbFetchBuffer(`${base}/file/${encodeURIComponent(reportId)}`,token,{
    label:'Загрузка ежедневной истории остатков WB',timeoutMs:90000,deadlineAt,
  })
  const rows = parseZipCsvRows(zip).map(normalizeStockHistoryRow)
  const summary = summarizeStockHistory(rows)
  await saveStreamItemBatch(pool,{
    connectionId,stream:'stockHistory',syncId,rows,
    keyOf:(row,index)=>engagementRowKey('stockHistory',row,index),batchSize:HEAVY_DB_BATCH_SIZE,
  })
  const persistedCount = await countStreamItems(pool,{connectionId,stream:'stockHistory',syncId})
  const value = await compactPersistedObjectStream(connectionId,'stockHistory',syncId,{
    period,extra:{complete:true,reportId,reportType:'STOCK_HISTORY_DAILY_CSV',source:'wb_csv_zip',summary},
  })
  return {
    pending:false,value,
    validation:{period,totalRows:persistedCount,reportId,reportType:'STOCK_HISTORY_DAILY_CSV',sourceFiles:[...new Set(rows.map(row=>row.sourceFile).filter(Boolean))],summary,persistedInBatches:true},
    endpoint:`${base}/file/${reportId}`,
  }
}


const QUESTION_HISTORY_START_UNIX = Math.floor(Date.UTC(2010,0,1) / 1000)

function initialQuestionWindows() {
  return [{ from:QUESTION_HISTORY_START_UNIX, to:Math.floor(Date.now()/1000) }]
}

async function finishQuestionsPhase(connectionId, syncId, phase, pageNumber, persistedCount, summary, tokenInfo) {
  if (phase === 'unanswered') {
    return {
      pending:true,
      nextAllowedAt:new Date(Date.now()+streamCooldownMs('questions',tokenInfo)).toISOString(),
      metadata:{ syncId,phase:'answered',questionStep:'count',windows:initialQuestionWindows(),pageNumber,persistedCount,summary },
    }
  }
  const value = await compactPersistedObjectStream(connectionId,'questions',syncId,{
    extra:{complete:true,summary,truncated:Number(summary?.truncated || 0) > 0},
  })
  return {
    pending:false,value,
    validation:{totalRows:value.totalRows,pages:pageNumber,truncated:Number(summary?.truncated || 0),persistedInBatches:true},
    endpoint:'https://feedbacks-api.wildberries.ru/api/v1/questions',
  }
}

async function advanceQuestionsTask(connectionId, token, state, { deadlineAt = 0, tokenInfo = null } = {}) {
  const syncId = String(state?.metadata?.syncId || crypto.randomUUID())
  const phase = String(state?.metadata?.phase || 'unanswered')
  const answered = phase === 'answered'
  const pageNumber = Math.max(0,Number(state?.metadata?.pageNumber || 0))
  const summary = state?.metadata?.summary && typeof state.metadata.summary === 'object' ? state.metadata.summary : {}
  const windows = Array.isArray(state?.metadata?.windows) && state.metadata.windows.length
    ? state.metadata.windows.map(item=>({from:Number(item.from),to:Number(item.to)})).filter(item=>Number.isFinite(item.from)&&Number.isFinite(item.to)&&item.to>=item.from)
    : initialQuestionWindows()
  const questionStep = String(state?.metadata?.questionStep || 'count')
  const persistedCount = await countStreamItems(pool,{connectionId,stream:'questions',syncId})
  if (!windows.length) return finishQuestionsPhase(connectionId,syncId,phase,pageNumber,persistedCount,summary,tokenInfo)

  const current = windows[0]
  const rest = windows.slice(1)
  const baseParams = new URLSearchParams({
    isAnswered:String(answered),
    dateFrom:String(Math.floor(current.from)),
    dateTo:String(Math.floor(current.to)),
  })
  const cooldown = streamCooldownMs('questions',tokenInfo)

  if (questionStep === 'count') {
    const countEndpoint = `https://feedbacks-api.wildberries.ru/api/v1/questions/count?${baseParams.toString()}`
    const payload = await wbFetch(countEndpoint,token,{
      label:'Количество вопросов покупателей WB',timeoutMs:45000,maxAttempts:1,maxRetryDelayMs:0,deadlineAt,
    })
    const count = Math.max(0,Number(payload?.data ?? payload?.count ?? payload ?? 0) || 0)
    if (count > 10000 && current.to > current.from) {
      const midpoint = Math.floor((current.from + current.to) / 2)
      const split = [{from:midpoint+1,to:current.to},{from:current.from,to:midpoint},...rest]
      return {
        pending:true,nextAllowedAt:new Date(Date.now()+cooldown).toISOString(),
        metadata:{syncId,phase,questionStep:'count',windows:split,pageNumber:pageNumber+1,persistedCount,summary},
      }
    }
    if (count === 0) {
      if (!rest.length) return finishQuestionsPhase(connectionId,syncId,phase,pageNumber+1,persistedCount,summary,tokenInfo)
      return {
        pending:true,nextAllowedAt:new Date(Date.now()+cooldown).toISOString(),
        metadata:{syncId,phase,questionStep:'count',windows:rest,pageNumber:pageNumber+1,persistedCount,summary},
      }
    }
    return {
      pending:true,nextAllowedAt:new Date(Date.now()+cooldown).toISOString(),
      metadata:{syncId,phase,questionStep:'fetch',windows,currentWindowCount:count,pageNumber:pageNumber+1,persistedCount,summary},
    }
  }

  const expected = Math.max(1,Math.min(10000,Number(state?.metadata?.currentWindowCount || 10000)))
  const listParams = new URLSearchParams(baseParams)
  listParams.set('take',String(expected))
  listParams.set('skip','0')
  listParams.set('order','dateDesc')
  const endpoint = `https://feedbacks-api.wildberries.ru/api/v1/questions?${listParams.toString()}`
  const payload = await wbFetch(endpoint,token,{
    label:'Вопросы покупателей WB',timeoutMs:90000,maxAttempts:1,maxRetryDelayMs:0,deadlineAt,
  })
  const rows = extractExtendedRows(payload,['questions']).map(row=>({...row,rowType:'questions',isAnswered:answered,archived:false}))
  await saveStreamItemBatch(pool,{
    connectionId,stream:'questions',syncId,rows,
    keyOf:(row,index)=>engagementRowKey('questions',row,index),batchSize:HEAVY_DB_BATCH_SIZE,
  })
  const nextPersistedCount = await countStreamItems(pool,{connectionId,stream:'questions',syncId})
  const nextSummary = mergeEngagementSummary(summary,rows,phase)
  const expectedCount = Number(state?.metadata?.currentWindowCount || rows.length)
  if (expectedCount > rows.length) nextSummary.truncated = Number(nextSummary.truncated || 0) + (expectedCount - rows.length)
  if (!rest.length) return finishQuestionsPhase(connectionId,syncId,phase,pageNumber+1,nextPersistedCount,nextSummary,tokenInfo)
  return {
    pending:true,nextAllowedAt:new Date(Date.now()+cooldown).toISOString(),
    metadata:{syncId,phase,questionStep:'count',windows:rest,pageNumber:pageNumber+1,persistedCount:nextPersistedCount,summary:nextSummary},
  }
}

async function advanceFeedbackTask(stage, connectionId, token, state, { deadlineAt = 0, tokenInfo = null } = {}) {
  if (stage === 'questions') return advanceQuestionsTask(connectionId,token,state,{deadlineAt,tokenInfo})
  const plural = 'feedbacks'
  const label = stage === 'reviews' ? 'Отзывы покупателей WB' : 'Вопросы покупателей WB'
  const syncId = String(state?.metadata?.syncId || crypto.randomUUID())
  const phase = String(state?.metadata?.phase || 'unanswered')
  const skip = Math.max(0,Number(state?.metadata?.skip || 0))
  const pageNumber = Math.max(0,Number(state?.metadata?.pageNumber || 0))
  const take = stage === 'reviews' ? 5000 : 10000
  const archived = stage === 'reviews' && phase === 'archive'
  const answered = phase === 'answered'
  const params = new URLSearchParams({ take:String(take),skip:String(skip),order:'dateDesc' })
  if (!archived) params.set('isAnswered',String(answered))
  const endpoint = `https://feedbacks-api.wildberries.ru/api/v1/${plural}${archived ? '/archive' : ''}?${params.toString()}`
  const payload = await wbFetch(endpoint,token,{
    label,timeoutMs:90000,maxAttempts:1,maxRetryDelayMs:0,deadlineAt,
  })
  const rows = extractExtendedRows(payload,[plural]).map(row=>({
    ...row,
    rowType:stage,
    isAnswered:archived ? Boolean(row?.answer) : answered,
    archived,
  }))
  await saveStreamItemBatch(pool,{
    connectionId,stream:stage,syncId,rows,
    keyOf:(row,index)=>engagementRowKey(stage,row,skip+index),batchSize:HEAVY_DB_BATCH_SIZE,
  })
  const persistedCount = await countStreamItems(pool,{connectionId,stream:stage,syncId})
  const cooldown = streamCooldownMs(stage,tokenInfo)
  const summary = mergeEngagementSummary(state?.metadata?.summary || {},rows,phase)
  const phaseCanContinue = stage === 'reviews' && rows.length >= take && skip + rows.length <= 199990
  if (phaseCanContinue) {
    return {pending:true,nextAllowedAt:new Date(Date.now()+cooldown).toISOString(),metadata:{syncId,phase,skip:skip+rows.length,pageNumber:pageNumber+1,persistedCount,summary}}
  }
  if (phase === 'unanswered') {
    const nextPhase = stage === 'reviews' ? 'archive' : 'answered'
    return {pending:true,nextAllowedAt:new Date(Date.now()+cooldown).toISOString(),metadata:{syncId,phase:nextPhase,skip:0,pageNumber:pageNumber+1,persistedCount,summary}}
  }
  const truncated = stage === 'questions' && rows.length >= take
  const value = await compactPersistedObjectStream(connectionId,stage,syncId,{extra:{complete:true,includesArchive:stage==='reviews',summary,truncated}})
  return {
    pending:false,value,
    validation:{totalRows:value.totalRows,pages:pageNumber+1,includesArchive:stage==='reviews',truncated,persistedInBatches:true},
    endpoint:`https://feedbacks-api.wildberries.ru/api/v1/${plural}`,
  }
}

async function advanceChatsTask(connectionId, token, state, { deadlineAt = 0, tokenInfo = null } = {}) {
  const syncId = String(state?.metadata?.syncId || crypto.randomUUID())
  const phase = String(state?.metadata?.phase || 'chats')
  const pageNumber = Math.max(0,Number(state?.metadata?.pageNumber || 0))
  const cursor = state?.metadata?.cursor == null ? '' : String(state.metadata.cursor)
  const base = 'https://buyer-chat-api.wildberries.ru/api/v1/seller'

  if (phase === 'chats') {
    const endpoint = `${base}/chats`
    const payload = await wbFetch(endpoint,token,{
      label:'Список чатов WB',timeoutMs:60000,maxAttempts:1,maxRetryDelayMs:0,deadlineAt,
    })
    const sourceRows = Array.isArray(payload?.result) ? payload.result : extractExtendedRows(payload,['chats'])
    const rows = sourceRows.map(row=>({rowType:'chat',...sanitizeChatObject(row)}))
    await saveStreamItemBatch(pool,{
      connectionId,stream:'chats',syncId,rows,
      keyOf:(row,index)=>engagementRowKey('chats',row,index),batchSize:HEAVY_DB_BATCH_SIZE,
    })
    const persistedCount = await countStreamItems(pool,{connectionId,stream:'chats',syncId})
    return {pending:true,nextAllowedAt:new Date(Date.now()+streamCooldownMs('chats',tokenInfo)).toISOString(),metadata:{syncId,phase:'events',cursor:'',pageNumber:pageNumber+1,persistedCount,chatCount:rows.length}}
  }

  const endpoint = `${base}/events${cursor ? `?next=${encodeURIComponent(cursor)}` : ''}`
  const payload = await wbFetch(endpoint,token,{
    label:'События чатов WB',timeoutMs:60000,maxAttempts:1,maxRetryDelayMs:0,deadlineAt,
  })
  const eventPayload = payload?.result && typeof payload.result === 'object' ? payload.result : payload
  const sourceRows = Array.isArray(eventPayload?.events) ? eventPayload.events : extractExtendedRows(payload,['events'])
  const rows = sourceRows.map(row=>({rowType:'event',...sanitizeChatObject(row)}))
  await saveStreamItemBatch(pool,{
    connectionId,stream:'chats',syncId,rows,
    keyOf:(row,index)=>engagementRowKey('chats',row,pageNumber*10000+index),batchSize:HEAVY_DB_BATCH_SIZE,
  })
  const persistedCount = await countStreamItems(pool,{connectionId,stream:'chats',syncId})
  const nextCursor = eventPayload?.next ?? ''
  const totalEvents = Number(eventPayload?.totalEvents ?? rows.length)
  if (totalEvents > 0 && nextCursor !== '' && String(nextCursor) !== cursor && pageNumber < 10000) {
    return {pending:true,nextAllowedAt:new Date(Date.now()+streamCooldownMs('chats',tokenInfo)).toISOString(),metadata:{syncId,phase:'events',cursor:String(nextCursor),pageNumber:pageNumber+1,persistedCount,chatCount:Number(state?.metadata?.chatCount||0),totalEvents}}
  }
  const chatCount = Number(state?.metadata?.chatCount||0)
  const value = await compactPersistedObjectStream(connectionId,'chats',syncId,{extra:{complete:true,readOnly:true,chatCount,eventCount:Math.max(0,persistedCount-chatCount),lastCursor:cursor||null}})
  return {pending:false,value,validation:{totalRows:value.totalRows,chatCount:value.chatCount,eventCount:value.eventCount,pages:pageNumber+1,readOnly:true,persistedInBatches:true},endpoint:`${base}/chats + ${base}/events`}
}

function extendedDateExpression(stream) {
  if (stream === 'stockHistory') return `NULLIF(SUBSTRING(COALESCE(payload->>'date',payload->>'dt',payload->>'reportDate') FROM 1 FOR 10),'')`
  if (stream === 'reviews' || stream === 'questions') return `NULLIF(SUBSTRING(COALESCE(payload->>'createdDate',payload->>'createdAt',payload->>'date') FROM 1 FOR 10),'')`
  if (stream === 'documents') return `NULLIF(SUBSTRING(COALESCE(payload->>'createdAt',payload->>'creationTime',payload->>'date',payload->>'periodFrom') FROM 1 FOR 10),'')`
  if (stream === 'chats') {
    const raw = `COALESCE(payload->>'addTimestamp',payload->>'createdAt',payload->>'createdDate',payload->>'timestamp',payload->>'date',payload#>>'{lastMessage,addTimestamp}',payload#>>'{lastMessage,createdAt}',payload#>>'{message,createdAt}')`
    return `(CASE WHEN ${raw} ~ '^[0-9]{10}$' THEN TO_CHAR(TO_TIMESTAMP((${raw})::numeric),'YYYY-MM-DD') WHEN ${raw} ~ '^[0-9]{13}$' THEN TO_CHAR(TO_TIMESTAMP((${raw})::numeric/1000),'YYYY-MM-DD') ELSE NULLIF(SUBSTRING(${raw} FROM 1 FOR 10),'') END)`
  }
  return ''
}

function extendedSqlFilter(stream, options = {}, params = [], { includePeriod = true, includeQuery = true, includeStatus = true } = {}) {
  const clauses = []
  const add = value => { params.push(value); return `$${params.length}` }
  const dateExpression = extendedDateExpression(stream)
  if (includePeriod && dateExpression && options.from && options.to) {
    const fromRef = add(String(options.from).slice(0,10))
    const toRef = add(String(options.to).slice(0,10))
    clauses.push(`${dateExpression} BETWEEN ${fromRef} AND ${toRef}`)
  }
  if (includeQuery && String(options.query || '').trim()) {
    clauses.push(`payload::text ILIKE ${add(`%${String(options.query).trim()}%`)}`)
  }
  if (includeStatus && options.status && options.status !== 'all') {
    if (stream === 'reviews' || stream === 'questions') {
      if (options.status === 'answered') clauses.push(`COALESCE(payload->>'isAnswered','false')='true'`)
      if (options.status === 'unanswered') clauses.push(`COALESCE(payload->>'isAnswered','false')<>'true' AND COALESCE(payload->>'archived','false')<>'true'`)
      if (options.status === 'archived') clauses.push(`COALESCE(payload->>'archived','false')='true'`)
    } else if (stream === 'chats' && ['chat','event'].includes(options.status)) {
      clauses.push(`payload->>'rowType'=${add(options.status)}`)
    } else if (stream === 'searchQueries' && ['group','query'].includes(options.status)) {
      clauses.push(`payload->>'rowType'=${add(options.status)}`)
    } else if (stream === 'stockHistory' && ['positive','zero'].includes(options.status)) {
      const quantity = `CASE WHEN COALESCE(payload->>'quantity','') ~ '^-?[0-9]+([.,][0-9]+)?$' THEN REPLACE(payload->>'quantity',',','.')::numeric ELSE NULL END`
      clauses.push(options.status === 'positive' ? `${quantity}>0` : `${quantity}=0`)
    }
  }
  if (stream === 'reviews' && options.rating && options.rating !== 'all') {
    const rating = `CASE WHEN COALESCE(payload->>'productValuation',payload->>'valuation',payload->>'rating','') ~ '^[0-9]+([.,][0-9]+)?$' THEN REPLACE(COALESCE(payload->>'productValuation',payload->>'valuation',payload->>'rating'),',','.')::numeric ELSE NULL END`
    clauses.push(`${rating}=${add(Number(options.rating))}`)
  }
  if (stream === 'stockHistory' && String(options.warehouse || '').trim()) {
    clauses.push(`COALESCE(payload->>'warehouse',payload->>'warehouseName',payload->>'officeName')=${add(String(options.warehouse).trim())}`)
  }
  return clauses
}

async function latestExtendedRows(connectionId, stream, { afterKey = '', limit = 100, ...filters } = {}) {
  const latest = await pool.query(`
    SELECT sync_id FROM wb_stream_items
    WHERE connection_id=$1 AND stream=$2
    ORDER BY updated_at DESC LIMIT 1
  `,[connectionId,stream])
  const syncId = latest.rows[0]?.sync_id
  if (!syncId) return { rows:[],syncId:null,next:null,total:0 }

  const pageParams = [connectionId,stream,syncId]
  const pageWhere = [`connection_id=$1`,`stream=$2`,`sync_id=$3::uuid`]
  if (afterKey) { pageParams.push(afterKey); pageWhere.push(`row_key>$${pageParams.length}`) }
  pageWhere.push(...extendedSqlFilter(stream,filters,pageParams))
  pageParams.push(Math.max(1,Math.min(500,Number(limit)||100)))
  const page = await pool.query(`
    SELECT row_key,payload FROM wb_stream_items
    WHERE ${pageWhere.join(' AND ')}
    ORDER BY row_key
    LIMIT $${pageParams.length}
  `,pageParams)

  const countParams = [connectionId,stream,syncId]
  const countWhere = [`connection_id=$1`,`stream=$2`,`sync_id=$3::uuid`,...extendedSqlFilter(stream,filters,countParams)]
  const count = await pool.query(`SELECT COUNT(*)::int AS count FROM wb_stream_items WHERE ${countWhere.join(' AND ')}`,countParams)
  return {
    rows:page.rows.map(item=>({rowKey:item.row_key,...item.payload})),
    syncId,
    next:page.rows.length ? page.rows.at(-1).row_key : null,
    total:Number(count.rows[0]?.count || 0),
  }
}

async function extendedStreamSummary(connectionId, stream, syncId, filters = {}) {
  if (!syncId) return { summary:null,availablePeriod:null }
  const dateExpression = extendedDateExpression(stream)
  let availablePeriod = null
  if (dateExpression) {
    const coverage = await pool.query(`
      SELECT MIN(${dateExpression}) AS from_date,MAX(${dateExpression}) AS to_date,COUNT(*) FILTER (WHERE ${dateExpression} IS NOT NULL)::int AS dated_rows
      FROM wb_stream_items WHERE connection_id=$1 AND stream=$2 AND sync_id=$3::uuid
    `,[connectionId,stream,syncId])
    availablePeriod = {
      from:coverage.rows[0]?.from_date || null,
      to:coverage.rows[0]?.to_date || null,
      datedRows:Number(coverage.rows[0]?.dated_rows || 0),
    }
  }

  const params = [connectionId,stream,syncId]
  const where = [`connection_id=$1`,`stream=$2`,`sync_id=$3::uuid`,...extendedSqlFilter(stream,filters,params)]
  const whereSql = where.join(' AND ')
  if (stream === 'reviews' || stream === 'questions') {
    const result = await pool.query(`
      SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE COALESCE(payload->>'archived','false')='true')::int AS archived,
        COUNT(*) FILTER (WHERE COALESCE(payload->>'isAnswered','false')='true' AND COALESCE(payload->>'archived','false')<>'true')::int AS answered,
        COUNT(*) FILTER (WHERE COALESCE(payload->>'isAnswered','false')<>'true' AND COALESCE(payload->>'archived','false')<>'true')::int AS unanswered
      FROM wb_stream_items WHERE ${whereSql}
    `,params)
    return { summary:{...result.rows[0]},availablePeriod }
  }
  if (stream === 'chats') {
    const result = await pool.query(`
      SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE payload->>'rowType'='chat')::int AS chatCount,
        COUNT(*) FILTER (WHERE payload->>'rowType'='event')::int AS eventCount
      FROM wb_stream_items WHERE ${whereSql}
    `,params)
    return { summary:{...result.rows[0]},availablePeriod }
  }
  if (stream === 'stockHistory') {
    const quantity = `CASE WHEN COALESCE(payload->>'quantity','') ~ '^-?[0-9]+([.,][0-9]+)?$' THEN REPLACE(payload->>'quantity',',','.')::numeric ELSE 0 END`
    const daily = await pool.query(`
      SELECT ${dateExpression} AS date,SUM(${quantity})::numeric AS quantity,COUNT(*)::int AS rows
      FROM wb_stream_items WHERE ${whereSql} AND ${dateExpression} IS NOT NULL
      GROUP BY ${dateExpression} ORDER BY ${dateExpression} DESC LIMIT 100
    `,params)
    const totals = await pool.query(`
      SELECT COUNT(DISTINCT ${dateExpression})::int AS dates,
        COUNT(DISTINCT COALESCE(payload->>'nmID',payload->>'nmId',payload->>'nm_id'))::int AS products,
        COUNT(DISTINCT COALESCE(payload->>'warehouse',payload->>'warehouseName',payload->>'officeName'))::int AS warehouses
      FROM wb_stream_items WHERE ${whereSql}
    `,params)
    const rows = [...daily.rows].reverse().map(row=>({date:row.date,quantity:Number(row.quantity || 0),rows:Number(row.rows || 0)}))
    const latest = rows.at(-1) || null
    return { summary:{...totals.rows[0],latestDate:latest?.date || null,latestQuantity:latest?.quantity ?? null,daily:rows},availablePeriod }
  }
  const result = await pool.query(`SELECT COUNT(*)::int AS total FROM wb_stream_items WHERE ${whereSql}`,params)
  return { summary:{...result.rows[0]},availablePeriod }
}


async function runSyncStage({ connection, tokens, data, stage, deadlineAt }) {
  const definition = WB_SYNC_STAGES[stage]
  const fallback = previousStageValue(data, stage)
  let state = (await pool.query('SELECT * FROM wb_sync_states WHERE connection_id=$1 AND stage=$2', [connection.id, stage])).rows[0] || null
  const now = Date.now()
  if (state?.next_allowed_at && new Date(state.next_allowed_at).getTime() > now) {
    return { stage, status:state.status || 'cooldown', value:fallback, warning:`${definition.label}: следующий запрос разрешён ${new Date(state.next_allowed_at).toLocaleString('ru-RU')}.`, state }
  }
  if (HEAVY_SYNC_STAGES.includes(stage)) {
    const activeHeavy = await pool.query(`
      SELECT stage FROM wb_sync_states
      WHERE connection_id=$1 AND stage=ANY($2::text[]) AND stage<>$3
        AND status='running' AND updated_at>NOW()-INTERVAL '10 minutes'
      LIMIT 1
    `,[connection.id,HEAVY_SYNC_STAGES,stage])
    if (activeHeavy.rows[0]) {
      state = await updateSyncState(connection.id,stage,{ status:'queued',nextAllowedAt:new Date(Date.now()+15000).toISOString(),lastError:`Ожидает завершения этапа «${WB_SYNC_STAGES[activeHeavy.rows[0].stage]?.label || activeHeavy.rows[0].stage}»` })
      return { stage,status:'queued',value:fallback,warning:`${definition.label}: поставлено в очередь, чтобы не перегружать память сервера.`,state }
    }
  }
  const selectedRow = selectTokenRowForStage(tokens,stage)
  if (!selectedRow) {
    const optionalPrivileged = OPTIONAL_PRIVILEGED_STAGES.has(stage)
    const status = optionalPrivileged ? 'optional_unavailable' : 'missing_token'
    const message = optionalPrivileged
      ? 'Дополнительный источник недоступен для типа текущего ключа. Основной финансовый реестр ELISEI продолжает работать через категорию «Финансы».'
      : `В подключённом ключе не включена категория «${WB_SCOPE_BITS[definition.scope].label}»`
    state = await updateSyncState(connection.id, stage, { status, lastAttemptAt:new Date().toISOString(), lastError:message, nextAllowedAt:null })
    return { stage, status, value:fallback, warning:`${definition.label}: ${message}`, state }
  }
  let selected
  try {
    selected = chooseTokenForStage(tokens,stage)
  } catch (error) {
    const status = 'token_invalid'
    state = await updateSyncState(connection.id,stage,{ status,lastAttemptAt:new Date().toISOString(),lastError:error.message,nextAllowedAt:null,metadata:{ ...(state?.metadata || {}),tokenId:selectedRow.id,tokenLabel:selectedRow.label } })
    return { stage,status,value:fallback,warning:`${definition.label}: ${error.message}`,state }
  }

  state = await updateSyncState(connection.id, stage, { status:'running', lastAttemptAt:new Date().toISOString(), lastError:null, nextAllowedAt:null })
  try {
    let value
    let meta = null
    let snapshot = null

    if (stage === 'products') {
      const loaded = await loadProducts(selected.token, { deadlineAt })
      value = loaded.value
      snapshot = loaded
    } else if (stage === 'sellerStocks') {
      const loaded = await loadSellerStocks(selected.token, Array.isArray(data.products) ? data.products : [], { deadlineAt })
      value = loaded.value
      meta = loaded.validation || null
      snapshot = loaded
    } else if (stage === 'orders' || stage === 'sales') {
      const loaded = await loadStatisticsRows(stage, selected.token, {
        deadlineAt,previousRows:fallback,dateFromOverride:state?.metadata?.dailyReadyDate || state?.metadata?.dateFrom || '',
      })
      value = loaded.value
      snapshot = loaded
    } else if (stage === 'advertising') {
      const loaded = await loadAdvertising(selected.token, { deadlineAt, previous:fallback, period:state?.metadata?.period || null })
      value = loaded.value
      meta = value.meta || null
      snapshot = loaded
    } else if (stage === 'financeReports' || stage === 'acquiringReports') {
      const result = await advanceFinanceReportListTask(stage,connection.id,selected.token,state,{deadlineAt,tokenInfo:selected.info})
      if (result.pending) {
        state = await updateSyncState(connection.id,stage,{
          status:'queued',lastAttemptAt:new Date().toISOString(),nextAllowedAt:result.nextAllowedAt,lastError:null,taskId:null,
          metadata:{...result.metadata,tokenId:selected.row.id,tokenLabel:selected.row.label,memorySafe:true},
        })
        return {stage,status:'queued',value:fallback,warning:`${definition.label}: сохранено ${Number(result.metadata.persistedCount||0)} отчётов, продолжение в очереди.`,state}
      }
      value=result.value; meta=result.validation; snapshot={endpoint:result.endpoint,validation:result.validation}
    } else if (stage === 'finance' || stage === 'acquiring') {
      const result = await advancePagedFinanceTask(stage,connection.id,selected.token,state,{ deadlineAt,tokenInfo:selected.info })
      if (result.pending) {
        state = await updateSyncState(connection.id,stage,{
          status:'queued',lastAttemptAt:new Date().toISOString(),nextAllowedAt:result.nextAllowedAt,lastError:null,lastCount:Number(result.metadata.persistedCount||0),taskId:null,
          metadata:{ ...result.metadata,tokenId:selected.row.id,tokenLabel:selected.row.label,primary:Boolean(selected.row.is_primary),memorySafe:true },
        })
        return { stage,status:'queued',value:result.partialValue || fallback,warning:`${definition.label}: сохранена страница ${Number(result.metadata.pageNumber || 0)} (${Number(result.metadata.persistedCount || 0)} строк). Продолжение поставлено в очередь.`,state }
      }
      value = result.value
      meta = { ...result.validation,totals:value.totals,balance:value.balance,memorySafe:true }
      snapshot = { endpoint:result.endpoint,validation:result.validation }
    } else if (stage === 'fbsArchive') {
      const result = await advanceFbsArchiveTask(connection.id,selected.token,state,{deadlineAt})
      if (result.pending) {
        state = await updateSyncState(connection.id,stage,{
          status:'queued',lastAttemptAt:new Date().toISOString(),nextAllowedAt:result.nextAllowedAt,lastError:null,taskId:null,
          metadata:{...result.metadata,tokenId:selected.row.id,tokenLabel:selected.row.label,memorySafe:true},
        })
        return {stage,status:'queued',value:fallback,warning:`${definition.label}: сохранено ${Number(result.metadata.persistedCount||0)} заказов, продолжение в очереди.`,state}
      }
      value=result.value
      meta=result.validation
      snapshot={endpoint:result.endpoint,validation:result.validation}
    } else if (stage === 'measurementPenalties' || stage === 'deductionsReport' || stage === 'warehouseMeasurements' || stage === 'documents') {
      const result = await advanceOffsetReportTask(stage,connection.id,selected.token,state,{deadlineAt,tokenInfo:selected.info})
      if (result.pending) {
        state = await updateSyncState(connection.id,stage,{
          status:'queued',lastAttemptAt:new Date().toISOString(),nextAllowedAt:result.nextAllowedAt,lastError:null,lastCount:Number(result.metadata.persistedCount||0),taskId:null,
          metadata:{...result.metadata,tokenId:selected.row.id,tokenLabel:selected.row.label,memorySafe:true},
        })
        return {stage,status:'queued',value:result.partialValue || fallback,warning:`${definition.label}: сохранено ${Number(result.metadata.persistedCount||0)} строк, продолжение в очереди.`,state}
      }
      value=result.value
      meta=result.validation
      snapshot={endpoint:result.endpoint,validation:result.validation}
    } else if (stage === 'antifraudRetention' || stage === 'labelingRetention') {
      const loaded=await loadRetentionReport(stage,connection.id,selected.token,state,{deadlineAt})
      value=loaded.value; meta=loaded.validation; snapshot=loaded
    } else if (stage === 'goodsReturns') {
      const loaded=await loadGoodsReturns(selected.token,{deadlineAt})
      value=loaded.value; meta=loaded.validation; snapshot=loaded
    } else if (stage === 'tariffs') {
      const loaded=await loadTariffs(selected.token,{deadlineAt})
      value=loaded.value; meta=loaded.validation; snapshot=loaded
    } else if (stage === 'jamSubscription') {
      const loaded=await loadJamSubscription(selected.token,{deadlineAt})
      value=loaded.value; meta=loaded.validation; snapshot=loaded
    } else if (stage === 'funnel') {
      const loaded=await loadFunnel(selected.token,{deadlineAt})
      value=loaded.value; meta=loaded.validation; snapshot=loaded
    } else if (stage === 'searchQueries' || stage === 'stockHistory' || stage === 'reviews' || stage === 'questions' || stage === 'chats') {
      const result = stage === 'searchQueries'
        ? await advanceSearchQueriesTask(connection.id,selected.token,state,data,{deadlineAt,tokenInfo:selected.info})
        : stage === 'stockHistory'
          ? await advanceStockHistoryTask(connection.id,selected.token,state,{deadlineAt,tokenInfo:selected.info})
          : stage === 'reviews' || stage === 'questions'
            ? await advanceFeedbackTask(stage,connection.id,selected.token,state,{deadlineAt,tokenInfo:selected.info})
            : await advanceChatsTask(connection.id,selected.token,state,{deadlineAt,tokenInfo:selected.info})
      if (result.pending) {
        state = await updateSyncState(connection.id,stage,{
          status:result.status || 'queued',lastAttemptAt:new Date().toISOString(),nextAllowedAt:result.nextAllowedAt,lastError:null,taskId:result.taskId || null,
          metadata:{...result.metadata,tokenId:selected.row.id,tokenLabel:selected.row.label,primary:Boolean(selected.row.is_primary),memorySafe:true},
        })
        return {stage,status:'queued',value:fallback,warning:`${definition.label}: сохранено ${Number(result.metadata.persistedCount||0)} строк, продолжение поставлено в очередь.`,state}
      }
      value=result.value
      meta=result.validation
      snapshot={endpoint:result.endpoint,validation:result.validation}
    } else if (stage === 'paidStorage' || stage === 'acceptance') {
      const result = await advanceGeneratedReportTask(stage, selected.token, state, { deadlineAt })
      if (result.pending) {
        state = await updateSyncState(connection.id, stage, {
          status:'pending', lastAttemptAt:new Date().toISOString(), nextAllowedAt:result.nextAllowedAt,
          lastError:null, taskId:result.taskId,
          metadata:{ ...result.metadata, taskStatus:result.taskStatus, tokenId:selected.row.id, tokenLabel:selected.row.label, primary:Boolean(selected.row.is_primary), memorySafe:true },
        })
        return { stage, status:'pending', value:fallback, warning:`${definition.label}: отчёт WB формируется в фоне. ELISEI загрузит его автоматически.`, state }
      }
      const syncId = String(result.metadata?.syncId || state?.metadata?.syncId || crypto.randomUUID())
      await saveStreamItemBatch(pool,{
        connectionId:connection.id,stream:stage,syncId,rows:result.rows,
        keyOf:(row,index)=>rawGeneratedReportKey(stage,row,index),batchSize:HEAVY_DB_BATCH_SIZE,
      })
      await persistFinanceLedgerBatch(pool,{
        connectionId:connection.id,stream:stage,rows:result.rows,
        keyOf:(row,index)=>rawGeneratedReportKey(stage,row,index),batchSize:HEAVY_DB_BATCH_SIZE,
      })
      const persistedCount = await countStreamItems(pool,{connectionId:connection.id,stream:stage,syncId})
      if (result.moreChunks) {
        state = await updateSyncState(connection.id,stage,{
          status:'queued',lastAttemptAt:new Date().toISOString(),lastSuccessAt:new Date().toISOString(),
          nextAllowedAt:new Date(Date.now()+HEAVY_STAGE_COOLDOWN_MS).toISOString(),lastError:null,lastCount:persistedCount,taskId:null,
          metadata:{ ...result.metadata,syncId,chunkIndex:result.nextChunkIndex,completedChunks:Number(result.nextChunkIndex || 0),persistedCount,tokenId:selected.row.id,tokenLabel:selected.row.label,memorySafe:true },
        })
        return { stage,status:'queued',value:fallback,warning:`${definition.label}: часть периода сохранена в PostgreSQL (${persistedCount} строк), продолжение в очереди.`,state }
      }
      value = await aggregatePersistedHeavyRows(connection.id,stage,syncId)
      await finalizeStreamItems(pool,{connectionId:connection.id,stream:stage,syncId})
      meta = { ...result.validation,rawRowCount:persistedCount,compactRows:value.length,memorySafe:true }
      snapshot = { endpoint:result.endpoint,validation:meta }
    } else if (stage === 'stocks') {
      const result = await advanceWarehouseRemainsTask(selected.token, state, { deadlineAt })
      if (result.pending) {
        state = await updateSyncState(connection.id, stage, {
          status:'pending', lastAttemptAt:new Date().toISOString(), nextAllowedAt:result.nextAllowedAt,
          lastError:null, taskId:result.taskId, metadata:{ taskStatus:result.taskStatus, reportProfile:result.reportProfile || STOCK_REPORT_PROFILE, tokenId:selected.row.id, tokenLabel:selected.row.label, primary:Boolean(selected.row.is_primary) },
        })
        return { stage, status:'pending', value:fallback, warning:'Остатки: отчёт WB формируется в фоне. ELISEI проверит его автоматически.', state }
      }
      value = result.rows
      meta = result.stockMeta
      snapshot = result
    }

    if (snapshot?.rawPayload !== undefined) {
      await saveSnapshot(pool, {
        connectionId:connection.id,
        stream:stage,
        endpoint:snapshot.endpoint || stage,
        requestKey:['stocks','paidStorage','acceptance'].includes(stage) ? String(state?.task_id || meta?.taskId || '') : '',
        rawPayload:snapshot.rawPayload,
        normalizedPayload:['products','stocks','sellerStocks','advertising','finance','paidStorage','acceptance','acquiring','goodsReturns','tariffs','funnel','searchQueries','stockHistory','reviews','questions','chats'].includes(stage) ? value : null,
        validation:snapshot.validation || meta || {},
        keep:['orders','sales','finance','acquiring'].includes(stage) ? 2 : 4,
      })
    }

    await saveStreamData(pool, {
      connectionId: connection.id,
      stream: stage,
      payload: value,
      metadata: {
        endpoint: snapshot?.endpoint || stage,
        validation: snapshot?.validation || meta || {},
        tokenId: selected.row.id,
        lastSuccessAt: new Date().toISOString(),
      },
      source: 'sync',
    })

    const count = stageCount(stage, value)
    const stateMetadata = {
      tokenId:selected.row.id,
      tokenLabel:selected.row.label,
      primary:Boolean(selected.row.is_primary),
      automaticRetryAttempt:0,
      automaticRetryReason:null,
      lastTransientError:null,
      ...(meta || {}),
      ...(snapshot?.validation ? { validation:snapshot.validation } : {}),
    }
    if (['orders','sales'].includes(stage) && /^\d{4}-\d{2}-\d{2}$/.test(String(state?.metadata?.dailyReadyDate || ''))) {
      stateMetadata.dailyReadyConfirmedFrom=String(state.metadata.dailyReadyDate).slice(0,10)
      stateMetadata.dailyReadyConfirmedThrough=String(state.metadata.dailyReadyDate).slice(0,10)
      stateMetadata.dailyReadyRecoveryAt=new Date().toISOString()
    }
    if (stage === 'advertising' && Number(value?.meta?.nextStatsOffset || 0) > 0) {
      state = await updateSyncState(connection.id,stage,{
        status:'queued',lastAttemptAt:new Date().toISOString(),lastSuccessAt:new Date().toISOString(),
        nextAllowedAt:new Date(Date.now()+13000).toISOString(),lastError:null,lastCount:count,taskId:null,
        metadata:{...stateMetadata,memorySafe:true},
      })
      return {stage,status:'queued',value,meta,warning:`${definition.label}: загружена статистика ещё для ${Number(value?.meta?.requestedCampaigns||0)} кампаний. Остальные кампании продолжат загружаться автоматически.`,state}
    }
    state = await updateSyncState(connection.id, stage, {
      status:'success', lastAttemptAt:new Date().toISOString(), lastSuccessAt:new Date().toISOString(), nextAllowedAt:null,
      lastError:null, lastCount:count, taskId:null, metadata:stateMetadata,
    })
    return { stage, status:'success', value, meta, state }
  } catch (error) {
    if (stage === 'searchQueries' && [402,403].includes(Number(error?.status))) {
      error.message = 'Поисковые запросы WB доступны только при активной подписке «Джем» и токене категории «Аналитика».'
    }
    const schedulerWait = error?.code === 'WB_SCHEDULER_WAIT'
    const retryable = !schedulerWait && isRetryableWbError(error)
    const retryPlan = retryable ? transientRetryPlan(state,stage,error) : null
    const nextAllowedAt = error?.nextAllowedAt
      || (error?.retryAfterSeconds ? new Date(Date.now()+Number(error.retryAfterSeconds)*1000).toISOString() : null)
      || retryPlan?.nextAllowedAt
      || null
    const status = schedulerWait
      ? 'queued'
      : Number(error?.status) === 429
        ? 'rate_limited'
        : retryable
          ? 'retry_scheduled'
          : stage === 'searchQueries' && [402,403].includes(Number(error?.status))
            ? 'subscription_required'
            : Number(error?.status) === 403
              ? (OPTIONAL_PRIVILEGED_STAGES.has(stage) ? 'optional_unavailable' : 'forbidden')
              : 'error'
    const retryMessage = schedulerWait
      ? `Smart Scheduler ждёт разрешённое окно WB${nextAllowedAt ? ` до ${new Date(nextAllowedAt).toLocaleString('ru-RU')}` : ''}. Запрос не отправлялся; прогресс сохранён.`
      : retryable
        ? `${Number(error?.status) === 504 ? 'Wildberries не ответил вовремя' : 'Временная ошибка Wildberries'}. Прогресс сохранён; автоматический повтор после ${new Date(nextAllowedAt).toLocaleString('ru-RU')}.`
        : error.message
    state = await updateSyncState(connection.id, stage, {
      status, lastAttemptAt:new Date().toISOString(), nextAllowedAt, lastError:retryMessage,
      taskId:error?.resetTask ? null : state?.task_id,
      metadata:{
        ...(state?.metadata || {}),
        requestId:error?.requestId || null,
        code:error?.code || null,
        details:error?.details || null,
        ...smartSchedulerMeta(stage,{reason:schedulerWait?'preflight_window':Number(error?.status)===429?'wb_429':'stage_result',requestSent:!schedulerWait}),
        ...(retryPlan ? { automaticRetryAttempt:retryPlan.attempt,automaticRetryReason:retryPlan.reason,lastTransientError:error.message } : {}),
      },
    })
    return { stage, status, value:fallback, warning:`${definition.label}: ${retryMessage}${stageCount(stage, fallback) ? ' Сохранены предыдущие данные.' : ''}`, state }
  }
}

function wbNmKey(row) {
  return productNmIds(row)[0] || ''
}

function enrichProducts(products, stats) {
  const rows = Array.isArray(products) ? products : []
  const aliasToKey = new Map()
  const stockByKey = new Map()
  const revenueByKey = new Map()

  for (const product of rows) {
    const key = productKey(product)
    if (!key) continue
    for (const alias of identityAliases(product)) aliasToKey.set(alias, key)
  }

  const resolveKey = row => {
    for (const alias of identityAliases(row)) {
      const key = aliasToKey.get(alias)
      if (key) return key
    }
    return productKey(row)
  }

  for (const row of stats.stocks || []) {
    const key = resolveKey(row)
    if (!key) continue
    const quantity = firstNumber(row, ['quantity','quantityFull','stock','stockCount','totalQuantity','availableQuantity'], 0)
    stockByKey.set(key, (stockByKey.get(key) || 0) + Math.max(0, Number.isFinite(quantity) ? quantity : 0))
  }

  for (const row of stats.sales || []) {
    const key = resolveKey(row)
    if (!key) continue
    const revenue = Number(row.forPay ?? row.finishedPrice ?? row.priceWithDisc ?? 0)
    revenueByKey.set(key, (revenueByKey.get(key) || 0) + (Number.isFinite(revenue) ? revenue : 0))
  }

  return rows.map(product => {
    const key = productKey(product)
    const stock = stockByKey.get(key) || 0
    return {
      ...product,
      stock,
      revenue: Math.round(revenueByKey.get(key) || 0),
      status: stock === 0 ? 'Нет остатка' : stock < 10 ? 'Риск' : 'В норме',
    }
  })
}

function withSyncLog(history, entry) { return [{ id: crypto.randomUUID(), at: new Date().toISOString(), ...entry }, ...(history || [])].slice(0, 20) }
function buildDashboard(data, settings = DEFAULT_BUSINESS_SETTINGS) { const summary = buildCoreAnalytics(data, settings).summary; return { revenue: summary.revenue, orders: summary.orders, sales: summary.sales, returns: summary.returns, stockUnits: summary.stockUnits, profit: summary.operatingProfit, margin: summary.margin, periodDays: 30 } }

app.get('/health', async (_req, res) => {
  res.json({
    ok: true,
    ready: databaseState.ready,
    service: 'elisei-api',
    version: '2.25.3',
    database: databaseState.status,
    databaseState: {
      attempts: databaseState.attempts,
      lastError: databaseState.lastError,
      lastConnectedAt: databaseState.lastConnectedAt,
      nextRetryAt: databaseState.nextRetryAt,
    },
    wbLiveIntegration: {
      pollingAvailable:true,
      catalogRegistered:wbCatalogServiceEnabled,
      publicBackendReady:Boolean(publicBackendUrl),
      serviceSecretReady:Boolean(publicServiceSecretStatus().valid),
      oauthConfigured:Boolean(oauthReadiness().configurationPrepared),
      oauthActive:false,
      webhookSetupReady:Boolean(wbCatalogServiceEnabled && publicBackendUrl && publicServiceSecretStatus().valid),
    },
    wbApiPolicy: {
      fbsArchive: 'GET /api/marketplace/v3/fbs/orders/archive',
      orderMetadata: { dbs:'POST /api/marketplace/v3/dbs/orders/meta/details', dbw:'POST /api/marketplace/v3/dbw/orders/meta/details', clickCollect:'POST /api/marketplace/v3/click-collect/orders/meta/details' },
      sgtWarehouseManagement: WB_API_POLICY.sellerWarehouses.management,
      sgtApiWriteCutoff: WB_API_POLICY.sellerWarehouses.apiWriteCutoff,
    },
    backgroundWorker: {
      running: backgroundWorkerState.running,
      lastStartedAt: backgroundWorkerState.lastStartedAt,
      lastFinishedAt: backgroundWorkerState.lastFinishedAt,
      lastReason: backgroundWorkerState.lastReason,
      lastError: backgroundWorkerState.lastError,
    },
  })
})

app.post('/api/auth/register', async (req, res) => {
  try {
    requireBackendConfig()
    const name = String(req.body?.name || '').trim(); const company = String(req.body?.company || '').trim(); const email = String(req.body?.email || '').trim().toLowerCase(); const password = String(req.body?.password || '')
    if (!name || !company || !email.includes('@') || password.length < 8) return res.status(400).json({ error: 'Заполните все поля. Пароль должен содержать минимум 8 символов.' })
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email])
    if (existing.rowCount) return res.status(409).json({ error: 'Аккаунт с такой почтой уже существует' })
    const user = { id: crypto.randomUUID(), name, company, email }
    const passwordHash = await bcrypt.hash(password, 12)
    const result = await pool.query('INSERT INTO users (id, name, company, email, password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING *', [user.id, name, company, email, passwordHash])
    res.status(201).json({ token: signToken(result.rows[0]), user: publicUser(result.rows[0]) })
  } catch (error) { res.status(error.code === '23505' ? 409 : (error.status || 500)).json({ error: error.code === '23505' ? 'Аккаунт с такой почтой уже существует' : error.message }) }
})

app.post('/api/auth/password-reset/request', async (req, res) => {
  try {
    requireBackendConfig()
    const email = String(req.body?.email || '').trim().toLowerCase()
    const genericResponse = {
      ok: true,
      expiresInMinutes: 15,
      message: 'Если аккаунт с такой почтой существует, ссылка для восстановления создана. Пока почтовая отправка не подключена, одноразовую ссылку можно взять в логах backend Render.'
    }
    if (!email || !email.includes('@')) return res.status(400).json({ error:'Введите корректную электронную почту.' })
    const result = await pool.query('SELECT id,email,password_hash FROM users WHERE email=$1', [email])
    const user = result.rows[0]
    if (!user) return res.json(genericResponse)

    const passwordFingerprint = crypto.createHash('sha256').update(String(user.password_hash || '')).digest('hex').slice(0,24)
    const resetToken = jwt.sign({
      sub:user.id,
      email:user.email,
      purpose:'password_reset',
      pwd:passwordFingerprint,
    }, jwtSecret, { expiresIn:'15m' })
    const frontendBase = String(req.headers.origin || allowedOrigins[0] || '').trim().replace(/\/$/,'')
    if (!frontendBase) throw Object.assign(new Error('FRONTEND_ORIGIN не настроен для восстановления пароля'), { status:503 })
    const resetUrl = `${frontendBase}/login?reset=${encodeURIComponent(resetToken)}&email=${encodeURIComponent(user.email)}`
    console.warn(`[ELISEI PASSWORD RESET] Одноразовая ссылка (15 мин): ${resetUrl}`)
    return res.json(genericResponse)
  } catch (error) {
    return res.status(error.status || 500).json({ error:error.message })
  }
})

app.post('/api/auth/password-reset/confirm', async (req, res) => {
  try {
    requireBackendConfig()
    const token = String(req.body?.token || '').trim()
    const password = String(req.body?.password || '')
    if (!token) return res.status(400).json({ error:'Ссылка восстановления отсутствует.' })
    if (password.length < 8) return res.status(400).json({ error:'Новый пароль должен содержать минимум 8 символов.' })

    let payload
    try {
      payload = jwt.verify(token, jwtSecret)
    } catch {
      return res.status(400).json({ error:'Ссылка восстановления недействительна или уже истекла. Запросите новую.' })
    }
    if (payload?.purpose !== 'password_reset' || !payload?.sub || !payload?.email || !payload?.pwd) {
      return res.status(400).json({ error:'Некорректная ссылка восстановления.' })
    }
    const result = await pool.query(
      'SELECT id,email,password_hash FROM users WHERE id=$1 AND email=$2',
      [payload.sub, String(payload.email).toLowerCase()]
    )
    const user = result.rows[0]
    if (!user) return res.status(400).json({ error:'Ссылка восстановления недействительна.' })
    const currentFingerprint = crypto.createHash('sha256').update(String(user.password_hash || '')).digest('hex').slice(0,24)
    if (currentFingerprint !== payload.pwd) {
      return res.status(400).json({ error:'Эта ссылка восстановления уже была использована. Запросите новую.' })
    }
    const passwordHash = await bcrypt.hash(password, 12)
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [passwordHash, user.id])
    return res.json({ ok:true, message:'Пароль изменён. Теперь войдите с новым паролем.' })
  } catch (error) {
    return res.status(error.status || 500).json({ error:error.message })
  }
})

app.post('/api/auth/login', async (req, res) => {
  try {
    requireBackendConfig()
    const email = String(req.body?.email || '').trim().toLowerCase(); const password = String(req.body?.password || '')
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email])
    const user = result.rows[0]
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Неверная почта или пароль' })
    res.json({ token: signToken(user), user: publicUser(user) })
  } catch (error) { res.status(error.status || 500).json({ error: error.message }) }
})

app.get('/api/auth/me', authRequired, async (req, res) => {
  const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.auth.sub])
  if (!result.rowCount) return res.status(404).json({ error: 'Пользователь не найден' })
  res.json({ user: publicUser(result.rows[0]) })
})

async function queueStagesFromWebhook(connectionId, events = []) {
  const stages = [...new Set(events.flatMap(eventStages).filter(stage=>WB_SYNC_STAGES[stage]))]
  for (const stage of stages) {
    const current = (await pool.query('SELECT * FROM wb_sync_states WHERE connection_id=$1 AND stage=$2',[connectionId,stage])).rows[0]
    if (current?.status === 'running' || current?.status === 'pending') continue
    await updateSyncState(connectionId,stage,{
      status:'queued',nextAllowedAt:new Date().toISOString(),lastError:null,
      metadata:{...(current?.metadata || {}),trigger:'webhook',webhookQueuedAt:new Date().toISOString()},
    })
  }
  if (stages.length) setTimeout(()=>kickBackgroundWorkers('webhook'),10).unref?.()
  return stages
}

async function persistWebhookEvents(connectionId, webhookId, incoming = []) {
  const events = (Array.isArray(incoming) ? incoming : []).slice(0,100).map(event=>({
    event,
    idempotencyKey:String(event?.idempotencyKey || event?.id || '').trim(),
    eventType:String(event?.type || '').trim(),
  })).filter(item=>item.idempotencyKey && item.eventType)
  if (!events.length) return []
  const params=[]
  const values=[]
  for (const item of events) {
    const event=item.event
    const row=[crypto.randomUUID(),connectionId,webhookId,String(event?.id || '') || null,item.idempotencyKey,item.eventType,String(event?.scope || '') || null,event?.time || null,Boolean(event?.test),JSON.stringify(event?.payload || {})]
    const placeholders=row.map(value=>{params.push(value);return `$${params.length}`})
    values.push(`(${placeholders.slice(0,9).join(',')},${placeholders[9]}::jsonb)`)
  }
  const result=await pool.query(`
    INSERT INTO wb_webhook_events(id,connection_id,webhook_id,wb_event_id,idempotency_key,event_type,event_scope,event_time,is_test,payload)
    VALUES ${values.join(',')}
    ON CONFLICT(connection_id,idempotency_key) DO NOTHING
    RETURNING idempotency_key,is_test
  `,params)
  const inserted=new Set(result.rows.filter(row=>!row.is_test).map(row=>String(row.idempotency_key)))
  return events.filter(item=>inserted.has(item.idempotencyKey)).map(item=>item.event)
}

app.post('/api/wb/webhooks/inbound/:connectionId/:receiverKey', async (req,res) => {
  try {
    const connectionId = String(req.params.connectionId || '')
    const receiverHash = receiverKeyHash(req.params.receiverKey)
    const webhookResult = await pool.query(`
      SELECT w.*,c.seller_id FROM wb_webhooks w
      JOIN marketplace_connections c ON c.id=w.connection_id
      WHERE w.connection_id=$1 AND w.receiver_key_hash=$2 AND w.enabled=TRUE
      LIMIT 1
    `,[connectionId,receiverHash])
    const webhook = webhookResult.rows[0]
    if (!webhook) return res.status(404).json({ok:false})
    const suppliedSecret = String(req.headers.authorization || '')
    const expectedSecret = webhook.secret_encrypted ? decryptToken(webhook.secret_encrypted) : ''
    if (!safeEqualSecret(suppliedSecret,expectedSecret)) return res.status(401).json({ok:false})
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    if (webhook.seller_id && body.sellerId && String(webhook.seller_id) !== String(body.sellerId)) return res.status(403).json({ok:false})
    const accepted = await persistWebhookEvents(connectionId,webhook.id,body.events)
    await Promise.all([
      pool.query('UPDATE wb_webhooks SET last_event_at=NOW(),updated_at=NOW() WHERE id=$1',[webhook.id]),
      pool.query(`INSERT INTO wb_live_sync_settings(connection_id,settings,last_event_at,updated_at)
        VALUES($1,$2::jsonb,NOW(),NOW())
        ON CONFLICT(connection_id) DO UPDATE SET last_event_at=NOW(),updated_at=NOW()`,[connectionId,JSON.stringify(defaultLiveSyncSettings())]),
    ])
    const liveRow=await liveSyncRow(connectionId)
    const liveEnabled=normalizeLiveSyncSettings(liveRow?.settings || {}).enabled
    // WB ждёт 200 не более 10 секунд. События сохраняются одним batch INSERT,
    // а тяжёлая синхронизация запускается уже после ответа.
    res.json({ok:true,accepted:accepted.length,queued:liveEnabled})
    ;(async()=>{
      if (liveEnabled) {
        await queueStagesFromWebhook(connectionId,accepted)
        // Для события готовности отчёта payload может не содержать тип отчёта.
        // В этом случае не создаём новый отчёт, а просто будим processors уже
        // сохранённых taskId — они сами заберут готовый файл.
        if (accepted.some(event=>String(event?.type || '').toLowerCase()==='report_generation_complete')) {
          setTimeout(()=>kickBackgroundWorkers('webhook-report-ready'),10).unref?.()
        }
      }
      const keys=accepted.map(event=>String(event?.idempotencyKey || event?.id || '')).filter(Boolean)
      if(keys.length) await pool.query('UPDATE wb_webhook_events SET processed_at=NOW() WHERE connection_id=$1 AND idempotency_key=ANY($2::text[])',[connectionId,keys])
    })().catch(error=>console.warn('Webhook stage queue failed:',error.message))
  } catch (error) {
    console.warn('WB webhook receiver failed:',error.message)
    res.status(500).json({ok:false})
  }
})

app.get('/api/wb/live/:id',authRequired,async(req,res)=>{
  const connection=await getConnection(req.auth.sub,req.params.id)
  if(!connection) return res.status(404).json({error:'Подключение не найдено'})
  const [status,webhooks]=await Promise.all([liveSyncStatus(connection.id),publicWebhookRows(connection.id)])
  res.json({status,webhooks})
})

app.put('/api/wb/live/:id',authRequired,async(req,res)=>{
  const connection=await getConnection(req.auth.sub,req.params.id)
  if(!connection) return res.status(404).json({error:'Подключение не найдено'})
  const status=await saveLiveSyncSettings(connection.id,req.body || {})
  if(status.enabled) setTimeout(()=>kickBackgroundWorkers('live-enabled'),10).unref?.()
  res.json({status})
})

app.post('/api/wb/live/:id/webhooks/setup',authRequired,async(req,res)=>{
  try {
    const connection=await getConnection(req.auth.sub,req.params.id)
    if(!connection) return res.status(404).json({error:'Подключение не найдено'})
    const secret=publicServiceSecretStatus()
    if(!wbCatalogServiceEnabled) return res.status(409).json({error:'Вебхуки доступны только после регистрации ELISEI в Каталоге решений WB. После одобрения установите WB_CATALOG_SERVICE_ENABLED=true.'})
    if(!secret.valid) return res.status(409).json({error:secret.error || 'Для вебхуков нужен WB_CLIENT_SECRET зарегистрированного сервиса.'})
    if(!publicBackendUrl) return res.status(409).json({error:'Укажите PUBLIC_BACKEND_URL в backend Render, чтобы WB мог отправлять вебхуки.'})
    const tokens=await getWbTokens(req.auth.sub,connection.id)
    const existing=await publicWebhookRows(connection.id)
    const created=[]
    const skipped=[]
    for(const group of WEBHOOK_GROUPS){
      if(existing.some(item=>item.name===group.name && item.enabled)){skipped.push(group.name);continue}
      if(!selectTokenRowForStage(tokens,group.stage)){skipped.push(`${group.name}: нет категории ${WB_SCOPE_BITS[WB_SYNC_STAGES[group.stage].scope]?.label || WB_SYNC_STAGES[group.stage].scope}`);continue}
      created.push(await createWbWebhook(connection,tokens,group))
      await sleep(1100)
    }
    const current=await liveSyncRow(connection.id)
    await saveLiveSyncSettings(connection.id,{...(current?.settings || {}),enabled:true,mode:'hybrid',webhooksEnabled:created.length>0 || existing.some(item=>item.enabled && ['active','local_ready'].includes(item.status))})
    res.json({ok:true,created,skipped,status:await liveSyncStatus(connection.id),webhooks:await publicWebhookRows(connection.id)})
  }catch(error){
    res.status(error.status || 502).json({error:error.message})
  }
})

app.get('/api/wb/oauth/readiness',authRequired,async(req,res)=>{
  res.json(oauthReadiness())
})

app.all('/api/wb/oauth/callback',(req,res)=>{
  res.status(409).json({
    error:'OAuth callback зарезервирован, но обмен кодом ещё не активирован. Нужны регистрация ELISEI в Каталоге решений WB и официальные параметры OAuth, выданные Wildberries.',
    code:'WB_OAUTH_REGISTRATION_REQUIRED',
  })
})

app.get('/api/wb/connection', authRequired, async (req, res) => {
  let connection = await getConnection(req.auth.sub)
  if (!connection) return res.json(publicConnection(null))
  await recoverLegacyFinanceCooldowns({ connectionId:connection.id })
  await recoverLegacySearchQueryBindings({ connectionId:connection.id })
  let [tokens, states] = await Promise.all([getWbTokens(req.auth.sub, connection.id), getSyncStates(connection.id)])
  // 5.10.1 migration: уже подключённому кабинету не нужно перевыпускать ключ
  // после обновления ELISEI. Первый просмотр сам поставит в очередь новые
  // доступные потоки и очистит старый ложный service-token блок у core-этапов.
  const oldServiceStatuses = new Set(['service_token_required','service_secret_required','service_token_invalid','service_permission_required'])
  const byStage = new Map(states.map(item => [item.stage,item]))
  const missingCoreStages = GENERAL_SYNC_STAGE_NAMES.filter(stage => {
    if (!selectTokenRowForStage(tokens,stage)) return false
    const state = byStage.get(stage)
    return !state || oldServiceStatuses.has(String(state.status || ''))
  })
  if (missingCoreStages.length) {
    await queueInitialCabinetSync(connection,tokens,{stages:missingCoreStages})
    states = await getSyncStates(connection.id)
  }
  // Render может приостанавливать обычные таймеры между обращениями. Каждый
  // просмотр кабинета дополнительно будит очередь просроченных этапов.
  const kick = kickBackgroundWorkers(`connection:${connection.id}`)
  await Promise.race([kick, sleep(650)])
  connection = await getConnection(req.auth.sub, connection.id)
  const refreshedConnectionState = await Promise.all([getWbTokens(req.auth.sub, connection.id), getSyncStates(connection.id)])
  tokens = refreshedConnectionState[0]
  states = refreshedConnectionState[1]
  res.json(publicConnection(connection, tokens, states))
})

async function queueInitialCabinetSync(connection, tokens, { stages = null } = {}) {
  const nowIso = new Date().toISOString()
  const today = nowIso.slice(0,10)
  const from = isoDaysAgo(29).slice(0,10)
  const range = analyticsPeriodRange({ from, to:today })
  const requested = (Array.isArray(stages) ? stages : GENERAL_SYNC_STAGE_NAMES)
    .filter(stage => WB_SYNC_STAGES[stage] && selectTokenRowForStage(tokens,stage))
  const schedule = initialStageSchedule(requested,{now:Date.now()})
  const scheduleByStage = new Map(schedule.map(item => [item.stage,item]))
  for (const stage of requested) {
    const period = ['advertising','searchQueries','stockHistory','finance','acquiring','documents'].includes(stage)
      ? syncPeriodForStage(stage,range)
      : null
    const slot = scheduleByStage.get(stage)
    await updateSyncState(connection.id,stage,{
      status:'queued',lastAttemptAt:null,nextAllowedAt:slot?.nextAllowedAt || nowIso,lastError:null,lastCount:0,taskId:null,
      metadata:{
        ...initialPeriodStageMetadata(stage,period),
        ...(stage === 'searchQueries' ? {searchBindingVersion:SEARCH_BINDING_VERSION,phase:'overview'} : {}),
        ...smartSchedulerMeta(stage,{reason:'initial_sync',sequence:slot?.sequence || null,scheduledAt:slot?.nextAllowedAt || nowIso}),
      },
    })
  }
  if (requested.length) setTimeout(() => kickBackgroundWorkers(`initial-sync:${connection.id}`),25).unref?.()
  return requested
}

app.post('/api/wb/connect', authRequired, async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim()
    const requestedLabel = String(req.body?.label || '').trim().slice(0, 80)
    if (token.length < 40) return res.status(400).json({ error: 'API-ключ выглядит слишком коротким' })
    const info = await probeToken(token)
    let connection = await getConnection(req.auth.sub)
    const wasConnected = Boolean(connection)
    const beforeTokens = connection ? await getWbTokens(req.auth.sub,connection.id) : []
    const previousScopes = new Set(unionTokenScopes(beforeTokens))
    if (connection?.seller_id && info.sellerId && connection.seller_id !== info.sellerId) {
      return res.status(409).json({ error: 'Этот токен относится к другому кабинету продавца. Для другого кабинета потребуется отдельный магазин ELISEI.' })
    }
    const label = requestedLabel || (!wasConnected ? 'Основной токен WB' : 'Резервный токен WB')
    if (!connection) {
      const result = await pool.query(`
        INSERT INTO marketplace_connections (id,user_id,marketplace,token_encrypted,scopes,status,seller_id)
        VALUES ($1,$2,'wildberries',$3,$4::jsonb,'connected',$5)
        RETURNING *
      `, [crypto.randomUUID(), req.auth.sub, encryptToken(token), JSON.stringify(info.scopes), info.sellerId || null])
      connection = result.rows[0]
    }
    const encrypted = encryptToken(token)
    const fingerprint = tokenFingerprint(token)
    await pool.query(`
      INSERT INTO wb_tokens (id,connection_id,user_id,label,token_encrypted,token_fingerprint,seller_id,token_type,token_type_label,scopes,read_only,expires_at,status,last_checked_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,'active',NOW())
      ON CONFLICT (user_id,token_fingerprint) DO UPDATE SET
        label=EXCLUDED.label,token_encrypted=EXCLUDED.token_encrypted,seller_id=EXCLUDED.seller_id,
        token_type=EXCLUDED.token_type,token_type_label=EXCLUDED.token_type_label,scopes=EXCLUDED.scopes,
        read_only=EXCLUDED.read_only,expires_at=EXCLUDED.expires_at,status='active',last_checked_at=NOW(),updated_at=NOW()
    `, [crypto.randomUUID(), connection.id, req.auth.sub, label, encrypted, fingerprint, info.sellerId || null, info.typeId, info.tokenType, JSON.stringify(info.scopes), info.readOnly, info.expiresAt])
    await recomputePrimaryToken(connection.id)
    const tokens = await getWbTokens(req.auth.sub, connection.id)
    const scopes = unionTokenScopes(tokens)
    const updated = await pool.query(`UPDATE marketplace_connections SET seller_id=COALESCE(seller_id,$1),scopes=$2::jsonb,status='connected',updated_at=NOW() WHERE id=$3 AND user_id=$4 RETURNING *`, [info.sellerId || null, JSON.stringify(scopes), connection.id, req.auth.sub])
    const stagesToQueue = wasConnected
      ? GENERAL_SYNC_STAGE_NAMES.filter(stage => {
          const scope = WB_SYNC_STAGES[stage]?.scope
          return scope && !previousScopes.has(scope) && scopes.includes(scope)
        })
      : GENERAL_SYNC_STAGE_NAMES
    const autoSyncStages = await queueInitialCabinetSync(updated.rows[0],tokens,{ stages:stagesToQueue })
    const states = await getSyncStates(connection.id)
    res.json({
      ...publicConnection(updated.rows[0], tokens, states),
      autoSyncStarted:autoSyncStages.length > 0,
      autoSyncStages,
      autoSyncMessage:autoSyncStages.length ? 'ELISEI начал автоматическую загрузку доступных данных кабинета.' : 'Ключ сохранён; доступные потоки уже подключены.',
    })
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message })
  }
})

app.delete('/api/wb/tokens/:tokenId', authRequired, async (req, res) => {
  const connection = await getConnection(req.auth.sub)
  if (!connection) return res.status(404).json({ error: 'Подключение не найдено' })
  await pool.query('DELETE FROM wb_tokens WHERE id=$1 AND user_id=$2 AND connection_id=$3', [req.params.tokenId, req.auth.sub, connection.id])
  const remaining = await pool.query(`SELECT 1 FROM wb_tokens WHERE connection_id=$1 AND status='active' LIMIT 1`, [connection.id])
  if (remaining.rows.length) await recomputePrimaryToken(connection.id)
  const tokens = await getWbTokens(req.auth.sub, connection.id)
  const scopes = unionTokenScopes(tokens)
  const hasToken = tokens.length > 0
  const updated = await pool.query(`UPDATE marketplace_connections SET scopes=$1::jsonb,status=$2,updated_at=NOW() WHERE id=$3 AND user_id=$4 RETURNING *`, [JSON.stringify(scopes), hasToken ? 'connected' : 'needs_token', connection.id, req.auth.sub])
  const states = await getSyncStates(connection.id)
  res.json(publicConnection(updated.rows[0], tokens, states))
})

app.post('/api/wb/tokens/:tokenId/primary', authRequired, async (req, res) => {
  try {
    const connection = await getConnection(req.auth.sub)
    if (!connection) return res.status(404).json({ error: 'Подключение не найдено' })
    const tokenResult = await pool.query(`SELECT * FROM wb_tokens WHERE id=$1 AND user_id=$2 AND connection_id=$3 AND status='active'`, [req.params.tokenId, req.auth.sub, connection.id])
    if (!tokenResult.rows[0]) return res.status(404).json({ error: 'API-токен не найден' })
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('UPDATE wb_tokens SET is_primary=FALSE,updated_at=NOW() WHERE connection_id=$1 AND is_primary=TRUE', [connection.id])
      await client.query('UPDATE wb_tokens SET is_primary=TRUE,updated_at=NOW() WHERE id=$1 AND connection_id=$2', [req.params.tokenId, connection.id])
      await client.query('UPDATE marketplace_connections SET token_encrypted=$1,updated_at=NOW() WHERE id=$2', [tokenResult.rows[0].token_encrypted, connection.id])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
    const refreshedConnection = await getConnection(req.auth.sub, connection.id)
    const [tokens, states] = await Promise.all([getWbTokens(req.auth.sub, connection.id), getSyncStates(connection.id)])
    res.json(publicConnection(refreshedConnection, tokens, states))
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message })
  }
})

app.get('/api/wb/status/:id', authRequired, async (req, res) => {
  let connection = await getConnection(req.auth.sub, req.params.id)
  if (!connection) return res.status(404).json({ error: 'Подключение не найдено' })
  // После перезапуска Render в БД мог остаться status=running, хотя процесса уже нет.
  // Watchdog переводит такой этап обратно в очередь и не позволяет ему блокировать остальные потоки.
  await recoverStaleSyncStates({ connectionId:connection.id, reason:'status-heartbeat' })
  await recoverLegacySearchQueryBindings({ connectionId:connection.id })
  // Статус опрашивается открытым интерфейсом. Используем этот heartbeat как
  // надёжный запуск фоновой очереди после окончания next_allowed_at.
  const kick = kickBackgroundWorkers(`status:${connection.id}`)
  await Promise.race([kick, sleep(650)])
  connection = await getConnection(req.auth.sub, connection.id)
  const [tokens, states] = await Promise.all([getWbTokens(req.auth.sub, connection.id), getSyncStates(connection.id)])
  res.json(publicConnection(connection, tokens, states))
})


app.get('/api/wb/documents/:serviceName/download', authRequired, async (req, res) => {
  try {
    const connection=await getConnection(req.auth.sub,String(req.query.connectionId||'')||null)
    if (!connection) return res.status(404).json({error:'Подключение не найдено'})
    const serviceName=String(req.params.serviceName||'').trim()
    const extension=String(req.query.extension||'').trim().replace(/^\./,'').toLowerCase()
    if (!serviceName || serviceName.length>240) return res.status(400).json({error:'Не указан идентификатор документа WB'})
    if (!/^[a-z0-9]{1,12}$/.test(extension)) return res.status(400).json({error:'Недопустимое расширение документа'})
    const tokens=await getWbTokens(req.auth.sub,connection.id)
    const selected=chooseTokenForStage(tokens,'documents')
    if (!selected) return res.status(403).json({error:'Нужен API-токен WB с категорией «Документы»'})
    const params=new URLSearchParams({serviceName,extension})
    const endpoint=`https://documents-api.wildberries.ru/api/v1/documents/download?${params.toString()}`
    const buffer=await wbFetchBuffer(endpoint,selected.token,{label:'Скачивание документа WB',timeoutMs:90000})
    const contentTypes={pdf:'application/pdf',zip:'application/zip',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',xls:'application/vnd.ms-excel',csv:'text/csv; charset=utf-8',xml:'application/xml',json:'application/json'}
    const safeName=serviceName.replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]+/g,'_').slice(0,120) || 'wildberries-document'
    res.setHeader('Content-Type',contentTypes[extension] || 'application/octet-stream')
    res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(`${safeName}.${extension}`)}`)
    res.setHeader('Cache-Control','private, no-store')
    res.send(buffer)
  } catch (error) {
    res.status(error.status||502).json({error:error.message,code:error.code||null,nextAllowedAt:error.nextAllowedAt||null})
  }
})

app.get('/api/wb/extended/:stream', authRequired, async (req, res) => {
  try {
    const stream=String(req.params.stream||'')
    if (!EXTENDED_OBJECT_STAGES.has(stream)) return res.status(404).json({error:'Неизвестный расширенный поток WB'})
    const connection=await getConnection(req.auth.sub,String(req.query.connectionId||'')||null)
    if (!connection) return res.status(404).json({error:'Подключение не найдено'})
    const limit=Math.max(20,Math.min(500,Number(req.query.limit)||100))
    const afterKey=String(req.query.afterKey||'')
    const range=analyticsPeriodRange(req.query)
    const filters={
      ...(range ? {from:range.from,to:range.to} : {}),
      query:String(req.query.query||''),
      status:String(req.query.status||'all'),
      rating:String(req.query.rating||'all'),
      warehouse:String(req.query.warehouse||''),
    }
    if (['financeReports','acquiringReports','fbsArchive','measurementPenalties','deductionsReport','warehouseMeasurements','antifraudRetention','labelingRetention','documents','jamSubscription','searchQueries','stockHistory','reviews','questions','chats'].includes(stream)) {
      const [stateResult,storedResult]=await Promise.all([
        pool.query('SELECT * FROM wb_sync_states WHERE connection_id=$1 AND stage=$2',[connection.id,stream]),
        pool.query('SELECT payload,row_count,metadata,updated_at FROM wb_stream_data WHERE connection_id=$1 AND stream=$2',[connection.id,stream]),
      ])
      const state=stateResult.rows[0]||null
      const stored=storedResult.rows[0]||null
      const payload=stored?.payload&&typeof stored.payload==='object'?stored.payload:null
      const storedPeriod=payload?.period || state?.metadata?.period || null
      const storedFrom=dateKey(storedPeriod?.dateFrom || storedPeriod?.from || storedPeriod?.start)
      const storedTo=dateKey(storedPeriod?.dateTo || storedPeriod?.to || storedPeriod?.end)
      const searchPeriodExact=stream!=='searchQueries' || !range || (storedFrom===range.from && storedTo===range.to)

      if (stream==='searchQueries' && !searchPeriodExact) {
        return res.json({
          stream,rows:[],next:null,syncId:payload?.syncId||null,total:0,
          status:state?.status||'idle',state:state?publicSyncState(state):null,payload,
          summary:{total:0},updatedAt:stored?.updated_at||null,
          period:range?{from:range.from,to:range.to,days:range.days}:null,
          coverage:{available:{from:storedFrom,to:storedTo},exact:false,reason:'search_report_requires_exact_period'},
        })
      }

      const page=await latestExtendedRows(connection.id,stream,{afterKey,limit,...filters})
      const calculated=await extendedStreamSummary(connection.id,stream,page.syncId,filters)
      let rows=page.rows
      let total=page.total
      let summary=calculated.summary
      if (!page.syncId && !afterKey && Array.isArray(payload?.rows)) {
        const query=filters.query.trim().toLowerCase()
        rows=payload.rows.filter(row=>{
          const rowDate=dateKey(row?.date || row?.createdDate || row?.createdAt || row?.addTimestamp || row?.timestamp)
          if (range && extendedDateExpression(stream) && (!rowDate || rowDate<range.from || rowDate>range.to)) return false
          if (query && !JSON.stringify(row).toLowerCase().includes(query)) return false
          if (filters.status==='answered' && !row?.isAnswered) return false
          if (filters.status==='unanswered' && (row?.isAnswered || row?.archived)) return false
          if (filters.status==='archived' && !row?.archived) return false
          if (['chat','event','group','query'].includes(filters.status) && row?.rowType!==filters.status) return false
          if (filters.rating!=='all' && Number(row?.productValuation ?? row?.valuation ?? row?.rating)!==Number(filters.rating)) return false
          if (filters.warehouse && String(row?.warehouse || row?.warehouseName || '')!==filters.warehouse) return false
          return true
        })
        total=rows.length
        rows=rows.slice(0,limit)
      }
      const available=calculated.availablePeriod || (storedFrom||storedTo?{from:storedFrom,to:storedTo}:null)
      return res.json({
        stream,rows,next:page.rows.length>=limit?page.next:null,syncId:page.syncId||payload?.syncId||null,total,
        status:state?.status||'idle',state:state?publicSyncState(state):null,payload,summary,updatedAt:stored?.updated_at||null,
        period:range?{from:range.from,to:range.to,days:range.days}:null,
        coverage:{
          available,
          exact:!range || !available?.from || !available?.to || (range.from>=available.from && range.to<=available.to),
          requested:range?{from:range.from,to:range.to}:null,
        },
      })
    }
    const stored=await pool.query('SELECT payload,row_count,metadata,updated_at FROM wb_stream_data WHERE connection_id=$1 AND stream=$2',[connection.id,stream])
    const row=stored.rows[0]
    const payload=row?.payload&&typeof row.payload==='object'?row.payload:{rows:[],totalRows:0}
    const rows=Array.isArray(payload.rows)?payload.rows.slice(0,limit):[]
    return res.json({stream,rows,total:Number(payload.totalRows??row?.row_count??rows.length),payload,updatedAt:row?.updated_at||null})
  } catch (error) {
    res.status(error.status||500).json({error:error.message})
  }
})


function boundedSyncPeriod(range, maxDays) {
  if (!range) return null
  const days=Math.max(1,Math.min(Number(maxDays || range.days),range.days))
  const end=new Date(`${range.to}T00:00:00.000Z`)
  const start=new Date(end.getTime()-(days-1)*86400000)
  return {
    dateFrom:start.toISOString().slice(0,10),dateTo:range.to,days,
    requestedFrom:range.from,requestedTo:range.to,requestedDays:range.days,
    limited:range.days>days,
  }
}

function syncPeriodForStage(stage, range) {
  if (!range) return null
  if (stage==='stockHistory') return boundedSyncPeriod(range,90)
  if (stage==='advertising') return boundedSyncPeriod(range,31)
  if (stage==='searchQueries') return boundedSyncPeriod(range,365)
  return boundedSyncPeriod(range,366)
}

function initialPeriodStageMetadata(stage, period) {
  if (!period) return {}
  if (stage==='searchQueries') {
    const detailRange=analyticsPeriodRange({from:period.dateFrom,to:period.dateTo})
    const detailPeriod=boundedSyncPeriod(detailRange,7)
    return {period,detailPeriod,syncId:crypto.randomUUID(),phase:'overview',offset:0,pageNumber:0,productOffset:0,persistedCount:0,summary:{}}
  }
  if (stage==='stockHistory') return {period,syncId:crypto.randomUUID(),reportId:crypto.randomUUID(),phase:'create',pollAttempts:0,persistedCount:0,reportType:'STOCK_HISTORY_DAILY_CSV'}
  if (stage==='advertising') return {period,nextStatsOffset:0}
  return {period}
}

app.post('/api/wb/sync', authRequired, async (req, res) => {
  const connection = await getConnection(req.auth.sub, String(req.body?.connectionId || '') || null)
  if (!connection) return res.status(404).json({ error: 'Подключение не найдено. Подключите Wildberries.' })
  await recoverStaleSyncStates({ connectionId:connection.id, reason:'manual-sync' })
  const allRequestedStages = Array.isArray(req.body?.stages) ? req.body.stages.filter(stage => WB_SYNC_STAGES[stage]) : [...GENERAL_SYNC_STAGE_NAMES]
  if (!allRequestedStages.length) return res.status(400).json({ error: 'Не выбраны этапы синхронизации' })
  const backgroundArchiveStages = allRequestedStages.length > 1 ? allRequestedStages.filter(stage => ARCHIVE_SYNC_STAGES.includes(stage)) : []
  const requestedStages = allRequestedStages.filter(stage => !backgroundArchiveStages.includes(stage))
  const requestedRange = analyticsPeriodRange(req.body?.period || {})
  if (requestedRange) {
    for (const stage of allRequestedStages.filter(item => ['advertising','searchQueries','stockHistory','finance','acquiring','documents'].includes(item))) {
      const period = syncPeriodForStage(stage,requestedRange)
      await updateSyncState(connection.id,stage,{
        status:'queued',lastAttemptAt:null,nextAllowedAt:null,lastError:null,lastCount:0,taskId:null,
        metadata:initialPeriodStageMetadata(stage,period),
      })
    }
  }

  const syncKey = `${req.auth.sub}:${connection.id}`
  if (activeSyncs.has(syncKey)) return res.status(409).json({ error: 'Синхронизация уже выполняется. Дождитесь её завершения.' })

  activeSyncs.add(syncKey)
  const startedAt = Date.now()
  const deadlineAt = startedAt + 100000
  try {
    const tokens = await getWbTokens(req.auth.sub, connection.id)
    if (!tokens.length) return res.status(400).json({ error: 'Добавьте хотя бы один API-токен Wildberries' })
    const canonical = await canonicalConnectionData(connection, { repair:true, persistManifest:false, queueMissing:false })
    const data = canonical.data
    const stageStatus = { ...(data.stageStatus || {}) }
    const warnings = []
    const results = []

    for (const stage of backgroundArchiveStages) {
      const queuedState = await updateSyncState(connection.id,stage,{
        status:'queued',nextAllowedAt:new Date().toISOString(),lastError:'Архив FBS вынесен в отдельную фоновую полосу и не блокирует оперативные потоки.',
      })
      const value = previousStageValue(data,stage)
      results.push({ stage,status:'queued',value,state:queuedState })
      stageStatus[stage] = {
        status:'queued',available:stageCount(stage,value)>0,count:stageCount(stage,value),
        lastSuccessAt:queuedState.last_success_at||null,nextAllowedAt:queuedState.next_allowed_at||null,error:queuedState.last_error||null,
      }
      warnings.push('Архив FBS: продолжение поставлено в отдельную фоновую полосу и не задерживает финансы, документы и другие потоки.')
    }

    for (const stage of requestedStages) {
      if (Date.now() >= deadlineAt - 1500) {
        const queuedState = await updateSyncState(connection.id, stage, {
          status:'queued', lastAttemptAt:new Date().toISOString(), nextAllowedAt:new Date().toISOString(),
          lastError:'Этап поставлен в фоновую очередь после достижения общего лимита времени.',
        })
        stageStatus[stage] = {
          status:'queued', available:stage === 'stocks' ? isTrustedStockSnapshot(data) : stageCount(stage, previousStageValue(data, stage)) > 0,
          count:stageCount(stage, previousStageValue(data, stage)), lastSuccessAt:queuedState.last_success_at || null,
          nextAllowedAt:queuedState.next_allowed_at || null, error:queuedState.last_error || null,
        }
        warnings.push(`${WB_SYNC_STAGES[stage].label}: этап поставлен в фоновую очередь из-за общего лимита времени.`)
        continue
      }
      const result = await runSyncStage({ connection, tokens, data, stage, deadlineAt })
      results.push(result)
      if (result.warning) warnings.push(result.warning)
      if (result.status === 'success' || (result.status === 'queued' && stageCount(stage,result.value) > 0)) {
        data[stageDataKey(stage)] = result.value
        if (stage === 'stocks') data.stockMeta = result.meta || buildStockMeta(result.value)
      }
      const stageAvailable = stage === 'stocks'
        ? isTrustedStockSnapshot(data)
        : (result.status === 'success' || stageCount(stage, result.value) > 0)
      stageStatus[stage] = {
        status: result.status,
        available: stageAvailable,
        count: stageCount(stage, result.value),
        lastSuccessAt: result.state?.last_success_at || null,
        nextAllowedAt: result.state?.next_allowed_at || null,
        error: result.state?.last_error || null,
      }
    }

    data.stageStatus = stageStatus
    data.syncWarnings = warnings
    rebuildUnifiedProductData(data)
    const counts = {
      products: data.products.length,
      orders: Array.isArray(data.orders) ? data.orders.length : 0,
      sales: Array.isArray(data.sales) ? data.sales.length : 0,
      stocks: Array.isArray(data.stocks) ? data.stocks.length : 0,
      sellerStocks: Array.isArray(data.sellerStocks) ? data.sellerStocks.length : 0,
      advertising: Array.isArray(data.advertising?.campaigns) ? data.advertising.campaigns.length : 0,
      finance: Array.isArray(data.finance?.rows) ? data.finance.rows.length : 0,
      paidStorage: Array.isArray(data.paidStorage) ? data.paidStorage.length : 0,
      acceptance: Array.isArray(data.acceptance) ? data.acceptance.length : 0,
      acquiring: Array.isArray(data.acquiring?.rows) ? data.acquiring.rows.length : 0,
    }
    const hasSuccess = results.some(result => result.status === 'success' || (result.status === 'queued' && stageCount(result.stage,result.value) > 0))
    const history = withSyncLog(connection.sync_history, {
      status: hasSuccess ? 'success' : 'partial', durationMs: Date.now() - startedAt, counts, warnings,
      stages: Object.fromEntries(results.map(result => [result.stage, result.status])),
    })
    const compactData = compactConnectionData(data, streamSourcesFromData(data, 'sync'))
    const updated = await pool.query(`UPDATE marketplace_connections SET data=$1::jsonb,sync_history=$2::jsonb,last_sync_at=CASE WHEN $3 THEN NOW() ELSE last_sync_at END,updated_at=NOW(),status='connected' WHERE id=$4 AND user_id=$5 RETURNING *`, [JSON.stringify(compactData), JSON.stringify(history), hasSuccess, connection.id, req.auth.sub])
    const row = updated.rows[0]
    const settings = await getBusinessSettings(req.auth.sub)
    const core = buildCoreAnalytics(data, settings)
    const states = await getSyncStates(connection.id)
    res.json({ ok:true, partial:warnings.length > 0, warnings, lastSync:row.last_sync_at, counts, dashboard:buildDashboard(data, settings), core, syncHistory:history, syncStates:states.map(publicSyncState) })
  } catch (error) {
    const history = withSyncLog(connection.sync_history, { status:'error', message:error.message, durationMs:Date.now() - startedAt })
    await pool.query(`UPDATE marketplace_connections SET sync_history=$1::jsonb,updated_at=NOW(),status='error' WHERE id=$2 AND user_id=$3`, [JSON.stringify(history), connection.id, req.auth.sub])
    res.status(error.status || 502).json({ error:error.message })
  } finally {
    activeSyncs.delete(syncKey)
  }
})


function analyticsPeriodRange(input = {}) {
  const from = dateKey(input?.from || input?.dateFrom || input?.start)
  const to = dateKey(input?.to || input?.dateTo || input?.end)
  if (!from || !to) return null
  const fromDate = new Date(`${from}T00:00:00.000Z`)
  const toDate = new Date(`${to}T00:00:00.000Z`)
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) return null
  const days = Math.max(1, Math.floor((toDate - fromDate) / 86400000) + 1)
  if (days > 366) {
    const error = new Error('Для интерактивной аналитики выберите период не более 366 дней.')
    error.status = 400
    throw error
  }
  return { from, to, fromDate, toDate, days }
}

function analyticsDateForRow(row = {}, keys = []) {
  for (const key of keys) {
    const value = row?.[key]
    const date = dateKey(value)
    if (date) return date
  }
  return ''
}

function analyticsFilterRows(rows, range, keys) {
  if (!Array.isArray(rows)) return []
  if (!range) return rows
  return rows.filter(row => {
    const date = analyticsDateForRow(row, keys)
    return date && date >= range.from && date <= range.to
  })
}

function analyticsAvailableRange(rows = [], keys = []) {
  const dates = (Array.isArray(rows) ? rows : []).map(row => analyticsDateForRow(row, keys)).filter(Boolean).sort()
  return { from:dates[0] || null, to:dates.at(-1) || null, totalRows:dates.length }
}

function analyticsMetrics(rows = []) {
  const totals = rows.reduce((acc, row) => {
    acc.views += Number(row?.views || 0)
    acc.clicks += Number(row?.clicks || 0)
    acc.spend += Number(row?.spend || 0)
    acc.orders += Number(row?.orders || 0)
    acc.revenue += Number(row?.revenue || 0)
    return acc
  }, { views:0, clicks:0, spend:0, orders:0, revenue:0 })
  totals.ctr = totals.views > 0 ? totals.clicks / totals.views * 100 : null
  totals.cpc = totals.clicks > 0 ? totals.spend / totals.clicks : null
  totals.crr = totals.revenue > 0 ? totals.spend / totals.revenue * 100 : null
  totals.romi = totals.spend > 0 ? (totals.revenue - totals.spend) / totals.spend * 100 : null
  totals.orderConversion = totals.clicks > 0 ? totals.orders / totals.clicks * 100 : null
  return totals
}

function analyticsFilterAdvertising(advertising = {}, range = null) {
  if (!range || !advertising || typeof advertising !== 'object') return advertising
  const campaigns = (Array.isArray(advertising.campaigns) ? advertising.campaigns : []).map(campaign => {
    const dailyStats = analyticsFilterRows(campaign?.dailyStats, range, ['date','day','dt'])
    const snapshotFrom = dateKey(advertising?.period?.from || advertising?.period?.beginDate || advertising?.period?.dateFrom)
    const snapshotTo = dateKey(advertising?.period?.to || advertising?.period?.endDate || advertising?.period?.dateTo)
    const exactSnapshot = snapshotFrom === range.from && snapshotTo === range.to
    if (!dailyStats.length) {
      return {
        ...campaign,
        dailyStats:[], nmStats:[], views:null, clicks:null, spend:null, orders:null, revenue:null,
        ctr:null, cpc:null, crr:null, romi:null, orderConversion:null,
        statsStatus:'period_not_loaded', statsAvailable:false,
      }
    }
    const metrics = analyticsMetrics(dailyStats)
    return {
      ...campaign,
      ...metrics,
      dailyStats,
      // Детализация по nmID в сохранённом fullstats агрегирована за весь снимок.
      // Для другого диапазона не переносим её как точный факт: расход распределится по выручке.
      nmStats:exactSnapshot ? (Array.isArray(campaign.nmStats) ? campaign.nmStats : []) : [],
      statsStatus:'loaded', statsAvailable:true,
    }
  })
  const loaded = campaigns.filter(item => item.statsStatus === 'loaded')
  const dailyMap = new Map()
  loaded.forEach(campaign => (campaign.dailyStats || []).forEach(row => {
    const current = dailyMap.get(row.date) || { date:row.date, views:0, clicks:0, spend:0, orders:0, revenue:0 }
    for (const key of ['views','clicks','spend','orders','revenue']) current[key] += Number(row?.[key] || 0)
    dailyMap.set(row.date,current)
  }))
  const daily = [...dailyMap.values()].sort((a,b) => a.date.localeCompare(b.date)).map(row => ({ ...row, ...analyticsMetrics([row]) }))
  return {
    ...advertising,
    campaigns,
    daily,
    totals:analyticsMetrics(loaded),
    period:{ from:range.from, to:range.to },
    statsLoadedCampaigns:loaded.length,
    statsPendingCampaigns:campaigns.length - loaded.length,
    periodFiltered:true,
  }
}

function analyticsFilterConnectionData(rawData = {}, range = null) {
  if (!range) return { ...rawData }
  const orderKeys = ['date','orderDate','lastChangeDate','createdAt','updatedAt']
  const saleKeys = ['sale_dt','saleDt','date','lastChangeDate','createdAt','updatedAt']
  const financeKeys = ['rrDate','rr_dt','saleDt','sale_dt','orderDt','order_dt','date','operationDate','createDate']
  const storageKeys = ['date','warehouseCalcDate','calcDate','rrDate','createDate']
  const acceptanceKeys = ['date','acceptanceDate','createDate']
  const acquiringKeys = ['date','transactionDate','rrDate','rr_dt','createDate']
  const orders = analyticsFilterRows(rawData.orders, range, orderKeys)
  const sales = analyticsFilterRows(rawData.sales, range, saleKeys)
  const financeRows = analyticsFilterRows(rawData?.finance?.rows, range, financeKeys)
  const paidStorage = analyticsFilterRows(rawData.paidStorage, range, storageKeys)
  const acceptance = analyticsFilterRows(rawData.acceptance, range, acceptanceKeys)
  const acquiringRows = analyticsFilterRows(rawData?.acquiring?.rows, range, acquiringKeys)
  const finance = rawData?.finance && typeof rawData.finance === 'object' && !Array.isArray(rawData.finance)
    ? { ...rawData.finance, rows:financeRows, totals:summarizeFinanceRows(financeRows), period:{ from:range.from,to:range.to } }
    : rawData.finance
  const acquiring = rawData?.acquiring && typeof rawData.acquiring === 'object' && !Array.isArray(rawData.acquiring)
    ? { ...rawData.acquiring, rows:acquiringRows, period:{ from:range.from,to:range.to } }
    : rawData.acquiring
  return {
    ...rawData,
    orders,
    sales,
    finance,
    paidStorage,
    acceptance,
    acquiring,
    advertising:analyticsFilterAdvertising(rawData.advertising, range),
    __periodDays:range.days,
    __periodFrom:range.from,
    __periodTo:range.to,
    __periodFiltered:true,
    __periodCoverage:{
      requested:{ from:range.from,to:range.to,days:range.days },
      orders:{ ...analyticsAvailableRange(rawData.orders,orderKeys),selectedRows:orders.length },
      sales:{ ...analyticsAvailableRange(rawData.sales,saleKeys),selectedRows:sales.length },
      finance:{ ...analyticsAvailableRange(rawData?.finance?.rows,financeKeys),selectedRows:financeRows.length },
      advertising:{
        from:dateKey(rawData?.advertising?.period?.from || rawData?.advertising?.period?.beginDate || rawData?.advertising?.period?.dateFrom) || null,
        to:dateKey(rawData?.advertising?.period?.to || rawData?.advertising?.period?.endDate || rawData?.advertising?.period?.dateTo) || null,
        selectedRows:Array.isArray(rawData?.advertising?.daily) ? analyticsFilterRows(rawData.advertising.daily,range,['date']).length : 0,
      },
    },
  }
}

app.get('/api/wb/dashboard/:id', authRequired, async (req, res) => {
  const connection = await getConnection(req.auth.sub, req.params.id)
  if (!connection) return res.status(404).json({ error: 'Подключение не найдено' })
  const [{ data, sources, recovered, recoveryQueued }, settings] = await Promise.all([
    canonicalConnectionData(connection),
    getBusinessSettings(req.auth.sub),
  ])
  res.json({ dashboard: buildDashboard(data, settings), dataSources:sources, recovered, recoveryQueued, lastSync: connection.last_sync_at || null })
})

app.get('/api/wb/core/:id', authRequired, async (req, res) => {
  const connection = await getConnection(req.auth.sub, req.params.id)
  if (!connection) return res.status(404).json({ error: 'Подключение не найдено' })
  const [{ data, sources, recovered, recoveryQueued }, settings] = await Promise.all([
    canonicalConnectionData(connection),
    getBusinessSettings(req.auth.sub),
  ])
  const range = analyticsPeriodRange(req.query)
  const selectedData = analyticsFilterConnectionData(data, range)
  res.json({
    core: buildCoreAnalytics(selectedData, settings),
    period:range ? { from:range.from, to:range.to, days:range.days } : null,
    dataSources:sources, recovered, recoveryQueued, lastSync: connection.last_sync_at || null,
  })
})


app.get('/api/wb/daily-ready/:id', authRequired, async (req,res) => {
  try {
    const connection=await getConnection(req.auth.sub,req.params.id)
    if(!connection) return res.status(404).json({error:'Подключение не найдено'})
    const requested=String(req.query.date || '').slice(0,10)
    const date=/^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : yesterdayDateKey(new Date(),dailyReadyTimezone)
    const states=await getSyncStates(connection.id)
    const revision=dailySnapshotSourceRevision(states,date)
    let row=await loadDailySnapshotRow(connection.id,date)
    let stale=false

    // 5.13.2: вход пользователя читает уже сохранённый снимок и никогда не
    // заставляет его исчезнуть на время фонового пересчёта. Если снимок есть,
    // обновляем его асинхронно из локальной БД. Только самый первый bootstrap,
    // когда строки ещё нет вообще, может построить снимок синхронно — без WB API.
    if(!row){
      row=await buildAndSaveDailyReadySnapshot(connection,date,states)
    } else if(snapshotNeedsRefresh(row,revision,{maxAgeMs:6*60*60*1000,now:Date.now()})){
      stale=true
      setTimeout(() => {
        buildAndSaveDailyReadySnapshot(connection,date)
          .catch(error=>console.warn(`Daily Ready background refresh failed for ${connection.id}:`,error.message))
      },10).unref?.()
    }

    res.json({
      snapshot:row?.snapshot || null,
      meta:{
        date,timezone:dailyReadyTimezone,status:row?.status || row?.snapshot?.status || 'waiting',
        generatedAt:row?.generated_at || row?.snapshot?.generatedAt || null,stale,
        automatic:true,entryDoesNotTriggerWbSync:true,servesLastKnownGood:true,
      },
    })
  } catch(error){
    res.status(error.status || 500).json({error:error.message})
  }
})


function product360ExtendedIdentityClause(product, params = []) {
  const identities = product360Identities(product)
  const clauses = []
  const addArray = values => {
    const normalized = [...new Set((values || []).map(value=>String(value || '').trim()).filter(Boolean))]
    if (!normalized.length) return null
    params.push(normalized)
    return `$${params.length}::text[]`
  }

  const nmRef = addArray(identities.nmIDs)
  if (nmRef) clauses.push(`COALESCE(payload->>'nmID',payload->>'nmId',payload->>'nm_id',payload#>>'{productDetails,nmID}',payload#>>'{productDetails,nmId}',payload#>>'{product,nmID}',payload#>>'{product,nmId}',payload#>>'{details,nmID}',payload#>>'{details,nmId}')=ANY(${nmRef})`)

  const barcodeRef = addArray(identities.barcodes)
  if (barcodeRef) clauses.push(`COALESCE(payload->>'barcode',payload->>'barCode',payload->>'sku',payload#>>'{productDetails,barcode}',payload#>>'{productDetails,barCode}',payload#>>'{product,barcode}',payload#>>'{product,barCode}',payload#>>'{details,barcode}')=ANY(${barcodeRef})`)

  const vendorRef = addArray(identities.vendorCodes)
  if (vendorRef) clauses.push(`COALESCE(payload->>'vendorCode',payload->>'supplierArticle',payload->>'supplier_article',payload#>>'{productDetails,vendorCode}',payload#>>'{productDetails,supplierArticle}',payload#>>'{product,vendorCode}',payload#>>'{product,supplierArticle}',payload#>>'{details,vendorCode}',payload#>>'{details,supplierArticle}')=ANY(${vendorRef})`)

  const chrtRef = addArray(identities.chrtIDs)
  if (chrtRef) clauses.push(`COALESCE(payload->>'chrtID',payload->>'chrtId',payload->>'chrt_id',payload#>>'{productDetails,chrtID}',payload#>>'{product,chrtID}',payload#>>'{details,chrtID}')=ANY(${chrtRef})`)
  return clauses.length ? `(${clauses.join(' OR ')})` : ''
}

function isSubstitutedSearchRow(row = {}) {
  const value = row?.isSubstitutedSKU ?? row?.isSubstitutedSku ?? row?.isSubstituted ?? false
  if (value === true || value === 1) return true
  return /^(?:1|true|yes)$/i.test(String(value || '').trim())
}

function compactProduct360ExtendedRows(canonicalData, stream, product, range, limit = 120) {
  const payload = canonicalData?.[stream] && typeof canonicalData[stream] === 'object' ? canonicalData[stream] : {}
  const sample = elFilterExtendedRows(elExtendedPayloadRows(canonicalData,stream),stream,range)
    .filter(row=>stream !== 'searchQueries' || trustedWbSearchRowForProduct(row,product))
    .filter(row=>stream === 'searchQueries' || product360Matches(row,product).matched)
    .slice(0,Math.max(1,Math.min(200,Number(limit)||120)))
  const totalRows = Math.max(Number(payload?.totalRows || 0), Number(payload?.rows?.length || 0))
  const searchBindingVerified = stream !== 'searchQueries' || Number(payload?.searchBindingVersion || 0) >= SEARCH_BINDING_VERSION
  return {
    rows:sample,
    total:sample.length,
    source:sample.length ? 'wb_stream_data_sample' : (totalRows > 0 ? (searchBindingVerified ? 'wb_stream_data_sample_no_match' : 'legacy_search_hidden') : 'none'),
    syncId:payload?.syncId || null,
    availablePeriod:payload?.period || null,
    truncated:totalRows > Number(payload?.rows?.length || 0),
    sampleOnly:totalRows > Number(payload?.rows?.length || 0),
    searchBindingVersion:Number(payload?.searchBindingVersion || 0),
    searchBindingVerified,
  }
}

async function loadProduct360ExtendedRows(connectionId, canonicalData, stream, product, range, limit = 500) {
  // 5.11.3: SKU 360 must never scan the same heavy JSON stream 5x with payload::text ILIKE + COUNT.
  // One exact-identity pass over the latest sync is enough; JS re-validates every row afterwards.
  const latest = await pool.query(`
    SELECT sync_id FROM wb_stream_items
    WHERE connection_id=$1 AND stream=$2
    ORDER BY updated_at DESC LIMIT 1
  `,[connectionId,stream])
  const syncId = latest.rows[0]?.sync_id
  if (!syncId) return compactProduct360ExtendedRows(canonicalData,stream,product,range,limit)

  const params = [connectionId,stream,syncId]
  const where = [`connection_id=$1`,`stream=$2`,`sync_id=$3::uuid`]
  if (stream === 'searchQueries') {
    // SearchReportTextRes contains nmId. For SKU 360 this is the only admissible join key:
    // never infer ownership of a search phrase from vendorCode/barcode/chrtID.
    const nmIDs = product360Identities(product).nmIDs.map(value=>String(value || '').trim()).filter(Boolean)
    if (!nmIDs.length) return compactProduct360ExtendedRows(canonicalData,stream,product,range,limit)
    params.push([...new Set(nmIDs)])
    const nmRef = `$${params.length}::text[]`
    where.push(`COALESCE(payload->>'sourceNmID','')=ANY(${nmRef})`)
    where.push(`COALESCE(payload->>'nmID',payload->>'nmId',payload->>'nm_id')=ANY(${nmRef})`)
    where.push(`COALESCE(payload->>'rowType','')='query'`)
    where.push(`COALESCE(payload->>'searchBindingVersion','0')=$${params.length+1}`)
    params.push(String(SEARCH_BINDING_VERSION))
    where.push(`COALESCE(payload->>'searchOrigin','')='organic_product_search_texts'`)
    where.push(`LOWER(COALESCE(payload->>'isSubstitutedSKU',payload->>'isSubstitutedSku',payload->>'isSubstituted','false')) NOT IN ('true','1','yes')`)
  } else {
    const identityClause = product360ExtendedIdentityClause(product,params)
    if (!identityClause) return compactProduct360ExtendedRows(canonicalData,stream,product,range,limit)
    where.push(identityClause)
  }
  const dateExpression = extendedDateExpression(stream)
  if (dateExpression && range?.from && range?.to) {
    params.push(String(range.from).slice(0,10)); const fromRef = `$${params.length}`
    params.push(String(range.to).slice(0,10)); const toRef = `$${params.length}`
    where.push(`${dateExpression} BETWEEN ${fromRef} AND ${toRef}`)
  }
  const safeLimit = Math.max(1,Math.min(500,Number(limit)||500))
  params.push(safeLimit + 1)
  const page = await pool.query(`
    SELECT row_key,payload FROM wb_stream_items
    WHERE ${where.join(' AND ')}
    ORDER BY row_key
    LIMIT $${params.length}
  `,params)
  const matched = page.rows
    .map(item=>({rowKey:item.row_key,...item.payload}))
    .filter(row=>stream === 'searchQueries'
      ? trustedWbSearchRowForProduct(row,product)
      : product360Matches(row,product).matched)
  const compact = compactProduct360ExtendedRows(canonicalData,stream,product,range,limit)
  const rows = matched.length ? matched.slice(0,safeLimit) : compact.rows
  const searchBindingVerified = stream !== 'searchQueries' || Number(canonicalData?.[stream]?.searchBindingVersion || 0) >= SEARCH_BINDING_VERSION
  return {
    rows,
    total:rows.length,
    source:matched.length ? 'wb_stream_items_exact' : compact.source,
    syncId,
    availablePeriod:canonicalData?.[stream]?.period || compact.availablePeriod || null,
    truncated:page.rows.length > safeLimit || compact.truncated,
    sampleOnly:false,
    searchBindingVersion:Number(canonicalData?.[stream]?.searchBindingVersion || compact.searchBindingVersion || 0),
    searchBindingVerified,
  }
}

app.get('/api/wb/product-360/:id', authRequired, async (req, res) => {
  const connection = await getConnection(req.auth.sub, req.params.id)
  if (!connection) return res.status(404).json({ error:'Подключение не найдено' })
  const selector = String(req.query.productKey || req.query.key || req.query.nmID || req.query.vendorCode || '').trim()
  if (!selector) return res.status(400).json({ error:'Не указан товар для SKU 360' })

  try {
    const [{data,sources},settings,states] = await Promise.all([
      canonicalConnectionData(connection),
      getBusinessSettings(req.auth.sub),
      getSyncStates(connection.id),
    ])
    const range = analyticsPeriodRange(req.query)
    const selectedData = analyticsFilterConnectionData(data,range)
    const core = buildCoreAnalytics(selectedData,settings)
    const product = findProduct360Product(core.products || [],selector)
    if (!product) return res.status(404).json({ error:'Товар не найден в едином ядре ELISEI' })

    // 5.12.0: SKU 360 compares the selected period with the immediately preceding
    // period of the same length. This uses only already persisted cabinet data —
    // no extra WB API calls and no historical-current stock substitution.
    const compareRange = range ? previousEqualPeriod(range) : null
    const previousData = compareRange ? analyticsFilterConnectionData(data,compareRange) : null
    const previousCore = previousData ? buildCoreAnalytics(previousData,settings) : null
    const previousProduct = previousCore
      ? findProduct360Product(previousCore.products || [],String(product.nmID || product.vendorCode || selector))
      : null
    const comparisonCoverage = Boolean(
      range && compareRange && previousCore
      && elStageRangeCovered(core?.periodCoverage?.sales || {},range)
      && elStageRangeCovered(previousCore?.periodCoverage?.sales || {},compareRange)
    )
    const currentComparisonAvailability = {
      ...(core?.availability || {}),
      sales:Boolean(core?.availability?.sales && elStageRangeCovered(core?.periodCoverage?.sales || {},range)),
      orders:Boolean(core?.availability?.orders && elStageRangeCovered(core?.periodCoverage?.orders || {},range)),
      finance:Boolean(core?.availability?.finance && elStageRangeCovered(core?.periodCoverage?.finance || {},range)),
      advertising:Boolean(core?.availability?.advertising && elStageRangeCovered(core?.periodCoverage?.advertising || {},range)),
    }
    const previousComparisonAvailability = {
      ...(previousCore?.availability || {}),
      sales:Boolean(previousCore?.availability?.sales && elStageRangeCovered(previousCore?.periodCoverage?.sales || {},compareRange)),
      orders:Boolean(previousCore?.availability?.orders && elStageRangeCovered(previousCore?.periodCoverage?.orders || {},compareRange)),
      finance:Boolean(previousCore?.availability?.finance && elStageRangeCovered(previousCore?.periodCoverage?.finance || {},compareRange)),
      advertising:Boolean(previousCore?.availability?.advertising && elStageRangeCovered(previousCore?.periodCoverage?.advertising || {},compareRange)),
    }

    const streamNames = ['searchQueries','reviews','questions','stockHistory']
    const detailLevel = String(req.query.depth || req.query.detail || 'core').toLowerCase() === 'full' ? 'full' : 'core'
    const streamResults = detailLevel === 'full'
      ? await Promise.all(streamNames.map(async stream=>[
          stream,
          await loadProduct360ExtendedRows(connection.id,data,stream,product,range,500),
        ]))
      : streamNames.map(stream=>[
          stream,
          compactProduct360ExtendedRows(data,stream,product,range,120),
        ])
    const streamMap = Object.fromEntries(streamResults)
    const financeQuery = String(product.nmID || product.vendorCode || '').trim()
    const financeResult = detailLevel === 'full' && financeQuery ? await queryFinanceLedger(pool,{
      connectionId:connection.id,
      from:range?.from || reportPeriod(30).dateFrom,
      to:range?.to || reportPeriod(30).dateTo,
      group:'all',mode:'all',role:'all',query:financeQuery,page:1,limit:60,
    }) : {rows:[]}
    const stateMap = Object.fromEntries(states.map(item=>[item.stage,publicSyncState(item)]))
    const streamCoverage = Object.fromEntries(streamNames.map(stream=>{
      const result=streamMap[stream] || {}
      const stage=stateMap[stream] || null
      return [stream,{
        status:stage?.status || null,
        lastSuccessAt:stage?.lastSuccessAt || null,
        nextAllowedAt:stage?.nextAllowedAt || null,
        rows:Number(result.rows?.length || 0),
        source:result.source || 'none',
        availablePeriod:result.availablePeriod || null,
        truncated:Boolean(result.truncated),
        searchBindingVersion:stream === 'searchQueries' ? Number(result.searchBindingVersion || stage?.metadata?.searchBindingVersion || 0) : undefined,
        searchBindingVerified:stream === 'searchQueries' ? Boolean(result.searchBindingVerified && Number(stage?.metadata?.searchBindingVersion || 0) >= SEARCH_BINDING_VERSION) : undefined,
        partial:Boolean(
          (detailLevel === 'core' && (result.sampleOnly || result.truncated || Number(data?.[stream]?.totalRows || 0) > Number(result.rows?.length || 0)))
          || (stream === 'searchQueries' && (!result.searchBindingVerified || Number(stage?.metadata?.searchBindingVersion || 0) < SEARCH_BINDING_VERSION))
        ),
      }]
    }))
    const searchSnapshotPeriod=data?.searchQueries?.period || null
    if (range && searchSnapshotPeriod?.from && searchSnapshotPeriod?.to) {
      streamCoverage.searchQueries.periodExact=String(searchSnapshotPeriod.from).slice(0,10)===range.from && String(searchSnapshotPeriod.to).slice(0,10)===range.to
      streamCoverage.searchQueries.snapshotPeriod={from:String(searchSnapshotPeriod.from).slice(0,10),to:String(searchSnapshotPeriod.to).slice(0,10)}
    }

    const payload = buildProduct360({
      product,
      advertisingRows:core?.advertising?.productRows || [],
      searchRows:streamMap.searchQueries?.rows || [],
      reviewRows:streamMap.reviews?.rows || [],
      questionRows:streamMap.questions?.rows || [],
      stockHistoryRows:streamMap.stockHistory?.rows || [],
      stockDetails:core?.stockDetails || [],
      financeMovements:financeResult?.rows || [],
      period:range ? {from:range.from,to:range.to,days:range.days} : (core?.period || null),
      coverage:{
        core:core?.availability || {},
        streams:streamCoverage,
        finance:stateMap.finance || null,
        stages:{
          orders:stateMap.orders || null,
          sales:stateMap.sales || null,
          stocks:stateMap.stocks || null,
          sellerStocks:stateMap.sellerStocks || null,
          advertising:stateMap.advertising || null,
          finance:stateMap.finance || null,
          paidStorage:stateMap.paidStorage || null,
          acceptance:stateMap.acceptance || null,
          acquiring:stateMap.acquiring || null,
        },
      },
      sources:{
        core:sources,
        extended:Object.fromEntries(streamNames.map(stream=>[stream,streamMap[stream]?.source || 'none'])),
      },
    })
    payload.comparison = buildProduct360Comparison({
      currentProduct:product,
      previousProduct:previousProduct || {},
      currentAdvertisingRows:core?.advertising?.productRows || [],
      previousAdvertisingRows:previousCore?.advertising?.productRows || [],
      currentAvailability:currentComparisonAvailability,
      previousAvailability:previousComparisonAvailability,
      currentPeriod:range ? {from:range.from,to:range.to,days:range.days} : null,
      previousPeriod:compareRange,
      comparisonCoverage,
    })
    res.json({
      product360:{...payload,detailLevel,enrichmentPending:detailLevel !== 'full'},
      detailLevel,
      enrichmentPending:detailLevel !== 'full',
      lastSync:connection.last_sync_at || null,
    })
  } catch (error) {
    console.warn('WB product 360 failed:',error.message)
    res.status(error.status || 500).json({ error:error.message })
  }
})

app.get('/api/wb/advertising/:id', authRequired, async (req, res) => {
  const connection = await getConnection(req.auth.sub, req.params.id)
  if (!connection) return res.status(404).json({ error: 'Подключение не найдено' })
  const canonical = await canonicalConnectionData(connection)
  const rawAdvertising = canonical.data?.advertising && typeof canonical.data.advertising === 'object'
    ? canonical.data.advertising
    : { campaigns: [], totals: {}, period: null, truncated: false }
  const range = analyticsPeriodRange(req.query)
  const advertising = analyticsFilterAdvertising(rawAdvertising,range)
  const availableFrom = dateKey(rawAdvertising?.period?.from || rawAdvertising?.period?.beginDate || rawAdvertising?.period?.dateFrom)
  const availableTo = dateKey(rawAdvertising?.period?.to || rawAdvertising?.period?.endDate || rawAdvertising?.period?.dateTo)
  const stateResult = await pool.query('SELECT * FROM wb_sync_states WHERE connection_id=$1 AND stage=$2', [connection.id, 'advertising'])
  res.json({
    advertising,
    meta: advertising.meta || buildAdvertisingMeta(advertising),
    period:range ? {from:range.from,to:range.to,days:range.days} : null,
    coverage:{
      available:{from:availableFrom || null,to:availableTo || null},
      exact:!range || !availableFrom || !availableTo || (range.from>=availableFrom && range.to<=availableTo),
      maxRequestDays:31,
    },
    dataSource:canonical.sources?.advertising || null,
    recovered:canonical.recovered || [],
    syncState: stateResult.rows[0] ? publicSyncState(stateResult.rows[0]) : null,
    lastSync: connection.last_sync_at || null,
  })
})

app.post('/api/wb/stocks/:id/repair', authRequired, async (req, res) => {
  const connection = await getConnection(req.auth.sub, req.params.id)
  if (!connection) return res.status(404).json({ error: 'Подключение не найдено' })

  try {
    const tokens = await getWbTokens(req.auth.sub, connection.id)
    const selected = chooseToken(tokens, 'analytics')
    if (!selected) return res.status(400).json({ error: 'Нужен токен WB с категорией «Аналитика»' })

    const stateResult = await pool.query('SELECT * FROM wb_sync_states WHERE connection_id=$1 AND stage=$2', [connection.id, 'stocks'])
    const state = stateResult.rows[0] || null
    const data = { ...(connection.data || {}) }
    const taskId = cleanIdentity(
      req.body?.taskId || data?.stockMeta?.taskId || state?.task_id || state?.metadata?.taskId || state?.metadata?.task_id,
    )

    if (!taskId) {
      const queued = await updateSyncState(connection.id, 'stocks', {
        status:'queued', taskId:null, nextAllowedAt:new Date().toISOString(), lastError:'Старый снимок не содержит taskId. Будет создан новый официальный отчёт остатков WB.',
      })
      kickBackgroundWorkers(`stock-repair-new:${connection.id}`)
      const states = await getSyncStates(connection.id)
      return res.status(202).json({
        ok:true, queued:true,
        message:'Старый отчёт уже нельзя скачать повторно. ELISEI поставил создание нового снимка остатков в очередь.',
        syncStates:states.map(publicSyncState), state:publicSyncState(queued),
      })
    }

    try {
      const downloaded = await downloadWarehouseRemainsReport(selected.token, taskId, { deadlineAt:Date.now() + 65000 })
      if (!downloaded.rows.length && Number(data?.stockMeta?.totalQuantity || 0) > 0) {
        throw Object.assign(new Error('Сохранённый отчёт WB больше недоступен для повторного скачивания.'), { status: 404, resetTask:true })
      }
      const persisted = await persistStockSnapshot(connection.id, downloaded.rows, {
        ...downloaded.stockMeta,
        repairedAt:new Date().toISOString(),
        repairedFromTaskId:taskId,
      })
      await updateSyncState(connection.id, 'stocks', {
        status:'success', lastAttemptAt:new Date().toISOString(), lastSuccessAt:new Date().toISOString(), nextAllowedAt:null,
        lastError:null, lastCount:downloaded.rows.length, taskId:null,
        metadata:{ taskStatus:'done', ...downloaded.stockMeta, persistedRows:persisted.persistedRows, persistedQuantity:persisted.persistedQuantity },
      })

      const refreshed = await getConnection(req.auth.sub, connection.id)
      const [settings, states, canonical] = await Promise.all([
        getBusinessSettings(req.auth.sub),
        getSyncStates(connection.id),
        canonicalConnectionData(refreshed),
      ])
      return res.json({
        ok:true, queued:false, repaired:true,
        message:`Детализация восстановлена: ${persisted.persistedRows} строк, ${Math.round(persisted.persistedQuantity)} шт.`,
        core:buildCoreAnalytics(canonical.data, settings),
        dashboard:buildDashboard(canonical.data, settings),
        dataSources:canonical.sources,
        syncStates:states.map(publicSyncState),
        lastSync:refreshed.last_sync_at || null,
      })
    } catch (error) {
      const expired = [404, 410].includes(Number(error?.status)) || error?.resetTask || /не найден|недоступен|purged|expired/i.test(String(error?.message || ''))
      if (!expired) throw error
      const queued = await updateSyncState(connection.id, 'stocks', {
        status:'queued', taskId:null, nextAllowedAt:new Date().toISOString(), lastError:'Предыдущий taskId истёк. Будет создан новый официальный отчёт остатков WB.',
      })
      kickBackgroundWorkers(`stock-repair-expired:${connection.id}`)
      const states = await getSyncStates(connection.id)
      return res.status(202).json({
        ok:true, queued:true,
        message:'Срок хранения предыдущего отчёта истёк. ELISEI поставил новый снимок остатков в очередь.',
        syncStates:states.map(publicSyncState), state:publicSyncState(queued),
      })
    }
  } catch (error) {
    console.warn('WB stock repair failed:', error.code || error.status || '', error.message, error.payloadShape || '')
    res.status(error.status || 502).json({ error:error.message, code:error.code || null })
  }
})

app.get('/api/business/settings', authRequired, async (req, res) => {
  res.json({ settings: await getBusinessSettings(req.auth.sub) })
})

app.put('/api/business/settings', authRequired, async (req, res) => {
  const settings = await saveBusinessSettings(req.auth.sub, req.body || {})
  const connection = await getConnection(req.auth.sub)
  const canonical = connection ? await canonicalConnectionData(connection) : null
  res.json({ settings, core: canonical ? buildCoreAnalytics(canonical.data, settings) : null })
})


app.get('/api/wb/finance-ledger/:id', authRequired, async (req, res) => {
  const connection = await getConnection(req.auth.sub, req.params.id)
  if (!connection) return res.status(404).json({ error:'Подключение не найдено' })
  try {
    const backfill = await backfillFinanceLedgerFromStreamItems(pool,{ connectionId:connection.id })
    const period = reportPeriod(30)
    const requestedRange = analyticsPeriodRange(req.query)
    const selectedFrom = requestedRange?.from || period.dateFrom
    const selectedTo = requestedRange?.to || period.dateTo
    const result = await queryFinanceLedger(pool,{
      connectionId:connection.id,
      from:selectedFrom,
      to:selectedTo,
      group:String(req.query.group || 'all'),
      mode:['FBS','FBO'].includes(String(req.query.mode || '').toUpperCase()) ? String(req.query.mode).toUpperCase() : 'all',
      role:String(req.query.role || 'all'),
      query:String(req.query.query || ''),
      page:Number(req.query.page || 1),
      limit:Number(req.query.limit || 100),
    })
    const states = await getSyncStates(connection.id)
    const stateMap = Object.fromEntries(states.map(item => [item.stage,publicSyncState(item)]))
    const supportingStreams = ['finance','financeReports','acquiringReports','documents','jamSubscription','measurementPenalties','deductionsReport','warehouseMeasurements','antifraudRetention','labelingRetention']
    const streamRows = await pool.query(`SELECT stream,payload,row_count,updated_at FROM wb_stream_data WHERE connection_id=$1 AND stream=ANY($2::text[])`,[connection.id,supportingStreams])
    const payloadByStream = Object.fromEntries(streamRows.rows.map(row => [row.stream,{payload:row.payload||{},rowCount:Number(row.row_count||0),updatedAt:row.updated_at||null}]))
    const financePayload = payloadByStream.finance?.payload || {}
    const financeReady = Boolean(Number(stateMap.finance?.lastCount || 0) > 0 || Number(payloadByStream.finance?.rowCount || 0) > 0 || Number(financePayload.rawRowCount || 0) > 0)
    const rowOverlapsPeriod = row => {
      const rowFrom=dateKey(row?.dateFrom || row?.from || row?.periodFrom || row?.operationDate || row?.rrDate || row?.rr_dt || row?.dtBonus || row?.dt || row?.date || row?.createdAt || row?.createDate)
      const rowTo=dateKey(row?.dateTo || row?.to || row?.periodTo || rowFrom)
      if (!rowFrom && !rowTo) return false
      return (rowFrom || rowTo) <= selectedTo && (rowTo || rowFrom) >= selectedFrom
    }
    const compactRows = stream => (Array.isArray(payloadByStream[stream]?.payload?.rows) ? payloadByStream[stream].payload.rows : []).filter(rowOverlapsPeriod)
    const jamLedgerResult = await pool.query(`
      SELECT source_report_id AS "reportId",source_rrd_id AS "rrdId",operation_date AS "operationDate",
        operation_code AS "operationCode",operation_name AS "operationName",amount::float8 AS amount,currency
      FROM wb_finance_ledger
      WHERE connection_id=$1 AND operation_code='jam_subscription'
        AND operation_date >= $2::date AND operation_date <= $3::date
      ORDER BY operation_date DESC,updated_at DESC LIMIT 100
    `,[connection.id,selectedFrom,selectedTo])
    const jamFinance = jamEvidenceFromFinanceRows(jamLedgerResult.rows)
    const jamDocumentResult = await pool.query(`
      SELECT DISTINCT ON (row_key) payload
      FROM wb_stream_items
      WHERE connection_id=$1 AND stream='documents'
        AND (payload::text ILIKE '%джем%' OR payload::text ILIKE '%jam%')
      ORDER BY row_key,updated_at DESC LIMIT 100
    `,[connection.id])
    const jamDocuments = jamDocumentResult.rows.map(item=>item.payload || {})
    const jamSubscription = payloadByStream.jamSubscription?.payload || null
    res.json({
      period:{from:selectedFrom,to:selectedTo,days:requestedRange?.days || 30},
      ...result,
      backfill,
      balance:financePayload.balance || null,
      reportPeriod:financePayload.period || null,
      financeUpdatedAt:payloadByStream.finance?.updatedAt || null,
      reports:{
        sales:{ rows:compactRows('financeReports'),totalRows:compactRows('financeReports').length,period:{from:selectedFrom,to:selectedTo},updatedAt:payloadByStream.financeReports?.updatedAt || null },
        acquiring:{ rows:compactRows('acquiringReports'),totalRows:compactRows('acquiringReports').length,period:{from:selectedFrom,to:selectedTo},updatedAt:payloadByStream.acquiringReports?.updatedAt || null },
      },
      jam:{
        financial:jamFinance,
        subscription:jamSubscription?.jam || null,
        subscriptionCheckedAt:jamSubscription?.checkedAt || payloadByStream.jamSubscription?.updatedAt || null,
        documents:{rows:jamDocuments,totalRows:jamDocuments.length,updatedAt:payloadByStream.documents?.updatedAt || null},
        confirmed:Boolean(jamFinance.confirmed || jamDocuments.length),
        note:jamFinance.confirmed || jamDocuments.length
          ? 'Списание или документ «Джем» подтверждены данными WB.'
          : 'Статус подписки сам по себе не считается денежным списанием. Сумма появится только после подтверждения финансовой операцией или документом WB.',
      },
      documents:{
        rows:compactRows('documents'),
        totalRows:compactRows('documents').length,
        summary:payloadByStream.documents?.payload?.summary || null,
        complete:payloadByStream.documents?.payload?.complete !== false,
        updatedAt:payloadByStream.documents?.updatedAt || null,
      },
      riskDetails:{
        measurementPenalties:{rows:compactRows('measurementPenalties'),totalRows:compactRows('measurementPenalties').length,updatedAt:payloadByStream.measurementPenalties?.updatedAt || null},
        deductions:{rows:compactRows('deductionsReport'),totalRows:compactRows('deductionsReport').length,updatedAt:payloadByStream.deductionsReport?.updatedAt || null},
        warehouseMeasurements:{rows:compactRows('warehouseMeasurements'),totalRows:compactRows('warehouseMeasurements').length,updatedAt:payloadByStream.warehouseMeasurements?.updatedAt || null},
        antifraud:{rows:compactRows('antifraudRetention'),totalRows:compactRows('antifraudRetention').length,updatedAt:payloadByStream.antifraudRetention?.updatedAt || null},
        labeling:{rows:compactRows('labelingRetention'),totalRows:compactRows('labelingRetention').length,updatedAt:payloadByStream.labelingRetention?.updatedAt || null},
      },
      coverage:{
        financeReady,
        finance:stateMap.finance || null,
        acquiring:stateMap.acquiring || null,
        paidStorage:stateMap.paidStorage || null,
        acceptance:stateMap.acceptance || null,
        financeReports:stateMap.financeReports || null,
        acquiringReports:stateMap.acquiringReports || null,
        documents:stateMap.documents || null,
        jamSubscription:stateMap.jamSubscription || null,
        financePartial:financePayload.complete === false,
        measurementPenalties:stateMap.measurementPenalties || null,
        deductionsReport:stateMap.deductionsReport || null,
        warehouseMeasurements:stateMap.warehouseMeasurements || null,
        antifraudRetention:stateMap.antifraudRetention || null,
        labelingRetention:stateMap.labelingRetention || null,
        waitingForFinance:!financeReady,
      },
      note:'Сумма «к перечислению» берётся из поля forPay. Базовый токен с категорией «Финансы» загружает детализацию реализации; расширенные сводки служат для сверки. Документы, списания «Джем», габариты, подмены, самовыкупы и маркировка показываются как подтверждающие источники и не вычитаются повторно из P&L.',
    })
  } catch (error) {
    console.warn('WB finance ledger failed:',error.message)
    res.status(error.status || 500).json({ error:error.message })
  }
})


async function dataQualityForConnection(connection, requestedRange = null) {
  const fallback=reportPeriod(30)
  const period=requestedRange?.from && requestedRange?.to
    ? {from:requestedRange.from,to:requestedRange.to}
    : {from:fallback.dateFrom,to:fallback.dateTo}
  const [{data,sources},states,streamResult,financeResult]=await Promise.all([
    canonicalConnectionData(connection),
    getSyncStates(connection.id),
    pool.query(`SELECT stream,payload,row_count,metadata,source,updated_at FROM wb_stream_data WHERE connection_id=$1`,[connection.id]),
    pool.query(`
      SELECT COUNT(*)::int AS movements,
        COALESCE(SUM(CASE WHEN metric_role='settlement' THEN amount ELSE 0 END),0)::float8 AS "sellerPayable",
        COALESCE(SUM(CASE WHEN operation_code='gross_sale' THEN amount ELSE 0 END),0)::float8 AS "grossRevenue",
        COALESCE(SUM(CASE WHEN included_in_pnl=TRUE AND detail_only=FALSE AND amount<0 THEN ABS(amount) ELSE 0 END),0)::float8 AS expenses,
        COALESCE(SUM(CASE WHEN metric_role='adjustment' AND detail_only=FALSE AND amount>0 THEN amount ELSE 0 END),0)::float8 AS compensations,
        MIN(operation_date) AS "dateFrom",MAX(operation_date) AS "dateTo"
      FROM wb_finance_ledger
      WHERE connection_id=$1 AND operation_date >= $2::date AND operation_date <= $3::date
    `,[connection.id,period.from,period.to]),
  ])
  const financeValue=financeResult.rows[0] || {}
  const componentNet=Number(financeValue.grossRevenue||0)-Number(financeValue.expenses||0)+Number(financeValue.compensations||0)
  const financeSummary={
    ...financeValue,
    componentNet:Math.round(componentNet*100)/100,
    reconciliationDifference:Math.round((Number(financeValue.sellerPayable||0)-componentNet)*100)/100,
  }
  const master=Array.isArray(data?.productMaster)?data.productMaster:[]
  const productLabel=item=>({
    title:String(item?.title || item?.subjectName || item?.vendorCode || `Товар ${item?.nmID || ''}`).trim(),
    vendorCode:String(item?.vendorCode || '').trim(),
    nmID:item?.nmID || null,
    brand:String(item?.brand || '').trim(),
  })
  const missingBarcodes=master
    .filter(item=>!Array.isArray(item?.barcodes) || item.barcodes.length===0)
    .map(item=>({...productLabel(item),reasonCode:'missing_barcodes',reason:'В карточке нет штрихкодов размеров; сопоставление по barcode невозможно.'}))
  const unmatchedStock=master
    .filter(item=>!item?.stockMapped && !(Number(item?.stock || 0)>0))
    .map(item=>({
      ...productLabel(item),
      reasonCode:Array.isArray(item?.barcodes)&&item.barcodes.length?'not_in_current_snapshot':'missing_barcodes_and_snapshot',
      reason:Array.isArray(item?.barcodes)&&item.barcodes.length
        ? 'В текущем снимке остатков не найдено строки по barcode → nmID → vendorCode. Это может означать нулевой остаток или разрыв идентификаторов.'
        : 'Нет штрихкодов и нет подтверждённой строки в текущем снимке остатков.',
    }))
  const productDiagnostics={
    products:master.length || Number(sources?.products?.count || 0),
    withBarcodes:master.filter(item=>Array.isArray(item?.barcodes)&&item.barcodes.length).length,
    withMappedStock:master.filter(item=>item?.stockMapped || Number(item?.stock || 0)>0).length,
    missingBarcodesCount:missingBarcodes.length,
    unmatchedStockCount:unmatchedStock.length,
    missingBarcodes:missingBarcodes.slice(0,100),
    unmatchedStock:unmatchedStock.slice(0,100),
  }
  return buildDataQualityReport({
    states:states.map(publicSyncState),
    streamRows:streamResult.rows,
    requestedPeriod:period,
    financeSummary,
    productDiagnostics,
  })
}

app.get('/api/wb/data-quality/:id', authRequired, async (req,res)=>{
  try{
    const connection=await getConnection(req.auth.sub,req.params.id)
    if(!connection) return res.status(404).json({error:'Подключение не найдено'})
    const range=analyticsPeriodRange(req.query)
    const quality=await dataQualityForConnection(connection,range)
    res.json({quality})
  }catch(error){
    console.warn('WB data quality failed:',error.message)
    res.status(error.status||500).json({error:error.message})
  }
})

app.get('/api/wb/diagnostics/:id', authRequired, async (req, res) => {
  const connection = await getConnection(req.auth.sub, req.params.id)
  if (!connection) return res.status(404).json({ error:'Подключение не найдено' })
  const canonical = await canonicalConnectionData(connection)
  const snapshots = {}
  for (const stream of WB_STREAMS) {
    const snapshot = await latestSnapshot(pool, connection.id, stream)
    snapshots[stream] = snapshot ? {
      id:snapshot.id,
      endpoint:snapshot.endpoint,
      requestKey:snapshot.request_key,
      checksum:snapshot.checksum,
      validation:snapshot.validation,
      createdAt:snapshot.created_at,
    } : null
  }
  const master = Array.isArray(canonical.data?.productMaster) ? canonical.data.productMaster : []
  res.json({
    snapshots,
    streamStore:canonical.sources,
    recovered:canonical.recovered,
    stockMeta:canonical.data?.stockMeta || null,
    stockAllocation:canonical.data?.stockAllocation?.diagnostics || null,
    advertisingMeta:canonical.data?.advertising?.meta || null,
    productMaster:{
      products:master.length,
      withBarcodes:master.filter(item => Array.isArray(item?.barcodes) && item.barcodes.length).length,
      withMappedStock:master.filter(item => item?.stockMapped).length,
      withAdvertising:master.filter(item => item?.advertising).length,
    },
  })
})

app.post('/api/wb/data-repair/:id', authRequired, async (req, res) => {
  const connection = await getConnection(req.auth.sub, req.params.id)
  if (!connection) return res.status(404).json({ error:'Подключение не найдено' })
  const canonical = await canonicalConnectionData(connection, { repair:true, persistManifest:true, queueMissing:true })
  const settings = await getBusinessSettings(req.auth.sub)
  const core = buildCoreAnalytics(canonical.data, settings)
  res.json({
    ok:true,
    message:canonical.recovered.length
      ? `Восстановлено потоков: ${canonical.recovered.length}`
      : 'Потоки данных уже находятся в едином хранилище.',
    recovered:canonical.recovered,
    recoveryQueued:canonical.recoveryQueued || [],
    dataSources:canonical.sources,
    counts:{
      products:Array.isArray(canonical.data.products) ? canonical.data.products.length : 0,
      orders:Array.isArray(canonical.data.orders) ? canonical.data.orders.length : 0,
      sales:Array.isArray(canonical.data.sales) ? canonical.data.sales.length : 0,
      stocks:Array.isArray(canonical.data.stocks) ? canonical.data.stocks.length : 0,
      advertising:Array.isArray(canonical.data.advertising?.campaigns) ? canonical.data.advertising.campaigns.length : 0,
    },
    dashboard:buildDashboard(canonical.data, settings),
    core,
  })
})

app.get('/api/wb/sync-history/:id', authRequired, async (req, res) => {
  const connection = await getConnection(req.auth.sub, req.params.id)
  if (!connection) return res.status(404).json({ error: 'Подключение не найдено' })
  res.json({ history: connection.sync_history || [] })
})

app.get('/api/wb/products/:id', authRequired, async (req, res) => {
  const connection = await getConnection(req.auth.sub, req.params.id)
  if (!connection) return res.status(404).json({ error: 'Подключение не найдено' })
  const canonical = await canonicalConnectionData(connection)
  res.json({ products: canonical.data?.products || [], dataSource:canonical.sources?.products || null, recovered:canonical.recovered || [], lastSync: connection.last_sync_at || null })
})

app.post('/api/wb/disconnect', authRequired, async (req, res) => {
  const id = String(req.body?.connectionId || '').trim()
  if (id) await pool.query(`DELETE FROM marketplace_connections WHERE user_id=$1 AND marketplace='wildberries' AND id=$2::uuid`, [req.auth.sub, id])
  else await pool.query(`DELETE FROM marketplace_connections WHERE user_id=$1 AND marketplace='wildberries'`, [req.auth.sub])
  res.json({ ok: true })
})



// ELISEI 5.4.2 — прямой read-only мост данных и постоянная память Эла.
// Эл получает данные того же пользователя и кабинета, что и основной интерфейс.
function elPeriodRange(period = {}) {
  const fromRaw = period?.from || period?.dateFrom || period?.date_from || period?.start || period?.startDate
  const toRaw = period?.to || period?.dateTo || period?.date_to || period?.end || period?.endDate
  const from = dateKey(fromRaw)
  const to = dateKey(toRaw)
  if (!from || !to) return null
  const fromDate = new Date(`${from}T00:00:00.000Z`)
  const toDate = new Date(`${to}T00:00:00.000Z`)
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) return null
  return { from, to, fromDate, toDate, days: Math.max(1, Math.floor((toDate - fromDate) / 86400000) + 1) }
}

function elRowDate(row = {}) {
  return dateKey(row.sale_dt || row.date || row.lastChangeDate || row.createdAt || row.updatedAt || row.orderDate)
}

function elFilterDataByPeriod(rawData = {}, period = {}) {
  const range = elPeriodRange(period)
  if (!range) return { data: { ...rawData }, range: null }
  return { range, data:analyticsFilterConnectionData(rawData, range) }
}

function elCompactProduct(item = {}) {
  return {
    key: item.key || null,
    nmID: item.nmID || null,
    vendorCode: item.vendorCode || '',
    title: item.title || 'Товар',
    brand: item.brand || '',
    stock: item.stock ?? null,
    stockStatus: item.stockStatus || null,
    stockCoverDays: item.stockCoverDays ?? null,
    orders: item.ordersCount ?? 0,
    sales: item.salesCount ?? 0,
    returns: item.returnsCount ?? 0,
    returnRate: item.returnRate ?? null,
    revenue: item.revenue ?? null,
    profit: item.profit ?? null,
    margin: item.margin ?? null,
    averagePrice: item.averagePrice ?? null,
    unitCost: item.unitCost ?? null,
    expenses: item.expenses ?? null,
    commission: item.commission ?? null,
    logistics: item.logistics ?? null,
    advertising: item.advertising ?? item.adSpend ?? null,
    adRevenue: item.adRevenue ?? null,
    adOrders: item.adOrders ?? null,
    breakevenPrice: item.breakevenPrice ?? null,
    targetPrice: item.targetPrice ?? null,
    recommendation: item.recommendation || null,
  }
}

function elTopProducts(products = [], score, limit = 35) {
  return [...products]
    .sort((a, b) => Number(score(b) || 0) - Number(score(a) || 0))
    .slice(0, limit)
    .map(elCompactProduct)
}

function elExtendedPayloadRows(data = {}, stream = '') {
  const value = data?.[stream]
  if (Array.isArray(value)) return value
  return Array.isArray(value?.rows) ? value.rows : []
}

function elExtendedRowDate(stream, row = {}) {
  if (stream === 'reviews' || stream === 'questions') return dateKey(row.createdDate || row.createdAt || row.updatedDate || row.updatedAt || row.date)
  if (stream === 'chats') return dateKey(row.addTimestamp || row.createdAt || row.createdDate || row.timestamp || row.date || row?.lastMessage?.addTimestamp || row?.lastMessage?.createdAt)
  return dateKey(row.date || row.createdAt || row.updatedAt)
}

function elFilterExtendedRows(rows = [], stream = '', range = null) {
  if (!range) return Array.isArray(rows) ? rows : []
  return (Array.isArray(rows) ? rows : []).filter(row => {
    const value = elExtendedRowDate(stream,row)
    return value && value >= range.from && value <= range.to
  })
}

async function elLoadExtendedStream(connectionId, canonicalData, stream, range, limit = 120) {
  const filters = range ? { from:range.from,to:range.to } : {}
  const page = await latestExtendedRows(connectionId,stream,{ limit,...filters })
  if (page.syncId) {
    const calculated = await extendedStreamSummary(connectionId,stream,page.syncId,filters)
    return {
      rows:page.rows,
      total:page.total,
      summary:calculated.summary || null,
      availablePeriod:calculated.availablePeriod || null,
      source:'wb_stream_items',
    }
  }
  const rows = elFilterExtendedRows(elExtendedPayloadRows(canonicalData,stream),stream,range).slice(0,limit)
  const payload = canonicalData?.[stream] && typeof canonicalData[stream] === 'object' ? canonicalData[stream] : {}
  return {
    rows,
    total:Math.max(Number(payload?.totalRows || 0),rows.length),
    summary:payload?.summary || null,
    availablePeriod:payload?.period || null,
    source:rows.length ? 'wb_stream_data_sample' : 'none',
  }
}

function elStageRangeCovered(item = {}, range = null) {
  if (!range) return true
  const from = dateKey(item?.from)
  const to = dateKey(item?.to)
  if (!from || !to) return false
  return range.from >= from && range.to <= to
}

function elRangeCovered(periodCoverage = {}, range = null) {
  if (!range) return true
  const stages = ['sales','orders']
  return stages.some(stage => elStageRangeCovered(periodCoverage?.[stage] || {},range))
}

function elDataCoverage(connection, core, range) {
  return {
    requestedPeriod: range ? { from: range.from, to: range.to, days: range.days } : null,
    salesAndOrdersFilteredByRequestedPeriod: Boolean(range),
    advertisingPeriod: core?.advertising?.period || null,
    note: core?.advertising?.period && range
      ? 'Реклама хранится в периоде последнего снимка WB; не приравнивай её автоматически к выбранному диапазону, если даты не совпадают.'
      : null,
    lastSync: connection?.last_sync_at || null,
  }
}

async function resolveElConnection(userId, cabinetId) {
  if (!userId) return null
  const candidate = String(cabinetId || '').trim()
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)) {
    const exact = await getConnection(userId, candidate)
    if (exact) return exact
  }
  return getConnection(userId)
}

async function buildElModuleData({ req, identity, period, module, focus }) {
  const userId = req?.auth?.sub || identity?.userId
  const connection = await resolveElConnection(userId, identity?.cabinetId)
  if (!connection) {
    return { available: false, module, warning: 'Кабинет Wildberries не подключён.', focus }
  }

  const settings = await getBusinessSettings(userId)
  const canonical = await canonicalConnectionData(connection)
  const filtered = elFilterDataByPeriod(canonical.data || {}, period || {})
  const core = buildCoreAnalytics(filtered.data, settings)
  const products = Array.isArray(core.products) ? core.products : []
  const syncStates = (await getSyncStates(connection.id)).map(publicSyncState)
  const sourceCounts = {
    products:Number(canonical.sources?.products?.count || (Array.isArray(canonical.data?.products) ? canonical.data.products.length : 0)),
    orders:Number(canonical.sources?.orders?.count || (Array.isArray(canonical.data?.orders) ? canonical.data.orders.length : 0)),
    sales:Number(canonical.sources?.sales?.count || (Array.isArray(canonical.data?.sales) ? canonical.data.sales.length : 0)),
  }
  const base = {
    available: true,
    module,
    focus,
    cabinet: { id: connection.id, sellerId: connection.seller_id || null },
    period: filtered.range ? { from: filtered.range.from, to: filtered.range.to, days: filtered.range.days } : { days: core.periodDays },
    coverage: elDataCoverage(connection, core, filtered.range),
    availability: core.availability,
    sourceCounts,
    lastSync: connection.last_sync_at || null,
  }

  if (module === 'diagnostics') {
    if (!filtered.range) {
      return { ...base, available:false, warning:'Для сравнения выбери конкретный период: день, неделю, месяц или диапазон.' }
    }
    const comparePeriod = previousEqualPeriod(filtered.range)
    const compareData = analyticsFilterConnectionData(canonical.data || {}, comparePeriod)
    const previousCore = buildCoreAnalytics(compareData, settings)
    const comparisonCoverage = elRangeCovered(previousCore.periodCoverage, comparePeriod)
    const analysis = buildDecisionAnalysis({
      current:core,
      previous:previousCore,
      period:{ from:filtered.range.from,to:filtered.range.to,days:filtered.range.days },
      comparePeriod,
      comparisonCoverage,
    })
    return {
      ...base,
      ...analysis,
      comparisonCoverage,
      compareAvailability:previousCore.availability,
      compareCoverage:previousCore.periodCoverage || null,
      compareSummary:previousCore.summary || null,
    }
  }
  if (module === 'overview') {
    return {
      ...base,
      summary: core.summary,
      topRecommendations: (core.recommendations || []).slice(0, 15),
      criticalProducts: products
        .filter(item => item.profit < 0 || item.stockStatus === 'Заканчивается' || item.returnRate >= 20)
        .slice(0, 30)
        .map(elCompactProduct),
      syncWarnings: core.syncWarnings || [],
    }
  }
  if (module === 'sales') {
    const salesAvailable = Boolean(core.availability?.orders || core.availability?.sales || sourceCounts.orders > 0 || sourceCounts.sales > 0)
    const selectedRows = {
      orders:Array.isArray(filtered.data?.orders) ? filtered.data.orders.length : 0,
      sales:Array.isArray(filtered.data?.sales) ? filtered.data.sales.length : 0,
    }
    const periodDataAvailable = !filtered.range || selectedRows.orders > 0 || selectedRows.sales > 0
    const periodCoverage = filtered.data?.__periodCoverage || null
    const latestAvailableDate = [periodCoverage?.orders?.to,periodCoverage?.sales?.to].filter(Boolean).sort().at(-1) || null
    const rawOrderSplit = splitOrdersByFulfillment(filtered.data?.orders)
    const fallbackFbs = Number(core.fulfillment?.FBS?.orders || 0)
    const fallbackFbo = Number(core.fulfillment?.FBO?.orders || 0)
    const fulfillment = rawOrderSplit.total > 0 ? {
      ...(core.fulfillment || {}),
      FBS:{ ...(core.fulfillment?.FBS || {}), orders:rawOrderSplit.fbs },
      FBO:{ ...(core.fulfillment?.FBO || {}), orders:rawOrderSplit.fbo },
      totalOrders:rawOrderSplit.total,
      classifiedOrders:rawOrderSplit.classified,
      unknownOrders:rawOrderSplit.unknown,
      ordersAvailable:true,
      source:'raw_order_rows',
    } : {
      ...(core.fulfillment || {}),
      totalOrders:Number(core.summary?.orders || 0),
      classifiedOrders:fallbackFbs + fallbackFbo,
      unknownOrders:Math.max(0,Number(core.summary?.orders || 0) - fallbackFbs - fallbackFbo),
      ordersAvailable:Boolean(core.availability?.orders || sourceCounts.orders > 0),
      source:'aggregated_order_rows',
    }
    return {
      ...base,
      available:salesAvailable,
      periodDataAvailable,
      selectedRows,
      periodCoverage,
      latestAvailableDate,
      warning:!salesAvailable
        ? 'Продажи и заказы ещё не синхронизированы для выбранного кабинета.'
        : (filtered.range && !periodDataAvailable
          ? `Потоки продаж и заказов загружены, но за период ${filtered.range.from} — ${filtered.range.to} подтверждённых строк пока нет.`
          : null),
      summary: {
        revenue: core.summary.revenue, orders: core.summary.orders, sales: core.summary.sales,
        returns: core.summary.returns, returnRate: core.summary.returnRate,
      },
      dailyTrend: core.dailyTrend || [],
      fulfillment,
      topByRevenue: elTopProducts(products, item => item.revenue),
      topBySales: elTopProducts(products, item => item.salesCount),
    }
  }
  if (module === 'advertising') {
    return {
      ...base,
      summary: {
        spend: core.summary.advertising,
        source: core.summary.advertisingSource,
        operatingProfit: core.summary.operatingProfit,
        margin: core.summary.margin,
      },
      advertising: {
        totals: core.advertising?.totals || {},
        period: core.advertising?.period || null,
        statsAvailable: Boolean(core.advertising?.statsAvailable),
        campaigns: (core.advertising?.campaigns || []).slice(0, 80),
        productRows: (core.advertising?.productRows || []).slice(0, 100),
      },
      productsWithAds: products.filter(item => Number(item.advertising || item.adSpend || 0) > 0).slice(0, 80).map(elCompactProduct),
    }
  }
  if (module === 'stocks') {
    return {
      ...base,
      summary: {
        stockUnits: core.summary.stockUnits, zeroStock: core.summary.zeroStock, lowStock: core.summary.lowStock,
        slowStock: core.summary.slowStock, stockCoverDays: core.summary.stockCoverDays,
      },
      stockMeta: core.stockMeta || null,
      warehouses: core.warehouses || [],
      lowStockProducts: products.filter(item => ['Нет остатка', 'Заканчивается'].includes(item.stockStatus)).slice(0, 80).map(elCompactProduct),
      slowStockProducts: products.filter(item => ['Избыток', 'Без движения'].includes(item.stockStatus)).slice(0, 80).map(elCompactProduct),
    }
  }
  if (module === 'finance') {
    return {
      ...base,
      summary: core.summary,
      settings: core.settings,
      lossMakingProducts: products.filter(item => item.profit != null && item.profit < 0).sort((a,b) => a.profit-b.profit).slice(0, 80).map(elCompactProduct),
      topProfitProducts: elTopProducts(products.filter(item => item.profit != null), item => item.profit),
      missingCostProducts: products.filter(item => !Number(item.unitCost || 0)).slice(0, 80).map(elCompactProduct),
    }
  }
  if (module === 'products') {
    return {
      ...base,
      summary: { activeProducts: core.summary.activeProducts, stockUnits: core.summary.stockUnits },
      products: products.slice(0, 150).map(elCompactProduct),
      recommendations: (core.recommendations || []).slice(0, 30),
    }
  }
  if (module === 'returns') {
    return {
      ...base,
      summary: { returns: core.summary.returns, returnRate: core.summary.returnRate, sales: core.summary.sales },
      highestReturnRate: products.filter(item => Number(item.returnsCount || 0) > 0)
        .sort((a,b) => Number(b.returnRate || 0)-Number(a.returnRate || 0)).slice(0, 80).map(elCompactProduct),
    }
  }
  if (module === 'reviews') {
    const range = filtered.range ? {from:filtered.range.from,to:filtered.range.to} : null
    const [reviewData,questionData,chatData] = await Promise.all([
      elLoadExtendedStream(connection.id,canonical.data,'reviews',range,500),
      elLoadExtendedStream(connection.id,canonical.data,'questions',range,500),
      elLoadExtendedStream(connection.id,canonical.data,'chats',range,200),
    ])
    const states = Object.fromEntries(syncStates
      .filter(item=>['reviews','questions','chats'].includes(item.stage))
      .map(item=>[item.stage,item]))
    const engagement = buildElEngagementData({
      reviews:reviewData.rows,
      questions:questionData.rows,
      chats:chatData.rows,
      totals:{reviews:reviewData.total,questions:questionData.total,chats:chatData.total},
      summaries:{reviews:reviewData.summary,questions:questionData.summary,chats:chatData.summary},
      period:base.period,
      states,
    })
    return {
      ...base,
      ...engagement,
      sources:{reviews:reviewData.source,questions:questionData.source,chats:chatData.source},
      coverage:{
        ...base.coverage,
        reviews:reviewData.availablePeriod,
        questions:questionData.availablePeriod,
        chats:chatData.availablePeriod,
      },
      relatedReturns:products.filter(item=>Number(item.returnsCount || 0)>0).slice(0,80).map(elCompactProduct),
    }
  }
  if (module === 'pricing') {
    return {
      ...base,
      settings: core.settings,
      lossMakingProducts: products.filter(item => item.profit != null && item.profit < 0).slice(0, 80).map(elCompactProduct),
      pricingProducts: products.filter(item => item.averagePrice || item.breakevenPrice || item.targetPrice).slice(0, 120).map(elCompactProduct),
    }
  }
  if (module === 'seasonality') {
    return {
      ...base,
      dailyTrend: core.dailyTrend || [],
      categories: core.categories || [],
      products: elTopProducts(products, item => item.salesCount, 80),
      warning: 'Сейчас сезонность строится по доступной истории кабинета и внешним данным из интернет-поиска. Для годовой сезонности потребуется накопленная история не менее 12 месяцев.',
    }
  }
  if (module === 'procurement') {
    return {
      ...base,
      candidates: products.filter(item => item.stockStatus === 'Заканчивается' && Number(item.salesCount || 0) > 0)
        .sort((a,b) => Number(a.stockCoverDays ?? 9999)-Number(b.stockCoverDays ?? 9999)).slice(0, 100).map(elCompactProduct),
      exclusions: products.filter(item => ['Избыток','Без движения'].includes(item.stockStatus) || (item.profit != null && item.profit < 0)).slice(0, 100).map(elCompactProduct),
      recommendations: (core.recommendations || []).filter(item => item.type === 'stock').slice(0, 40),
    }
  }
  if (module === 'sync') {
    const quality=await dataQualityForConnection(connection,filtered.range ? {from:filtered.range.from,to:filtered.range.to} : null)
    return {
      ...base,
      syncStates,
      syncWarnings: core.syncWarnings || [],
      stockMeta: core.stockMeta || null,
      stages: core.stageStatus || {},
      quality,
      history: (connection.sync_history || []).slice(0, 20),
    }
  }
  return { ...base, summary: core.summary }
}


function elMemoryIdentity(identity = {}) {
  return {
    userId:String(identity.userId || ''),
    cabinetId:String(identity.cabinetId || 'main').slice(0,120),
  }
}

function elMemoryRow(row = {}) {
  return {
    id:row.id,
    text:row.text,
    category:row.category,
    createdAt:row.created_at,
    updatedAt:row.updated_at,
  }
}

const elPostgresMemoryStore = pool ? {
  async loadConversation(identity, conversationId) {
    const key = elMemoryIdentity(identity)
    const result = await pool.query(
      `SELECT messages FROM el_conversations WHERE user_id=$1::uuid AND cabinet_id=$2 AND conversation_id=$3`,
      [key.userId, key.cabinetId, String(conversationId).slice(0,100)],
    )
    return Array.isArray(result.rows[0]?.messages) ? result.rows[0].messages : []
  },
  async appendMessages(identity, conversationId, messages) {
    const key = elMemoryIdentity(identity)
    const id = String(conversationId).slice(0,100)
    const current = await this.loadConversation(identity, id)
    const merged = [...current, ...(Array.isArray(messages) ? messages : [])]
      .filter(item => item && ['user','assistant'].includes(item.role) && item.content)
      .slice(-80)
    await pool.query(
      `INSERT INTO el_conversations(user_id,cabinet_id,conversation_id,messages)
       VALUES($1::uuid,$2,$3,$4::jsonb)
       ON CONFLICT(user_id,cabinet_id,conversation_id)
       DO UPDATE SET messages=EXCLUDED.messages, updated_at=NOW()`,
      [key.userId, key.cabinetId, id, JSON.stringify(merged)],
    )
    return { id, messages:merged }
  },
  async deleteConversation(identity, conversationId) {
    const key = elMemoryIdentity(identity)
    await pool.query(
      `DELETE FROM el_conversations WHERE user_id=$1::uuid AND cabinet_id=$2 AND conversation_id=$3`,
      [key.userId, key.cabinetId, String(conversationId).slice(0,100)],
    )
  },
  async listMemories(identity) {
    const key = elMemoryIdentity(identity)
    const result = await pool.query(
      `SELECT id,text,category,created_at,updated_at FROM el_memories
       WHERE user_id=$1::uuid AND cabinet_id=$2 ORDER BY updated_at DESC LIMIT 100`,
      [key.userId, key.cabinetId],
    )
    return result.rows.map(elMemoryRow)
  },
  async addMemory(identity, input = {}) {
    const key = elMemoryIdentity(identity)
    const text = String(input.text || '').replace(/\s+/g,' ').trim().slice(0,800)
    const category = String(input.category || 'preference').replace(/\s+/g,' ').trim().slice(0,50) || 'preference'
    if (!text) throw new Error('Пустую память сохранить нельзя.')
    const existing = await pool.query(
      `SELECT id,text,category,created_at,updated_at FROM el_memories
       WHERE user_id=$1::uuid AND cabinet_id=$2 AND LOWER(text)=LOWER($3) LIMIT 1`,
      [key.userId, key.cabinetId, text],
    )
    if (existing.rowCount) {
      const updated = await pool.query(
        `UPDATE el_memories SET category=$4, updated_at=NOW()
         WHERE user_id=$1::uuid AND cabinet_id=$2 AND id=$3::uuid
         RETURNING id,text,category,created_at,updated_at`,
        [key.userId, key.cabinetId, existing.rows[0].id, category],
      )
      return elMemoryRow(updated.rows[0])
    }
    const created = await pool.query(
      `INSERT INTO el_memories(id,user_id,cabinet_id,category,text)
       VALUES($1::uuid,$2::uuid,$3,$4,$5)
       RETURNING id,text,category,created_at,updated_at`,
      [crypto.randomUUID(), key.userId, key.cabinetId, category, text],
    )
    return elMemoryRow(created.rows[0])
  },
  async removeMemory(identity, memoryId) {
    const key = elMemoryIdentity(identity)
    const result = await pool.query(
      `DELETE FROM el_memories WHERE user_id=$1::uuid AND cabinet_id=$2 AND id=$3::uuid`,
      [key.userId, key.cabinetId, memoryId],
    )
    return result.rowCount > 0
  },
  async forgetByText(identity, query) {
    const key = elMemoryIdentity(identity)
    const needle = String(query || '').replace(/\s+/g,' ').trim().slice(0,300)
    if (!needle) return []
    const result = await pool.query(
      `DELETE FROM el_memories WHERE user_id=$1::uuid AND cabinet_id=$2 AND text ILIKE '%' || $3 || '%'
       RETURNING id,text,category,created_at,updated_at`,
      [key.userId, key.cabinetId, needle],
    )
    return result.rows.map(elMemoryRow)
  },
  async getProfile(identity) {
    const key = elMemoryIdentity(identity)
    const result = await pool.query(
      `SELECT profile,updated_at FROM el_profiles WHERE user_id=$1::uuid AND cabinet_id=$2 LIMIT 1`,
      [key.userId, key.cabinetId],
    )
    return result.rows[0]?.profile || null
  },
  async saveProfile(identity, profile) {
    const key = elMemoryIdentity(identity)
    const value = profile && typeof profile === 'object' ? profile : {}
    const result = await pool.query(
      `INSERT INTO el_profiles(user_id,cabinet_id,profile)
       VALUES($1::uuid,$2,$3::jsonb)
       ON CONFLICT(user_id,cabinet_id)
       DO UPDATE SET profile=EXCLUDED.profile,updated_at=NOW()
       RETURNING profile`,
      [key.userId, key.cabinetId, JSON.stringify(value)],
    )
    return result.rows[0]?.profile || value
  },
} : null

if (elPostgresMemoryStore) app.locals.elMemoryStore = elPostgresMemoryStore

function normalizeElTier(value, fallback = 'analyst') {
  const tier = String(value || '').trim().toLowerCase()
  return ['analyst','gpt','pro'].includes(tier) ? tier : fallback
}

function elAdminEmails() {
  return String(process.env.ELISEI_ADMIN_EMAILS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean)
}

function isElAdmin(req) {
  const email = String(req?.auth?.email || '').trim().toLowerCase()
  return Boolean(email && elAdminEmails().includes(email))
}

app.locals.getElPlan = async ({ req, identity }) => {
  const email = String(req?.auth?.email || '').trim().toLowerCase()
  const ownerEmails = String(process.env.ELISEI_EL_OWNER_EMAILS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean)
  if (email && ownerEmails.includes(email)) {
    return { tier:normalizeElTier(process.env.ELISEI_EL_OWNER_TIER || 'pro'), status:'active', source:'owner-environment' }
  }
  if (pool && identity?.userId && /^[0-9a-f-]{36}$/i.test(String(identity.userId))) {
    const result = await pool.query(
      `SELECT tier,status,metadata,starts_at,expires_at FROM el_entitlements WHERE user_id=$1 AND status='active' AND (expires_at IS NULL OR expires_at > NOW())`,
      [identity.userId],
    )
    if (result.rowCount) return { ...result.rows[0], source:'database' }
  }
  return { tier:normalizeElTier(process.env.ELISEI_EL_DEFAULT_TIER || 'analyst'), status:'active', source:'default' }
}

app.locals.setElPlan = async ({ req, identity, body }) => {
  if (!isElAdmin(req)) throw Object.assign(new Error('Только администратор ELISEI может менять тариф Эла.'), { status:403 })
  if (!pool) throw Object.assign(new Error('DATABASE_URL не настроен'), { status:503 })
  const targetUserId = String(body?.userId || identity?.userId || '')
  if (!/^[0-9a-f-]{36}$/i.test(targetUserId)) throw Object.assign(new Error('Некорректный userId'), { status:400 })
  const tier = normalizeElTier(body?.tier, '')
  if (!tier) throw Object.assign(new Error('Тариф должен быть analyst, gpt или pro'), { status:400 })
  const status = ['active','paused','cancelled'].includes(String(body?.status || 'active')) ? String(body?.status || 'active') : 'active'
  const expiresAt = body?.expiresAt || null
  const metadata = body?.metadata && typeof body.metadata === 'object' ? body.metadata : {}
  const result = await pool.query(
    `INSERT INTO el_entitlements (user_id,tier,status,metadata,expires_at,updated_at)
     VALUES ($1,$2,$3,$4::jsonb,$5,NOW())
     ON CONFLICT (user_id) DO UPDATE SET tier=EXCLUDED.tier,status=EXCLUDED.status,metadata=EXCLUDED.metadata,expires_at=EXCLUDED.expires_at,updated_at=NOW()
     RETURNING tier,status,metadata,starts_at,expires_at`,
    [targetUserId,tier,status,JSON.stringify(metadata),expiresAt],
  )
  return { ...result.rows[0], source:'database-admin' }
}

app.locals.getElModuleData = buildElModuleData
app.locals.getElBusinessContext = async options => {
  const overview = await buildElModuleData({ ...options, module: 'overview', focus: options?.question || 'Общий контекст' })
  return {
    overview,
    page: options?.page || null,
    requestedPeriod: options?.period || null,
    rule: 'Используй только подтверждённые данные. Для другого раздела вызови инструмент соответствующего модуля.',
  }
}

app.use('/api/el', authRequired, elRouter)

app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message || 'Внутренняя ошибка' }))

async function persistStockSnapshot(connectionId, rows, stockMeta) {
  const normalizedRows = Array.isArray(rows) ? rows : []
  const normalizedMeta = stockMeta || buildStockMeta(normalizedRows)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const current = await client.query('SELECT data FROM marketplace_connections WHERE id=$1 FOR UPDATE', [connectionId])
    if (!current.rowCount) throw new Error('Подключение WB не найдено при сохранении остатков')
    const data = { ...(current.rows[0].data || {}) }
    const saved = await saveStreamData(client, {
      connectionId,
      stream:'stocks',
      payload:normalizedRows,
      metadata:normalizedMeta,
      source:'background_sync',
    })
    data.stockMeta = normalizedMeta
    data.stageStatus = {
      ...(data.stageStatus || {}),
      stocks: {
        status:'success', available:true, count:normalizedRows.length, totalQuantity:normalizedMeta.totalQuantity,
        lastSuccessAt:new Date().toISOString(), nextAllowedAt:null, error:null,
      },
    }
    data.syncWarnings = (Array.isArray(data.syncWarnings) ? data.syncWarnings : []).filter(text => !String(text).startsWith('Остатки:'))
    const existingSources = data?.dataManifest?.streams && typeof data.dataManifest.streams === 'object'
      ? data.dataManifest.streams
      : {}
    const sources = {
      ...existingSources,
      stocks:{ source:'background_sync', count:Number(saved.row_count || normalizedRows.length), updatedAt:saved.updated_at || new Date().toISOString(), checksum:saved.checksum || null },
    }
    const compactData = compactConnectionData(data, sources)
    await client.query(`
      UPDATE marketplace_connections
      SET data=$1::jsonb,last_sync_at=NOW(),updated_at=NOW(),status='connected'
      WHERE id=$2
    `, [JSON.stringify(compactData), connectionId])
    const persistedRows = Number(saved.row_count || 0)
    const persistedQuantity = Number(normalizedMeta.totalQuantity || 0)
    if (persistedRows !== normalizedRows.length) {
      throw new Error(`Остатки WB не прошли проверку сохранения: ${persistedRows}/${normalizedRows.length} строк.`)
    }
    await client.query('COMMIT')
    return { data:compactData, persistedRows, persistedQuantity }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

const backgroundStockLocks = new Set()
async function processPendingStockReports() {
  if (!pool) return
  let pending = []
  try {
    const result = await pool.query(`
      SELECT s.*, c.user_id, c.data, c.sync_history
      FROM wb_sync_states s
      JOIN marketplace_connections c ON c.id=s.connection_id
      WHERE s.stage='stocks' AND s.status IN ('pending','rate_limited','queued','retry_scheduled')
        AND (s.next_allowed_at IS NULL OR s.next_allowed_at <= NOW())
      ORDER BY s.updated_at
      LIMIT 10
    `)
    pending = result.rows
  } catch (error) {
    console.warn('Pending stock report scan failed:', error.message)
    return
  }

  for (const row of pending) {
    if (!smartSchedulerAllows(row.connection_id,'stocks')) continue
    if (backgroundStockLocks.has(row.connection_id)) continue
    backgroundStockLocks.add(row.connection_id)
    try {
      const tokens = await getWbTokens(row.user_id, row.connection_id)
      const selected = chooseToken(tokens, 'analytics')
      if (!selected) {
        await updateSyncState(row.connection_id, 'stocks', { status:'missing_token', lastError:'Нужен токен с категорией «Аналитика»', nextAllowedAt:null })
        continue
      }
      const result = await advanceWarehouseRemainsTask(selected.token, row, { deadlineAt:Date.now() + 55000 })
      if (result.pending) {
        await updateSyncState(row.connection_id, 'stocks', { status:'pending', nextAllowedAt:result.nextAllowedAt, taskId:result.taskId, metadata:{ taskStatus:result.taskStatus }, lastError:null })
        continue
      }
      const stockMeta = result.stockMeta || buildWarehouseMetaStrict(result.rows)
      if (result.rawPayload !== undefined) {
        await saveSnapshot(pool, {
          connectionId:row.connection_id,
          stream:'stocks',
          endpoint:result.endpoint || 'warehouse_remains/download',
          requestKey:String(stockMeta?.taskId || row.task_id || ''),
          rawPayload:result.rawPayload,
          normalizedPayload:result.rows,
          validation:result.validation || stockMeta,
          keep:3,
        })
      }
      const persisted = await persistStockSnapshot(row.connection_id, result.rows, stockMeta)
      await updateSyncState(row.connection_id, 'stocks', {
        status:'success', lastSuccessAt:new Date().toISOString(), nextAllowedAt:null, lastError:null,
        lastCount:result.rows.length, taskId:null,
        metadata:{ taskStatus:'done', ...stockMeta, persistedRows:persisted.persistedRows, persistedQuantity:persisted.persistedQuantity },
      })
    } catch (error) {
      const schedulerWait = error?.code === 'WB_SCHEDULER_WAIT'
      const retryable = !schedulerWait && isRetryableWbError(error)
      const plan = retryable ? transientRetryPlan(row,'stocks',error) : null
      const nextAllowedAt = error?.nextAllowedAt || plan?.nextAllowedAt || new Date(Date.now() + 60000).toISOString()
      const status = schedulerWait ? 'queued' : Number(error?.status)===429 ? 'rate_limited' : retryable ? 'retry_scheduled' : 'pending'
      await updateSyncState(row.connection_id, 'stocks', {
        status,nextAllowedAt,lastError:schedulerWait ? 'Smart Scheduler ждёт разрешённое окно WB; повтор выполнится автоматически без нового запроса до этого времени.' : retryable ? `Временная ошибка WB. Прогресс отчёта сохранён; автоповтор после ${new Date(nextAllowedAt).toLocaleString('ru-RU')}.` : error.message,
        taskId:error?.resetTask?null:row.task_id,
        metadata:{ ...(row.metadata || {}),...smartSchedulerMeta('stocks',{reason:schedulerWait?'preflight_window':Number(error?.status)===429?'wb_429':'stock_poll',requestSent:!schedulerWait}),...(plan ? {automaticRetryAttempt:plan.attempt,automaticRetryReason:plan.reason,lastTransientError:error.message} : {}) },
      })
    } finally {
      backgroundStockLocks.delete(row.connection_id)
    }
  }
}



const generatedReportLocks = new Set()
async function processPendingGeneratedReports() {
  if (!pool) return
  let due = []
  try {
    const result = await pool.query(`
      SELECT s.*, c.user_id, c.data, c.sync_history
      FROM wb_sync_states s
      JOIN marketplace_connections c ON c.id=s.connection_id
      WHERE s.stage IN ('paidStorage','acceptance')
        AND s.status IN ('pending','queued','rate_limited','retry_scheduled')
        AND (s.next_allowed_at IS NULL OR s.next_allowed_at <= NOW())
      ORDER BY (s.task_id IS NOT NULL) DESC, s.next_allowed_at NULLS FIRST, s.updated_at
      LIMIT 6
    `)
    due = result.rows
  } catch (error) {
    console.warn('Generated WB reports scan failed:', error.message)
    return
  }

  for (const row of due) {
    if (!smartSchedulerAllows(row.connection_id,row.stage)) continue
    if (generatedReportLocks.has(row.connection_id)) continue
    generatedReportLocks.add(row.connection_id)
    try {
      const connectionResult = await pool.query('SELECT * FROM marketplace_connections WHERE id=$1 AND user_id=$2', [row.connection_id,row.user_id])
      const connection = connectionResult.rows[0]
      if (!connection) continue
      const tokens = await getWbTokens(row.user_id,row.connection_id)
      const canonical = await canonicalConnectionData(connection,{ repair:true,persistManifest:false,queueMissing:false })
      const data = canonical.data
      const result = await runSyncStage({ connection,tokens,data,stage:row.stage,deadlineAt:Date.now()+85000 })
      if (['success','queued'].includes(result.status)) data[stageDataKey(row.stage)] = result.value
      const stageStatus = { ...(data.stageStatus || {}) }
      stageStatus[row.stage] = {
        status:result.status,
        available:stageCount(row.stage,result.value) > 0,
        count:stageCount(row.stage,result.value),
        lastSuccessAt:result.state?.last_success_at || null,
        nextAllowedAt:result.state?.next_allowed_at || null,
        error:result.state?.last_error || null,
      }
      data.stageStatus = stageStatus
      const existingSources = data?.dataManifest?.streams && typeof data.dataManifest.streams === 'object' ? data.dataManifest.streams : {}
      const sources = { ...existingSources, [row.stage]:{ source:'background_sync', count:stageCount(row.stage,result.value), updatedAt:new Date().toISOString(), checksum:null } }
      const compactData = compactConnectionData(data,sources)
      await pool.query(`UPDATE marketplace_connections SET data=$1::jsonb,updated_at=NOW(),status='connected' WHERE id=$2`,[JSON.stringify(compactData),row.connection_id])
    } catch (error) {
      console.warn(`Generated WB report ${row.stage} failed:`,error.message)
    } finally {
      generatedReportLocks.delete(row.connection_id)
    }
  }
}


async function dailyFinanceSummary(connectionId, date) {
  const result = await pool.query(`
    SELECT COUNT(*)::int AS movements,
      COALESCE(SUM(CASE WHEN metric_role='settlement' THEN amount ELSE 0 END),0)::float8 AS "sellerPayable",
      COALESCE(SUM(CASE WHEN operation_code='gross_sale' THEN amount ELSE 0 END),0)::float8 AS "grossRevenue",
      COALESCE(SUM(CASE WHEN included_in_pnl=TRUE AND detail_only=FALSE AND amount<0 THEN ABS(amount) ELSE 0 END),0)::float8 AS expenses,
      COALESCE(SUM(CASE WHEN metric_role='adjustment' AND detail_only=FALSE AND amount>0 THEN amount ELSE 0 END),0)::float8 AS compensations,
      COALESCE(SUM(CASE WHEN operation_group='commission' AND detail_only=FALSE THEN ABS(amount) ELSE 0 END),0)::float8 AS commission,
      COALESCE(SUM(CASE WHEN operation_group='logistics' AND detail_only=FALSE THEN ABS(amount) ELSE 0 END),0)::float8 AS logistics,
      COALESCE(SUM(CASE WHEN operation_group='storage' AND detail_only=FALSE THEN ABS(amount) ELSE 0 END),0)::float8 AS storage,
      COALESCE(SUM(CASE WHEN operation_group='acceptance' AND detail_only=FALSE THEN ABS(amount) ELSE 0 END),0)::float8 AS acceptance,
      COALESCE(SUM(CASE WHEN operation_group='acquiring' AND detail_only=FALSE THEN ABS(amount) ELSE 0 END),0)::float8 AS acquiring,
      COALESCE(SUM(CASE WHEN operation_group='penalties' AND detail_only=FALSE THEN ABS(amount) ELSE 0 END),0)::float8 AS penalties,
      COALESCE(SUM(CASE WHEN operation_group='deductions' AND detail_only=FALSE THEN ABS(amount) ELSE 0 END),0)::float8 AS deductions,
      MIN(operation_date) AS "dateFrom",MAX(operation_date) AS "dateTo"
    FROM wb_finance_ledger
    WHERE connection_id=$1 AND operation_date=$2::date
  `,[connectionId,date])
  const row=result.rows[0] || {}
  return {
    movements:Number(row.movements || 0),sellerPayable:Number(row.sellerPayable || 0),grossRevenue:Number(row.grossRevenue || 0),
    expenses:Number(row.expenses || 0),compensations:Number(row.compensations || 0),commission:Number(row.commission || 0),
    logistics:Number(row.logistics || 0),storage:Number(row.storage || 0),acceptance:Number(row.acceptance || 0),
    acquiring:Number(row.acquiring || 0),penalties:Number(row.penalties || 0),deductions:Number(row.deductions || 0),
    dateFrom:row.dateFrom || null,dateTo:row.dateTo || null,
  }
}

async function loadDailySnapshotRow(connectionId,date) {
  const result=await pool.query(`
    SELECT connection_id,snapshot_date::text AS snapshot_date,timezone,source_revision,status,snapshot,generated_at,updated_at
    FROM wb_daily_snapshots WHERE connection_id=$1 AND snapshot_date=$2::date
  `,[connectionId,date])
  return result.rows[0] || null
}

function dailySnapshotMetricSummary(core = {}, finance = {}) {
  const summary={...(core?.summary || {})}
  if (Number(finance?.movements || 0) > 0) {
    summary.sellerPayable=Number(finance.sellerPayable || 0)
    summary.commission=Math.round(Number(finance.commission || 0))
    summary.logistics=Math.round(Number(finance.logistics || 0))
    summary.storage=Math.round(Number(finance.storage || 0))
    summary.acceptance=Math.round(Number(finance.acceptance || 0))
    summary.acquiring=Math.round(Number(finance.acquiring || 0))
    summary.penalties=Math.round(Number(finance.penalties || 0))
    summary.deductions=Math.round(Number(finance.deductions || 0))
  } else {
    summary.sellerPayable=null
  }
  return summary
}

async function buildAndSaveDailyReadySnapshot(connection, date, states = null) {
  const targetDate=String(date || yesterdayDateKey(new Date(),dailyReadyTimezone)).slice(0,10)
  const stateRows=Array.isArray(states) ? states : await getSyncStates(connection.id)
  const revision=dailySnapshotSourceRevision(stateRows,targetDate)
  const previousSavedRow=await loadDailySnapshotRow(connection.id,targetDate)
  const [{data},settings,finance,previousFinance]=await Promise.all([
    canonicalConnectionData(connection,{repair:true,persistManifest:false,queueMissing:false}),
    getBusinessSettings(connection.user_id),
    dailyFinanceSummary(connection.id,targetDate),
    dailyFinanceSummary(connection.id,shiftIsoDate(targetDate,-1)),
  ])
  const range={from:targetDate,to:targetDate,days:1}
  const previousDate=shiftIsoDate(targetDate,-1)
  const previousRange={from:previousDate,to:previousDate,days:1}
  const core=buildCoreAnalytics(analyticsFilterConnectionData(data,range),settings)
  const previousCore=buildCoreAnalytics(analyticsFilterConnectionData(data,previousRange),settings)
  const metricStates=buildDailyMetricStates({core,states:stateRows,date:targetDate,financeLedger:{summary:finance}})
  const previousMetricStates=buildDailyMetricStates({core:previousCore,states:stateRows,date:previousDate,financeLedger:{summary:previousFinance}})
  const readiness=dailyReadinessSummary(metricStates)
  const compact=compactDailyCore(core,{summary:finance})
  compact.summary=dailySnapshotMetricSummary(core,finance)
  const previousCompact=compactDailyCore(previousCore,{summary:previousFinance})
  previousCompact.summary=dailySnapshotMetricSummary(previousCore,previousFinance)
  const nextSnapshot={
    version:2,date:targetDate,timezone:dailyReadyTimezone,generatedAt:new Date().toISOString(),sourceRevision:revision,
    status:readiness.status,readiness,metricStates,
    core:compact,
    previous:{date:previousDate,metricStates:previousMetricStates,core:previousCompact},
    automatic:{
      enabled:true,mode:'daily_ready',slot:dailyReadySlot(new Date(),dailyReadyTimezone),
      operationalCadenceMinutes:{orders:30,sales:30,advertising:60,stocks:60},
      note:'ELISEI готовит вчерашний день в фоне. Вход пользователя не запускает запросы к WB.',
    },
  }
  const snapshot=mergeDailyReadySnapshots(previousSavedRow?.snapshot || null,nextSnapshot)
  snapshot.sourceRevision=revision
  snapshot.generatedAt=nextSnapshot.generatedAt
  const saved=await pool.query(`
    INSERT INTO wb_daily_snapshots(connection_id,snapshot_date,timezone,source_revision,status,snapshot,generated_at,updated_at)
    VALUES($1,$2::date,$3,$4,$5,$6::jsonb,NOW(),NOW())
    ON CONFLICT(connection_id,snapshot_date) DO UPDATE SET
      timezone=EXCLUDED.timezone,source_revision=EXCLUDED.source_revision,status=EXCLUDED.status,snapshot=EXCLUDED.snapshot,
      generated_at=NOW(),updated_at=NOW()
    RETURNING snapshot_date::text AS snapshot_date,timezone,source_revision,status,snapshot,generated_at,updated_at
  `,[connection.id,targetDate,dailyReadyTimezone,revision,readiness.status,JSON.stringify(snapshot)])
  return saved.rows[0]
}

async function scheduleDailyReadyStages() {
  if (!pool) return
  let rows=[]
  try {
    // Нужен сам connection.data: Daily Ready проверяет фактически сохранённое
    // покрытие вчерашней даты, а не только текущий статус очереди Scheduler.
    const result=await pool.query(`SELECT * FROM marketplace_connections WHERE status='connected' ORDER BY updated_at LIMIT 40`)
    rows=result.rows
  } catch(error) {
    console.warn('Daily Ready schedule scan failed:',error.message)
    return
  }
  const now=Date.now()
  const slot=dailyReadySlot(new Date(now),dailyReadyTimezone)
  const targetDate=yesterdayDateKey(new Date(now),dailyReadyTimezone)
  const targetRange={from:targetDate,to:targetDate,days:1}
  for(const row of rows){
    try{
      const [states,canonical]=await Promise.all([
        getSyncStates(row.id),
        canonicalConnectionData(row,{repair:true,persistManifest:false,queueMissing:false}),
      ])
      const filtered=analyticsFilterConnectionData(canonical.data,targetRange)
      const coverage=filtered?.__periodCoverage || {}
      const operationalPlan=dailyOperationalRecoveryPlan({coverage,states,date:targetDate,now})
      for(const stage of operationalPlan){
        const current=states.find(item=>item.stage===stage) || null
        const metadata={
          ...(current?.metadata || {}),trigger:'daily_ready_recovery',dailyReadySlot:slot,dailyReadyDate:targetDate,
          missingCoverage:true,queuedForClosedDay:true,
        }
        if(['orders','sales'].includes(stage)) metadata.dateFrom=targetDate
        if(stage==='advertising') {
          metadata.period=boundedSyncPeriod(analyticsPeriodRange({from:shiftIsoDate(targetDate,-29),to:targetDate}),31)
        }
        await updateSyncState(row.id,stage,{status:'queued',nextAllowedAt:new Date().toISOString(),lastError:null,metadata})
      }

      const heavyPlan=dailyHeavyStagePlan({states,now,timeZone:dailyReadyTimezone})
      for(const stage of heavyPlan){
        const current=states.find(item=>item.stage===stage) || null
        const metadata={...(current?.metadata || {}),trigger:'daily_ready',dailyReadySlot:slot,dailyReadyDate:targetDate}
        if(['finance','acquiring'].includes(stage)) metadata.period=reportPeriod(30)
        await updateSyncState(row.id,stage,{status:'queued',nextAllowedAt:new Date().toISOString(),lastError:null,metadata})
      }
    }catch(error){
      console.warn(`Daily Ready scheduler failed for ${row.id || row.connection_id}:`,error.message)
    }
  }
}

async function refreshDailyReadySnapshots() {
  if (!pool) return
  let rows=[]
  try {
    const result=await pool.query(`SELECT * FROM marketplace_connections WHERE status='connected' ORDER BY updated_at DESC LIMIT 30`)
    rows=result.rows
  } catch(error) {
    console.warn('Daily Ready snapshot scan failed:',error.message)
    return
  }
  const date=yesterdayDateKey(new Date(),dailyReadyTimezone)
  for(const connection of rows){
    try{
      const states=await getSyncStates(connection.id)
      const revision=dailySnapshotSourceRevision(states,date)
      const current=await loadDailySnapshotRow(connection.id,date)
      if (!snapshotNeedsRefresh(current,revision,{maxAgeMs:6*60*60*1000,now:Date.now()})) continue
      await buildAndSaveDailyReadySnapshot(connection,date,states)
    }catch(error){
      console.warn(`Daily Ready snapshot failed for ${connection.id}:`,error.message)
    }
  }
}

async function scheduleDueLiveSyncStages() {
  if (!pool) return
  let rows=[]
  try {
    const result=await pool.query(`
      SELECT c.id AS connection_id,COALESCE(l.settings,'{}'::jsonb) AS settings,c.user_id
      FROM marketplace_connections c
      LEFT JOIN wb_live_sync_settings l ON l.connection_id=c.id
      WHERE c.status='connected'
      ORDER BY COALESCE(l.updated_at,c.updated_at)
      LIMIT 40
    `)
    rows=result.rows
  } catch(error) {
    console.warn('Live sync schedule scan failed:',error.message)
    return
  }
  for(const row of rows){
    try{
      const states=await getSyncStates(row.connection_id)
      const due=dueLiveStages({settings:{...(row.settings || {}),enabled:true,intervals:{...AUTOMATIC_REFRESH_INTERVALS_SECONDS}},states,now:Date.now()}).slice(0,liveSyncBatchLimit)
      for(const stage of due){
        const current=states.find(item=>item.stage===stage) || null
        const metadata={...(current?.metadata || {}),trigger:'live_poll',liveQueuedAt:new Date().toISOString()}
        if(stage==='advertising') metadata.period=boundedSyncPeriod(analyticsPeriodRange({from:isoDaysAgo(30).slice(0,10),to:new Date().toISOString().slice(0,10)}),31)
        await updateSyncState(row.connection_id,stage,{status:'queued',nextAllowedAt:new Date().toISOString(),lastError:null,metadata})
      }
      if(due.length) await pool.query(`INSERT INTO wb_live_sync_settings(connection_id,settings,last_poll_at,updated_at) VALUES($1,$2::jsonb,NOW(),NOW()) ON CONFLICT(connection_id) DO UPDATE SET last_poll_at=NOW(),updated_at=NOW()`,[row.connection_id,JSON.stringify({enabled:true,mode:'polling',intervals:AUTOMATIC_REFRESH_INTERVALS_SECONDS,webhooksEnabled:Boolean(row.settings?.webhooksEnabled),automaticPolicyVersion:1})])
    }catch(error){
      console.warn(`Live sync scheduler failed for ${row.connection_id}:`,error.message)
    }
  }
}

const deferredStageLocks = new Set()
async function processDueDeferredStages() {
  if (!pool) return
  let due = []
  try {
    const result = await pool.query(`
      SELECT s.*, c.user_id, c.data, c.sync_history, c.id AS connection_id
      FROM wb_sync_states s
      JOIN marketplace_connections c ON c.id=s.connection_id
      WHERE s.stage NOT IN ('stocks','paidStorage','acceptance','fbsArchive') AND s.status IN ('rate_limited','queued','retry_scheduled')
        AND s.next_allowed_at IS NOT NULL AND s.next_allowed_at <= NOW()
      ORDER BY s.next_allowed_at
      LIMIT 10
    `)
    due = result.rows
  } catch (error) {
    console.warn('Deferred WB stage scan failed:', error.message)
    return
  }

  for (const row of due) {
    if (!smartSchedulerAllows(row.connection_id,row.stage)) continue
    const syncKey = `${row.user_id}:${row.connection_id}`
    if (deferredStageLocks.has(row.connection_id) || activeSyncs.has(syncKey)) continue
    deferredStageLocks.add(row.connection_id)
    try {
      const connectionResult = await pool.query('SELECT * FROM marketplace_connections WHERE id=$1 AND user_id=$2', [row.connection_id, row.user_id])
      const connection = connectionResult.rows[0]
      if (!connection) continue
      const tokens = await getWbTokens(row.user_id, row.connection_id)
      const canonical = await canonicalConnectionData(connection, { repair:true, persistManifest:false, queueMissing:false })
      const data = canonical.data
      const result = await runSyncStage({ connection, tokens, data, stage:row.stage, deadlineAt:Date.now() + 85000 })
      const stageStatus = { ...(data.stageStatus || {}) }
      stageStatus[row.stage] = {
        status:result.status,
        available:result.status === 'success' || stageCount(row.stage, result.value) > 0,
        count:stageCount(row.stage, result.value),
        lastSuccessAt:result.state?.last_success_at || null,
        nextAllowedAt:result.state?.next_allowed_at || null,
        error:result.state?.last_error || null,
      }
      data.stageStatus = stageStatus
      if (result.status === 'success') data[stageDataKey(row.stage)] = result.value
      const prefix = `${WB_SYNC_STAGES[row.stage]?.label || row.stage}:`
      const previousWarnings = (Array.isArray(data.syncWarnings) ? data.syncWarnings : []).filter(text => !String(text).startsWith(prefix))
      data.syncWarnings = result.warning ? [...previousWarnings, result.warning] : previousWarnings
      rebuildUnifiedProductData(data)
      const history = withSyncLog(connection.sync_history, {
        status:result.status === 'success' ? 'success' : 'partial',
        durationMs:0,
        automatic:true,
        counts:{ [row.stage]:stageCount(row.stage, result.value) },
        warnings:result.warning ? [result.warning] : [],
        stages:{ [row.stage]:result.status },
      })
      const compactData = compactConnectionData(data, streamSourcesFromData(data, result.status === 'success' ? 'sync' : 'stream_store'))
      await pool.query(`
        UPDATE marketplace_connections
        SET data=$1::jsonb,sync_history=$2::jsonb,last_sync_at=CASE WHEN $3 THEN NOW() ELSE last_sync_at END,
            updated_at=NOW(),status='connected'
        WHERE id=$4 AND user_id=$5
      `, [JSON.stringify(compactData), JSON.stringify(history), result.status === 'success', row.connection_id, row.user_id])
    } catch (error) {
      console.warn(`Deferred WB stage ${row.stage} failed:`, error.message)
    } finally {
      deferredStageLocks.delete(row.connection_id)
    }
  }
}

const archiveStageLocks = new Set()
async function processDueArchiveStages() {
  if (!pool) return
  let due = []
  try {
    const result = await pool.query(`
      SELECT s.*,c.user_id,c.id AS connection_id
      FROM wb_sync_states s
      JOIN marketplace_connections c ON c.id=s.connection_id
      WHERE s.stage='fbsArchive'
        AND s.status IN ('rate_limited','queued','retry_scheduled')
        AND s.next_allowed_at IS NOT NULL AND s.next_allowed_at <= NOW()
      ORDER BY s.next_allowed_at
      LIMIT 4
    `)
    due = result.rows
  } catch (error) {
    console.warn('FBS archive lane scan failed:',error.message)
    return
  }

  for (const row of due) {
    if (!smartSchedulerAllows(row.connection_id,'fbsArchive')) continue
    const syncKey = `${row.user_id}:${row.connection_id}`
    if (archiveStageLocks.has(row.connection_id) || activeSyncs.has(syncKey)) continue
    archiveStageLocks.add(row.connection_id)
    try {
      const connectionResult = await pool.query('SELECT * FROM marketplace_connections WHERE id=$1 AND user_id=$2',[row.connection_id,row.user_id])
      const connection = connectionResult.rows[0]
      if (!connection) continue
      const tokens = await getWbTokens(row.user_id,row.connection_id)
      const canonical = await canonicalConnectionData(connection,{ repair:true,persistManifest:false,queueMissing:false })
      await runSyncStage({ connection,tokens,data:canonical.data,stage:'fbsArchive',deadlineAt:Date.now()+85000 })
      // Архив хранится в wb_stream_items/wb_stream_data и обновляет свой sync-state.
      // Полный JSON подключения здесь не переписывается, поэтому архивная полоса
      // может работать параллельно и не затирает результаты финансов/документов.
    } catch (error) {
      console.warn(`FBS archive lane failed for ${row.connection_id}:`,error.message)
    } finally {
      archiveStageLocks.delete(row.connection_id)
    }
  }
}

app.listen(port, () => {
  console.log(`ELISEI API listening on ${port}`)
  // HTTP поднимается независимо от PostgreSQL. Если база Render просыпается
  // дольше backend, сервис остаётся доступным и переподключается сам.
  scheduleDatabaseInitialization(100, 'startup')
})

// Worker не трогает очередь, пока PostgreSQL не готов. Это предотвращает
// падение API и ложные зависшие стадии во время краткого отказа базы.
setInterval(() => {
  if (databaseState.ready) kickBackgroundWorkers('interval')
  else if (!databaseInitPromise && !databaseRetryTimer) scheduleDatabaseInitialization(0, 'interval-retry')
}, 30000)
