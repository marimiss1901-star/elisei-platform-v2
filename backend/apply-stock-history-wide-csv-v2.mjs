import fs from 'node:fs'

const serverFile='src/server.js'
let source=fs.readFileSync(serverFile,'utf8')

if (source.includes("'NmID','nm_id'")) {
  console.log('ELISEI 5.19.18 stock-history identity parser already applied')
  process.exit(0)
}

const replacements = [
  ["['nmID','nmId','nm_id','Артикул WB','Номенклатура']", "['nmID','nmId','NmID','nm_id','Артикул WB','Номенклатура']"],
  ["['vendorCode','supplierArticle','sa_name','Артикул продавца','Артикул поставщика']", "['vendorCode','VendorCode','supplierArticle','sa_name','Артикул продавца','Артикул поставщика']"],
  ["['title','name','Название','Предмет']", "['title','name','Name','Название','Предмет']"],
  ["['warehouseName','warehouse','officeName','Склад','Название склада']", "['warehouseName','warehouse','officeName','OfficeName','Склад','Название склада']"],
  ['expanded.push({...normalized,date,quantity,raw:row,wideCsv:true,wideCsvColumn:key})', 'expanded.push({...normalized,date,quantity,raw:null,wideCsv:true,wideCsvColumn:key})'],
]

for (const [before,after] of replacements) {
  if (!source.includes(before)) throw new Error(`ELISEI 5.19.18 could not find parser fragment: ${before}`)
  source=source.replace(before,after)
}

fs.writeFileSync(serverFile,source)
console.log('ELISEI 5.19.18 stock-history identity parser applied')
