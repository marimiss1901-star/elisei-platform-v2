const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
const TOKEN_KEY = 'elisei_auth_token'

export const authStore = {
  getToken: () => localStorage.getItem(TOKEN_KEY) || '',
  setToken: (token) => token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

async function request(path, options = {}) {
  if (!API_BASE) throw new Error('Backend не настроен: добавьте VITE_API_BASE_URL')
  const token = authStore.getToken()
  let response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    })
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw new Error('Синхронизация превысила безопасное время ожидания. Повторите позже — повторно нажимать кнопку несколько раз не нужно.')
    }
    throw new Error(`Не удалось связаться с backend ELISEI (${API_BASE}). Проверьте, что сервис Render запущен и VITE_API_BASE_URL указан верно.`)
  }
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401) authStore.clear()
    throw new Error(payload.error || payload.message || `Ошибка ${response.status}`)
  }
  return payload
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

export const authApi = {
  register: (data) => request('/api/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  login: (data) => request('/api/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  requestPasswordReset: (data) => request('/api/auth/password-reset/request', { method: 'POST', body: JSON.stringify(data) }),
  confirmPasswordReset: (data) => request('/api/auth/password-reset/confirm', { method: 'POST', body: JSON.stringify(data) }),
  me: () => request('/api/auth/me'),
  logout: () => authStore.clear(),
}

export const wbApi = {
  current: () => request('/api/wb/connection'),
  connect: (token, label = '') => request('/api/wb/connect', { method: 'POST', body: JSON.stringify({ token, label }) }),
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
  dashboard: (connectionId) => request(`/api/wb/dashboard/${encodeURIComponent(connectionId)}`),
  products: (connectionId) => request(`/api/wb/products/${encodeURIComponent(connectionId)}`),
  core: (connectionId, params = {}) => {
    const query = new URLSearchParams()
    if (params?.from) query.set('from', String(params.from).slice(0,10))
    if (params?.to) query.set('to', String(params.to).slice(0,10))
    const suffix = query.toString() ? `?${query.toString()}` : ''
    return request(`/api/wb/core/${encodeURIComponent(connectionId)}${suffix}`)
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
    const query = new URLSearchParams()
    if (params?.from) query.set('from',String(params.from).slice(0,10))
    if (params?.to) query.set('to',String(params.to).slice(0,10))
    const suffix = query.toString() ? `?${query.toString()}` : ''
    return request(`/api/wb/advertising/${encodeURIComponent(connectionId)}${suffix}`)
  },
  diagnostics: (connectionId) => request(`/api/wb/diagnostics/${encodeURIComponent(connectionId)}`),
  dataQuality: (connectionId, params = {}) => {
    const query = new URLSearchParams()
    if (params?.from) query.set('from',String(params.from).slice(0,10))
    if (params?.to) query.set('to',String(params.to).slice(0,10))
    const suffix = query.toString() ? `?${query.toString()}` : ''
    return request(`/api/wb/data-quality/${encodeURIComponent(connectionId)}${suffix}`)
  },
  financeLedger: (connectionId, params = {}) => {
    const query = new URLSearchParams()
    for (const [key,value] of Object.entries(params || {})) {
      if (value === undefined || value === null || value === '' || value === 'all') continue
      query.set(key,String(value))
    }
    const suffix = query.toString() ? `?${query.toString()}` : ''
    return request(`/api/wb/finance-ledger/${encodeURIComponent(connectionId)}${suffix}`)
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
  syncHistory: (connectionId) => request(`/api/wb/sync-history/${encodeURIComponent(connectionId)}`),
  removeToken: (tokenId) => request(`/api/wb/tokens/${encodeURIComponent(tokenId)}`, { method: 'DELETE' }),
  setPrimaryToken: (tokenId) => request(`/api/wb/tokens/${encodeURIComponent(tokenId)}/primary`, { method: 'POST' }),
  disconnect: (connectionId) => request('/api/wb/disconnect', { method: 'POST', body: JSON.stringify({ connectionId }) }),
  configured: Boolean(API_BASE),
  baseUrl: API_BASE,
}

export const businessApi = {
  settings: () => request('/api/business/settings'),
  saveSettings: (settings) => request('/api/business/settings', { method: 'PUT', body: JSON.stringify(settings) }),
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
