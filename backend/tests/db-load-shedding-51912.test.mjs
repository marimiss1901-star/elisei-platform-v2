import assert from 'node:assert/strict'
import fs from 'node:fs'

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
const page=fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx',import.meta.url),'utf8')
const backendPkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'))
const frontendPkg=JSON.parse(fs.readFileSync(new URL('../../package.json',import.meta.url),'utf8'))

assert.match(server,/kickBackgroundWorkers\('interval'\)[\s\S]*\}, 60000\)/,
  'heavy WB background scheduler must wake at most once per minute on the low-tier DB')
assert.doesNotMatch(server,/kickBackgroundWorkers\('interval'\)[\s\S]{0,180}\}, 30000\)/,
  'legacy 30-second heavy scheduler interval must be removed')
assert.match(page,/if \(shouldReload\) await loadDailyReady\(connectionId\)[\s\S]{0,180}\}, 45000\)/,
  'frontend WB status polling must be reduced to 45 seconds')
assert.ok(backendPkg.scripts.prestart.includes('apply-db-load-shedding.mjs'))
assert.ok(backendPkg.scripts.pretest.includes('apply-db-load-shedding.mjs'))
assert.ok(frontendPkg.scripts.prebuild.includes('apply-db-load-shedding-ui.mjs'))
assert.equal(frontendPkg.version,'5.15.9','canonical frontend package version guard must remain unchanged')
assert.equal(backendPkg.dependencies.cors,'^2.8.5','unrelated dependency must remain unchanged')

console.log('ELISEI 5.19.12 DB load shedding regression: OK')
