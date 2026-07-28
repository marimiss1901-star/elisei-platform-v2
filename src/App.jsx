import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import DashboardPage from './pages/DashboardPage'

function ScrollToTop() {
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [pathname])

  return null
}

function AppRoutes() {
  const navigate = useNavigate()
  const [isAuthenticated, setAuthenticated] = useState(
    () => localStorage.getItem('elisei_demo_auth') === '1'
  )

  const login = () => {
    localStorage.setItem('elisei_demo_auth', '1')
    setAuthenticated(true)
    navigate('/app', { replace: true })
  }

  const logout = () => {
    localStorage.removeItem('elisei_demo_auth')
    setAuthenticated(false)
    navigate('/', { replace: true })
  }

  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route
          path="/"
          element={<LandingPage onNavigate={navigate} isAuthenticated={isAuthenticated} />}
        />
        <Route
          path="/login"
          element={
            isAuthenticated
              ? <Navigate to="/app" replace />
              : <LoginPage onNavigate={navigate} onLogin={login} />
          }
        />
        <Route
          path="/register"
          element={
            isAuthenticated
              ? <Navigate to="/app" replace />
              : <RegisterPage onNavigate={navigate} onRegister={login} />
          }
        />
        <Route
          path="/app/*"
          element={
            isAuthenticated
              ? <DashboardPage onNavigate={navigate} onLogout={logout} />
              : <Navigate to="/login" replace />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}

export default function App() {
  return <AppRoutes />
}
