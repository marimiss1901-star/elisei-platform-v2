import fs from 'node:fs'

const file = 'src/server.js'
let source = fs.readFileSync(file, 'utf8')

const oldText = `if (pool) {
  pool.on('error', error => {
    databaseState.ready = false
    databaseState.status = 'reconnecting'
    databaseState.lastError = error.message
    console.warn('PostgreSQL pool error; API stays online and will reconnect:', error.message)
    scheduleDatabaseInitialization(2000, 'pool-error')
  })
}
`

const newText = `if (pool) {
  pool.on('error', error => {
    // A pg Pool error can belong to one idle client. pg evicts that client and
    // keeps the rest of the pool usable, so do not announce a global outage
    // until a lightweight probe confirms the database itself is unavailable.
    databaseState.status = databaseState.ready ? 'degraded' : 'reconnecting'
    databaseState.lastError = error.message
    console.warn('PostgreSQL pool client error; probing database before global reconnect:', error.message)
    const probeTimer = setTimeout(async () => {
      try {
        await pool.query('SELECT 1')
        databaseState.ready = true
        databaseState.status = 'ok'
        databaseState.lastError = null
        databaseState.lastConnectedAt = new Date().toISOString()
      } catch (probeError) {
        databaseState.ready = false
        databaseState.status = 'reconnecting'
        databaseState.lastError = probeError.message
        scheduleDatabaseInitialization(2000, 'pool-error-probe')
      }
    }, 250)
    probeTimer.unref?.()
  })
}
`

if (!source.includes(newText)) {
  if (!source.includes(oldText)) throw new Error('Pool resilience patch target not found')
  source = source.replace(oldText,newText)
}

fs.writeFileSync(file, source)
console.log('PostgreSQL pool resilience fix applied')
