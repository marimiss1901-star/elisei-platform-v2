import fs from 'node:fs'

// ELISEI 5.19.4 — finance-first global heavy lane.
// The memory guard intentionally allows only one heavy WB stage per worker cycle.
// Smart Scheduler already orders stages inside each API group, but winners from
// different groups used to be processed in database update order. That allowed
// products/paidStorage/stockHistory to consume the single heavy slot just before
// an already-due finance continuation. Sort the cross-group due list so finance
// and its direct financial dependants get first access to the heavy slot.

const serverFile='src/server.js'
let source=fs.readFileSync(serverFile,'utf8')

const before=`  let memoryHeavyProcessed=false\n  for (const row of due) {`
const after=`  // Finance-first ordering is only a dispatch preference. Smart Scheduler still\n  // decides the winner inside each WB API group and all WB next_allowed_at windows\n  // remain authoritative. Operational lightweight stages may still run in the\n  // same cycle; only the single heavy memory slot is ordered here.\n  const heavyDispatchRank=stage=>({finance:0,acquiring:1,paidStorage:2,acceptance:3}[String(stage || '')] ?? 20)\n  due.sort((a,b)=>{\n    const heavyA=Object.prototype.hasOwnProperty.call(DAILY_READY_HEAVY_INTERVALS_SECONDS,String(a?.stage || ''))\n    const heavyB=Object.prototype.hasOwnProperty.call(DAILY_READY_HEAVY_INTERVALS_SECONDS,String(b?.stage || ''))\n    if(heavyA && heavyB){\n      const rank=heavyDispatchRank(a?.stage)-heavyDispatchRank(b?.stage)\n      if(rank) return rank\n      return stagePriority(a?.stage)-stagePriority(b?.stage)\n    }\n    return 0\n  })\n  let memoryHeavyProcessed=false\n  for (const row of due) {`

if(source.includes(after)){
  console.log('ELISEI 5.19.4 finance-first night priority already applied')
  process.exit(0)
}
if(!source.includes(before)){
  throw new Error('ELISEI 5.19.4 could not find nightly memory-guard dispatch marker')
}
source=source.replace(before,after)
fs.writeFileSync(serverFile,source)
console.log('ELISEI 5.19.4 finance-first night priority applied')
