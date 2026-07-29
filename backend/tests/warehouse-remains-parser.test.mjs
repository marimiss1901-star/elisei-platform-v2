import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const serverPath = path.resolve(here, '../src/server.js')
const source = fs.readFileSync(serverPath, 'utf8')

function extractFunction(name) {
  const patterns = [`function ${name}(`, `async function ${name}(`]
  let start = -1
  for (const pattern of patterns) {
    start = source.indexOf(pattern)
    if (start >= 0) break
  }
  if (start < 0) throw new Error(`Function ${name} not found`)
  const openParen = source.indexOf('(', start)
  let parenDepth = 0
  let brace = -1
  let paramQuote = null
  let paramEscaped = false
  for (let i = openParen; i < source.length; i += 1) {
    const char = source[i]
    if (paramQuote) {
      if (paramEscaped) paramEscaped = false
      else if (char === '\\') paramEscaped = true
      else if (char === paramQuote) paramQuote = null
      continue
    }
    if (char === '"' || char === "'" || char === '`') { paramQuote = char; continue }
    if (char === '(') parenDepth += 1
    else if (char === ')') {
      parenDepth -= 1
      if (parenDepth === 0) {
        brace = source.indexOf('{', i)
        break
      }
    }
  }
  if (brace < 0) throw new Error(`Function ${name} body not found`)
  let depth = 0
  let quote = null
  let escaped = false
  for (let i = brace; i < source.length; i += 1) {
    const char = source[i]
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue }
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`Function ${name} is not balanced`)
}

const names = [
  'firstNumber','cleanIdentity','cleanNumericIdentity','cleanVendorIdentity','uniqueIdentities',
  'productNmIds','productVendorCodes','productChrtIds','productBarcodes','firstDefined','warehouseIdentitySources',
  'warehouseArrayFrom','looksLikeWarehouseRemainsItem','extractWarehouseRemainsItems',
  'describeWarehouseRemainsPayload','normalizeWarehouseRemains','stockIdentityCounts','buildStockMeta',
  'validateWarehouseRemainsSnapshot',
]
const script = [
  "const STOCK_DATA_SCHEMA_VERSION = 4; const STOCK_DATA_SOURCE = 'wb_warehouse_remains';",
  ...names.map(extractFunction),
  'globalThis.__api = { normalizeWarehouseRemains, stockIdentityCounts, buildStockMeta, validateWarehouseRemainsSnapshot };',
].join('\n\n')
const sandbox = { console }
vm.createContext(sandbox)
vm.runInContext(script, sandbox)
const { normalizeWarehouseRemains, stockIdentityCounts, buildStockMeta, validateWarehouseRemainsSnapshot } = sandbox.__api

const official = [
  {
    brand:'Wonderful', subjectName:'Фотоальбомы', vendorCode:'41058/прозрачный', nmId:183804172,
    barcode:'2037031652319', techSize:'0', warehouses:[
      { warehouseName:'Рязань', quantity:4148 },
      { warehouseName:'В пути до получателей', quantity:20 },
      { warehouseName:'Екатеринбург', quantity:2421 },
      { warehouseName:'Всего находится на складах', quantity:6569 },
    ],
  },
]
let rows = normalizeWarehouseRemains(official)
assert.equal(rows.length, 2)
assert.equal(rows.reduce((s, r) => s + r.quantity, 0), 6569)
assert.equal(rows[0].nmId, 183804172)
assert.equal(rows[0].vendorCode, '41058/прозрачный')
assert.equal(rows[0].barcode, '2037031652319')
{ const counts = stockIdentityCounts(rows); assert.equal(counts.nmIds,1); assert.equal(counts.barcodes,1); assert.equal(counts.vendorCodes,1) }

rows = normalizeWarehouseRemains({ data: official })
assert.equal(rows.length, 2)
assert.equal(rows[1].warehouseName, 'Екатеринбург')

rows = normalizeWarehouseRemains({ result: { items: [{
  product: { nm_id:'991122', vendor_code:'SKU-77', bar_code:'4600000000001', tech_size:'42' },
  warehouse_remains:[{ warehouse_name:'Коледино', available_quantity:8 }],
}] } })
assert.equal(rows.length, 1)
assert.equal(String(rows[0].nmId), '991122')
assert.equal(rows[0].vendorCode, 'SKU-77')
assert.equal(rows[0].barcode, '4600000000001')
assert.equal(rows[0].quantity, 8)

rows = normalizeWarehouseRemains([{ nmID:555, supplierArticle:'ABC', sku:'123', warehouseName:'Тула', quantity:11 }])
assert.equal(rows.length, 1)
assert.equal(rows[0].quantity, 11)
assert.equal(rows[0].vendorCode, 'ABC')

const meta = buildStockMeta(normalizeWarehouseRemains(official), { taskId:'task-1' })
assert.equal(meta.totalQuantity, 6569)
assert.equal(meta.products, 1)
assert.equal(meta.barcodes, 1)
assert.doesNotThrow(() => validateWarehouseRemainsSnapshot(normalizeWarehouseRemains(official), meta, official))

const broken = [{ warehouseName:'Рязань', quantity:100 }]
const brokenMeta = buildStockMeta(broken)
assert.throws(() => validateWarehouseRemainsSnapshot(broken, brokenMeta, broken), /идентификаторы товаров не распознаны/)

console.log('warehouse-remains parser tests: OK')
