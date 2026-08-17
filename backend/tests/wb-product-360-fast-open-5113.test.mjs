import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here,'..','..')
const server = fs.readFileSync(path.join(root,'backend','src','server.js'),'utf8')
const dashboard = fs.readFileSync(path.join(root,'src','pages','DashboardPage.jsx'),'utf8')
const api = fs.readFileSync(path.join(root,'src','lib','api.js'),'utf8')
const product360 = fs.readFileSync(path.join(root,'backend','src','wb','product-360.js'),'utf8')

assert.ok(server.includes("const detailLevel = String(req.query.depth || req.query.detail || 'core')"),'SKU 360 endpoint must support lightweight core depth')
assert.ok(server.includes('compactProduct360ExtendedRows(data,stream,product,range,120)'),'core depth must avoid heavy extended DB scans')
assert.ok(server.includes("source:matched.length ? 'wb_stream_items_exact'"),'full depth must use exact identity query')
assert.ok(!server.includes('for (const candidate of candidates.slice(0,5))'),'SKU 360 must not perform repeated payload::text scans for multiple identity candidates')
assert.ok(product360.includes('state?.partial || state?.sampleOnly || state?.truncated'),'compact samples must remain partial, never prove a false per-SKU zero')
assert.ok(api.includes("params?.depth === 'full' ? 25000 : 12000"),'SKU 360 calls must have bounded timeouts')
assert.ok(dashboard.includes("depth:'core'"),'drawer must request lightweight core first')
assert.ok(dashboard.includes("depth:'full'"),'drawer must enrich after core is visible')
assert.ok(dashboard.includes('const product360DataRevision = (value = {}) => JSON.stringify('),'SKU 360 needs data-only refresh revision')
assert.ok(!/analyticsPeriod\.to,product360SyncRevision\]\)/.test(dashboard),'primary SKU 360 request must not be cancelled by scheduler status changes')

console.log('WB 5.11.3 SKU 360 fast-open regression tests passed')
