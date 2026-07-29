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
app.use(express.json({ limit: '64kb' }))

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
  `)
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
  statistics: { bit: 5, label: 'Статистика' },
}
const WB_TOKEN_TYPES = { 1: 'Базовый', 2: 'Тестовый', 3: 'Персональный', 4: 'Сервисный' }

function decodeWbToken(token) {
  try {
    const parts = String(token || '').split('.')
    if (parts.length < 2) throw new Error('not jwt')
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    throw Object.assign(new Error('API-ключ Wildberries имеет неверный формат'), { status: 401 })
  }
}

function inspectWbToken(token) {
  const payload = decodeWbToken(token)
  const scopeMask = Number(payload.s || 0)
  const typeId = Number(payload.acc || 0)
  const scopes = Object.entries(WB_SCOPE_BITS)
    .filter(([, item]) => (scopeMask & (1 << item.bit)) !== 0)
    .map(([key]) => key)
  const missing = Object.entries(WB_SCOPE_BITS)
    .filter(([, item]) => (scopeMask & (1 << item.bit)) === 0)
    .map(([, item]) => item.label)

  if (Number(payload.exp || 0) > 0 && Number(payload.exp) * 1000 <= Date.now()) {
    throw Object.assign(new Error('API-ключ Wildberries истёк. Создайте новый ключ.'), { status: 401 })
  }
  if (Boolean(payload.t) || typeId === 2) {
    throw Object.assign(new Error('Тестовый токен не имеет доступа к реальным данным кабинета'), { status: 403 })
  }
  if (missing.length) {
    throw Object.assign(new Error(`В API-ключе не хватает категорий: ${missing.join(', ')}. Нужны Контент, Аналитика и Статистика.`), { status: 403 })
  }
  if (typeId === 4 && !wbClientSecret) {
    throw Object.assign(new Error('Сервисный токен WB требует секрет сервиса. В Render не задан WB_CLIENT_SECRET.'), { status: 403 })
  }

  return {
    scopes,
    typeId,
    tokenType: WB_TOKEN_TYPES[typeId] || 'Неизвестный',
    readOnly: (scopeMask & (1 << 30)) !== 0,
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
  const headers = {
    Authorization: token,
    Accept: 'application/json',
    'User-Agent': 'ELISEI/2.5.5 (marketplace analytics)',
  }
  if (wbClientSecret) headers['X-Client-Secret'] = wbClientSecret
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

    if (response.status === 429 && attempt + 1 < maxAttempts) {
      const retrySeconds = retryAfterSeconds(response, attempt)
      const delayMs = retryDelayMs(response, attempt)
      error.retryAfterSeconds = retrySeconds
      if (delayMs > maxRetryDelayMs) {
        error.message = `${label}: Wildberries установил паузу ${humanWait(retrySeconds)}. Долгое ожидание отменено — повторите синхронизацию позже.`
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
  // Он не расходует лимит тяжёлого отчёта остатков.
  await wbFetch('https://common-api.wildberries.ru/ping', token, {
    label: 'Проверка токена WB',
    timeoutMs: 15000,
    maxAttempts: 2,
  })
  return info.scopes
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

async function getConnection(userId, id = null) {
  const params = [userId]
  let sql = `SELECT * FROM marketplace_connections WHERE user_id = $1 AND marketplace = 'wildberries'`
  if (id) { params.push(id); sql += ' AND id = $2' }
  const result = await pool.query(sql, params)
  return result.rows[0] || null
}

function publicConnection(row) {
  return {
    connected: Boolean(row),
    connectionId: row?.id || null,
    scopes: row?.scopes || [],
    status: row?.status || 'disconnected',
    connectedAt: row?.created_at || null,
    lastSync: row?.last_sync_at || null,
    syncHistory: row?.sync_history || [],
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

function extractStockRows(payload) {
  if (Array.isArray(payload?.data?.items)) return payload.data.items
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload?.stocks)) return payload.stocks
  if (Array.isArray(payload?.items)) return payload.items
  if (Array.isArray(payload?.result?.data)) return payload.result.data
  return []
}

async function loadWbWarehouseStocks(token, { limit = 250000, maxPages = 20, deadlineAt = 0 } = {}) {
  const endpoint = 'https://seller-analytics-api.wildberries.ru/api/analytics/v1/stocks-report/wb-warehouses'
  const rows = []
  let offset = 0

  for (let page = 0; page < maxPages; page += 1) {
    const payload = await wbFetch(endpoint, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit, offset }),
      label: 'Остатки WB',
      timeoutMs: 120000,
      maxAttempts: 2,
      maxRetryDelayMs: 15000,
      deadlineAt,
    })
    const batch = extractStockRows(payload)
    rows.push(...batch)

    if (batch.length < limit) break
    offset += batch.length
    await sleep(21000)
  }
  return rows
}


function normalizeWarehouseRemains(report) {
  const rows = []
  for (const item of Array.isArray(report) ? report : []) {
    const warehouses = Array.isArray(item?.warehouses) ? item.warehouses : []
    const totalRow = warehouses.find(row => String(row?.warehouseName || '').trim().toLowerCase() === 'всего находится на складах')
    const quantity = totalRow
      ? Number(totalRow.quantity || 0)
      : warehouses
          .filter(row => !String(row?.warehouseName || '').toLowerCase().includes('в пути'))
          .reduce((sum, row) => sum + Number(row?.quantity || 0), 0)
    rows.push({
      nmId: item?.nmId ?? item?.nmID,
      vendorCode: item?.vendorCode || '',
      barcode: item?.barcode || '',
      techSize: item?.techSize || '',
      quantity: Number.isFinite(quantity) ? quantity : 0,
    })
  }
  return rows
}

async function loadWarehouseRemainsReport(token, { maxWaitMs = 55000, deadlineAt = 0 } = {}) {
  const base = 'https://seller-analytics-api.wildberries.ru/api/v1/warehouse_remains'
  const created = await wbFetch(`${base}?locale=ru`, token, {
    label: 'Создание отчёта остатков WB',
    timeoutMs: 30000,
    maxAttempts: 2,
    maxRetryDelayMs: 10000,
    deadlineAt,
  })
  const taskId = created?.data?.taskId
  if (!taskId) throw Object.assign(new Error('Отчёт остатков WB: не получен taskId'), { status: 502 })

  const startedAt = Date.now()
  let status = 'new'
  while (Date.now() - startedAt < maxWaitMs && (!deadlineAt || Date.now() + 5200 < deadlineAt)) {
    await sleep(5200)
    const state = await wbFetch(`${base}/tasks/${encodeURIComponent(taskId)}/status`, token, {
      label: 'Проверка отчёта остатков WB',
      timeoutMs: 20000,
      maxAttempts: 2,
      maxRetryDelayMs: 10000,
      deadlineAt,
    })
    status = String(state?.data?.status || '').toLowerCase()
    if (status === 'done') break
    if (status === 'canceled' || status === 'purged') {
      throw Object.assign(new Error(`Отчёт остатков WB завершён со статусом ${status}`), { status: 502 })
    }
  }

  if (status !== 'done') {
    throw Object.assign(new Error('Отчёт остатков WB формируется дольше 55 секунд. Долгое ожидание остановлено; повторите синхронизацию позже.'), { status: 504 })
  }

  const report = await wbFetch(`${base}/tasks/${encodeURIComponent(taskId)}/download`, token, {
    label: 'Загрузка отчёта остатков WB',
    timeoutMs: 60000,
    maxAttempts: 2,
    maxRetryDelayMs: 10000,
    deadlineAt,
  })
  return normalizeWarehouseRemains(report)
}

async function safeSyncStage(label, loader, fallback, warnings) {
  try {
    return await loader()
  } catch (error) {
    if ([402, 403, 429, 504].includes(Number(error?.status))) {
      warnings.push(`${label}: ${error.message}${Array.isArray(fallback) && fallback.length ? ' Сохранены предыдущие данные.' : ''}`)
      return Array.isArray(fallback) ? fallback : []
    }
    throw error
  }
}

async function loadStatistics(token, tokenInfo, previousData = {}, warnings = [], deadlineAt = 0) {
  const orders = await safeSyncStage(
    'Заказы',
    () => wbFetch(
      `https://statistics-api.wildberries.ru/api/v1/supplier/orders?dateFrom=${encodeURIComponent(isoDaysAgo(30))}&flag=0`,
      token,
      { label: 'Заказы WB', timeoutMs: 45000, maxAttempts: 2, maxRetryDelayMs: 10000, deadlineAt },
    ),
    previousData.orders,
    warnings,
  )
  await sleep(1200)

  const sales = await safeSyncStage(
    'Продажи',
    () => wbFetch(
      `https://statistics-api.wildberries.ru/api/v1/supplier/sales?dateFrom=${encodeURIComponent(isoDaysAgo(30))}&flag=0`,
      token,
      { label: 'Продажи WB', timeoutMs: 45000, maxAttempts: 2, maxRetryDelayMs: 10000, deadlineAt },
    ),
    previousData.sales,
    warnings,
  )
  await sleep(1200)

  const useAsyncReport = tokenInfo?.typeId === 1 && !wbClientSecret
  const stocks = await safeSyncStage(
    'Остатки',
    () => useAsyncReport ? loadWarehouseRemainsReport(token, { deadlineAt }) : loadWbWarehouseStocks(token, { deadlineAt }),
    previousData.stocks,
    warnings,
  )

  return {
    orders: Array.isArray(orders) ? orders : [],
    sales: Array.isArray(sales) ? sales : [],
    stocks: Array.isArray(stocks) ? stocks : [],
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
function buildDashboard(data) { const sales = data.sales || []; const orders = data.orders || []; const stocks = data.stocks || []; const revenue = sales.reduce((sum, row) => sum + Number(row.forPay || row.finishedPrice || row.priceWithDisc || 0), 0); const returns = sales.filter(row => String(row.saleID || '').startsWith('R')).length; const stockUnits = stocks.reduce((sum, row) => sum + Number(row.quantity ?? row.quantityFull ?? row.stock ?? row.stockCount ?? row.totalQuantity ?? row.availableQuantity ?? 0), 0); return { revenue: Math.round(revenue), orders: orders.length, sales: sales.length, returns, stockUnits, profit: null, margin: null, periodDays: 30 } }

app.get('/health', async (_req, res) => {
  let database = 'not-configured'
  if (pool) { try { await pool.query('SELECT 1'); database = 'ok' } catch { database = 'error' } }
  res.json({ ok: true, service: 'elisei-api', version: '2.5.5', database })
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
  res.json(publicConnection(connection))
})

app.post('/api/wb/connect', authRequired, async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim()
    if (token.length < 40) return res.status(400).json({ error: 'API-ключ выглядит слишком коротким' })
    const scopes = await probeToken(token)
    const id = crypto.randomUUID()
    const result = await pool.query(`
      INSERT INTO marketplace_connections (id, user_id, marketplace, token_encrypted, scopes, status)
      VALUES ($1,$2,'wildberries',$3,$4::jsonb,'connected')
      ON CONFLICT (user_id, marketplace) DO UPDATE SET
        token_encrypted = EXCLUDED.token_encrypted,
        scopes = EXCLUDED.scopes,
        status = 'connected',
        updated_at = NOW()
      RETURNING *
    `, [id, req.auth.sub, encryptToken(token), JSON.stringify(scopes)])
    res.json(publicConnection(result.rows[0]))
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message })
  }
})

