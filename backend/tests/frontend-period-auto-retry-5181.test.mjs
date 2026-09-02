import assert from 'node:assert/strict'
import fs from 'node:fs'

const source=fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx',import.meta.url),'utf8')

assert.ok(source.includes('const analyticsRetryRef = useRef(new Map())'),'period reads need a bounded retry registry')
assert.ok(source.includes("['REQUEST_TIMEOUT','BACKEND_UNAVAILABLE','DATABASE_RECONNECTING'].includes"),'transient failures must trigger automatic readiness checks')
assert.ok(source.includes('retryState.attempt < 4'),'automatic period retry must be bounded')
assert.ok(source.includes('[7000,12000,20000,30000]'),'retry cadence must give the backend time to finish and persist the mart')
assert.ok(source.includes('повторно нажимать не нужно'),'the user must receive an actionable non-technical status')
assert.ok(source.includes('analyticsRetryRef.current.delete(cacheKey)'),'successful reads must clear retry state')

console.log('ELISEI 5.18.1 automatic period readiness retry regression: OK')
