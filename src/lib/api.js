const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
const TOKEN_KEY = 'elisei_auth_token'
const WB_CONNECTION_CACHE_KEY = 'elisei_wb_connection_v1'
const BUSINESS_SETTINGS_CACHE_KEY = 'elisei_business_settings_v1'
const READ_CACHE_PREFIX = 'elisei_read_cache_v1:'
const READ_CACHE_LIMIT = 18
const DEFAULT_READ_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

function readLocalJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}

function writeLocalJson(key, value) {
  try {
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch { /* browser cache is best-effort */ }
}

function pruneReadCache() {
  try {
    const entries = []
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key?.startsWith(READ_CACHE_PREFIX)) continue
      const value = readLocalJson(key, null)
      entries.push({ key, savedAt:Number(value?.savedAt || 0) })
    }
    entries.sort((a,b) => b.savedAt-a.savedAt)
    for (const entry of entries.slice(READ_CACHE_LIMIT)) localStorage.removeItem(entry.key)
  } catch { /* ignore storage quota/browser restrictions */ }
}

function writeReadCache(key, payload) {
  if (!key || payload == null) return
  try {
    localStorage.setItem(`${READ_CACHE_PREFIX}${key}`, JSON.stringify({ savedAt:Date.now(), payload }))
    pruneReadCache()
  } catch { /* cache is best-effort and must never break API calls */ }
}

function readReadCache(key, maxAgeMs = DEFAULT_READ_CACHE_MAX_AGE_MS) {
  try {
    const cached = readLocalJson(`${READ_CACHE_PREFIX}${key}`, null)
    const savedAt = Number(cached?.savedAt || 0)
    if (!cached?.payload || !savedAt || Date.now()-savedAt > maxAgeMs) return null
    return cached
  } catch { return null }
}

function clearReadCaches() {
  try {
    const keys = []
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key?.startsWith(READ_CACHE_PREFIX)) keys.push(key)
    }
    keys.forEach(key => localStorage.removeItem(key))
  } catch { /* ignore */ }
}

function clearSessionCaches() {
  try {
    localStorage.removeItem(WB_CONNECTION_CACHE_KEY)
    localStorage.removeItem(BUSINESS_SETTINGS_CACHE_KEY)
    clearReadCaches()
  } catch { /* ignore */ }
}

export const authStore = {
  getToken: () => localStorage.getItem(TOKEN_KEY) || '',
  setToken: (token) => {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token)
      else localStorage.removeItem(TOKEN_KEY)
    } catch { /* auth persistence is best-effort when browser storage is full */ }
  },
  clear: () => {
    try { localStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ }
    clearSessionCaches()
  },
}

async function request(path, options = {}) {
  if (!API_BASE) throw new Error('Backend не настроен: добавьте VITE_API_BASE_URL')
  const token = authStore.getToken()
  const method = String(options.method || 'GET').toUpperCase()
  const signal = options.signal || (method === 'GET' ? AbortSignal.timeout(15000) : undefined)
  let response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      ...(signal ? { signal } : {}),
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    })
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      const timeoutError = new Error('Backend отвечает дольше обычного. ELISEI сохранит последние подтверждённые данные и повторит чтение позже.')
      timeoutError.code = 'REQUEST_TIMEOUT'
      throw timeoutError
    }
    const networkError = new Error(`Не удалось связаться с backend ELISEI (${API_BASE}). Последние подтверждённые данные не удаляются.`)
    networkError.code = 'BACKEND_UNAVAILABLE'
    throw networkError
  }
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401) authStore.clear()
    const error = new Error(payload.error || payload.message || `Ошибка ${response.status}`)
    error.status = response.status
    error.code = payload.code || ''
    throw error
  }
  return payload
}

function isTransientBackendError(error) {
  if (!error) return false
  if (error.status >= 500) return true
  return ['DATABASE_RECONNECTING','REQUEST_TIMEOUT','BACKEND_UNAVAILABLE'].includes(String(error.code || ''))
    || /база данных.*переподключ|database.*reconnect|connection terminated|recovery mode/i.test(String(error.message || ''))
}

