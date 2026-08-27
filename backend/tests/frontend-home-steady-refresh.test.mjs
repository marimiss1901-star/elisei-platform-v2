import assert from 'node:assert/strict'
import fs from 'node:fs'

const patch=fs.readFileSync(new URL('../../apply-home-steady-refresh.mjs',import.meta.url),'utf8')
const frontendPackage=JSON.parse(fs.readFileSync(new URL('../../package.json',import.meta.url),'utf8'))

assert.ok(frontendPackage.scripts.prebuild.includes('apply-home-steady-refresh.mjs'),'steady Main patch must run in production build')
assert.ok(patch.includes("if (shouldReload) await loadDailyReady(connectionId)"),'15-second status poll must refresh only Daily Ready')
assert.ok(!patch.includes("newText,\n\"        if (shouldReload) await Promise.allSettled([loadDailyReady(connectionId),loadConnectionData(connectionId)])\""),'status poll must not requeue the full workspace reader')
assert.ok(patch.includes("connection.connectionId, analyticsPeriod.from, analyticsPeriod.to, analyticsCompare])"),'analytics effect must depend on user-visible period state')
assert.ok(patch.includes('analytics effect must ignore worker heartbeat'),'worker lastSync must not trigger selected-period recalculation')

console.log('ELISEI Steady Home background refresh regression: OK')
