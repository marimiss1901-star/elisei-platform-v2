const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

async function request(path, options = {}) {
  if (!API_BASE) throw new Error('Backend не настроен: добавьте VITE_API_BASE_URL')
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || payload.message || `Ошибка ${response.status}`)
  return payload
}

export const wbApi = {
  connect: (token) => request('/api/wb/connect', { method: 'POST', body: JSON.stringify({ token }) }),
  status: (connectionId) => request(`/api/wb/status/${encodeURIComponent(connectionId)}`),
  sync: (connectionId) => request('/api/wb/sync', { method: 'POST', body: JSON.stringify({ connectionId }) }),
  dashboard: (connectionId) => request(`/api/wb/dashboard/${encodeURIComponent(connectionId)}`),
  products: (connectionId) => request(`/api/wb/products/${encodeURIComponent(connectionId)}`),
  syncHistory: (connectionId) => request(`/api/wb/sync-history/${encodeURIComponent(connectionId)}`),
  disconnect: (connectionId) => request('/api/wb/disconnect', { method: 'POST', body: JSON.stringify({ connectionId }) }),
  configured: Boolean(API_BASE),
  baseUrl: API_BASE,
}