async function cachedRead(cacheKey, path, options = {}, maxAgeMs = DEFAULT_READ_CACHE_MAX_AGE_MS) {
  try {
    const result = await request(path, options)
    writeReadCache(cacheKey, result)
    return result
  } catch (error) {
    if (error?.status === 401 || !isTransientBackendError(error)) throw error
    const cached = readReadCache(cacheKey, maxAgeMs)
    if (!cached?.payload) throw error
    return {
      ...cached.payload,
      transientFallback:true,
      transientCachedAt:new Date(cached.savedAt).toISOString(),
      transientErrorCode:String(error.code || 'BACKEND_RECONNECTING'),
    }
  }
}

async function currentWbConnection() {
  try {
    const result = await request('/api/wb/connection', { signal:AbortSignal.timeout(8000) })
    if (result?.connected && result?.connectionId) writeLocalJson(WB_CONNECTION_CACHE_KEY, result)
    else writeLocalJson(WB_CONNECTION_CACHE_KEY, null)
    return result
  } catch (error) {
    if (error?.status === 401) throw error
    const cached = readLocalJson(WB_CONNECTION_CACHE_KEY, null)
    if (isTransientBackendError(error) && cached?.connected && cached?.connectionId) {
      return {
        ...cached,
        connected:true,
        transientFallback:true,
        transientErrorCode:String(error.code || 'BACKEND_RECONNECTING'),
      }
    }
    throw error
  }
}

async function connectWb(token, label = '') {
  const result = await request('/api/wb/connect', { method:'POST', body:JSON.stringify({ token, label }) })
  if (result?.connected && result?.connectionId) writeLocalJson(WB_CONNECTION_CACHE_KEY, result)
  return result
}

async function disconnectWb(connectionId) {
  const result = await request('/api/wb/disconnect', { method:'POST', body:JSON.stringify({ connectionId }) })
  writeLocalJson(WB_CONNECTION_CACHE_KEY, null)
  clearReadCaches()
  return result
}

async function currentBusinessSettings() {
  try {
    const result = await request('/api/business/settings', { signal:AbortSignal.timeout(8000) })
    if (result?.settings) writeLocalJson(BUSINESS_SETTINGS_CACHE_KEY, result.settings)
    return result
  } catch (error) {
    if (error?.status === 401) throw error
    if (!isTransientBackendError(error)) throw error
    const cached = readLocalJson(BUSINESS_SETTINGS_CACHE_KEY, null)
    return { settings:cached, transientFallback:true }
  }
}

async function downloadFile(path) {
  if (!API_BASE) throw new Error('Backend не настроен: добавьте VITE_API_BASE_URL')
  const token = authStore.getToken()
  const response = await fetch(`${API_BASE}${path}`, { headers:{ ...(token ? { Authorization:`Bearer ${token}` } : {}) } })
  if (!response.ok) {
    const payload = await response.json().catch(()=>({}))
    if (response.status === 401) authStore.clear()
    throw new Error(payload.error || payload.message || `Ошибка ${response.status}`)
  }
  const disposition = response.headers.get('content-disposition') || ''
  const utf = disposition.match(/filename\*=UTF-8''([^;]+)/i)
  const plain = disposition.match(/filename="?([^";]+)"?/i)
  const filename = decodeURIComponent(utf?.[1] || plain?.[1] || 'wildberries-document')
  return { blob:await response.blob(),filename }
}

const querySuffix = params => {
  const query = new URLSearchParams()
  for (const [key,value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '' || value === 'all') continue
    query.set(key,String(value))
  }
  return query.toString() ? `?${query.toString()}` : ''
}

