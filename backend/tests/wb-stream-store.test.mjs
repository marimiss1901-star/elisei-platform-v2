import assert from 'node:assert/strict'
import {
  normalizeStreamPayload,
  snapshotPayload,
  streamCount,
} from '../src/wb/stream-store.js'

assert.deepEqual(normalizeStreamPayload('orders', null), [])
assert.equal(streamCount('orders', [{ srid:'1' }, { srid:'2' }]), 2)
assert.equal(streamCount('advertising', { campaigns:[{ advertId:1 }] }), 1)
assert.deepEqual(snapshotPayload('sales', { normalized_payload:null, raw_payload:[{ srid:'s1' }] }), [{ srid:'s1' }])
assert.deepEqual(snapshotPayload('products', { normalized_payload:[{ nmID:7 }], raw_payload:[] }), [{ nmID:7 }])
assert.equal(snapshotPayload('advertising', { normalized_payload:null, raw_payload:{ campaigns:[] } }), null)
console.log('WB stream store tests: OK')
