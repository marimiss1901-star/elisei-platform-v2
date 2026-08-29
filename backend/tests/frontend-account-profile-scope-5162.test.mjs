import assert from 'node:assert/strict'
import fs from 'node:fs'

const page=fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx',import.meta.url),'utf8')
const api=fs.readFileSync(new URL('../../src/lib/api.js',import.meta.url),'utf8')
const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')

assert.match(page,/const scopedElStorageKey = \(key, user = \{\}\) =>/,
  'EL local profile state must be namespaced by the signed-in user')
assert.match(page,/scopedElStorageKey\(EL_CHAT_SETTINGS_KEY,user\)/)
assert.match(page,/readStoredJson\(elSettingsStorageKey, \{\}\)/,
  'the greeting must not read another account’s unscoped preferred name')
assert.match(page,/const result=await authApi\.updateProfile\(\{ name:accountNameDraft \}\)/,
  'account name must be editable from Settings')
assert.match(page,/Сохранить имя/)
assert.match(api,/updateProfile: \(data\) => request\('\/api\/auth\/profile', \{ method:'PUT'/)
assert.match(server,/app\.put\('\/api\/auth\/profile', authRequired/)
assert.match(server,/UPDATE users SET name=\$1 WHERE id=\$2 RETURNING \*/,
  'the corrected name must persist in the database and survive future logins')
assert.match(server,/\^\[\\p\{L\}\\p\{M\} \.'-\]\+\$\/u/,
  'profile validation must accept Cyrillic names')

console.log('ELISEI 5.16.2 per-account profile regression: OK')
