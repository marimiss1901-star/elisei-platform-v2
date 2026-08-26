import fs from 'node:fs'

const file='src/pages/DashboardPage.jsx'
let source=fs.readFileSync(file,'utf8')

source=source.replaceAll("title:'Остатки FBO'","title:'Склад WB'")
source=source.replaceAll("['stocks','Остатки FBO']","['stocks','Склад WB']")

fs.writeFileSync(file,source)
console.log('WB consolidated stock labels applied')
