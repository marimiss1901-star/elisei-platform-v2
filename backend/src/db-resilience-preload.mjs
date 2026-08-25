import express from 'express'

// ELISEI 5.14.1 — async route resilience for short PostgreSQL interruptions.
// Express 4 does not automatically forward rejected async route promises.
// A short Render/PostgreSQL reconnect could therefore terminate Node even though
// the pool itself was already configured to reconnect. Wrap route handlers at
// registration time so rejected promises always reach Express safely.

const METHODS = ['get','post','put','patch','delete','all']

function transientDatabaseError(error) {
  const code = String(error?.code || '').trim().toUpperCase()
  if (['57P01','57P02','57P03','08000','08003','08006','08001','08004','08P01','ECONNRESET','ECONNREFUSED','ETIMEDOUT'].includes(code)) return true
  const message = String(error?.message || error || '')
  return /(?:connection terminated unexpectedly|server closed the connection unexpectedly|database system is in recovery mode|database system is not yet accepting connections|terminating connection due to administrator command|connection reset|econnreset|connection refused|econnrefused|connection timeout|timeout exceeded when trying to connect|timeout acquiring (?:a )?client|etimedout)/i.test(message)
}

function handleRejectedRoute(error, req, res, next) {
  if (transientDatabaseError(error)) {
    console.warn('[ELISEI 5.14.1 DB RESILIENCE] transient database interruption:', {
      method:req?.method || '',
      path:req?.originalUrl || req?.url || '',
      code:String(error?.code || ''),
      message:String(error?.message || error || ''),
    })
    if (res?.headersSent) return next(error)
    res.setHeader('Retry-After','3')
    return res.status(503).json({
      error:'База данных ELISEI переподключается. Данные сохранены; повторите запрос через несколько секунд.',
      code:'DATABASE_RECONNECTING',
      retryAfterSeconds:3,
    })
  }
  return next(error)
}

function wrapHandler(handler) {
  if (typeof handler !== 'function' || handler.__eliseiAsyncRouteWrapped) return handler
  // Preserve Express error middleware semantics (err, req, res, next).
  if (handler.length === 4) return handler
  function wrapped(req,res,next) {
    try {
      const result = handler.call(this,req,res,next)
      if (result && typeof result.then === 'function') {
        result.catch(error => handleRejectedRoute(error,req,res,next))
      }
      return result
    } catch (error) {
      return handleRejectedRoute(error,req,res,next)
    }
  }
  Object.defineProperty(wrapped,'__eliseiAsyncRouteWrapped',{value:true})
  return wrapped
}

for (const method of METHODS) {
  const inherited = express.application[method]
  if (typeof inherited !== 'function') continue
  express.application[method] = function resilientRouteRegistration(path,...handlers) {
    // app.get('setting') is also an Express API; do not alter setting reads.
    if (method === 'get' && handlers.length === 0) return inherited.call(this,path)
    const wrapped = handlers.map(item => {
      if (Array.isArray(item)) return item.map(wrapHandler)
      return wrapHandler(item)
    })
    return inherited.call(this,path,...wrapped)
  }
}

console.log('[ELISEI 5.14.1] Async routes protected against transient PostgreSQL reconnects')
