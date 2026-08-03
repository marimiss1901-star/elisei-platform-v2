import assert from 'node:assert/strict'
import fs from 'node:fs'
import { saveStreamItemBatch } from '../src/wb/stream-store.js'

const calls = []
const db = {
  async query(sql, params) {
    calls.push({ sql, params })
    return { rows: [] }
  },
}
const rows = Array.from({ length: 620 }, (_, index) => ({ rrdId:index + 1, value:`row-${index + 1}` }))
const saved = await saveStreamItemBatch(db, {
  connectionId:'00000000-0000-0000-0000-000000000001',
  stream:'finance',
  syncId:'00000000-0000-0000-0000-000000000002',
  rows,
  keyOf:row=>`finance:rrd:${row.rrdId}`,
  batchSize:250,
})
assert.equal(saved,620)
assert.equal(calls.length,3)
assert.equal(JSON.parse(calls[0].params[3]).length,250)
assert.equal(JSON.parse(calls[2].params[3]).length,120)

const source = fs.readFileSync(new URL('../src/server.js', import.meta.url),'utf8')
for (const marker of [
  'HEAVY_PAGE_LIMIT',
  'HEAVY_DB_BATCH_SIZE',
  'advancePagedFinanceTask',
  'aggregatePersistedHeavyRows',
  'saveStreamItemBatch',
  "chunkDays:2",
  "chunkDays:7",
  "storage:'wb_stream_items'",
  "status:'queued'",
  'memorySafe:true',
]) assert.ok(source.includes(marker),`server.js must contain ${marker}`)
assert.ok(!source.includes('const limit = 100000\n  for (let page = 0; page < 3'), 'old in-memory finance accumulator removed')

console.log('WB memory-safe sync tests passed')
