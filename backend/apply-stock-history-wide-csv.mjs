import fs from 'node:fs'

const serverFile='src/server.js'
let source=fs.readFileSync(serverFile,'utf8')

if (source.includes('function expandStockHistoryRow(row = {})')) {
  console.log('ELISEI 5.19.16 stock-history wide CSV parser already applied')
  process.exit(0)
}

const anchor=`function normalizeStockHistoryRow(row = {}) {
  const date = firstRowValue(row,['date','dt','reportDate','Дата','День'])
  const quantity = firstRowValue(row,['quantity','stockCount','stocks','stock','остаток','Остаток','Остаток, шт.'])
  return {
    rowType:'daily',
    sourceFile:row.sourceFile || null,
    date:date == null ? null : String(date).slice(0,10),
    nmID:firstRowValue(row,['nmID','nmId','nm_id','Артикул WB','Номенклатура']),
    vendorCode:firstRowValue(row,['vendorCode','supplierArticle','sa_name','Артикул продавца','Артикул поставщика']),
    title:firstRowValue(row,['title','name','Название','Предмет']),
    warehouse:firstRowValue(row,['warehouseName','warehouse','officeName','Склад','Название склада']),
    quantity:quantity == null || Number.isNaN(Number(quantity)) ? null : Number(quantity),
    inWayToClient:Number(firstRowValue(row,['inWayToClient','in_way_to_client','В пути к клиенту']) || 0),
    inWayFromClient:Number(firstRowValue(row,['inWayFromClient','in_way_from_client','В пути от клиента']) || 0),
    raw:row,
  }
}`

const addition=anchor+`

function stockHistoryDateKey(key) {
  const value=String(key || '').trim()
  const iso=value.match(/^(\\d{4})[-/.](\\d{2})[-/.](\\d{2})(?:$|\\s|T)/)
  if (iso) return \`${'${iso[1]}-${iso[2]}-${iso[3]}'}\`
  const ru=value.match(/^(\\d{2})[./-](\\d{2})[./-](\\d{4})(?:$|\\s)/)
  if (ru) return \`${'${ru[3]}-${ru[2]}-${ru[1]}'}\`
  return null
}

function expandStockHistoryRow(row = {}) {
  const normalized=normalizeStockHistoryRow(row)
  if (normalized.date && normalized.quantity != null) return [normalized]
  const expanded=[]
  for (const [key,value] of Object.entries(row || {})) {
    const date=stockHistoryDateKey(key)
    if (!date) continue
    const quantity=Number(String(value ?? '').replace(/\\s/g,'').replace(',','.'))
    if (!Number.isFinite(quantity)) continue
    expanded.push({...normalized,date,quantity,raw:row,wideCsv:true,wideCsvColumn:key})
  }
  return expanded.length ? expanded : [normalized]
}`

if (!source.includes(anchor)) throw new Error('ELISEI 5.19.16 could not find normalizeStockHistoryRow anchor')
source=source.replace(anchor,addition)
const before='const rows = parseZipCsvRows(zip).map(normalizeStockHistoryRow)'
const after='const rows = parseZipCsvRows(zip).flatMap(expandStockHistoryRow)'
if (!source.includes(before)) throw new Error('ELISEI 5.19.16 could not find stock-history normalization call')
source=source.replace(before,after)
fs.writeFileSync(serverFile,source)
console.log('ELISEI 5.19.16 stock-history wide CSV parser applied')
