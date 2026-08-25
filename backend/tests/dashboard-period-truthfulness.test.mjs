import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const here=path.dirname(fileURLToPath(import.meta.url))
const backendRoot=path.resolve(here,'..')
const repoRoot=path.resolve(backendRoot,'..')

const periodPatch=fs.readFileSync(path.join(backendRoot,'apply-period-coverage-fix.mjs'),'utf8')
const weekPatch=fs.readFileSync(path.join(repoRoot,'apply-completed-week-period.mjs'),'utf8')
const frontendPackage=fs.readFileSync(path.join(repoRoot,'package.json'),'utf8')

assert.ok(periodPatch.includes("orders: data?.__periodFiltered ? (periodCoverageConfirms('orders') || orders.length > 0)"),'Filtered orders must not inherit a stale global available flag')
assert.ok(periodPatch.includes("sales: data?.__periodFiltered ? (periodCoverageConfirms('sales') || salesRows.length > 0)"),'Filtered sales must be period-aware')
assert.ok(periodPatch.includes("finance: data?.__periodFiltered ? (periodCoverageConfirms('finance') || financeRows.length > 0)"),'Filtered finance must be period-aware')
assert.ok(weekPatch.includes("const completedTo = addDays(to,-1)"),'Seven-day preset must end yesterday')
assert.ok(weekPatch.includes("from:addDays(completedTo,-6), to:completedTo"),'Seven-day preset must contain seven completed days')
assert.ok(frontendPackage.includes('apply-completed-week-period.mjs'),'Completed-week patch must run in frontend prebuild')

console.log('Dashboard period truthfulness regression passed')
