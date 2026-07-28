import 'dotenv/config'
import crypto from 'node:crypto'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'

const app = express()
const port = Number(process.env.PORT || 10000)
const allowedOrigins = (process.env.FRONTEND_ORIGIN || '').split(',').map(v => v.trim()).filter(Boolean)
const ttlMs = Number(process.env.CONNECTION_TTL_HOURS || 12) * 60 * 60 * 1000
const sessions = new Map()

app.use(helmet())
app.use(cors({ origin(origin, cb) { if (!origin || !allowedOrigins.length || allowedOrigins.includes(origin)) return cb(null, true); cb(new Error('Origin is not allowed')) } }))
app.use(express.json({ limit: '64kb' }))

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
    { scope: 'statistics', run: () => wbFetch(`https://statistics-api.wildberries.ru/api/v1/supplier/stocks?dateFrom=${encodeURIComponent(isoDaysAgo(1))}`, token) },
    { scope: 'content', run: () => wbFetch('https://content-api.wildberries.ru/content/v2/get/cards/list', token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { cursor: { limit: 1 }, filter: { withPhoto: -1 } } }) }) },
  ]
  const scopes = []
  for (const probe of probes) {
    try { await probe.run(); scopes.push(probe.scope) } catch (error) { if (error.status === 401) throw new Error('Wildberries отклонил API-ключ'); if (![403, 404].includes(error.status)) continue }
  }
  if (!scopes.length) throw new Error('Ключ принят, но не найдены права Content или Statistics')
  return scopes
}

function getSession(id) {
  const session = sessions.get(id)
  if (!session || Date.now() - session.updatedAt > ttlMs) { if (session) sessions.delete(id); return null }
  return session
}

async function loadProducts(token) {
  try {
    const result = await wbFetch('https://content-api.wildberries.ru/content/v2/get/cards/list', token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { cursor: { limit: 100 }, filter: { withPhoto: -1 } } }) })
    return (result?.cards || []).map(card => ({ nmID: card.nmID, vendorCode: card.vendorCode, title: card.title || card.subjectName || 'Товар', brand: card.brand || '', photo: card.photos?.[0]?.big || card.photos?.[0]?.square || '' }))
  } catch { return [] }
}

async function loadStatistics(token) {
  const [orders, sales, stocks] = await Promise.all([
    wbFetch(`https://statistics-api.wildberries.ru/api/v1/supplier/orders?dateFrom=${encodeURIComponent(isoDaysAgo(30))}&flag=0`, token).catch(() => []),
    wbFetch(`https://statistics-api.wildberries.ru/api/v1/supplier/sales?dateFrom=${encodeURIComponent(isoDaysAgo(30))}&flag=0`, token).catch(() => []),
    wbFetch(`https://statistics-api.wildberries.ru/api/v1/supplier/stocks?dateFrom=${encodeURIComponent(isoDaysAgo(1))}`, token).catch(() => []),
  ])
  return { orders: Array.isArray(orders) ? orders : [], sales: Array.isArray(sales) ? sales : [], stocks: Array.isArray(stocks) ? stocks : [] }
}


function enrichProducts(products, stats) {
  const stockByNm = new Map()
  const revenueByNm = new Map()
  for (const row of stats.stocks || []) {
    const key = String(row.nmId || row.nmID || '')
    if (!key) continue
    stockByNm.set(key, (stockByNm.get(key) || 0) + Number(row.quantity || 0))
  }
  for (const row of stats.sales || []) {
    const key = String(row.nmId || row.nmID || '')
    if (!key) continue
    const value = Number(row.forPay || row.finishedPrice || row.priceWithDisc || 0)
    revenueByNm.set(key, (revenueByNm.get(key) || 0) + value)
  }
  return products.map(product => {
    const key = String(product.nmID || '')
    const stock = stockByNm.get(key) || 0
    return { ...product, stock, revenue: Math.round(revenueByNm.get(key) || 0), status: stock === 0 ? 'Нет остатка' : stock < 10 ? 'Риск' : 'В норме' }
  })
}

