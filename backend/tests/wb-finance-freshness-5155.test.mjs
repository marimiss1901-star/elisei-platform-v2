import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stageCanBeQueued } from '../src/wb/daily-ready.js'

const now=Date.parse('2026-08-24T07:00:00Z')
assert.equal(stageCanBeQueued({status:'queued',next_allowed_at:'2026-08-24T06:59:00Z',last_success_at:'2026-08-22T00:00:00Z'},{now,minimumAgeSeconds:20*60*60}),false,
  'an existing queued finance continuation must not be reinitialized as a fresh nightly job')
assert.equal(stageCanBeQueued({status:'success',last_success_at:'2026-08-23T00:00:00Z'},{now,minimumAgeSeconds:20*60*60}),true,
  'an old successful finance stage may start a fresh nightly pass')

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
for(const marker of [
  "trigger:'finance_freshness_repair'",
  "rrdId:'0'",
  'syncId:crypto.randomUUID()',
  'financePeriodTo<targetDate',
  'financePayload?.complete!==true',
  "console.log('[ELISEI 5.15.5] Finance freshness repair queued:'",
  'nightlyReadyVersion:3',
]) assert.ok(server.includes(marker),`server.js must contain ${marker}`)

console.log('ELISEI 5.15.5 finance freshness regression: OK')
