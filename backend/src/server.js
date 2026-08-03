import 'dotenv/config'
import crypto from 'node:crypto'
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

const { Pool } = pg
const app = express()
const port = Number(process.env.PORT || 10000)
const allowedOrigins = (process.env.FRONTEND_ORIGIN || '').split(',').map(v => v.trim()).filter(Boolean)
const ttlMs = Number(process.env.CONNECTION_TTL_HOURS || 12) * 60 * 60 * 1000
const jwtSecret = process.env.JWT_SECRET || ''
const databaseUrl = process.env.DATABASE_URL || ''
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined }) : null
const encryptionSecret = process.env.ENCRYPTION_KEY || jwtSecret
const encryptionKey = encryptionSecret ? crypto.createHash('sha256').update(encryptionSecret).digest() : null


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
    // Выполняем последовательно, чтобы два тяжёлых запроса WB одного продавца
    // не стартовали в одну секунду и не провоцировали глобальный лимитер.
    await processPendingStockReports()
    await processPendingGeneratedReports()
    await processDueDeferredStages()
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
app.use(cors({ origin(origin, cb) { if (!origin || !allowedOrigins.length || allowedOrigins.includes(origin)) return cb(null, true); cb(new Error('Origin is not allowed')) } }))
app.use(express.json({ limit: '2mb' }))

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
  await migrateLegacyWbTokens()
  await ensurePrimaryTokens()
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
})
const CORE_SYNC_SCOPES = [...new Set(Object.values(WB_SYNC_STAGES).map(item => item.scope))]
const STOCK_DATA_SCHEMA_VERSION = 5
const STOCK_DATA_SOURCE = 'wb_warehouse_remains'
const STOCK_REPORT_PROFILE = 'article_barcode_size_v1'
const HEAVY_SYNC_STAGES = Object.freeze(['finance','paidStorage','acceptance','acquiring'])
const HEAVY_PAGE_LIMIT = Math.max(500, Math.min(5000, Number(process.env.WB_HEAVY_PAGE_LIMIT || 2500)))
const HEAVY_DB_BATCH_SIZE = Math.max(100, Math.min(500, Number(process.env.WB_HEAVY_DB_BATCH_SIZE || 250)))
const HEAVY_STAGE_COOLDOWN_MS = Math.max(5000, Number(process.env.WB_HEAVY_STAGE_COOLDOWN_MS || 65000))

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
  const serviceSecret = inspectServiceSecret()
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
  const base = retryAfterSeconds(response, attempt) * 1000
  const jitter = 0.85 + Math.random() * 0.3
  return Math.max(1000, Math.round(base * jitter))
}

function humanWait(seconds) {
  if (seconds >= 3600) return `${Math.ceil(seconds / 3600)} ч.`
  if (seconds >= 60) return `${Math.ceil(seconds / 60)} мин.`
  return `${Math.max(1, Math.ceil(seconds))} сек.`
}

function authHeaders(token) {
  const info = inspectWbToken(token)
  const headers = {
    Authorization: token,
    Accept: 'application/json',
    'User-Agent': 'ELISEI/2.7.9 (marketplace analytics)',
  }
  // WB требует маркировать секретом запросы зарегистрированного облачного сервиса.
  // Персональные токены облачный ELISEI не принимает; для Базового без секрета действуют сниженные лимиты.
  if (wbClientSecret && (info.typeId === 1 || info.typeId === 4)) headers['X-Client-Secret'] = wbClientSecret
  return headers
}

