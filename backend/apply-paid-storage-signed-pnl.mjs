import fs from 'node:fs'

// ELISEI 5.19.13 — paid-storage reversals must keep their sign.
// WB sends negative warehousePrice rows for storage reversals. Previous code
// applied Math.abs() at several layers, turning reversals into extra expense.

const serverUrl = new URL('./src/server.js', import.meta.url)
const ledgerUrl = new URL('./src/wb/finance-ledger.js', import.meta.url)
const storageLedgerUrl = new URL('./src/wb/storage-ledger.js', import.meta.url)
let server = fs.readFileSync(serverUrl,'utf8')
let ledger = fs.readFileSync(ledgerUrl,'utf8')
let storageLedger = fs.readFileSync(storageLedgerUrl,'utf8')

function replaceOnce(source,before,after,label){
  if(source.includes(after)) return source
  if(!source.includes(before)) throw new Error(`ELISEI 5.19.13 signed storage: ${label} marker not found`)
  return source.replace(before,after)
}

ledger = replaceOnce(
  ledger,
  `  if (stream === 'paidStorage') {\n    const amount = Math.abs(money(row,['warehousePrice','warehouse_price','amount','total'],0))`,
  `  if (stream === 'paidStorage') {\n    const amount = money(row,['warehousePrice','warehouse_price','amount','total'],0)`,
  'finance-ledger paidStorage sign',
)

server = replaceOnce(
  server,
  `  for (const row of paidStorageRows) {\n    const amount = Math.abs(fieldNumber(row,['warehousePrice'],0))`,
  `  for (const row of paidStorageRows) {\n    const amount = fieldNumber(row,['warehousePrice','warehouse_price'],0)`,
  'product detail storage sign',
)

server = replaceOnce(
  server,
  `  const dedicatedStorageTotal = paidStorageRows.reduce((sum,row) => sum + Math.abs(fieldNumber(row,['warehousePrice','warehouse_price'],0)),0)`,
  `  const dedicatedStorageTotal = Math.max(0,paidStorageRows.reduce((sum,row) => sum + fieldNumber(row,['warehousePrice','warehouse_price'],0),0))`,
  'dedicated storage total sign',
)

server = replaceOnce(
  server,
  `      } else if (stream === 'paidStorage') {\n        target.warehousePrice += Math.abs(fieldNumber(row,['warehousePrice','warehouse_price'],0))`,
  `      } else if (stream === 'paidStorage') {\n        target.warehousePrice += fieldNumber(row,['warehousePrice','warehouse_price'],0)`,
  'compact paidStorage aggregation sign',
)

// 5.19.3 creates a durable selected-period storage query at prestart. Use the
// exact WB source value when available, because the ledger amount is rounded to
// cents per row while warehousePrice can have more precision.
server = replaceOnce(
  server,
  `          ABS(amount)::float8 AS "warehousePrice"`,
  `          CASE\n            WHEN jsonb_typeof(source_payload->'warehousePrice')='number'\n              THEN (source_payload->>'warehousePrice')::float8\n            ELSE (-amount)::float8\n          END AS "warehousePrice"`,
  'durable selected-period storage sign',
)

storageLedger = replaceOnce(
  storageLedger,
  `      ROUND(SUM(ABS(amount))::numeric,2)::float8 AS amount,`,
  `      ROUND(SUM(CASE\n        WHEN jsonb_typeof(source_payload->'warehousePrice')='number'\n          THEN (source_payload->>'warehousePrice')::numeric\n        ELSE -amount\n      END)::numeric,2)::float8 AS amount,`,
  'product warehouse breakdown sign',
)

storageLedger = replaceOnce(
  storageLedger,
  `  const safeRows = Array.isArray(rows) ? rows.filter(row => num(row.amount) > 0) : []`,
  `  const safeRows = Array.isArray(rows) ? rows.filter(row => Math.abs(num(row.amount)) > 0.000001) : []`,
  'allow storage reversal credits',
)

fs.writeFileSync(serverUrl,server)
fs.writeFileSync(ledgerUrl,ledger)
fs.writeFileSync(storageLedgerUrl,storageLedger)
console.log('ELISEI 5.19.13 signed paid-storage product P&L applied')
