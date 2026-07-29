import 'dotenv/config'
import crypto from 'node:crypto'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import pg from 'pg'

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
  `)
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
  stocks: { label: 'Остатки', scope: 'analytics' },
  advertising: { label: 'Реклама', scope: 'promotion' },
})
const CORE_SYNC_SCOPES = [...new Set(Object.values(WB_SYNC_STAGES).map(item => item.scope))]

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
    'User-Agent': 'ELISEI/2.7.1 (marketplace analytics)',
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

function productKey(row) {
  return String(row?.nmId ?? row?.nmID ?? row?.nm_id ?? '').trim()
}

function buildCoreAnalytics(data = {}, rawSettings = {}) {
  const settings = sanitizeBusinessSettings({ ...DEFAULT_BUSINESS_SETTINGS, ...rawSettings })
  const rawProducts = Array.isArray(data.products) ? data.products : []
  const orders = Array.isArray(data.orders) ? data.orders : []
  const salesRows = Array.isArray(data.sales) ? data.sales : []
  const stocks = Array.isArray(data.stocks) ? data.stocks : []
  const advertisingData = data?.advertising && typeof data.advertising === 'object' ? data.advertising : { campaigns: [], totals: {} }
  const stageStatus = data?.stageStatus && typeof data.stageStatus === 'object' ? data.stageStatus : {}
  const availability = {
    products: stageStatus.products?.available ?? rawProducts.length > 0,
    orders: stageStatus.orders?.available ?? orders.length > 0,
    sales: stageStatus.sales?.available ?? salesRows.length > 0,
    stocks: stageStatus.stocks?.available ?? stocks.length > 0,
    advertising: stageStatus.advertising?.available ?? (Array.isArray(advertisingData.campaigns) && advertisingData.campaigns.length > 0),
  }
  const periodDays = 30
  const productMap = new Map()
  const ensure = (row = {}) => {
    const key = productKey(row) || String(row.vendorCode || row.supplierArticle || '').trim()
    if (!key) return null
    if (!productMap.has(key)) {
      productMap.set(key, {
        key,
        nmID: row.nmID ?? row.nmId ?? null,
        vendorCode: row.vendorCode || row.supplierArticle || '',
        title: row.title || row.subject || row.subjectName || 'Товар',
        brand: row.brand || '',
        photo: row.photo || '',
        stock: 0,
        ordersCount: 0,
        salesCount: 0,
        returnsCount: 0,
        revenue: 0,
        dailySales: {},
      })
    }
    const item = productMap.get(key)
    if (!item.vendorCode) item.vendorCode = row.vendorCode || row.supplierArticle || ''
    if ((!item.title || item.title === 'Товар') && (row.title || row.subjectName)) item.title = row.title || row.subjectName
    if (!item.brand && row.brand) item.brand = row.brand
    if (!item.photo && row.photo) item.photo = row.photo
    return item
  }

  rawProducts.forEach(row => ensure(row))
  const warehouses = new Map()
  for (const row of stocks) {
    const item = ensure(row)
    if (!item) continue
    const quantity = Math.max(0, firstNumber(row, ['quantity', 'quantityFull', 'stock', 'stockCount', 'totalQuantity', 'availableQuantity'], 0))
    item.stock += quantity
    const name = String(row.warehouseName || row.warehouse || row.officeName || 'Все склады').trim() || 'Все склады'
    warehouses.set(name, (warehouses.get(name) || 0) + quantity)
  }

  const dailyMap = new Map()
  for (let offset = periodDays - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10)
    dailyMap.set(date, { date, revenue: 0, orders: 0, sales: 0, returns: 0 })
  }

  for (const row of orders) {
    const item = ensure(row)
    if (item) item.ordersCount += 1
    const day = dateKey(row.date || row.lastChangeDate || row.createdAt)
    if (dailyMap.has(day)) dailyMap.get(day).orders += 1
  }

  for (const row of salesRows) {
    const item = ensure(row)
    const isReturn = String(row.saleID || row.saleId || '').toUpperCase().startsWith('R') || Boolean(row.isReturn)
    let amount = firstNumber(row, ['forPay', 'finishedPrice', 'priceWithDisc', 'totalPrice'], 0)
    if (isReturn && amount > 0) amount = -amount
    const day = dateKey(row.sale_dt || row.date || row.lastChangeDate || row.createdAt)
    if (item) {
      item.revenue += amount
      if (isReturn) item.returnsCount += 1
      else item.salesCount += 1
      if (day) item.dailySales[day] = (item.dailySales[day] || 0) + (isReturn ? -1 : 1)
    }
    if (dailyMap.has(day)) {
      const bucket = dailyMap.get(day)
      bucket.revenue += amount
      if (isReturn) bucket.returns += 1
      else bucket.sales += 1
    }
  }

  const actualAdvertisingSpend = Math.max(0, finiteNumber(advertisingData?.totals?.spend, 0))
  const advertisingExpense = availability.advertising ? actualAdvertisingSpend : settings.advertisingMonthly
  const sharedExpenses = advertisingExpense + settings.storageMonthly + settings.fixedMonthly
  let totalRevenue = 0
  let totalSales = 0
  let totalReturns = 0
  let totalOrders = orders.length
  let totalStock = 0
  for (const item of productMap.values()) {
    totalRevenue += item.revenue
    totalSales += item.salesCount
    totalReturns += item.returnsCount
    totalStock += item.stock
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
    const commission = Math.max(0, item.revenue) * settings.commissionPercent / 100
    const tax = Math.max(0, item.revenue) * settings.taxPercent / 100
    const logistics = item.salesCount * settings.logisticsPerSale
    const revenueShare = positiveRevenue > 0 ? Math.max(0, item.revenue) / positiveRevenue : 0
    const allocatedShared = sharedExpenses * revenueShare
    const profit = hasCost ? item.revenue - cogs - commission - tax - logistics - allocatedShared : null
    const margin = profit != null && item.revenue > 0 ? profit / item.revenue * 100 : null
    const dailyAverage = item.salesCount / periodDays
    const stockCoverDays = availability.stocks && dailyAverage > 0 ? item.stock / dailyAverage : null
    const values = [...dailyMap.keys()].map(day => item.dailySales[day] || 0)
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
    const cv = mean > 0 ? Math.sqrt(variance) / mean : null
    const xyz = cv == null ? 'Z' : cv <= 0.5 ? 'X' : cv <= 1 ? 'Y' : 'Z'
    const returnRate = item.salesCount > 0 ? item.returnsCount / item.salesCount * 100 : 0
    const denominator = 1 - (settings.commissionPercent + settings.taxPercent) / 100
    const breakevenPrice = hasCost && denominator > 0 ? (unitCost + settings.logisticsPerSale) / denominator : null
    const targetDenominator = 1 - settings.targetMarginPercent / 100
    const targetPrice = breakevenPrice != null && targetDenominator > 0 ? breakevenPrice / targetDenominator : null
    const frozenMoney = availability.stocks && item.salesCount === 0 && item.stock > 0 ? item.stock * (unitCost || averagePrice * 0.5) : 0
    let stockStatus = availability.stocks ? 'В наличии' : 'Не загружено'
    if (availability.stocks && item.stock <= 0) stockStatus = 'Нет остатка'
    else if (availability.stocks && stockCoverDays != null && stockCoverDays < 14) stockStatus = 'Заканчивается'
    else if (availability.stocks && stockCoverDays != null && stockCoverDays > 120) stockStatus = 'Избыток'
    else if (availability.stocks && item.salesCount === 0 && item.stock > 20) stockStatus = 'Без движения'

    let recommendation = availability.stocks ? 'Контролировать динамику' : 'Дождаться загрузки остатков WB'
    if (availability.stocks && item.stock <= 0 && item.salesCount > 0) recommendation = 'Срочно пополнить остаток'
    else if (availability.stocks && stockCoverDays != null && stockCoverDays < 14) recommendation = 'Запланировать поставку'
    else if (availability.stocks && item.salesCount === 0 && item.stock > 20) recommendation = 'Проверить цену и запустить распродажу'
    else if (returnRate >= 20 && item.salesCount >= 3) recommendation = 'Проверить карточку и причины возвратов'
    else if (profit != null && profit < 0) recommendation = 'Повысить цену или сократить расходы'
    else if (item.abc === 'A' && stockCoverDays != null && stockCoverDays < 30) recommendation = 'Сохранить цену и пополнить запас'

    return {
      ...item,
      revenue: Math.round(item.revenue),
      stock: availability.stocks ? Math.round(item.stock) : null,
      stockAvailable: availability.stocks,
      netUnits,
      averagePrice: Math.round(averagePrice),
      unitCost: Math.round(unitCost * 100) / 100,
      cogs: Math.round(cogs),
      commission: Math.round(commission),
      logistics: Math.round(logistics),
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
    acc.cogs += item.cogs || 0
    acc.commission += item.commission || 0
    acc.logistics += item.logistics || 0
    return acc
  }, { cogs: 0, commission: 0, logistics: 0 })
  const tax = Math.max(0, totalRevenue) * settings.taxPercent / 100
  const costConfigured = products.some(item => item.unitCost > 0)
  const operatingProfit = costConfigured
    ? totalRevenue - totals.cogs - totals.commission - totals.logistics - tax - sharedExpenses
    : null
  const margin = operatingProfit != null && totalRevenue > 0 ? operatingProfit / totalRevenue * 100 : null
  const averageDailySales = totalSales / periodDays
  const stockCoverDays = averageDailySales > 0 ? totalStock / averageDailySales : null

  const recommendations = []
  const pushRecommendation = (priority, type, product, title, text, effect = '') => {
    recommendations.push({ id: `${type}:${product?.key || recommendations.length}`, priority, type, productKey: product?.key || null, title, text, effect })
  }
  for (const item of products) {
    if (availability.stocks && item.stock <= 0 && item.salesCount > 0) pushRecommendation(1, 'stock', item, `Пополнить «${item.title}»`, `За 30 дней было ${item.salesCount} продаж, но текущий остаток равен нулю.`, `Риск потерять продажи`)
    else if (availability.stocks && item.stockCoverDays != null && item.stockCoverDays < 14) pushRecommendation(2, 'stock', item, `Запланировать поставку «${item.title}»`, `Запаса примерно на ${item.stockCoverDays} дней.`, `${item.stock} шт. на складах`)
    if (availability.stocks && item.salesCount === 0 && item.stock > 20) pushRecommendation(3, 'slow', item, `Разобрать неликвид «${item.title}»`, `Нет продаж за 30 дней при остатке ${item.stock} шт.`, item.frozenMoney ? `Заморожено ≈ ${item.frozenMoney} ₽` : '')
    if (item.returnRate >= 20 && item.salesCount >= 3) pushRecommendation(2, 'quality', item, `Проверить качество «${item.title}»`, `Возвраты составляют ${item.returnRate}% от продаж.`, `${item.returnsCount} возвратов`)
    if (item.profit != null && item.profit < 0) pushRecommendation(1, 'price', item, `Исправить экономику «${item.title}»`, `Расчётная прибыль отрицательная: ${item.profit} ₽.`, item.breakevenPrice ? `Цена в 0: ${item.breakevenPrice} ₽` : '')
  }
  recommendations.sort((a, b) => a.priority - b.priority)

  const stockDetailMap = new Map()
  if (availability.stocks) {
    for (const row of stocks) {
      const key = productKey(row) || String(row?.vendorCode || '').trim()
      const product = productMap.get(key)
      const warehouseName = String(row?.warehouseName || row?.warehouse || 'Все склады').trim() || 'Все склады'
      const techSize = String(row?.techSize || row?.size || '—').trim() || '—'
      const barcode = String(row?.barcode || '').trim()
      const detailKey = [key, barcode, techSize, warehouseName].join('|')
      const quantity = Math.max(0, firstNumber(row, ['quantity','quantityFull','stock','stockCount','totalQuantity','availableQuantity'], 0))
      const current = stockDetailMap.get(detailKey) || {
        key:detailKey, nmID:row?.nmId ?? row?.nmID ?? product?.nmID ?? null,
        vendorCode:row?.vendorCode || product?.vendorCode || '', title:product?.title || row?.subjectName || 'Товар',
        brand:product?.brand || row?.brand || '', barcode, techSize, warehouseName, quantity:0,
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
    current.stock += item.stock
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
      zeroStock: availability.stocks ? products.filter(item => item.stock <= 0).length : null,
      lowStock: availability.stocks ? products.filter(item => item.stockStatus === 'Заканчивается').length : null,
      slowStock: availability.stocks ? products.filter(item => ['Избыток', 'Без движения'].includes(item.stockStatus)).length : null,
      stockCoverDays: stockCoverDays == null ? null : Math.round(stockCoverDays),
      cogs: costConfigured ? Math.round(totals.cogs) : null,
      commission: Math.round(totals.commission),
      logistics: Math.round(totals.logistics),
      advertising: Math.round(advertisingExpense),
      advertisingSource: availability.advertising ? 'wb_api' : 'manual',
      storage: Math.round(settings.storageMonthly),
      fixed: Math.round(settings.fixedMonthly),
      tax: Math.round(tax),
      operatingProfit: operatingProfit == null ? null : Math.round(operatingProfit),
      margin: margin == null ? null : Math.round(margin * 10) / 10,
    },
    settings,
    availability,
    stageStatus,
    advertising: {
      campaigns: Array.isArray(advertisingData.campaigns) ? advertisingData.campaigns : [],
      totals: advertisingData.totals || {},
      period: advertisingData.period || null,
      truncated: Boolean(advertisingData.truncated),
      source: availability.advertising ? 'wb_api' : 'manual',
    },
    products,
    dailyTrend: [...dailyMap.values()].map(row => ({ ...row, revenue: Math.round(row.revenue) })),
    warehouses: [...warehouses.entries()].map(([name, quantity]) => ({ name, quantity: Math.round(quantity) })).sort((a, b) => b.quantity - a.quantity),
    stockDetails: [...stockDetailMap.values()].map(item => ({ ...item, quantity:Math.round(item.quantity) })).sort((a,b) => b.quantity - a.quantity),
    categories: [...categoryMap.values()].sort((a, b) => b.revenue - a.revenue),
    recommendations: recommendations.slice(0, 30),
    syncWarnings: Array.isArray(data.syncWarnings) ? data.syncWarnings : [],
  }
}

async function loadProducts(token, { limit = 100, maxPages = 300, deadlineAt = 0 } = {}) {
  const endpoint = 'https://content-api.wildberries.ru/content/v2/get/cards/list'
  const products = []
  let cursor = { limit }

  for (let page = 0; page < maxPages; page += 1) {
    const result = await wbFetch(endpoint, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { cursor, filter: { withPhoto: -1 } } }),
      label: 'Товары WB',
      timeoutMs: 45000,
      maxAttempts: 2,
      maxRetryDelayMs: 10000,
      deadlineAt,
    })
    const cards = Array.isArray(result?.cards) ? result.cards : []
    products.push(...cards.map(card => ({
      nmID: card.nmID,
      vendorCode: card.vendorCode,
      title: card.title || card.subjectName || 'Товар',
      brand: card.brand || '',
      photo: card.photos?.[0]?.big || card.photos?.[0]?.square || '',
    })))

    const next = result?.cursor || {}
    if (cards.length < limit || !next.updatedAt || !next.nmID) break
    cursor = { limit, updatedAt: next.updatedAt, nmID: next.nmID }
    await sleep(700)
  }
  return products
}

function normalizeWarehouseRemains(report) {
  const rows = []
  for (const item of Array.isArray(report) ? report : []) {
    const warehouses = Array.isArray(item?.warehouses) ? item.warehouses : []
    const physical = warehouses.filter(row => {
      const name = String(row?.warehouseName || '').trim().toLowerCase()
      return name && name !== 'всего находится на складах' && !name.includes('в пути')
    })
    const source = physical.length
      ? physical
      : warehouses.filter(row => String(row?.warehouseName || '').trim().toLowerCase() === 'всего находится на складах')
    if (!source.length) {
      rows.push({
        nmId:item?.nmId ?? item?.nmID, vendorCode:item?.vendorCode || '', barcode:item?.barcode || '',
        techSize:item?.techSize || '', warehouseName:'Все склады', quantity:0,
      })
      continue
    }
    for (const warehouse of source) {
      const quantity = Number(warehouse?.quantity || 0)
      rows.push({
        nmId:item?.nmId ?? item?.nmID,
        vendorCode:item?.vendorCode || '',
        barcode:item?.barcode || '',
        techSize:item?.techSize || '',
        brand:item?.brand || '',
        subjectName:item?.subjectName || '',
        warehouseName:String(warehouse?.warehouseName || 'Все склады').trim() || 'Все склады',
        quantity:Number.isFinite(quantity) ? Math.max(0, quantity) : 0,
      })
    }
  }
  return rows
}

function stageDataKey(stage) {
  return stage === 'advertising' ? 'advertising' : stage
}

function previousStageValue(data, stage) {
  const value = data?.[stageDataKey(stage)]
  if (stage === 'advertising') return value && typeof value === 'object' ? value : { campaigns: [], totals: {}, period: null }
  return Array.isArray(value) ? value : []
}

function stageCount(stage, value) {
  if (stage === 'advertising') return Array.isArray(value?.campaigns) ? value.campaigns.length : 0
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
  const endpoint = kind === 'orders' ? 'orders' : 'sales'
  const label = kind === 'orders' ? 'Заказы WB' : 'Продажи WB'
  const dateFrom = incrementalDateFrom(previousRows)
  const payload = await wbFetch(
    `https://statistics-api.wildberries.ru/api/v1/supplier/${endpoint}?dateFrom=${encodeURIComponent(dateFrom)}&flag=0`,
    token,
    { label, timeoutMs: 45000, maxAttempts: 1, maxRetryDelayMs: 0, deadlineAt },
  )
  return mergeStatisticsRows(kind, previousRows, Array.isArray(payload) ? payload : [])
}

