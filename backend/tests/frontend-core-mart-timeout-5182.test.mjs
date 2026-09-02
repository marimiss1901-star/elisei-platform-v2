import assert from 'node:assert/strict'
import fs from 'node:fs'

const api=fs.readFileSync(new URL('../../src/lib/api.js',import.meta.url),'utf8')
const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')

const coreStart=api.indexOf('core: (connectionId, params = {}) =>')
const coreEnd=api.indexOf('product360:',coreStart)
assert.ok(coreStart>0 && coreEnd>coreStart,'core API section must exist')
const core=api.slice(coreStart,coreEnd)

assert.ok(core.includes('AbortSignal.timeout(110000)'),'cold period mart creation must survive the generic 15-second GET timeout')
assert.ok(core.includes('cachedRead('),'period mart must preserve last-known-good fallback')
assert.ok(server.includes("app.use('/api/wb/core/:id'"),'core reads must register foreground priority')
assert.ok(server.includes("foregroundReadState.active > 0 && ['timer','interval'].includes"),'periodic worker must yield to foreground analytics')

console.log('ELISEI 5.18.2 cold core mart timeout regression: OK')
