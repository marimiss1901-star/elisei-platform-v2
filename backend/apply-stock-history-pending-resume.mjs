import fs from 'node:fs'

// ELISEI 5.19.2 — stockHistory report continuation.
// stockHistory uses WB's asynchronous generated-report flow and can therefore
// legitimately remain `pending` while a taskId is being polled. The generic
// deferred worker used to scan only queued/rate-limited/retry states, so an
// already-created stockHistory report could be selected by Smart Scheduler but
// never reach runSyncStage again. Preserve the taskId/progress and let only the
// stockHistory pending state re-enter the deferred worker.

const serverUrl = new URL('./src/server.js', import.meta.url)
let source = fs.readFileSync(serverUrl, 'utf8')

const before = "WHERE s.stage NOT IN ('stocks','paidStorage','acceptance','fbsArchive') AND s.status IN ('rate_limited','queued','retry_scheduled')\n        AND s.next_allowed_at IS NOT NULL AND s.next_allowed_at <= NOW()"
const after = "WHERE s.stage NOT IN ('stocks','paidStorage','acceptance','fbsArchive')\n        AND (s.status IN ('rate_limited','queued','retry_scheduled') OR (s.stage='stockHistory' AND s.status='pending'))\n        AND s.next_allowed_at IS NOT NULL AND s.next_allowed_at <= NOW()"

if (source.includes(after)) {
  console.log('ELISEI 5.19.2 stock history pending-resume already applied')
  process.exit(0)
}

if (!source.includes(before)) {
  throw new Error('ELISEI 5.19.2 could not find deferred-stage SQL marker in server.js')
}

source = source.replace(before, after)
fs.writeFileSync(serverUrl, source)
console.log('ELISEI 5.19.2 stock history pending-resume applied')
