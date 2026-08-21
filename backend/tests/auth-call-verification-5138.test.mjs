import assert from 'node:assert/strict'
import fs from 'node:fs'

const preload = fs.readFileSync(new URL('../src/call-auth-preload.mjs', import.meta.url), 'utf8')
const backendPackage = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const registerPage = fs.readFileSync(new URL('../../src/pages/RegisterPage.jsx', import.meta.url), 'utf8')
const loginPage = fs.readFileSync(new URL('../../src/pages/LoginPage.jsx', import.meta.url), 'utf8')

assert.equal(backendPackage.version, '2.25.8')
assert.match(backendPackage.scripts.start, /--import \.\/src\/call-auth-preload\.mjs/)

assert.match(preload, /https:\/\/sms\.ru\/code\/call/)
assert.match(preload, /ip:ip \|\| '-1'/)
assert.match(preload, /code\.length!==4/)
assert.match(preload, /phone_call_code/)
assert.match(preload, /OWNER_RECOVERY_PHONE/)
assert.match(preload, /requestedEmail/)
assert.match(preload, /phone=COALESCE\(phone,\$2\)/)
assert.doesNotMatch(preload, /sms\/send/)

for (const source of [registerPage, loginPage]) {
  assert.match(source, /последние 4 цифры/i)
  assert.match(source, /slice\(0,4\)/)
  assert.match(source, /maxLength=\{4\}/)
}
assert.match(loginPage, /email:recovery\.email/)
assert.match(loginPage, /Получить звонок/)
assert.match(registerPage, /Получить звонок/)

console.log('ELISEI 5.13.8 call verification regression: OK')
