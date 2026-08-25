import assert from 'node:assert/strict'
import fs from 'node:fs'

const api = fs.readFileSync(new URL('../../src/lib/api.js', import.meta.url), 'utf8')

assert.match(api, /WB_CONNECTION_CACHE_KEY/)
assert.match(api, /currentWbConnection/)
assert.match(api, /AbortSignal\.timeout\(8000\)/)
assert.match(api, /DATABASE_RECONNECTING/)
assert.match(api, /cached\?\.connected && cached\?\.connectionId/)
assert.match(api, /transientFallback:true/)
assert.match(api, /if \(result\?\.connected && result\?\.connectionId\) writeLocalJson\(WB_CONNECTION_CACHE_KEY, result\)/)
assert.match(api, /else writeLocalJson\(WB_CONNECTION_CACHE_KEY, null\)/)
assert.match(api, /disconnectWb/)
assert.match(api, /writeLocalJson\(WB_CONNECTION_CACHE_KEY, null\)/)
assert.match(api, /currentBusinessSettings/)
assert.match(api, /return \{ settings:cached, transientFallback:true \}/)
assert.match(api, /if \(error\?\.status === 401\) throw error/)

console.log('ELISEI WB connection transient fallback regression: OK')