function normalizeCampaignList(payload) {
  const result = []
  const seen = new Set()
  const push = (row, inherited = {}) => {
    const advertId = Number(row?.advertId ?? row?.advert_id ?? row?.id)
    if (!Number.isFinite(advertId) || seen.has(advertId)) return
    seen.add(advertId)
    result.push({
      advertId,
      name: row?.name || row?.advertName || row?.campaignName || `Кампания ${advertId}`,
      status: Number(row?.status ?? inherited.status ?? 0),
      type: Number(row?.type ?? inherited.type ?? 0),
      paymentType: row?.payment_type || row?.paymentType || inherited.paymentType || '',
      changeTime: row?.changeTime || row?.change_time || null,
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

const AD_METRIC_KEYS = ['views','clicks','sum','atbs','orders','shks','sum_price','orders_price']
function numericMetric(row, key) {
  const value = Number(row?.[key])
  return Number.isFinite(value) ? value : 0
}

function collectNmAdStats(node, output = []) {
  if (!node) return output
  if (Array.isArray(node)) { node.forEach(item => collectNmAdStats(item, output)); return output }
  if (typeof node !== 'object') return output
  if (node.nmId != null || node.nmID != null || node.nm_id != null) output.push(node)
  for (const value of Object.values(node)) if (value && typeof value === 'object') collectNmAdStats(value, output)
  return output
}

function normalizeAdvertisingStats(payload, campaigns) {
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.adverts) ? payload.adverts : Array.isArray(payload?.data) ? payload.data : []
  const statsById = new Map()
  for (const row of rows) {
    const advertId = Number(row?.advertId ?? row?.advert_id ?? row?.id)
    if (!Number.isFinite(advertId)) continue
    const productRows = collectNmAdStats(row, [])
    const directHasMetrics = AD_METRIC_KEYS.some(key => Number.isFinite(Number(row?.[key])))
    const source = productRows.length ? productRows : directHasMetrics ? [row] : []
    const metrics = source.reduce((acc, item) => {
      for (const key of AD_METRIC_KEYS) acc[key] += numericMetric(item, key)
      return acc
    }, Object.fromEntries(AD_METRIC_KEYS.map(key => [key, 0])))
    const nmStats = productRows.map(item => ({
      nmId: Number(item.nmId ?? item.nmID ?? item.nm_id) || null,
      name: item.name || item.title || '',
      views: numericMetric(item, 'views'), clicks: numericMetric(item, 'clicks'), spend: numericMetric(item, 'sum'),
      orders: numericMetric(item, 'orders'), revenue: numericMetric(item, 'orders_price') || numericMetric(item, 'sum_price'),
    }))
    statsById.set(advertId, { ...metrics, nmStats })
  }

  const normalized = campaigns.map(campaign => {
    const stats = statsById.get(campaign.advertId) || Object.fromEntries(AD_METRIC_KEYS.map(key => [key, 0]))
    const spend = Number(stats.sum || 0)
    const views = Number(stats.views || 0)
    const clicks = Number(stats.clicks || 0)
    const orders = Number(stats.orders || 0)
    const revenue = Number(stats.orders_price || stats.sum_price || 0)
    return {
      ...campaign,
      views, clicks, spend, orders, revenue,
      ctr: views > 0 ? clicks / views * 100 : 0,
      cpc: clicks > 0 ? spend / clicks : 0,
      crr: revenue > 0 ? spend / revenue * 100 : null,
      nmStats: stats.nmStats || [],
    }
  })
  const totals = normalized.reduce((acc, item) => {
    acc.views += item.views; acc.clicks += item.clicks; acc.spend += item.spend; acc.orders += item.orders; acc.revenue += item.revenue
    return acc
  }, { views: 0, clicks: 0, spend: 0, orders: 0, revenue: 0 })
  totals.ctr = totals.views > 0 ? totals.clicks / totals.views * 100 : 0
  totals.cpc = totals.clicks > 0 ? totals.spend / totals.clicks : 0
  totals.crr = totals.revenue > 0 ? totals.spend / totals.revenue * 100 : null
  return { campaigns: normalized, totals }
}

async function loadAdvertising(token, { deadlineAt = 0 } = {}) {
  const campaignPayload = await wbFetch('https://advert-api.wildberries.ru/api/advert/v2/adverts?statuses=4,7,8,9,11', token, {
    label: 'Кампании WB', timeoutMs: 45000, maxAttempts: 1, maxRetryDelayMs: 0, deadlineAt,
  })
  const allCampaigns = normalizeCampaignList(campaignPayload)
  const campaigns = allCampaigns.slice(0, 50)
  if (!campaigns.length) return { campaigns: [], totals: { views:0, clicks:0, spend:0, orders:0, revenue:0, ctr:0, cpc:0, crr:null }, period: { days:30 }, truncated:false }
  const endDate = new Date().toISOString().slice(0, 10)
  const beginDate = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10)
  const ids = campaigns.map(item => item.advertId).join(',')
  const statsPayload = await wbFetch(`https://advert-api.wildberries.ru/adv/v3/fullstats?ids=${encodeURIComponent(ids)}&beginDate=${beginDate}&endDate=${endDate}`, token, {
    label: 'Статистика рекламы WB', timeoutMs: 60000, maxAttempts: 1, maxRetryDelayMs: 0, deadlineAt,
  })
  const normalized = normalizeAdvertisingStats(statsPayload, campaigns)
  return { ...normalized, period: { beginDate, endDate, days:30 }, truncated: allCampaigns.length > campaigns.length, totalCampaigns: allCampaigns.length }
}

async function advanceWarehouseRemainsTask(token, state, { deadlineAt = 0 } = {}) {
  const base = 'https://seller-analytics-api.wildberries.ru/api/v1/warehouse_remains'
  if (!state?.task_id) {
    const created = await wbFetch(`${base}?locale=ru`, token, {
      label: 'Создание отчёта остатков WB', timeoutMs: 30000, maxAttempts: 1, maxRetryDelayMs: 0, deadlineAt,
    })
    const taskId = created?.data?.taskId
    if (!taskId) throw Object.assign(new Error('Отчёт остатков WB: не получен taskId'), { status: 502 })
    return { pending: true, taskId, taskStatus: 'new', nextAllowedAt: new Date(Date.now() + 30000).toISOString() }
  }

  const taskId = state.task_id
  const statusPayload = await wbFetch(`${base}/tasks/${encodeURIComponent(taskId)}/status`, token, {
    label: 'Проверка отчёта остатков WB', timeoutMs: 25000, maxAttempts: 1, maxRetryDelayMs: 0, deadlineAt,
  })
  const taskStatus = String(statusPayload?.data?.status || '').toLowerCase()
  if (taskStatus === 'done') {
    const report = await wbFetch(`${base}/tasks/${encodeURIComponent(taskId)}/download`, token, {
      label: 'Загрузка отчёта остатков WB', timeoutMs: 60000, maxAttempts: 1, maxRetryDelayMs: 0, deadlineAt,
    })
    return { pending: false, rows: normalizeWarehouseRemains(report), taskId: null, taskStatus: 'done' }
  }
  if (taskStatus === 'canceled' || taskStatus === 'purged') {
    throw Object.assign(new Error(`Отчёт остатков WB завершён со статусом ${taskStatus}. Будет создан новый отчёт.`), { status: 502, resetTask: true })
  }
  return { pending: true, taskId, taskStatus: taskStatus || 'processing', nextAllowedAt: new Date(Date.now() + 30000).toISOString() }
}

async function runSyncStage({ connection, tokens, data, stage, deadlineAt }) {
  const definition = WB_SYNC_STAGES[stage]
  const fallback = previousStageValue(data, stage)
  let state = (await pool.query('SELECT * FROM wb_sync_states WHERE connection_id=$1 AND stage=$2', [connection.id, stage])).rows[0] || null
  const now = Date.now()
  if (state?.next_allowed_at && new Date(state.next_allowed_at).getTime() > now) {
    return { stage, status: state.status || 'cooldown', value: fallback, warning: `${definition.label}: следующий запрос разрешён ${new Date(state.next_allowed_at).toLocaleString('ru-RU')}.`, state }
  }
  const selected = chooseToken(tokens, definition.scope)
  if (!selected) {
    state = await updateSyncState(connection.id, stage, { status:'missing_token', lastAttemptAt:new Date().toISOString(), lastError:`Нужен токен с категорией «${WB_SCOPE_BITS[definition.scope].label}»`, nextAllowedAt:null })
    return { stage, status:'missing_token', value:fallback, warning:`${definition.label}: добавьте токен с категорией «${WB_SCOPE_BITS[definition.scope].label}».`, state }
  }

  state = await updateSyncState(connection.id, stage, { status:'running', lastAttemptAt:new Date().toISOString(), lastError:null, nextAllowedAt:null })
  try {
    let value
    if (stage === 'products') value = await loadProducts(selected.token, { deadlineAt })
    else if (stage === 'orders' || stage === 'sales') value = await loadStatisticsRows(stage, selected.token, { deadlineAt, previousRows:fallback })
    else if (stage === 'advertising') value = await loadAdvertising(selected.token, { deadlineAt })
    else if (stage === 'stocks') {
      const result = await advanceWarehouseRemainsTask(selected.token, state, { deadlineAt })
      if (result.pending) {
        state = await updateSyncState(connection.id, stage, {
          status:'pending', lastAttemptAt:new Date().toISOString(), nextAllowedAt:result.nextAllowedAt,
          lastError:null, taskId:result.taskId, metadata:{ taskStatus:result.taskStatus, tokenId:selected.row.id, tokenLabel:selected.row.label, primary:Boolean(selected.row.is_primary) },
        })
        return { stage, status:'pending', value:fallback, warning:'Остатки: отчёт WB формируется в фоне. ELISEI проверит его автоматически.', state }
      }
      value = result.rows
    }
    const count = stageCount(stage, value)
    state = await updateSyncState(connection.id, stage, {
      status:'success', lastAttemptAt:new Date().toISOString(), lastSuccessAt:new Date().toISOString(), nextAllowedAt:null,
      lastError:null, lastCount:count, taskId:null, metadata:{ tokenId:selected.row.id, tokenLabel:selected.row.label, primary:Boolean(selected.row.is_primary) },
    })
    return { stage, status:'success', value, state }
  } catch (error) {
    const nextAllowedAt = error?.nextAllowedAt || (error?.retryAfterSeconds ? new Date(Date.now() + Number(error.retryAfterSeconds) * 1000).toISOString() : null)
    const status = Number(error?.status) === 429 ? 'rate_limited' : Number(error?.status) === 403 ? 'forbidden' : 'error'
    state = await updateSyncState(connection.id, stage, {
      status, lastAttemptAt:new Date().toISOString(), nextAllowedAt, lastError:error.message,
      taskId:error?.resetTask ? null : state?.task_id, metadata:{ ...(state?.metadata || {}), requestId:error?.requestId || null },
    })
    return { stage, status, value:fallback, warning:`${definition.label}: ${error.message}${stageCount(stage, fallback) ? ' Сохранены предыдущие данные.' : ''}`, state }
  }
}

function wbNmKey(row) {
  return String(row?.nmId ?? row?.nmID ?? row?.nm_id ?? '').trim()
}

function enrichProducts(products, stats) {
  const stockByNm = new Map()
  const revenueByNm = new Map()

  for (const row of stats.stocks || []) {
    const key = wbNmKey(row)
    if (!key) continue
    const quantity = Number(row.quantity ?? row.quantityFull ?? row.stock ?? row.stockCount ?? row.totalQuantity ?? row.availableQuantity ?? 0)
    stockByNm.set(key, (stockByNm.get(key) || 0) + (Number.isFinite(quantity) ? quantity : 0))
  }

  for (const row of stats.sales || []) {
    const key = wbNmKey(row)
    if (!key) continue
    const revenue = Number(row.forPay ?? row.finishedPrice ?? row.priceWithDisc ?? 0)
    revenueByNm.set(key, (revenueByNm.get(key) || 0) + (Number.isFinite(revenue) ? revenue : 0))
  }

  return products.map(product => {
    const key = wbNmKey(product)
    const stock = stockByNm.get(key) || 0
    return {
      ...product,
      stock,
      revenue: Math.round(revenueByNm.get(key) || 0),
      status: stock === 0 ? 'Нет остатка' : stock < 10 ? 'Риск' : 'В норме',
    }
  })
}

function withSyncLog(history, entry) { return [{ id: crypto.randomUUID(), at: new Date().toISOString(), ...entry }, ...(history || [])].slice(0, 20) }
function buildDashboard(data, settings = DEFAULT_BUSINESS_SETTINGS) { const summary = buildCoreAnalytics(data, settings).summary; return { revenue: summary.revenue, orders: summary.orders, sales: summary.sales, returns: summary.returns, stockUnits: summary.stockUnits, profit: summary.operatingProfit, margin: summary.margin, periodDays: 30 } }

app.get('/health', async (_req, res) => {
  let database = 'not-configured'
  if (pool) { try { await pool.query('SELECT 1'); database = 'ok' } catch { database = 'error' } }
  res.json({ ok: true, service: 'elisei-api', version: '2.7.1', database })
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
  const connection = await getConnection(req.auth.sub)
  if (!connection) return res.json(publicConnection(null))
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
  const connection = await getConnection(req.auth.sub, req.params.id)
  if (!connection) return res.status(404).json({ error: 'Подключение не найдено' })
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
    const data = { ...(connection.data || {}) }
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
          status:'queued', available:stageCount(stage, previousStageValue(data, stage)) > 0,
          count:stageCount(stage, previousStageValue(data, stage)), lastSuccessAt:queuedState.last_success_at || null,
          nextAllowedAt:queuedState.next_allowed_at || null, error:queuedState.last_error || null,
        }
        warnings.push(`${WB_SYNC_STAGES[stage].label}: этап поставлен в фоновую очередь из-за общего лимита времени.`)
        continue
      }
      const result = await runSyncStage({ connection, tokens, data, stage, deadlineAt })
      results.push(result)
      if (result.warning) warnings.push(result.warning)
      if (result.status === 'success') data[stageDataKey(stage)] = result.value
      stageStatus[stage] = {
        status: result.status,
        available: result.status === 'success' || stageCount(stage, result.value) > 0,
        count: stageCount(stage, result.value),
        lastSuccessAt: result.state?.last_success_at || null,
        nextAllowedAt: result.state?.next_allowed_at || null,
        error: result.state?.last_error || null,
      }
    }

    data.stageStatus = stageStatus
    data.syncWarnings = warnings
    const stats = { orders: Array.isArray(data.orders) ? data.orders : [], sales: Array.isArray(data.sales) ? data.sales : [], stocks: Array.isArray(data.stocks) ? data.stocks : [] }
    data.products = enrichProducts(Array.isArray(data.products) ? data.products : [], stats)
    const counts = {
      products: data.products.length,
      orders: Array.isArray(data.orders) ? data.orders.length : 0,
      sales: Array.isArray(data.sales) ? data.sales.length : 0,
      stocks: Array.isArray(data.stocks) ? data.stocks.length : 0,
      advertising: Array.isArray(data.advertising?.campaigns) ? data.advertising.campaigns.length : 0,
    }
    const hasSuccess = results.some(result => result.status === 'success')
    const history = withSyncLog(connection.sync_history, {
      status: hasSuccess ? 'success' : 'partial', durationMs: Date.now() - startedAt, counts, warnings,
      stages: Object.fromEntries(results.map(result => [result.stage, result.status])),
    })
    const updated = await pool.query(`UPDATE marketplace_connections SET data=$1::jsonb,sync_history=$2::jsonb,last_sync_at=CASE WHEN $3 THEN NOW() ELSE last_sync_at END,updated_at=NOW(),status='connected' WHERE id=$4 AND user_id=$5 RETURNING *`, [JSON.stringify(data), JSON.stringify(history), hasSuccess, connection.id, req.auth.sub])
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
  const settings = await getBusinessSettings(req.auth.sub)
  res.json({ dashboard: buildDashboard(connection.data || {}, settings), lastSync: connection.last_sync_at || null })
})

