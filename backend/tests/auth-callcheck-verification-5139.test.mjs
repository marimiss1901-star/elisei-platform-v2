import assert from 'node:assert/strict'
import fs from 'node:fs'

const preload = fs.readFileSync(new URL('../src/callcheck-auth-preload.mjs', import.meta.url), 'utf8')
const backendPackage = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const frontendPackage = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
const registerPage = fs.readFileSync(new URL('../../src/pages/RegisterPage.jsx', import.meta.url), 'utf8')
const loginPage = fs.readFileSync(new URL('../../src/pages/LoginPage.jsx', import.meta.url), 'utf8')

const backendVersion = backendPackage.version.split('.').map(Number)
assert.ok(backendVersion[0] > 2 || (backendVersion[0] === 2 && backendVersion[1] >= 27), 'callcheck regression must remain enabled on backend 2.27+')
assert.equal(frontendPackage.version, '5.15.9')
assert.match(backendPackage.scripts.start, /callcheck-auth-preload\.mjs/)
assert.match(preload, /\/callcheck\/add/)
assert.match(preload, /\/callcheck\/status/)
assert.match(preload, /code===401/)
assert.match(preload, /legacy owner bootstrap/)
assert.match(preload, /phone=COALESCE\(phone,\$2\)/)
assert.doesNotMatch(preload, /sms\/send/)
assert.match(loginPage, /Я позвонила — проверить и сменить пароль/)
assert.match(registerPage, /Я позвонила — проверить/)
assert.doesNotMatch(loginPage, /Последние 4 цифры входящего номера/)
assert.doesNotMatch(registerPage, /Последние 4 цифры входящего номера/)

console.log('ELISEI 5.15.9 preserves user-initiated callcheck regression: OK')