app.get('/api/wb/status/:id', authRequired, async (req, res) => {
  const connection = await getConnection(req.auth.sub, req.params.id)
  if (!connection) return res.status(404).json({ error: 'Подключение не найдено' })
  res.json(publicConnection(connection))
})

app.post('/api/wb/sync', authRequired, async (req, res) => {
  const connection = await getConnection(req.auth.sub, String(req.body?.connectionId || '') || null)
  if (!connection) return res.status(404).json({ error: 'Подключение не найдено. Подключите Wildberries.' })

  const syncKey = `${req.auth.sub}:${connection.id}`
  if (activeSyncs.has(syncKey)) return res.status(409).json({ error: 'Синхронизация уже выполняется. Дождитесь её завершения.' })

  activeSyncs.add(syncKey)
  const startedAt = Date.now()
  const deadlineAt = startedAt + 95000
  try {
    const token = decryptToken(connection.token_encrypted)
    const tokenInfo = inspectWbToken(token)
    const previousData = connection.data || {}
    const warnings = []

    // Запросы идут последовательно. Долгие лимиты WB не удерживают HTTP-запрос часами:
    // этап сохраняет предыдущие данные и возвращает понятное предупреждение.
    const products = await safeSyncStage('Товары', () => loadProducts(token, { deadlineAt }), previousData.products, warnings)
    await sleep(1200)
    const stats = await loadStatistics(token, tokenInfo, previousData, warnings, deadlineAt)

    const enrichedProducts = enrichProducts(products, stats)
    const data = { products: enrichedProducts, ...stats, syncWarnings: warnings }
    const counts = { products: enrichedProducts.length, orders: stats.orders.length, sales: stats.sales.length, stocks: stats.stocks.length }
    const history = withSyncLog(connection.sync_history, { status: 'success', durationMs: Date.now() - startedAt, counts, warnings })
    const updated = await pool.query(`UPDATE marketplace_connections SET data=$1::jsonb, sync_history=$2::jsonb, last_sync_at=NOW(), updated_at=NOW(), status='connected' WHERE id=$3 AND user_id=$4 RETURNING *`, [JSON.stringify(data), JSON.stringify(history), connection.id, req.auth.sub])
    const row = updated.rows[0]
    res.json({ ok: true, partial: warnings.length > 0, warnings, lastSync: row.last_sync_at, counts, dashboard: buildDashboard(data), syncHistory: history })
  } catch (error) {
    const history = withSyncLog(connection.sync_history, { status: 'error', message: error.message, durationMs: Date.now() - startedAt })
    await pool.query(`UPDATE marketplace_connections SET sync_history=$1::jsonb, updated_at=NOW(), status='error' WHERE id=$2 AND user_id=$3`, [JSON.stringify(history), connection.id, req.auth.sub])
    res.status(error.status || 502).json({ error: error.message })
  } finally {
    activeSyncs.delete(syncKey)
  }
})

app.get('/api/wb/dashboard/:id', authRequired, async (req, res) => {
  const connection = await getConnection(req.auth.sub, req.params.id)
  if (!connection) return res.status(404).json({ error: 'Подключение не найдено' })
  res.json({ dashboard: buildDashboard(connection.data || {}), lastSync: connection.last_sync_at || null })
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
  const id = String(req.body?.connectionId || '')
  await pool.query(`DELETE FROM marketplace_connections WHERE user_id=$1 AND marketplace='wildberries' AND ($2='' OR id=$2::uuid)`, [req.auth.sub, id])
  res.json({ ok: true })
})

app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message || 'Внутренняя ошибка' }))

initDatabase().then(() => app.listen(port, () => console.log(`ELISEI API listening on ${port}`))).catch(error => { console.error('Database initialization failed:', error); process.exit(1) })