app.get('/api/wb/core/:id', authRequired, async (req, res) => {
  const connection = await getConnection(req.auth.sub, req.params.id)
  if (!connection) return res.status(404).json({ error: 'Подключение не найдено' })
  const settings = await getBusinessSettings(req.auth.sub)
  res.json({ core: buildCoreAnalytics(connection.data || {}, settings), lastSync: connection.last_sync_at || null })
})

app.get('/api/business/settings', authRequired, async (req, res) => {
  res.json({ settings: await getBusinessSettings(req.auth.sub) })
})

app.put('/api/business/settings', authRequired, async (req, res) => {
  const settings = await saveBusinessSettings(req.auth.sub, req.body || {})
  const connection = await getConnection(req.auth.sub)
  res.json({ settings, core: connection ? buildCoreAnalytics(connection.data || {}, settings) : null })
})

app.get('/api/wb/sync-history/:id', authRequired, async (req, res) => {
  const connection = await getConnection(req.auth.sub, req.params.id)
  if (!connection) return res.status(404).json({ error: 'Подключение не найдено' })
  res.json({ history: connection.sync_history || [] })
})

app.get('/api/wb/products/:id', authRequired, async (req, res) => {
  const connection = await getConnection(req.auth.sub, req.params.id)
  if (!connection) return res.status(404).json({ error: 'Подключение не найдено' })
  res.json({ products: connection.data?.products || [], lastSync: connection.last_sync_at || null })
})

