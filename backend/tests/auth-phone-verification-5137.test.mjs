import assert from 'node:assert/strict'
import fs from 'node:fs'

const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8')
const api = fs.readFileSync(new URL('../../src/lib/api.js', import.meta.url), 'utf8')
const register = fs.readFileSync(new URL('../../src/pages/RegisterPage.jsx', import.meta.url), 'utf8')
const dashboard = fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx', import.meta.url), 'utf8')
const app = fs.readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8')

// 5.13.7 SMS endpoints remain compatible for profile/security flows.
assert.match(server, /CREATE TABLE IF NOT EXISTS phone_verification_otps/)
assert.match(server, /app\.post\('\/api\/auth\/register\/phone\/request'/)
assert.match(server, /app\.post\('\/api\/auth\/register\/phone\/confirm'/)
assert.match(server, /purpose:'register_phone'/)
assert.match(server, /Сначала подтвердите телефон кодом из SMS/)
assert.match(server, /app\.post\('\/api\/auth\/phone\/request', authRequired/)
assert.match(server, /app\.post\('\/api\/auth\/phone\/confirm', authRequired/)
assert.match(server, /UPDATE users SET phone=\$1 WHERE id=\$2/)
assert.match(server, /INTERVAL '5 minutes'/)
assert.match(server, /INTERVAL '1 hour'/)
assert.match(server, /version: '2\.25\.7'/)

assert.match(api, /requestRegisterPhoneCode/)
assert.match(api, /confirmRegisterPhoneCode/)
assert.match(api, /requestPhoneChange/)
assert.match(api, /confirmPhoneChange/)
// Registration itself migrated in 5.13.9 to user-initiated callcheck.
assert.match(register, /Я позвонила — проверить/)
assert.match(register, /phoneVerificationToken/)
assert.match(register, /Телефон подтверждён/)
assert.doesNotMatch(register, /Подтвердить телефон кодом из SMS/)
assert.match(dashboard, /Безопасность аккаунта/)
assert.match(dashboard, /Сменить телефон/)
assert.match(dashboard, /confirmPhoneChange/)
assert.match(app, /onUserUpdate=\{setUser\}/)

console.log('auth-phone-verification-5137: legacy SMS security flow preserved; registration uses callcheck')