async function wbFetch(url, token, options = {}) {
  const {
    maxAttempts = 3,
    timeoutMs = 45000,
    maxRetryDelayMs = 45000,
    deadlineAt = 0,
    label = 'WB API',
    ...fetchOptions
  } = options

  let lastError = null
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
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
    try { payload = text ? JSON.parse(text) : null } catch { payload = text }
    const requestId = response.headers.get('x-request-id') || payload?.requestId || ''

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

async function probeToken(token) {
  const info = inspectWbToken(token)
  // Лёгкий официальный /ping подтверждает, что токен активен и принимается WB.
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

function tokenStageCoverage(row) {
  const scopes = rowScopes(row)
  return Object.entries(WB_SYNC_STAGES)
    .filter(([, definition]) => scopes.includes(definition.scope))
    .map(([stage, definition]) => ({ stage, label: definition.label }))
}

function tokenCoreCoverage(row) {
  const scopes = rowScopes(row)
  return CORE_SYNC_SCOPES.filter(scope => scopes.includes(scope)).length
}

function coversAllCoreFlows(row) {
  const scopes = rowScopes(row)
  return CORE_SYNC_SCOPES.every(scope => scopes.includes(scope))
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
    readOnly: Boolean(row.read_only),
    isPrimary: Boolean(row.is_primary),
    coversAllCoreFlows: coversAllCoreFlows(row),
    stageCoverage,
    stageCoverageCount: stageCoverage.length,
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

function selectTokenRow(tokens, scope) {
  return [...tokens]
    .filter(item => rowScopes(item).includes(scope))
    .sort((a, b) => {
      const primaryDiff = Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary))
      if (primaryDiff) return primaryDiff
      const coreDiff = tokenCoreCoverage(b) - tokenCoreCoverage(a)
      if (coreDiff) return coreDiff
      const scopeDiff = rowScopes(b).length - rowScopes(a).length
      if (scopeDiff) return scopeDiff
      return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
    })[0] || null
}

function chooseToken(tokens, scope) {
  const row = selectTokenRow(tokens, scope)
  if (!row) return null
  const token = decryptToken(row.token_encrypted)
  return { row, token, info: inspectWbToken(token) }
}

async function recomputePrimaryToken(connectionId) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query(`SELECT * FROM wb_tokens WHERE connection_id=$1 AND status='active' ORDER BY created_at`, [connectionId])
    if (!result.rows.length) {
      await client.query('COMMIT')
      return null
    }
    const selected = [...result.rows].sort((a, b) => {
      const coreDiff = tokenCoreCoverage(b) - tokenCoreCoverage(a)
      if (coreDiff) return coreDiff
      const scopeDiff = rowScopes(b).length - rowScopes(a).length
      if (scopeDiff) return scopeDiff
      const primaryDiff = Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary))
      if (primaryDiff) return primaryDiff
      return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
    })[0]
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

