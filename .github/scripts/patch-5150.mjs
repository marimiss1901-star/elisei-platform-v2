import fs from 'node:fs'

const path='backend/src/server.js'
let source=fs.readFileSync(path,'utf8')

const replacements=[
  [
    "const recoveryOrder = new Map([['orders',0],['sales',1],['advertising',2]])",
    "const recoveryOrder = new Map([['orders',0],['sales',1]])",
  ],
  [
    "smartSchedulerWinners.set(connectionId,String(winner.stage))",
    "smartSchedulerWinners.set(`${connectionId}:${schedulerGroup(winner.stage)}`,String(winner.stage))",
  ],
  [
    "const winner = smartSchedulerWinners.get(String(connectionId))\n  return winner === String(stage)",
    "const winner = smartSchedulerWinners.get(`${String(connectionId)}:${schedulerGroup(stage)}`)\n  return winner === String(stage)",
  ],
  [
    "// затем выбираем ровно один приоритетный due-этап на каждый кабинет.\n    // Это исключает cold-start burst: разные lanes больше не стреляют по WB\n    // одновременно от имени одного продавца.",
    "// затем выбираем по одному due-этапу на каждую независимую WB API-группу.\n    // Один токен может обслуживать несколько категорий: независимые группы идут\n    // параллельно, а внутри одной группы сохраняются приоритет и rate-limit окна.",
  ],
]

for(const [from,to] of replacements){
  if(source.includes(to)) continue
  const matches=source.split(from).length-1
  if(matches!==1) throw new Error(`Expected exactly one server.js marker, found ${matches}: ${from.slice(0,80)}`)
  source=source.replace(from,to)
}

if(!source.includes("smartSchedulerWinners.get(`${String(connectionId)}:${schedulerGroup(stage)}`)")) {
  throw new Error('Grouped scheduler guard was not applied')
}
fs.writeFileSync(path,source)
console.log('ELISEI 5.15.0 server scheduler source patch applied')
