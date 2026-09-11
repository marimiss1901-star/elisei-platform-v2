import fs from 'node:fs'

const file='src/wb/stream-store.js'
let source=fs.readFileSync(file,'utf8')

if(source.includes('function normalizeLegacyWideStockHistory(payload)')){
  console.log('ELISEI 5.19.19 stock-history read compatibility already applied')
  process.exit(0)
}

const anchor=`export function normalizeStreamPayload(stream, payload) {
  if (stream === 'advertising') {`

const helper=`function legacyStockHistoryDateKey(key) {
  const value=String(key || '').trim()
  const iso=value.match(/^(\\d{4})[-/.](\\d{2})[-/.](\\d{2})(?:$|\\s|T)/)
  if (iso) return \\`${'${iso[1]}-${iso[2]}-${iso[3]}'}\\`
  const ru=value.match(/^(\\d{2})[./-](\\d{2})[./-](\\d{4})(?:$|\\s)/)
  if (ru) return \\`${'${ru[3]}-${ru[2]}-${ru[1]}'}\\`
  return null
}

function normalizeLegacyWideStockHistory(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload
  const rows=Array.isArray(payload.rows) ? payload.rows : []
  const malformed=payload?.summary?.latestDate === 'Без даты' || rows.some(row=>row?.date == null && row?.raw && typeof row.raw === 'object')
  if (!malformed || !rows.length) return payload

  const expanded=[]
  for (const row of rows) {
    const raw=row?.raw && typeof row.raw === 'object' ? row.raw : null
    if (!raw) {
      expanded.push(row)
      continue
    }
    const base={
      rowType:'daily',
      sourceFile:row.sourceFile || raw.sourceFile || null,
      nmID:raw.NmID ?? raw.nmID ?? raw.nmId ?? row.nmID ?? null,
      vendorCode:raw.VendorCode ?? raw.vendorCode ?? raw.supplierArticle ?? row.vendorCode ?? null,
      title:raw.Name ?? raw.name ?? raw.title ?? row.title ?? null,
      warehouse:raw.OfficeName ?? raw.officeName ?? raw.warehouseName ?? raw.warehouse ?? row.warehouse ?? null,
      inWayToClient:Number(row.inWayToClient || 0),
      inWayFromClient:Number(row.inWayFromClient || 0),
      raw:null,
      legacyWideCsv:true,
    }
    let found=false
    for (const [key,value] of Object.entries(raw)) {
      const date=legacyStockHistoryDateKey(key)
      if (!date) continue
      const quantity=Number(String(value ?? '').replace(/\\s/g,'').replace(',','.'))
      if (!Number.isFinite(quantity)) continue
      expanded.push({...base,date,quantity,wideCsvColumn:key})
      found=true
    }
    if (!found) expanded.push(row)
  }

  const byDate=new Map()
  const products=new Set()
  const warehouses=new Set()
  for (const row of expanded) {
    const date=row?.date || 'Без даты'
    const item=byDate.get(date) || {date,quantity:0,rows:0}
    item.quantity += Number(row?.quantity || 0)
    item.rows += 1
    byDate.set(date,item)
    if (row?.nmID != null && String(row.nmID).trim() !== '') products.add(String(row.nmID))
    if (row?.warehouse) warehouses.add(String(row.warehouse))
  }
  const daily=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date))
  return {
    ...payload,
    rows:expanded,
    totalRows:expanded.length,
    summary:{
      dates:daily.length,
      products:products.size,
      warehouses:warehouses.size,
      latestDate:daily.at(-1)?.date || null,
      latestQuantity:daily.at(-1)?.quantity ?? null,
      daily:daily.slice(-100),
    },
    legacyWideCsvExpanded:true,
  }
}

export function normalizeStreamPayload(stream, payload) {
  if (stream === 'stockHistory' && payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return { rows: [], totalRows: 0, complete: true, ...normalizeLegacyWideStockHistory(payload) }
  }
  if (stream === 'advertising') {`

if(!source.includes(anchor)) throw new Error('ELISEI 5.19.19 could not find normalizeStreamPayload anchor')
source=source.replace(anchor,helper)
fs.writeFileSync(file,source)
console.log('ELISEI 5.19.19 stock-history read compatibility applied')
