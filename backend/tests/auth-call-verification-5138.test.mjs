import assert from 'node:assert/strict'
import fs from 'node:fs'

// Historical regression for 5.13.8 transport itself. The active transport may
// advance in later releases, so this test no longer asserts current package/UI.
const preload = fs.readFileSync(new URL('../src/call-auth-preload.mjs', import.meta.url), 'utf8')

assert.match(preload, /https:\/\/sms\.ru\/code\/call/)
assert.match(preload, /phone_call_code/)
assert.match(preload, /OWNER_RECOVERY_PHONE/)
assert.match(preload, /requestedEmail/)
assert.match(preload, /phone=COALESCE\(phone,\$2\)/)
assert.doesNotMatch(preload, /sms\/send/)

console.log('ELISEI 5.13.8 historical call verification regression: OK')
