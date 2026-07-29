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
    throw error
  }
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401) authStore.clear()
    throw new Error(payload.error || payload.message || `Ошибка ${response.status}`)
  }
  return payload
}

export const authApi = {
  register: (data) => request('/api/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  login: (data) => request('/api/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  me: () => request('/api/auth/me'),
  logout: () => authStore.clear(),
}

export const wbApi = {
  current: () => request('/api/wb/connection'),
  connect: (token, label = '') => request('/api/wb/connect', { method: 'POST', body: JSON.stringify({ token, label }) }),
  status: (connectionId) => request(`/api/wb/status/${encodeURIComponent(connectionId)}`),
  sync: (connectionId, stages = null) => request('/api/wb/sync', { method: 'POST', body: JSON.stringify({ connectionId, ...(Array.isArray(stages) ? { stages } : {}) }), signal: AbortSignal.timeout(110000) }),
  dashboard: (connectionId) => request(`/api/wb/dashboard/${encodeURIComponent(connectionId)}`),
  products: (connectionId) => request(`/api/wb/products/${encodeURIComponent(connectionId)}`),
  core: (connectionId) => request(`/api/wb/core/${encodeURIComponent(connectionId)}`),
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
