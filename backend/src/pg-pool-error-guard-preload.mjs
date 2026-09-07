import pg from 'pg'

// ELISEI PostgreSQL pool safety guard.
// Several early preloads create their own pg.Pool before server.js is evaluated.
// node-postgres emits an `error` event on a pool when an idle client is dropped
// by PostgreSQL. An EventEmitter `error` with no listener terminates Node, so a
// short Render/Postgres reconnect could take the whole API down even though the
// request layer already knows how to return a temporary 503 and recover.
//
// Install this guard before every other preload. It wraps pg.Pool once and gives
// every subsequently-created pool a non-throwing idle-client error listener.

const OriginalPool = pg?.Pool
const PATCH_MARK = Symbol.for('elisei.pgPoolIdleErrorGuard')

if (typeof OriginalPool === 'function' && !OriginalPool[PATCH_MARK]) {
  class EliseiGuardedPool extends OriginalPool {
    constructor(...args) {
      super(...args)
      this.on('error', error => {
        console.warn('[ELISEI DB POOL] idle PostgreSQL client error; keeping process online:', String(error?.message || error || 'unknown error'))
      })
    }
  }

  Object.defineProperty(EliseiGuardedPool, PATCH_MARK, { value:true })
  pg.Pool = EliseiGuardedPool
  console.log('[ELISEI DB POOL] global idle-client error guard installed')
}
