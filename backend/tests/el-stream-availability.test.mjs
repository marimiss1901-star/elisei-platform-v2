import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8')
const start = source.indexOf('function streamDataAvailable')
const end = source.indexOf('function buildCoreAnalytics', start)
assert.ok(start > 0 && end > start, 'streamDataAvailable helper must exist before buildCoreAnalytics')
const helperSource = source.slice(start, end)
const load = new Function(`${helperSource}; return streamDataAvailable`)
const streamDataAvailable = load()

assert.equal(streamDataAvailable({ sales:{ available:false } }, 'sales', 9798), true, 'saved sales rows must override stale false status')
assert.equal(streamDataAvailable({ orders:{ available:false } }, 'orders', 9111), true, 'saved order rows must override stale false status')
assert.equal(streamDataAvailable({ finance:{ available:true } }, 'finance', 0), true, 'successful empty stream remains available')
assert.equal(streamDataAvailable({ reviews:{ available:false } }, 'reviews', 0), false)

console.log('ELISEI El stream availability tests passed')
