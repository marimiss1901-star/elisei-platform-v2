import fs from 'node:fs'

// ELISEI 5.19.7 — paid storage rows must have a stable identity across retries.
// WB may return the same report rows in a different order; using the array index
// in the key created duplicate storage charges in wb_stream_items and the finance ledger.

const serverUrl = new URL('./src/server.js', import.meta.url)
let source = fs.readFileSync(serverUrl,'utf8')

const before = `  if (stream === 'paidStorage') {\n    return [stream,row.date || '',row.originalDate || '',row.nmId ?? row.nmID ?? '',row.chrtId ?? '',row.barcode || '',row.warehouse || '',index].join(':')\n  }`
const after = `  if (stream === 'paidStorage') {\n    const stablePayloadHash=crypto.createHash('sha1').update(JSON.stringify(row)).digest('hex').slice(0,20)\n    return [stream,row.date || '',row.originalDate || '',row.nmId ?? row.nmID ?? '',row.chrtId ?? '',row.barcode || '',row.warehouse || '',stablePayloadHash].join(':')\n  }`

if (!source.includes(after)) {
  if (!source.includes(before)) throw new Error('ELISEI 5.19.7 paidStorage key marker not found')
  source = source.replace(before,after)
}

fs.writeFileSync(serverUrl,source)
console.log('ELISEI 5.19.7 paid storage stable key applied')