function addSyncLog(session, entry) {
  session.syncHistory = [{ id: crypto.randomUUID(), at: new Date().toISOString(), ...entry }, ...(session.syncHistory || [])].slice(0, 20)
}

function buildDashboard(data) {
  const sales = data.sales || []
  const orders = data.orders || []
  const stocks = data.stocks || []
  const revenue = sales.reduce((sum, row) => sum + Number(row.forPay || row.finishedPrice || row.priceWithDisc || 0), 0)
  const returns = sales.filter(row => String(row.saleID || '').startsWith('R')).length
  const stockUnits = stocks.reduce((sum, row) => sum + Number(row.quantity || 0), 0)
  return { revenue: Math.round(revenue), orders: orders.length, sales: sales.length, returns, stockUnits, profit: null, margin: null, periodDays: 30 }
}

app.get('/health', (_req, res) => res.json({ ok: true, service: 'elisei-api', version: '2.2.0' }))

app.post('/api/wb/connect', async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim()
    if (token.length < 40) return res.status(400).json({ error: 'API-ключ выглядит слишком коротким' })
    const scopes = await probeToken(token)
    const id = crypto.randomUUID()
    sessions.set(id, { token, scopes, createdAt: Date.now(), updatedAt: Date.now(), data: null, syncHistory: [] })
    res.json({ connectionId: id, scopes, connectedAt: new Date().toISOString(), expiresInHours: ttlMs / 3600000 })
  } catch (error) { res.status(error.status === 429 ? 429 : 400).json({ error: error.message }) }
})

app.get('/api/wb/status/:id', (req, res) => {
  const session = getSession(req.params.id)
  if (!session) return res.status(404).json({ error: 'Подключение истекло или сервер был перезапущен' })
  res.json({ connected: true, scopes: session.scopes, lastSync: session.lastSync || null, syncHistory: session.syncHistory || [] })
})

app.post('/api/wb/sync', async (req, res) => {
  const session = getSession(String(req.body?.connectionId || ''))
  if (!session) return res.status(404).json({ error: 'Подключение не найдено. Подключите Wildberries повторно.' })
  try {
    const startedAt = Date.now()
    const [products, stats] = await Promise.all([loadProducts(session.token), loadStatistics(session.token)])
    const enrichedProducts = enrichProducts(products, stats)
    session.data = { products: enrichedProducts, ...stats }
    session.updatedAt = Date.now(); session.lastSync = new Date().toISOString()
    const counts = { products: enrichedProducts.length, orders: stats.orders.length, sales: stats.sales.length, stocks: stats.stocks.length }
    addSyncLog(session, { status: 'success', durationMs: Date.now() - startedAt, counts })
    res.json({ ok: true, lastSync: session.lastSync, counts, dashboard: buildDashboard(session.data), syncHistory: session.syncHistory })
  } catch (error) {
    addSyncLog(session, { status: 'error', message: error.message })
    res.status(error.status || 502).json({ error: error.message })
  }
})

app.get('/api/wb/dashboard/:id', (req, res) => {
  const session = getSession(req.params.id)
  if (!session) return res.status(404).json({ error: 'Подключение не найдено' })
  res.json({ dashboard: buildDashboard(session.data || {}), lastSync: session.lastSync || null })
})

app.get('/api/wb/sync-history/:id', (req, res) => {
  const session = getSession(req.params.id)
  if (!session) return res.status(404).json({ error: 'Подключение не найдено' })
  res.json({ history: session.syncHistory || [] })
})

app.get('/api/wb/products/:id', (req, res) => {
  const session = getSession(req.params.id)
  if (!session) return res.status(404).json({ error: 'Подключение не найдено' })
  res.json({ products: session.data?.products || [], lastSync: session.lastSync || null })
})

app.post('/api/wb/disconnect', (req, res) => { sessions.delete(String(req.body?.connectionId || '')); res.json({ ok: true }) })

app.use((error, _req, res, _next) => res.status(500).json({ error: error.message || 'Внутренняя ошибка' }))
app.listen(port, () => console.log(`ELISEI API listening on ${port}`))