export const authApi = {
  register: (data) => request('/api/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  requestRegisterPhoneCode: (data) => request('/api/auth/register/phone/request', { method: 'POST', body: JSON.stringify(data) }),
  confirmRegisterPhoneCode: (data) => request('/api/auth/register/phone/confirm', { method: 'POST', body: JSON.stringify(data) }),
  login: (data) => request('/api/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  updateProfile: (data) => request('/api/auth/profile', { method:'PUT',body:JSON.stringify(data) }),
  requestPasswordResetSms: (data) => request('/api/auth/password-reset/sms/request', { method: 'POST', body: JSON.stringify(data) }),
  confirmPasswordResetSms: (data) => request('/api/auth/password-reset/sms/confirm', { method: 'POST', body: JSON.stringify(data) }),
  me: () => request('/api/auth/me'),
  requestPhoneChange: (data) => request('/api/auth/phone/request', { method: 'POST', body: JSON.stringify(data) }),
  confirmPhoneChange: (data) => request('/api/auth/phone/confirm', { method: 'POST', body: JSON.stringify(data) }),
  logout: () => authStore.clear(),
}

export const wbApi = {
  current: () => currentWbConnection(),
  connect: (token, label = '') => connectWb(token, label),
  status: (connectionId) => request(`/api/wb/status/${encodeURIComponent(connectionId)}`),
  live: (connectionId) => request(`/api/wb/live/${encodeURIComponent(connectionId)}`),
  updateLive: (connectionId, settings = {}) => request(`/api/wb/live/${encodeURIComponent(connectionId)}`, { method:'PUT',body:JSON.stringify(settings) }),
  setupWebhooks: (connectionId) => request(`/api/wb/live/${encodeURIComponent(connectionId)}/webhooks/setup`, { method:'POST' }),
  oauthReadiness: () => request('/api/wb/oauth/readiness'),
  sync: (connectionId, stages = null, options = {}) => request('/api/wb/sync', {
    method: 'POST',
    body: JSON.stringify({
      connectionId,
      ...(Array.isArray(stages) ? { stages } : {}),
      ...(options?.period?.from && options?.period?.to ? { period:{ from:String(options.period.from).slice(0,10),to:String(options.period.to).slice(0,10) } } : {}),
    }),
    signal: AbortSignal.timeout(110000),
  }),
  dashboard: (connectionId, params = {}) => {
    const clean = {
      ...(params?.from ? { from:String(params.from).slice(0,10) } : {}),
      ...(params?.to ? { to:String(params.to).slice(0,10) } : {}),
    }
    const suffix = querySuffix(clean)
    return cachedRead(`dashboard:${connectionId}:${clean.from || 'all'}:${clean.to || 'all'}`, `/api/wb/dashboard/${encodeURIComponent(connectionId)}${suffix}`)
  },
  dailyReady: (connectionId, date = '') => {
    const query = date ? `?date=${encodeURIComponent(String(date).slice(0,10))}` : ''
    return cachedRead(`daily:${connectionId}:${date || 'latest'}`, `/api/wb/daily-ready/${encodeURIComponent(connectionId)}${query}`, {}, 3 * 24 * 60 * 60 * 1000)
  },
  products: (connectionId) => cachedRead(`products:${connectionId}`, `/api/wb/products/${encodeURIComponent(connectionId)}`),
  core: (connectionId, params = {}) => {
    const clean = {
      ...(params?.from ? { from:String(params.from).slice(0,10) } : {}),
      ...(params?.to ? { to:String(params.to).slice(0,10) } : {}),
    }
    const suffix = querySuffix(clean)
    // A cold period miss builds and persists a server-side mart. Keep that first
    // request alive long enough to finish instead of aborting at the generic
    // 15-second GET limit; subsequent reads are served from the mart quickly.
    return cachedRead(
      `core:${connectionId}:${clean.from || 'all'}:${clean.to || 'all'}`,
      `/api/wb/core/${encodeURIComponent(connectionId)}${suffix}`,
      { signal:AbortSignal.timeout(110000) },
    )
  },
  product360: (connectionId, productKey, params = {}) => {
    const query = new URLSearchParams({ productKey:String(productKey || '') })
    if (params?.from) query.set('from',String(params.from).slice(0,10))
    if (params?.to) query.set('to',String(params.to).slice(0,10))
    if (params?.depth) query.set('depth',String(params.depth))
    const timeoutMs = params?.depth === 'full' ? 25000 : 12000
    return request(`/api/wb/product-360/${encodeURIComponent(connectionId)}?${query.toString()}`, { signal:AbortSignal.timeout(timeoutMs) })
  },
  advertising: (connectionId, params = {}) => {
    const clean = {
      ...(params?.from ? { from:String(params.from).slice(0,10) } : {}),
      ...(params?.to ? { to:String(params.to).slice(0,10) } : {}),
    }
    const suffix = querySuffix(clean)
    return cachedRead(`advertising:${connectionId}:${clean.from || 'all'}:${clean.to || 'all'}`, `/api/wb/advertising/${encodeURIComponent(connectionId)}${suffix}`)
  },
  diagnostics: (connectionId) => request(`/api/wb/diagnostics/${encodeURIComponent(connectionId)}`),
  dataQuality: (connectionId, params = {}) => {
    const clean = {
      ...(params?.from ? { from:String(params.from).slice(0,10) } : {}),
      ...(params?.to ? { to:String(params.to).slice(0,10) } : {}),
    }
    const suffix = querySuffix(clean)
    return cachedRead(
      `quality:${connectionId}:${clean.from || 'all'}:${clean.to || 'all'}`,
      `/api/wb/data-quality/${encodeURIComponent(connectionId)}${suffix}`,
      {},
      3 * 24 * 60 * 60 * 1000,
    )
  },
  financeLedger: (connectionId, params = {}) => {
    const suffix = querySuffix(params)
    return cachedRead(`finance:${connectionId}:${suffix || 'overview'}`, `/api/wb/finance-ledger/${encodeURIComponent(connectionId)}${suffix}`)
  },
  downloadDocument: async (connectionId, serviceName, extension) => {
    const cleanExtension=String(extension || '').replace(/^\./,'')
    const query = new URLSearchParams({ connectionId:String(connectionId),extension:cleanExtension })
    const result=await downloadFile(`/api/wb/documents/${encodeURIComponent(serviceName)}/download?${query.toString()}`)
    return { ...result,filename:result.filename === 'wildberries-document' ? `${serviceName}.${cleanExtension}` : result.filename }
  },
  extended: (stream, connectionId, options = {}, legacyLimit = 150) => {
    const params = typeof options === 'string' ? { afterKey:options,limit:legacyLimit } : (options || {})
    const query = new URLSearchParams({ connectionId:String(connectionId),limit:String(params.limit || 150) })
    for (const key of ['afterKey','from','to','query','status','rating','warehouse']) {
      const value = params[key]
      if (value !== undefined && value !== null && String(value).trim() !== '') query.set(key,String(value))
    }
    return request(`/api/wb/extended/${encodeURIComponent(stream)}?${query.toString()}`)
  },
  repairStocks: (connectionId, taskId = '') => request(`/api/wb/stocks/${encodeURIComponent(connectionId)}/repair`, { method: 'POST', body: JSON.stringify({ ...(taskId ? { taskId } : {}) }), signal: AbortSignal.timeout(75000) }),
  syncHistory: (connectionId) => cachedRead(`sync-history:${connectionId}`, `/api/wb/sync-history/${encodeURIComponent(connectionId)}`, {}, 3 * 24 * 60 * 60 * 1000),
  removeToken: (tokenId) => request(`/api/wb/tokens/${encodeURIComponent(tokenId)}`, { method: 'DELETE' }),
  setPrimaryToken: (tokenId) => request(`/api/wb/tokens/${encodeURIComponent(tokenId)}/primary`, { method: 'POST' }),
  disconnect: (connectionId) => disconnectWb(connectionId),
  configured: Boolean(API_BASE),
  baseUrl: API_BASE,
}

export const businessApi = {
  settings: () => currentBusinessSettings(),
  saveSettings: async (settings) => {
    const result = await request('/api/business/settings', { method: 'PUT', body: JSON.stringify(settings) })
    writeLocalJson(BUSINESS_SETTINGS_CACHE_KEY, result?.settings || settings)
    return result
  },
}

export const elApi = {
  status: () => request('/api/el/status'),
  plan: () => request('/api/el/plan'),
  setPlan: (payload) => request('/api/el/plan', { method:'PUT', body:JSON.stringify(payload) }),
  capabilities: () => request('/api/el/capabilities'),
  profile: (cabinetId = 'main') => request(`/api/el/profile?cabinetId=${encodeURIComponent(cabinetId || 'main')}`),
  saveProfile: (profile, cabinetId = 'main', cabinetName = 'Основной кабинет') => request('/api/el/profile', {
    method:'PUT',
    body:JSON.stringify({ ...profile, cabinetId: cabinetId || 'main', cabinetName }),
  }),
  chat: (payload) => request('/api/el/chat', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(125000),
  }),
  memories: () => request('/api/el/memory'),
  forgetMemory: (memoryId) => request(`/api/el/memory/${encodeURIComponent(memoryId)}`, { method:'DELETE' }),
  clearConversation: (conversationId) => request(`/api/el/conversation/${encodeURIComponent(conversationId)}`, { method:'DELETE' }),
}
