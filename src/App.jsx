import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import DashboardPage from './pages/DashboardPage'
import { authApi, authStore } from './lib/api'

const AUTH_USER_CACHE_KEY = 'elisei_auth_user_v1'
const AUTH_VERIFY_TIMEOUT_MS = 8000

function readCachedUser() {
  try {
    const raw = localStorage.getItem(AUTH_USER_CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function cacheUser(user) {
  try {
    if (user) localStorage.setItem(AUTH_USER_CACHE_KEY, JSON.stringify(user))
    else localStorage.removeItem(AUTH_USER_CACHE_KEY)
  } catch { /* local cache is best-effort */ }
}

function authMeWithTimeout() {
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      const error = new Error('Проверка сессии временно недоступна')
      error.code = 'AUTH_VERIFY_TIMEOUT'
      reject(error)
    }, AUTH_VERIFY_TIMEOUT_MS)
  })
  return Promise.race([authApi.me(), timeout]).finally(() => window.clearTimeout(timeoutId))
}

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'auto' }) }, [pathname])
  return null
}

function AppRoutes() {
  const navigate = useNavigate()
  const hasToken = Boolean(authStore.getToken())
  // 5.15.9: a slow Render/backend wake must never blank the whole workspace.
  // A stored token opens the shell immediately; /auth/me verifies in background.
  const [authState, setAuthState] = useState(() => hasToken ? 'authenticated' : 'guest')
  const [user, setUser] = useState(() => hasToken ? readCachedUser() : null)

  useEffect(() => {
    if (!authStore.getToken()) return
    let cancelled = false
    let retryTimer = null
    const verifySession = () => {
      authMeWithTimeout().then(({ user: currentUser }) => {
        if (cancelled) return
        setUser(currentUser || null)
        cacheUser(currentUser || null)
        setAuthState('authenticated')
      }).catch((error) => {
        if (cancelled) return
        if (error?.status === 401) {
          authStore.clear()
          cacheUser(null)
          setUser(null)
          setAuthState('guest')
          navigate('/login', { replace:true })
          return
        }
        // Temporary backend/network errors do not lock the UI. Verify again quietly.
        retryTimer = setTimeout(verifySession, 5000)
      })
    }
    verifySession()
    return () => { cancelled = true; if (retryTimer) clearTimeout(retryTimer) }
  }, [navigate])

  const applyUser = currentUser => {
    setUser(currentUser || null)
    cacheUser(currentUser || null)
  }

  const finishAuth = ({ token, user: currentUser }) => {
    authStore.setToken(token)
    applyUser(currentUser)
    setAuthState('authenticated')
    navigate('/app', { replace: true })
  }

  const logout = () => {
    authApi.logout()
    cacheUser(null)
    setUser(null)
    setAuthState('guest')
    navigate('/', { replace: true })
  }

  const isAuthenticated = authState === 'authenticated'

  return <><ScrollToTop/><Routes>
    <Route path="/" element={<LandingPage onNavigate={navigate} isAuthenticated={isAuthenticated} />} />
    <Route path="/login" element={isAuthenticated ? <Navigate to="/app" replace /> : <LoginPage onNavigate={navigate} onLogin={finishAuth} />} />
    <Route path="/register" element={isAuthenticated ? <Navigate to="/app" replace /> : <RegisterPage onNavigate={navigate} onRegister={finishAuth} />} />
    <Route path="/app/*" element={isAuthenticated ? <DashboardPage onNavigate={navigate} onLogout={logout} user={user} onUserUpdate={applyUser} /> : <Navigate to="/login" replace />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></>
}

export default function App() { return <AppRoutes /> }
