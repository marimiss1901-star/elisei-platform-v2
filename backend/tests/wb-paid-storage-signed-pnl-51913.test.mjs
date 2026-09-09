import assert from 'node:assert/strict'
import fs from 'node:fs'
import { normalizeFinanceLedgerRows } from '../src/wb/finance-ledger.js'

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
const ledger=fs.readFileSync(new URL('../src/wb/finance-ledger.js',import.meta.url),'utf8')
const storageLedger=fs.readFileSync(new URL('../src/wb/storage-ledger.js',import.meta.url),'utf8')
const migration=fs.readFileSync(new URL('../migrate-paid-storage-signed-history.mjs',import.meta.url),'utf8')
const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'))

assert.doesNotMatch(ledger,/stream === 'paidStorage'[\s\S]{0,160}Math\.abs\(money\(row,\['warehousePrice'/,
  'paidStorage ledger normalization must preserve WB reversal signs')
assert.match(server,/const amount = fieldNumber\(row,\['warehousePrice','warehouse_price'\],0\)/,
  'product P&L must accumulate signed storage rows')
assert.doesNotMatch(server,/dedicatedStorageTotal = paidStorageRows\.reduce\(\(sum,row\) => sum \+ Math\.abs/,
  'dedicated storage total must not turn reversals into expense')
assert.match(server,/target\.warehousePrice \+= fieldNumber\(row,\['warehousePrice','warehouse_price'\],0\)/,
  'compact paidStorage snapshots must keep signed warehousePrice')
assert.match(server,/jsonb_typeof\(source_payload->'warehousePrice'\)='number'[\s\S]{0,160}source_payload->>'warehousePrice'/,
  'selected-period product storage must read the exact signed WB warehousePrice')
assert.doesNotMatch(storageLedger,/SUM\(ABS\(amount\)\)/,
  'product/warehouse storage breakdown must not sum absolute ledger amounts')
assert.match(storageLedger,/source_payload->>'warehousePrice'/,
  'product/warehouse storage breakdown must use signed WB source values')
assert.match(storageLedger,/Math\.abs\(num\(row\.amount\)\) > 0\.000001/,
  'storage credits must not be discarded from product allocation')

const charge=normalizeFinanceLedgerRows('paidStorage',{warehousePrice:0.16128,nmId:1,date:'2026-09-07'},'charge')[0]
const reversal=normalizeFinanceLedgerRows('paidStorage',{warehousePrice:-0.16128,nmId:1,date:'2026-09-07'},'reversal')[0]
assert.equal(charge.amount,-0.16,'positive WB storage is an expense')
assert.equal(reversal.amount,0.16,'negative WB storage reversal is a credit')
assert.equal(Number((charge.amount+reversal.amount).toFixed(2)),0,'matching storage charge/reversal must cancel')

assert.match(migration,/signedStorageVersion:2/)
assert.match(migration,/SUM\(CASE[\s\S]*warehousePrice/)
assert.match(migration,/DELETE FROM wb_core_marts/,
  'migration must invalidate stale product P&L marts')
assert.ok(pkg.scripts.prestart.includes('apply-paid-storage-signed-pnl.mjs'))
assert.ok(pkg.scripts.pretest.includes('apply-paid-storage-signed-pnl.mjs'))
assert.ok(pkg.scripts.prestart.includes('migrate-paid-storage-signed-history.mjs'))
assert.equal(pkg.version,'2.29.3')

console.log('ELISEI 5.19.13 signed paid-storage product P&L regression: OK')
