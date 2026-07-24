import { useEffect, useState } from 'react'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import DashboardPage from './pages/DashboardPage'

function normalizePath() {
  const path = window.location.pathname.replace(/\/+$/, '')
  return path || '/'
}

function App() {
  const [path, setPath] = useState(normalizePath())
  const [isAuthenticated, setAuthenticated] = useState(() => localStorage.getItem('elisei_demo_auth') === '1')

  useEffect(() => {
    const onPopState = () => setPath(normalizePath())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = (next) => {
    window.history.pushState({}, '', next)
    setPath(normalizePath())
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const login = () => {
    localStorage.setItem('elisei_demo_auth', '1')
    setAuthenticated(true)
    navigate('/app')
  }

  const logout = () => {
    localStorage.removeItem('elisei_demo_auth')
    setAuthenticated(false)
    navigate('/')
  }

  if (path === '/login') return <LoginPage onNavigate={navigate} onLogin={login} />
  if (path === '/register') return <RegisterPage onNavigate={navigate} onRegister={login} />
  if (path === '/app') {
    if (!isAuthenticated) return <LoginPage onNavigate={navigate} onLogin={login} />
    return <DashboardPage onNavigate={navigate} onLogout={logout} />
  }
  return <LandingPage onNavigate={navigate} isAuthenticated={isAuthenticated} />
}

export default App
