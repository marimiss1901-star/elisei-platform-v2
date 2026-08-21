import assert from 'node:assert/strict'
import fs from 'node:fs'
import { rateLimitHeaderSeconds,wbRateWindowDelaySeconds } from '../src/wb/rate-window.js'

function response(status,headers={}){
  const map=new Map(Object.entries(headers).map(([key,value])=>[key.toLowerCase(),String(value)]))
  return {status,ok:status>=200&&status<300,headers:{get(name){return map.get(String(name).toLowerCase()) ?? null}}}
}

const now=Date.parse('2026-08-21T14:00:00Z')
assert.equal(rateLimitHeaderSeconds('2',{now}),2)
assert.equal(rateLimitHeaderSeconds('Fri, 21 Aug 2026 14:00:15 GMT',{now,allowHttpDate:true}),15)

// Successful requests must not poison the next live refresh with the full burst reset.
assert.equal(wbRateWindowDelaySeconds(response(200,{
  'x-ratelimit-remaining':'0','x-ratelimit-reset':'2520',
}),{now}),0)

// A real 429 follows WB retry guidance.
assert.equal(wbRateWindowDelaySeconds(response(429,{
  'x-ratelimit-retry':'2','x-ratelimit-reset':'29',
}),{now}),2)
assert.equal(wbRateWindowDelaySeconds(response(429,{
  'x-ratelimit-reset':'29',
}),{now}),29)
assert.equal(wbRateWindowDelaySeconds(response(429,{
  'retry-after':'Fri, 21 Aug 2026 14:00:15 GMT',
}),{now}),15)

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
assert.match(server,/wbRateWindowDelaySeconds\(response\)/)
assert.match(server,/recoverLegacyRuntimeRateWindows/)
assert.match(server,/runtimeWindowMigration/)
assert.match(server,/metadata->'scheduler'->>'reason',''\)='preflight_window'/)
assert.match(server,/await recoverLegacyRuntimeRateWindows\(\)/)

console.log('ELISEI 5.15.2 WB rate-window regression: OK')