function publicConnection(row, tokens = [], syncStates = []) {
  const scopes = tokens.length ? unionTokenScopes(tokens) : rowScopes(row)
  const primaryRow = tokens.find(item => item.is_primary) || [...tokens].sort((a,b) => tokenCoreCoverage(b) - tokenCoreCoverage(a))[0] || null
  const primaryToken = primaryRow ? publicWbToken(primaryRow) : null
  const allCoreCovered = CORE_SYNC_SCOPES.every(scope => scopes.includes(scope))
  const universal = Boolean(primaryRow && coversAllCoreFlows(primaryRow))
  const coverageByStage = Object.fromEntries(Object.entries(WB_SYNC_STAGES).map(([stage, definition]) => {
    const selected = selectTokenRow(tokens, definition.scope)
    return [stage, selected ? { tokenId:selected.id, label:selected.label, isPrimary:Boolean(selected.is_primary) } : null]
  }))
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
  const raw = String(value)
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10)
  const parsed = new Date(value)
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
    products: stageStatus.products?.available ?? rawProducts.length > 0,
    orders: stageStatus.orders?.available ?? orders.length > 0,
    sales: stageStatus.sales?.available ?? salesRows.length > 0,
    stocks: Boolean((trustedStocks && (stageStatus.stocks?.available ?? true)) || (stageStatus.sellerStocks?.available ?? sellerStocks.length > 0)),
    fboStocks: trustedStocks && Boolean(stageStatus.stocks?.available ?? true),
    sellerStocks: stageStatus.sellerStocks?.available ?? sellerStocks.length > 0,
    stockDetails: stocks.length > 0,
    advertising: stageStatus.advertising?.available ?? (Array.isArray(advertisingData.campaigns) && advertisingData.campaigns.length > 0),
    finance: stageStatus.finance?.available ?? financeRows.length > 0,
    paidStorage: stageStatus.paidStorage?.available ?? paidStorageRows.length > 0,
    acceptance: stageStatus.acceptance?.available ?? acceptanceRows.length > 0,
    acquiring: stageStatus.acquiring?.available ?? acquiringRows.length > 0,
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
        photo: row.photo || '',
        stock: 0,
        stockRows: 0,
        ordersCount: 0,
        salesCount: 0,
        returnsCount: 0,
        revenue: 0,
        dailySales: {},
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
  for (let offset = periodDays - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10)
    dailyMap.set(date, { date, revenue: 0, orders: 0, sales: 0, returns: 0 })
  }

  for (const row of orders) {
    const item = ensure(row)
    const mode = fulfillmentMode(row)
    const srid = String(row.srid || row.rid || '').trim()
    if (srid && mode !== 'UNKNOWN') modeBySrid.set(srid, mode)
    if (item) {
      item.ordersCount += 1
      const bucket = touchMode(item, mode)
      if (bucket) bucket.orders += 1
    }
    const day = dateKey(row.date || row.lastChangeDate || row.createdAt)
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
      if (day) item.dailySales[day] = (item.dailySales[day] || 0) + (isReturn ? -1 : 1)
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
        crr: adRevenue > 0 ? spend / adRevenue * 100 : null,
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
          spend:null, views:null, clicks:null, orders:null, revenue:null, ctr:null, crr:null,
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
    if (availability.stockDetails && item.stock <= 0 && item.salesCount > 0) pushRecommendation(1, 'stock', item, `Пополнить «${item.title}»`, `За 30 дней было ${item.salesCount} продаж, но текущий остаток равен нулю.`, `Риск потерять продажи`)
    else if (availability.stockDetails && item.stockCoverDays != null && item.stockCoverDays < 14) pushRecommendation(2, 'stock', item, `Запланировать поставку «${item.title}»`, `Запаса примерно на ${item.stockCoverDays} дней.`, `${item.stock} шт. на складах`)
    if (availability.stockDetails && item.salesCount === 0 && item.stock > 20) pushRecommendation(3, 'slow', item, `Разобрать неликвид «${item.title}»`, `Нет продаж за 30 дней при остатке ${item.stock} шт.`, item.frozenMoney ? `Заморожено ≈ ${item.frozenMoney} ₽` : '')
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
  const chrtIds = uniqueIdentities((Array.isArray(products) ? products : []).flatMap(productChrtIds), cleanNumericIdentity).map(Number).filter(Number.isFinite)
  if (!sellerWarehouses.length || !chrtIds.length) {
    return { value:[], rawPayload:{ warehouses:sellerWarehouses, stocks:[] }, validation:{ warehouses:sellerWarehouses.length, chrtIds:chrtIds.length, rows:0 }, endpoint:warehouseEndpoint }
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
    rawPayload:{ warehouses:sellerWarehouses, stocks:rawStocks },
    validation:{ warehouses:sellerWarehouses.length, chrtIds:chrtIds.length, rows:rows.length, totalQuantity:rows.reduce((sum,row)=>sum+Number(row.quantity||0),0) },
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
  return Array.isArray(value) ? value : []
}

function stageCount(stage, value) {
  if (stage === 'advertising') return Array.isArray(value?.campaigns) ? value.campaigns.length : 0
  if (stage === 'finance' || stage === 'acquiring') return Array.isArray(value?.rows) ? value.rows.length : 0
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

async function loadStatisticsRows(kind, token, { deadlineAt = 0, previousRows = [] } = {}) {
  const endpointName = kind === 'orders' ? 'orders' : 'sales'
  const label = kind === 'orders' ? 'Заказы WB' : 'Продажи WB'
  const dateFrom = incrementalDateFrom(previousRows)
  const endpoint = `https://statistics-api.wildberries.ru/api/v1/supplier/${endpointName}?dateFrom=${encodeURIComponent(dateFrom)}&flag=0`
  const rawPayload = await wbFetch(endpoint, token, {
    label, timeoutMs:45000, maxAttempts:1, maxRetryDelayMs:0, deadlineAt,
  })
  const incoming = Array.isArray(rawPayload) ? rawPayload : []
  return {
    value:mergeStatisticsRows(kind, previousRows, incoming),
    rawPayload,
    validation:{ incomingRows:incoming.length, dateFrom },
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

async function loadAdvertising(token, { deadlineAt = 0, previous = {} } = {}) {
  const campaignEndpoint = 'https://advert-api.wildberries.ru/api/advert/v2/adverts?statuses=4,7,8,9,11'
  const campaignPayload = await wbFetch(campaignEndpoint, token, {
    label:'Кампании WB', timeoutMs:45000, maxAttempts:1, maxRetryDelayMs:0, deadlineAt,
  })
  const allCampaigns = normalizeCampaignListStrict(campaignPayload)
  const statusPriority = status => ({ 9:0, 11:1, 4:2, 7:3, 8:4 }[Number(status)] ?? 9)
  const campaigns = [...allCampaigns].sort((a,b) => statusPriority(a.status)-statusPriority(b.status) || Date.parse(b.changeTime || 0)-Date.parse(a.changeTime || 0))

  if (!campaigns.length) {
    const value = mergeAdvertisingSnapshot({ previous, campaigns:[], requestedIds:[], period:{ days:30 } })
    value.meta = buildAdvertisingMeta(value)
    return { value, rawPayload:{ campaigns:campaignPayload, stats:[] }, validation:{ campaigns:0, statsRows:0 }, endpoint:campaignEndpoint }
  }

  const batchSize = 50
  const previousOffset = Math.max(0, Number(previous?.meta?.nextStatsOffset || 0))
  const offset = previousOffset >= campaigns.length ? 0 : previousOffset
  const batch = campaigns.slice(offset, offset + batchSize)
  const requestedIds = batch.map(item => String(item.advertId))
  const endDate = new Date().toISOString().slice(0,10)
  const beginDate = new Date(Date.now()-29*86400000).toISOString().slice(0,10)
  const statsEndpoint = `https://advert-api.wildberries.ru/adv/v3/fullstats?ids=${encodeURIComponent(requestedIds.join(','))}&beginDate=${beginDate}&endDate=${endDate}`
  const statsPayload = requestedIds.length ? await wbFetch(statsEndpoint, token, {
    label:'Статистика рекламы WB', timeoutMs:60000, maxAttempts:1, maxRetryDelayMs:0, deadlineAt,
  }) : []
  const statsByAdvertId = normalizeFullStatsStrict(statsPayload)
  const value = mergeAdvertisingSnapshot({
    previous,
    campaigns,
    statsByAdvertId,
    requestedIds,
    period:{ beginDate, endDate, days:30 },
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

async function advancePagedFinanceTask(stage, connectionId, token, state, { deadlineAt = 0 } = {}) {
  const isFinance = stage === 'finance'
  const period = state?.metadata?.period || reportPeriod(30)
  const syncId = String(state?.metadata?.syncId || crypto.randomUUID())
  const rrdId = Number(state?.metadata?.rrdId || 0)
  const pageNumber = Number(state?.metadata?.pageNumber || 0)
  const endpoint = isFinance
    ? 'https://finance-api.wildberries.ru/api/finance/v1/sales-reports/detailed'
    : 'https://finance-api.wildberries.ru/api/finance/v1/acquiring/detailed'
  const payload = await wbFetch(endpoint, token, {
    method:'POST',
    body:JSON.stringify({ dateFrom:period.dateFrom, dateTo:period.dateTo, limit:HEAVY_PAGE_LIMIT, rrdId, period:'daily' }),
    headers:{ 'Content-Type':'application/json' },
    label:isFinance ? 'Финансовая детализация WB' : 'Эквайринг WB',
    timeoutMs:60000,maxAttempts:1,maxRetryDelayMs:0,deadlineAt,
  })
  const incoming = Array.isArray(payload) ? payload : []
  await saveStreamItemBatch(pool, {
    connectionId,stream:stage,syncId,rows:incoming,
    keyOf:(row,index)=>rawFinanceRowKey(stage,row,index),batchSize:HEAVY_DB_BATCH_SIZE,
  })
  const nextRrdId = Number(incoming.at(-1)?.rrdId ?? incoming.at(-1)?.rrd_id ?? 0)
  const hasMore = incoming.length >= HEAVY_PAGE_LIMIT && nextRrdId && nextRrdId !== rrdId
  const persistedCount = await countStreamItems(pool,{connectionId,stream:stage,syncId})
  if (hasMore) {
    return {
      pending:true,
      nextAllowedAt:new Date(Date.now()+HEAVY_STAGE_COOLDOWN_MS).toISOString(),
      metadata:{ period,syncId,rrdId:nextRrdId,pageNumber:pageNumber+1,persistedCount,lastPageRows:incoming.length },
    }
  }
  const compactRows = await aggregatePersistedHeavyRows(connectionId,stage,syncId)
  await finalizeStreamItems(pool,{connectionId,stream:stage,syncId})
  let balance = state?.metadata?.balance || null
  if (isFinance) {
    try {
      balance = await wbFetch('https://finance-api.wildberries.ru/api/v1/account/balance', token, {
        label:'Баланс WB',timeoutMs:20000,maxAttempts:1,maxRetryDelayMs:0,deadlineAt,
      })
    } catch (error) { console.warn('WB balance skipped:',error.message) }
  }
  const totals = isFinance
    ? summarizeFinanceRows(compactRows)
    : { acquiring:Math.round(compactRows.reduce((sum,row)=>sum+Math.abs(fieldNumber(row,['acquiringFee'],0)),0)*100)/100 }
  return {
    pending:false,
    value:{ rows:compactRows,totals,period,balance:isFinance?balance:null,complete:true,lastRrdId:nextRrdId||rrdId||null,rawRowCount:persistedCount,storage:'wb_stream_items' },
    validation:{ incomingRows:incoming.length,persistedRows:persistedCount,compactRows:compactRows.length,period,pages:pageNumber+1,memorySafe:true },
    endpoint,
  }
}

const GENERATED_REPORTS = Object.freeze({
  paidStorage:{ base:'https://seller-analytics-api.wildberries.ru/api/v1/paid_storage', chunkDays:2, totalDays:30, label:'Платное хранение WB' },
  acceptance:{ base:'https://seller-analytics-api.wildberries.ru/api/v1/acceptance_report', chunkDays:7, totalDays:30, label:'Платная приёмка WB' },
})

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
      nextAllowedAt:new Date(Date.now()+10000).toISOString(),
      metadata:{ ...metadata, chunks, chunkIndex, reportFrom:chunk.dateFrom, reportTo:chunk.dateTo },
    }
  }
  const statusPayload = await wbFetch(`${definition.base}/tasks/${encodeURIComponent(taskId)}/status`, token, {
    label:`Проверка отчёта «${definition.label}»`, timeoutMs:20000, maxAttempts:1, maxRetryDelayMs:0, deadlineAt,
  })
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
      metadata:{ ...metadata, chunks, chunkIndex, reportFrom:chunk.dateFrom, reportTo:chunk.dateTo },
    }
  }
  if (taskStatus === 'canceled' || taskStatus === 'purged') {
    throw Object.assign(new Error(`${definition.label}: отчёт завершён со статусом ${taskStatus}. Будет создан заново.`), { status:502, resetTask:true })
  }
  return {
    pending:true, taskId, taskStatus:taskStatus || 'processing',
    nextAllowedAt:new Date(Date.now()+10000).toISOString(),
    metadata:{ ...metadata, chunks, chunkIndex, reportFrom:chunk.dateFrom, reportTo:chunk.dateTo },
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
  const selected = chooseToken(tokens, definition.scope)
  if (!selected) {
    state = await updateSyncState(connection.id, stage, { status:'missing_token', lastAttemptAt:new Date().toISOString(), lastError:`Нужен токен с категорией «${WB_SCOPE_BITS[definition.scope].label}»`, nextAllowedAt:null })
    return { stage, status:'missing_token', value:fallback, warning:`${definition.label}: добавьте токен с категорией «${WB_SCOPE_BITS[definition.scope].label}».`, state }
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
      const loaded = await loadStatisticsRows(stage, selected.token, { deadlineAt, previousRows:fallback })
      value = loaded.value
      snapshot = loaded
    } else if (stage === 'advertising') {
      const loaded = await loadAdvertising(selected.token, { deadlineAt, previous:fallback })
      value = loaded.value
      meta = value.meta || null
      snapshot = loaded
    } else if (stage === 'finance' || stage === 'acquiring') {
      const result = await advancePagedFinanceTask(stage,connection.id,selected.token,state,{ deadlineAt })
      if (result.pending) {
        state = await updateSyncState(connection.id,stage,{
          status:'queued',lastAttemptAt:new Date().toISOString(),nextAllowedAt:result.nextAllowedAt,lastError:null,taskId:null,
          metadata:{ ...result.metadata,tokenId:selected.row.id,tokenLabel:selected.row.label,primary:Boolean(selected.row.is_primary),memorySafe:true },
        })
        return { stage,status:'queued',value:fallback,warning:`${definition.label}: сохранена страница ${Number(result.metadata.pageNumber || 0)} (${Number(result.metadata.persistedCount || 0)} строк). Продолжение поставлено в очередь.`,state }
      }
      value = result.value
      meta = { ...result.validation,totals:value.totals,balance:value.balance,memorySafe:true }
      snapshot = { endpoint:result.endpoint,validation:result.validation }
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
        normalizedPayload:['products','stocks','sellerStocks','advertising','finance','paidStorage','acceptance','acquiring'].includes(stage) ? value : null,
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
      ...(meta || {}),
      ...(snapshot?.validation ? { validation:snapshot.validation } : {}),
    }
    state = await updateSyncState(connection.id, stage, {
      status:'success', lastAttemptAt:new Date().toISOString(), lastSuccessAt:new Date().toISOString(), nextAllowedAt:null,
      lastError:null, lastCount:count, taskId:null, metadata:stateMetadata,
    })
    return { stage, status:'success', value, meta, state }
  } catch (error) {
    const nextAllowedAt = error?.nextAllowedAt || (error?.retryAfterSeconds ? new Date(Date.now()+Number(error.retryAfterSeconds)*1000).toISOString() : null)
    const status = Number(error?.status) === 429 ? 'rate_limited' : Number(error?.status) === 403 ? 'forbidden' : 'error'
    state = await updateSyncState(connection.id, stage, {
      status, lastAttemptAt:new Date().toISOString(), nextAllowedAt, lastError:error.message,
      taskId:error?.resetTask ? null : state?.task_id,
      metadata:{ ...(state?.metadata || {}), requestId:error?.requestId || null, code:error?.code || null, details:error?.details || null },
    })
    return { stage, status, value:fallback, warning:`${definition.label}: ${error.message}${stageCount(stage, fallback) ? ' Сохранены предыдущие данные.' : ''}`, state }
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
  let database = 'not-configured'
  if (pool) { try { await pool.query('SELECT 1'); database = 'ok' } catch { database = 'error' } }
  res.json({
    ok: true,
    service: 'elisei-api',
    version: '2.10.1',
    database,
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

app.get('/api/wb/connection', authRequired, async (req, res) => {
  let connection = await getConnection(req.auth.sub)
  if (!connection) return res.json(publicConnection(null))
  // Render может приостанавливать обычные таймеры между обращениями. Каждый
  // просмотр кабинета дополнительно будит очередь просроченных этапов.
  const kick = kickBackgroundWorkers(`connection:${connection.id}`)
  await Promise.race([kick, sleep(650)])
  connection = await getConnection(req.auth.sub, connection.id)
  const [tokens, states] = await Promise.all([getWbTokens(req.auth.sub, connection.id), getSyncStates(connection.id)])
  res.json(publicConnection(connection, tokens, states))
})

app.post('/api/wb/connect', authRequired, async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim()
    const requestedLabel = String(req.body?.label || '').trim().slice(0, 80)
    if (token.length < 40) return res.status(400).json({ error: 'API-ключ выглядит слишком коротким' })
    const info = await probeToken(token)
    const label = requestedLabel || (CORE_SYNC_SCOPES.every(scope => info.scopes.includes(scope)) ? 'Основной токен WB' : 'Дополнительный токен WB')
    let connection = await getConnection(req.auth.sub)
    if (connection?.seller_id && info.sellerId && connection.seller_id !== info.sellerId) {
      return res.status(409).json({ error: 'Этот токен относится к другому кабинету продавца. Для другого кабинета потребуется отдельный магазин ELISEI.' })
    }
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
    const states = await getSyncStates(connection.id)
    res.json(publicConnection(updated.rows[0], tokens, states))
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
  const updated = await pool.query(`UPDATE marketplace_connections SET scopes=$1::jsonb,status=$2,updated_at=NOW() WHERE id=$3 AND user_id=$4 RETURNING *`, [JSON.stringify(scopes), tokens.length ? 'connected' : 'needs_token', connection.id, req.auth.sub])
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
  // Статус опрашивается открытым интерфейсом. Используем этот heartbeat как
  // надёжный запуск фоновой очереди после окончания next_allowed_at.
  const kick = kickBackgroundWorkers(`status:${connection.id}`)
  await Promise.race([kick, sleep(650)])
  connection = await getConnection(req.auth.sub, connection.id)
  const [tokens, states] = await Promise.all([getWbTokens(req.auth.sub, connection.id), getSyncStates(connection.id)])
  res.json(publicConnection(connection, tokens, states))
})

app.post('/api/wb/sync', authRequired, async (req, res) => {
  const connection = await getConnection(req.auth.sub, String(req.body?.connectionId || '') || null)
  if (!connection) return res.status(404).json({ error: 'Подключение не найдено. Подключите Wildberries.' })
  const requestedStages = Array.isArray(req.body?.stages) ? req.body.stages.filter(stage => WB_SYNC_STAGES[stage]) : Object.keys(WB_SYNC_STAGES)
  if (!requestedStages.length) return res.status(400).json({ error: 'Не выбраны этапы синхронизации' })

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
  res.json({ core: buildCoreAnalytics(data, settings), dataSources:sources, recovered, recoveryQueued, lastSync: connection.last_sync_at || null })
})

app.get('/api/wb/advertising/:id', authRequired, async (req, res) => {
  const connection = await getConnection(req.auth.sub, req.params.id)
  if (!connection) return res.status(404).json({ error: 'Подключение не найдено' })
  const canonical = await canonicalConnectionData(connection)
  const advertising = canonical.data?.advertising && typeof canonical.data.advertising === 'object'
    ? canonical.data.advertising
    : { campaigns: [], totals: {}, period: null, truncated: false }
  const stateResult = await pool.query('SELECT * FROM wb_sync_states WHERE connection_id=$1 AND stage=$2', [connection.id, 'advertising'])
  res.json({
    advertising,
    meta: advertising.meta || buildAdvertisingMeta(advertising),
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
  const toDate = new Date(`${to}T23:59:59.999Z`)
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) return null
  return { from, to, fromDate, toDate, days: Math.max(1, Math.round((toDate - fromDate) / 86400000) + 1) }
}

function elRowDate(row = {}) {
  return dateKey(row.sale_dt || row.date || row.lastChangeDate || row.createdAt || row.updatedAt || row.orderDate)
}

function elFilterDataByPeriod(rawData = {}, period = {}) {
  const range = elPeriodRange(period)
  if (!range) return { data: { ...rawData }, range: null }
  const inside = row => {
    const key = elRowDate(row)
    return key && key >= range.from && key <= range.to
  }
  return {
    range,
    data: {
      ...rawData,
      orders: Array.isArray(rawData.orders) ? rawData.orders.filter(inside) : [],
      sales: Array.isArray(rawData.sales) ? rawData.sales.filter(inside) : [],
      __periodDays: range.days,
    },
  }
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
  const base = {
    available: true,
    module,
    focus,
    cabinet: { id: connection.id, sellerId: connection.seller_id || null },
    period: filtered.range ? { from: filtered.range.from, to: filtered.range.to, days: filtered.range.days } : { days: core.periodDays },
    coverage: elDataCoverage(connection, core, filtered.range),
    availability: core.availability,
    lastSync: connection.last_sync_at || null,
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
    return {
      ...base,
      summary: {
        revenue: core.summary.revenue, orders: core.summary.orders, sales: core.summary.sales,
        returns: core.summary.returns, returnRate: core.summary.returnRate,
      },
      dailyTrend: core.dailyTrend || [],
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
    const reviews = Array.isArray(connection.data?.reviews) ? connection.data.reviews
      : Array.isArray(connection.data?.feedbacks) ? connection.data.feedbacks : []
    return {
      ...base,
      available: reviews.length > 0,
      reviews: reviews.slice(0, 120),
      warning: reviews.length ? null : 'Отзывы и вопросы покупателей пока не синхронизированы с WB. Эл не будет выдумывать причины отзывов.',
      relatedReturns: products.filter(item => Number(item.returnsCount || 0) > 0).slice(0, 60).map(elCompactProduct),
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
    return {
      ...base,
      syncStates,
      syncWarnings: core.syncWarnings || [],
      stockMeta: core.stockMeta || null,
      stages: core.stageStatus || {},
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
      WHERE s.stage='stocks' AND s.status IN ('pending','rate_limited','queued')
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
      const nextAllowedAt = error?.nextAllowedAt || new Date(Date.now() + 60000).toISOString()
      await updateSyncState(row.connection_id, 'stocks', { status:Number(error?.status)===429?'rate_limited':'pending', nextAllowedAt, lastError:error.message, taskId:error?.resetTask?null:row.task_id })
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
        AND s.status IN ('pending','queued','rate_limited')
        AND (s.next_allowed_at IS NULL OR s.next_allowed_at <= NOW())
      ORDER BY s.updated_at
      LIMIT 6
    `)
    due = result.rows
  } catch (error) {
    console.warn('Generated WB reports scan failed:', error.message)
    return
  }

  for (const row of due) {
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

const deferredStageLocks = new Set()
async function processDueDeferredStages() {
  if (!pool) return
  let due = []
  try {
    const result = await pool.query(`
      SELECT s.*, c.user_id, c.data, c.sync_history, c.id AS connection_id
      FROM wb_sync_states s
      JOIN marketplace_connections c ON c.id=s.connection_id
      WHERE s.stage NOT IN ('stocks','paidStorage','acceptance') AND s.status IN ('rate_limited','queued')
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

initDatabase().then(() => {
  app.listen(port, () => console.log(`ELISEI API listening on ${port}`))
  // Один координированный worker вместо двух параллельных таймеров. Таймер
  // оставляем referenced, а HTTP heartbeat дублирует запуск после сна Render.
  setInterval(() => kickBackgroundWorkers('interval'), 30000)
  setTimeout(() => kickBackgroundWorkers('startup'), 5000)
}).catch(error => { console.error('Database initialization failed:', error); process.exit(1) })
