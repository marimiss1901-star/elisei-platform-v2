import assert from 'node:assert/strict'
import fs from 'node:fs'

const bootstrap = fs.readFileSync(new URL('../src/bootstrap-business-preload.mjs', import.meta.url), 'utf8')
const scheduler = fs.readFileSync(new URL('../src/wb/smart-scheduler.js', import.meta.url), 'utf8')
const backendPackage = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const frontendPackage = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))

assert.equal(frontendPackage.version, '5.15.9')
assert.equal(backendPackage.version, '2.27.8')
assert.match(backendPackage.scripts.start, /callcheck-auth-preload\.mjs/)
assert.match(backendPackage.scripts.start, /bootstrap-business-preload\.mjs/)

assert.match(bootstrap, /yesterday_and_7_complete_days/)
assert.match(bootstrap, /weekFrom:shiftDate\(yesterday,-6\)/)
assert.match(bootstrap, /MANDATORY_BUSINESS_STAGES = Object\.freeze\(\[\s*'products','orders','sales','finance','advertising'/)
assert.doesNotMatch(bootstrap, /MANDATORY_BUSINESS_STAGES = Object\.freeze\(\[[^\]]*'stocks'/s,'FBO must not block the first dashboard')
assert.match(bootstrap, /bootstrapNonBlocking/)
assert.match(bootstrap, /'sellerStocks','stocks','acquiring','paidStorage','acceptance'/)
assert.match(bootstrap, /bootstrapBusinessPriority/)
assert.match(bootstrap, /business_core/)
assert.match(bootstrap, /history_backfill/)
assert.match(bootstrap, /SAFETY_RELEASE_MS = 10 \* 60 \* 1000/)
assert.match(bootstrap, /financeAvailable/)
assert.match(bootstrap, /GENERATED_REPORT_STAGES = new Set\(\['paidStorage','acceptance'\]\)/)
assert.match(bootstrap, /reportChunks\(stage,range\.weekFrom,range\.weekTo\)/)
assert.match(bootstrap, /delete additions\[key\]/)
assert.match(bootstrap, /'syncId','rrdId','pageNumber','offset','persistedCount'/)
assert.match(bootstrap, /FBO и сверочные отчёты догружаются фоном и не блокируют работу/)
assert.match(bootstrap, /const scheduledAt=new Date\(now\)\.toISOString\(\)/)

assert.match(scheduler, /function bootstrapPriority/)
assert.match(scheduler, /bootstrapBusinessPriority/)
assert.match(scheduler, /explicitA \?\? stagePriority/)
assert.match(scheduler, /schedulerWinnerKey/)

console.log('ELISEI 5.15.9 business-first bootstrap regression: OK')
