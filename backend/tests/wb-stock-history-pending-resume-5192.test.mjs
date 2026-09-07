import assert from 'node:assert/strict'
import fs from 'node:fs'

const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8')

assert.ok(
  server.includes("AND (s.status IN ('rate_limited','queued','retry_scheduled') OR (s.stage='stockHistory' AND s.status='pending'))"),
  'deferred worker must resume pending stockHistory reports without resetting their taskId',
)

assert.ok(
  server.includes("WHERE s.stage='stocks' AND s.status IN ('pending','rate_limited','queued','retry_scheduled')"),
  'ordinary WB stock report pending lane must remain intact',
)

assert.ok(
  server.includes("WHERE s.stage IN ('paidStorage','acceptance')") && server.includes("AND s.status IN ('pending','queued','rate_limited','retry_scheduled')"),
  'generated paid-storage/acceptance report pending lane must remain intact',
)

console.log('ELISEI 5.19.2 pending stockHistory resume regression: OK')
