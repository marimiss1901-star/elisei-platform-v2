import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import DashboardPage from './pages/DashboardPage'
import { authApi, authStore } from './lib/api'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'auto' }) }, [pathname])
  return null
}

function AppRoutes() {
  const navigate = useNavigate()
  const [authState, setAuthState] = useState(() => authStore.getToken() ? 'checking' : 'guest')
  const [user, setUser] = useState(null)

  useEffect(() => {
    if (!authStore.getToken()) return
    let cancelled = false
    let retryTimer = null
    const verifySession = () => {
      authApi.me().then(({ user: currentUser }) => {
        if (cancelled) return
        setUser(currentUser)
        setAuthState('authenticated')
      }).catch((error) => {
        if (cancelled) return
        if (error?.status === 401) {
          authStore.clear()
          setAuthState('guest')
          return
        }
        setAuthState('checking')
        retryTimer = setTimeout(verifySession, 3000)
      })
    }
    verifySession()
    return () => { cancelled = true; if (retryTimer) clearTimeout(retryTimer) }
  }, [])

  const finishAuth = ({ token, user: currentUser }) => {
    authStore.setToken(token)
    setUser(currentUser)
    setAuthState('authenticated')
    navigate('/app', { replace: true })
  }

  const logout = () => {
    authApi.logout()
    setUser(null)
    setAuthState('guest')
    navigate('/', { replace: true })
  }

  if (authState === 'checking') return <div className="app-loading">Загружаем рабочее пространство…</div>
  const isAuthenticated = authState === 'authenticated'

  return <><ScrollToTop/><Routes>
    <Route path="/" element={<LandingPage onNavigate={navigate} isAuthenticated={isAuthenticated} />} />
    <Route path="/login" element={isAuthenticated ? <Navigate to="/app" replace /> : <LoginPage onNavigate={navigate} onLogin={finishAuth} />} />
    <Route path="/register" element={isAuthenticated ? <Navigate to="/app" replace /> : <RegisterPage onNavigate={navigate} onRegister={finishAuth} />} />
    <Route path="/app/*" element={isAuthenticated ? <DashboardPage onNavigate={navigate} onLogout={logout} user={user} onUserUpdate={setUser} /> : <Navigate to="/login" replace />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></>
}

export default function App() { return <AppRoutes /> }
