import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import AppErrorBoundary from './components/AppErrorBoundary'
import './lib/callAuthCompat'
import './styles/tokens.css'
import './styles/global.css'
import './styles/app.css'

window.__ELISEI_API_BASE__ = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AppErrorBoundary>
  </React.StrictMode>
)
