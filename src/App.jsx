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
    authApi.me().then(({ user: currentUser }) => { setUser(currentUser); setAuthState('authenticated') }).catch(() => { authStore.clear(); setAuthState('guest') })
  }, [])

  const finishAuth = ({ token, user: currentUser }) => {
    authStore.setToken(token)
    setUser(currentUser)
    setAuthState('authenticated')
    navigate('/app', { replace: true })
  }

  const logout = () => {
    authApi.logout()
    localStorage.removeItem('elisei_wb_connection_id')
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
    <Route path="/app/*" element={isAuthenticated ? <DashboardPage onNavigate={navigate} onLogout={logout} user={user} /> : <Navigate to="/login" replace />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></>
}

export default function App() { return <AppRoutes /> }
