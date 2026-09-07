import assert from 'node:assert/strict'
import { defaultLiveSyncSettings, normalizeLiveSyncSettings, effectiveLiveIntervalSeconds } from '../src/wb/live-sync.js'

const defaults=defaultLiveSyncSettings()
assert.equal(defaults.intervals.orders,3*60*60,'Basic-token orders must not run more often than every 3 hours')
assert.equal(defaults.intervals.sales,2*60*60,'Basic-token sales must not run more often than every 2 hours')

const legacy=normalizeLiveSyncSettings({intervals:{orders:7200,sales:1800}})
assert.equal(legacy.intervals.orders,3*60*60,'legacy 2-hour orders setting must be migrated up to WB Basic limit')
assert.equal(legacy.intervals.sales,2*60*60,'legacy fast sales setting must be migrated up to WB Basic limit')

const activeNow=new Date('2026-09-07T09:00:00+03:00').getTime()
assert.equal(effectiveLiveIntervalSeconds('orders',{settings:legacy,now:activeNow,timeZone:'Europe/Moscow'}),3*60*60)
assert.equal(effectiveLiveIntervalSeconds('sales',{settings:legacy,now:activeNow,timeZone:'Europe/Moscow'}),2*60*60)

console.log('ELISEI 5.18.7 WB Basic Statistics cadence regression: OK')
