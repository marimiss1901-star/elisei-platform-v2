import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(here, '../src/server.js'), 'utf8')

assert.match(source, /async function recoverStreamFromSnapshotStrict/)
assert.match(source, /async function queueMissingStreamsForRecovery/)
assert.match(source, /source:'snapshot_strict_recovery'/)
assert.match(source, /recoveryReason:'payload_missing'/)
assert.match(source, /queueMissing:false/)
assert.match(source, /const safeData = \{ \.\.\.\(connection\.data/)
assert.doesNotMatch(source, /if \(persistManifest[^]*JSON\.stringify\(compactConnectionData\(data, hydrated\.sources\)\)/)

console.log('WB self-healing source checks: OK')
