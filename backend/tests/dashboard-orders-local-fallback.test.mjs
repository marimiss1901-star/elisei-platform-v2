import assert from 'node:assert/strict'
import fs from 'node:fs'

const patch=fs.readFileSync(new URL('../../apply-dashboard-orders-local-fallback.mjs',import.meta.url),'utf8')

assert.ok(patch.includes("snapshotOrdersState !== 'ready'"),'fallback must only override a non-ready Daily Ready orders snapshot')
assert.ok(patch.includes('coreOrdersSelectedRows > 0'),'fallback must require actual selected order rows for the chosen day')
assert.ok(patch.includes('analyticsCore?.summary?.orders != null'),'fallback must require a concrete local orders value')
assert.ok(patch.includes('ordersMetricValue = ordersFromFreshCore ? analyticsCore.summary.orders : businessSummary.orders'),'Main must use the confirmed local core value when the stored snapshot lags')
assert.ok(patch.includes('&& !ordersFromFreshCore'),'a confirmed local row must clear the stale partial UI state')
assert.ok(!patch.includes('coreOrdersSelectedRows >= 0'),'zero selected rows must never be promoted into a false confirmed zero')

console.log('dashboard orders local fallback: ok')
