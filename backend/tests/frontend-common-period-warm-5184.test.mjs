import assert from 'node:assert/strict'
import fs from 'node:fs'

const page = fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx',import.meta.url),'utf8')
const api = fs.readFileSync(new URL('../../src/lib/api.js',import.meta.url),'utf8')
const server = fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')

assert.match(page,/const warmCommonAnalyticsPeriods = async/,'dashboard must warm common periods after the foreground result')
assert.match(page,/\['yesterday','7','30','month'\]/,'warm set must cover the four home presets')
assert.match(page,/wbApi\.core\(connectionId,\{ from:period\.from,to:period\.to,warm:true \}\)/,'warming must be explicitly marked as background work')
assert.match(page,/void warmCommonAnalyticsPeriods\(connectionId,period\)/,'warming must begin after a successful primary period')
assert.match(api,/params\?\.warm \? \{ warm:'1' \}/,'API client must forward the warm marker')
assert.match(server,/req\.query\?\.warm[^\n]+return next\(\)/,'warm requests must not pause the WB sync worker')

console.log('frontend common period warm 5.18.4: OK')
