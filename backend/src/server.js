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
const authHeaders = token => ({ Authorization: token, Accept: 'application/json' })

async function wbFetch(url, token, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...authHeaders(token), ...(options.headers || {}) }, signal: AbortSignal.timeout(18000) })
  const text = await response.text()
  let payload = null
  try { payload = text ? JSON.parse(text) : null } catch { payload = text }
  if (!response.ok) {
    const error = new Error(payload?.detail || payload?.message || `Wildberries API: ${response.status}`)
    error.status = response.status
    error.payload = payload
    throw error
  }
  return payload
}

async function probeToken(token) {
  const probes = [
    { scope: 'analytics', run: () => loadWbWarehouseStocks(token, { limit: 1, maxPages: 1 }) },
    { scope: 'content', run: () => wbFetch('https://content-api.wildberries.ru/content/v2/get/cards/list', token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { cursor: { limit: 1 }, filter: { withPhoto: -1 } } }) }) },
  ]
  const scopes = []
  for (const probe of probes) {
    try { await probe.run(); scopes.push(probe.scope) } catch (error) { if (error.status === 401) throw new Error('Wildberries отклонил API-ключ'); if (![403, 404].includes(error.status)) continue }
  }
  if (!scopes.length) throw new Error('Ключ принят, но не найдены права Content или Statistics')
  return scopes
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

async function loadProducts(token) {
  try {
    const result = await wbFetch('https://content-api.wildberries.ru/content/v2/get/cards/list', token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { cursor: { limit: 100 }, filter: { withPhoto: -1 } } }) })
    return (result?.cards || []).map(card => ({ nmID: card.nmID, vendorCode: card.vendorCode, title: card.title || card.subjectName || 'Товар', brand: card.brand || '', photo: card.photos?.[0]?.big || card.photos?.[0]?.square || '' }))
  } catch { return [] }
}

function extractStockRows(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.data)) return payload.data
  if (Array.isArray(payload?.stocks)) return payload.stocks
  if (Array.isArray(payload?.items)) return payload.items
  if (Array.isArray(payload?.result?.data)) return payload.result.data
  return []
}

async function loadWbWarehouseStocks(token, { limit = 250000, maxPages = 20 } = {}) {
  const endpoint = 'https://seller-analytics-api.wildberries.ru/api/analytics/v1/stocks-report/wb-warehouses'
  const rows = []
  let offset = 0

  for (let page = 0; page < maxPages; page += 1) {
    const payload = await wbFetch(endpoint, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit, offset }),
    })
    const batch = extractStockRows(payload)
    rows.push(...batch)

    if (batch.length < limit) break
    offset += batch.length
  }

  return rows
}

async function loadStatistics(token) {
  const [orders, sales, stocks] = await Promise.all([
    wbFetch(`https://statistics-api.wildberries.ru/api/v1/supplier/orders?dateFrom=${encodeURIComponent(isoDaysAgo(30))}&flag=0`, token).catch(() => []),
    wbFetch(`https://statistics-api.wildberries.ru/api/v1/supplier/sales?dateFrom=${encodeURIComponent(isoDaysAgo(30))}&flag=0`, token).catch(() => []),
    loadWbWarehouseStocks(token),
  ])
  return { orders: Array.isArray(orders) ? orders : [], sales: Array.isArray(sales) ? sales : [], stocks }
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
  res.json({ ok: true, service: 'elisei-api', version: '2.5.2', database })
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
    res.status(error.status === 429 ? 429 : 400).json({ error: error.message })
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
  const startedAt = Date.now()
  try {
    const token = decryptToken(connection.token_encrypted)
    const [products, stats] = await Promise.all([loadProducts(token), loadStatistics(token)])
    const enrichedProducts = enrichProducts(products, stats)
    const data = { products: enrichedProducts, ...stats }
    const counts = { products: enrichedProducts.length, orders: stats.orders.length, sales: stats.sales.length, stocks: stats.stocks.length }
    const history = withSyncLog(connection.sync_history, { status: 'success', durationMs: Date.now() - startedAt, counts })
    const updated = await pool.query(`UPDATE marketplace_connections SET data=$1::jsonb, sync_history=$2::jsonb, last_sync_at=NOW(), updated_at=NOW(), status='connected' WHERE id=$3 AND user_id=$4 RETURNING *`, [JSON.stringify(data), JSON.stringify(history), connection.id, req.auth.sub])
    const row = updated.rows[0]
    res.json({ ok: true, lastSync: row.last_sync_at, counts, dashboard: buildDashboard(data), syncHistory: history })
  } catch (error) {
    const history = withSyncLog(connection.sync_history, { status: 'error', message: error.message, durationMs: Date.now() - startedAt })
    await pool.query(`UPDATE marketplace_connections SET sync_history=$1::jsonb, updated_at=NOW(), status='error' WHERE id=$2 AND user_id=$3`, [JSON.stringify(history), connection.id, req.auth.sub])
    res.status(error.status || 502).json({ error: error.message })
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
