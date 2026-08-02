import assert from 'node:assert/strict'
import { hydrateStreamData } from '../src/wb/stream-store.js'

const snapshots = {
  products:{ id:1, endpoint:'cards', normalized_payload:[{ nmID:1 }, { nmID:2 }], raw_payload:null, validation:{}, created_at:'2026-08-02T10:00:00Z' },
  orders:{ id:2, endpoint:'orders', normalized_payload:null, raw_payload:[{ srid:'o1' }, { srid:'o2' }], validation:{}, created_at:'2026-08-02T10:01:00Z' },
  sales:{ id:3, endpoint:'sales', normalized_payload:null, raw_payload:[{ srid:'s1' }], validation:{}, created_at:'2026-08-02T10:02:00Z' },
  stocks:{ id:4, endpoint:'stocks', normalized_payload:[{ nmID:1, quantity:10 }], raw_payload:null, validation:{ totalQuantity:10 }, created_at:'2026-08-02T10:03:00Z' },
  advertising:{ id:5, endpoint:'advert', normalized_payload:{ campaigns:[{ advertId:9 }], totals:{ spend:100 } }, raw_payload:null, validation:{}, created_at:'2026-08-02T10:04:00Z' },
}
const saved = []
const db = {
  async query(sql, params = []) {
    if (sql.includes('FROM wb_stream_data') && sql.includes('WHERE connection_id=$1') && !sql.includes('INSERT')) return { rows:[] }
    if (sql.includes('FROM wb_api_snapshots')) return { rows:snapshots[params[1]] ? [snapshots[params[1]]] : [] }
    if (sql.includes('INSERT INTO wb_stream_data')) {
      saved.push({ stream:params[1], payload:JSON.parse(params[2]), rowCount:params[3], source:params[6] })
      return { rows:[{ connection_id:params[0], stream:params[1], row_count:params[3], checksum:params[4], metadata:JSON.parse(params[5]), source:params[6], updated_at:'2026-08-02T10:05:00Z' }] }
    }
    throw new Error(`Unexpected SQL: ${sql.slice(0,80)}`)
  },
}

const result = await hydrateStreamData(db, '00000000-0000-4000-8000-000000000001', {}, { repair:true })
assert.equal(result.data.products.length, 2)
assert.equal(result.data.orders.length, 2)
assert.equal(result.data.sales.length, 1)
assert.equal(result.data.stocks.length, 1)
assert.equal(result.data.advertising.campaigns.length, 1)
assert.equal(result.recovered.length, 5)
assert.equal(saved.length, 5)
assert.ok(saved.every(item => item.source === 'snapshot_recovery'))
console.log('WB stream recovery tests: OK')
