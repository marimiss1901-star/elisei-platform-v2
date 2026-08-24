import assert from 'node:assert/strict'
import fs from 'node:fs'

const dashboard = fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx', import.meta.url), 'utf8')

assert.match(dashboard, /const preferredElName = elSettings\.preferredName \|\| displayName/)
assert.match(dashboard, /const preferredProfileInitial = preferredElName/)
assert.match(dashboard, /<em>\{preferredElName \|\| 'рады вас видеть'\}<\/em>/)
assert.match(dashboard, /title=\{preferredElName \|\| rawName \|\| 'Профиль'\}/)
assert.match(dashboard, />\{preferredProfileInitial\}<\/button>/)
assert.doesNotMatch(dashboard, /<em>\{displayName \|\| 'рады вас видеть'\}<\/em>/)

console.log('ELISEI preferred display name regression: OK')
