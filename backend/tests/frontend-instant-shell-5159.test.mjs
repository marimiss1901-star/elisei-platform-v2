import assert from 'node:assert/strict'
import fs from 'node:fs'

const app=fs.readFileSync(new URL('../../src/App.jsx',import.meta.url),'utf8')
const frontendPackage=JSON.parse(fs.readFileSync(new URL('../../package.json',import.meta.url),'utf8'))

assert.equal(frontendPackage.version,'5.15.9')
assert.ok(app.includes("hasToken ? 'authenticated' : 'guest'"),'stored token must open the shell immediately')
assert.ok(app.includes('AUTH_VERIFY_TIMEOUT_MS = 8000'),'background session verification must be bounded')
assert.ok(app.includes('Promise.race([authApi.me(), timeout])'),'auth/me must not block the workspace indefinitely')
assert.ok(app.includes('AUTH_USER_CACHE_KEY'),'user profile should be cached for instant greeting')
assert.ok(!app.includes("authState === 'checking'"),'full-screen checking state must not return')
assert.ok(!app.includes('Загружаем рабочее пространство'),'workspace must not be replaced by an indefinite auth loader')

console.log('ELISEI 5.15.9 instant authenticated shell regression: OK')
