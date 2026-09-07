import pg from 'pg'

// ELISEI 5.18.7 — every PostgreSQL pool must survive a Render/Postgres restart.
// Some preload modules create their own small pg.Pool before src/server.js is
// evaluated. An idle-client error on any pool without an `error` listener is an
// uncaught EventEmitter error and terminates Node. Install a safe listener at
// construction time so auxiliary pools cannot bring down the whole backend.

const OriginalPool = pg.Pool

if (!OriginalPool?.__eliseiResilientPool) {
  class EliseiResilientPool extends OriginalPool {
    constructor(...args) {
      super(...args)
      this.on('error', error => {
        console.warn('[ELISEI PG POOL] transient idle-client error; process kept alive:', {
          code:String(error?.code || ''),
          message:String(error?.message || error || ''),
        })
      })
    }
  }
  Object.defineProperty(EliseiResilientPool,'__eliseiResilientPool',{value:true})
  pg.Pool = EliseiResilientPool
}

console.log('[ELISEI 5.18.7] Global PostgreSQL pool resilience enabled')