app.post('/api/wb/disconnect', authRequired, async (req, res) => {
  const id = String(req.body?.connectionId || '').trim()
  if (id) await pool.query(`DELETE FROM marketplace_connections WHERE user_id=$1 AND marketplace='wildberries' AND id=$2::uuid`, [req.auth.sub, id])
  else await pool.query(`DELETE FROM marketplace_connections WHERE user_id=$1 AND marketplace='wildberries'`, [req.auth.sub])
  res.json({ ok: true })
})

app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message || 'Внутренняя ошибка' }))

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
      const data = { ...(row.data || {}), stocks:result.rows }
      data.stageStatus = { ...(data.stageStatus || {}), stocks:{ status:'success', available:true, count:result.rows.length, lastSuccessAt:new Date().toISOString(), nextAllowedAt:null, error:null } }
      data.syncWarnings = (Array.isArray(data.syncWarnings) ? data.syncWarnings : []).filter(text => !String(text).startsWith('Остатки:'))
      const stats = { orders:Array.isArray(data.orders)?data.orders:[], sales:Array.isArray(data.sales)?data.sales:[], stocks:result.rows }
      data.products = enrichProducts(Array.isArray(data.products)?data.products:[], stats)
      await pool.query(`UPDATE marketplace_connections SET data=$1::jsonb,last_sync_at=NOW(),updated_at=NOW(),status='connected' WHERE id=$2`, [JSON.stringify(data), row.connection_id])
      await updateSyncState(row.connection_id, 'stocks', { status:'success', lastSuccessAt:new Date().toISOString(), nextAllowedAt:null, lastError:null, lastCount:result.rows.length, taskId:null, metadata:{ taskStatus:'done' } })
    } catch (error) {
      const nextAllowedAt = error?.nextAllowedAt || new Date(Date.now() + 60000).toISOString()
      await updateSyncState(row.connection_id, 'stocks', { status:Number(error?.status)===429?'rate_limited':'pending', nextAllowedAt, lastError:error.message, taskId:error?.resetTask?null:row.task_id })
    } finally {
      backgroundStockLocks.delete(row.connection_id)
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
      WHERE s.stage <> 'stocks' AND s.status IN ('rate_limited','queued')
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
      const data = { ...(connection.data || {}) }
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
      const stats = {
        orders:Array.isArray(data.orders) ? data.orders : [],
        sales:Array.isArray(data.sales) ? data.sales : [],
        stocks:Array.isArray(data.stocks) ? data.stocks : [],
      }
      data.products = enrichProducts(Array.isArray(data.products) ? data.products : [], stats)
      const history = withSyncLog(connection.sync_history, {
        status:result.status === 'success' ? 'success' : 'partial',
        durationMs:0,
        automatic:true,
        counts:{ [row.stage]:stageCount(row.stage, result.value) },
        warnings:result.warning ? [result.warning] : [],
        stages:{ [row.stage]:result.status },
      })
      await pool.query(`
        UPDATE marketplace_connections
        SET data=$1::jsonb,sync_history=$2::jsonb,last_sync_at=CASE WHEN $3 THEN NOW() ELSE last_sync_at END,
            updated_at=NOW(),status='connected'
        WHERE id=$4 AND user_id=$5
      `, [JSON.stringify(data), JSON.stringify(history), result.status === 'success', row.connection_id, row.user_id])
    } catch (error) {
      console.warn(`Deferred WB stage ${row.stage} failed:`, error.message)
    } finally {
      deferredStageLocks.delete(row.connection_id)
    }
  }
}

initDatabase().then(() => {
  app.listen(port, () => console.log(`ELISEI API listening on ${port}`))
  const stockTimer = setInterval(() => processPendingStockReports().catch(error => console.warn('Stock worker failed:', error.message)), 30000)
  stockTimer.unref?.()
  const deferredTimer = setInterval(() => processDueDeferredStages().catch(error => console.warn('Deferred WB worker failed:', error.message)), 60000)
  deferredTimer.unref?.()
  setTimeout(() => processPendingStockReports().catch(error => console.warn('Initial stock worker failed:', error.message)), 5000)
  setTimeout(() => processDueDeferredStages().catch(error => console.warn('Initial deferred WB worker failed:', error.message)), 10000)
}).catch(error => { console.error('Database initialization failed:', error); process.exit(1) })
