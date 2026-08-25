import fs from 'node:fs'

function replaceOnce(source, from, to, label) {
  if (source.includes(to)) return source
  const count = source.split(from).length - 1
  if (count !== 1) throw new Error(`${label}: expected one marker, found ${count}`)
  return source.replace(from, to)
}

const dailyPath='backend/src/wb/daily-ready.js'
let daily=fs.readFileSync(dailyPath,'utf8')
daily=replaceOnce(daily,
`export const DAILY_READY_VERSION = 6`,
`export const DAILY_READY_VERSION = 7`,
'daily ready version')

daily=replaceOnce(daily,
`  documents: 24 * 60 * 60,
})`,
`  documents: 24 * 60 * 60,

  // Secondary nightly layer. These reports are valuable for morning analytics
  // but do not need to compete with live orders/sales during the seller day.
  // Finance remains first in object order, so P&L readiness is prioritized.
  measurementPenalties: 24 * 60 * 60,
  deductionsReport: 24 * 60 * 60,
  warehouseMeasurements: 24 * 60 * 60,
  antifraudRetention: 24 * 60 * 60,
  labelingRetention: 24 * 60 * 60,
  goodsReturns: 24 * 60 * 60,
  tariffs: 24 * 60 * 60,
  funnel: 24 * 60 * 60,
  searchQueries: 24 * 60 * 60,
  stockHistory: 24 * 60 * 60,
})`,
'extended nightly stages')
fs.writeFileSync(dailyPath,daily)

for (const [path,version] of [['package.json','5.15.8'],['backend/package.json','2.27.8']]) {
  const data=JSON.parse(fs.readFileSync(path,'utf8'))
  data.version=version
  fs.writeFileSync(path,JSON.stringify(data,null,2)+'\n')
}

const testPath='backend/tests/wb-nightly-ready-5158.test.mjs'
fs.writeFileSync(testPath,`import assert from 'node:assert/strict'\nimport { DAILY_READY_HEAVY_INTERVALS_SECONDS, dailyHeavyStagePlan } from '../src/wb/daily-ready.js'\n\nconst expected=[\n  'finance','acquiring','paidStorage','acceptance','documents',\n  'measurementPenalties','deductionsReport','warehouseMeasurements','antifraudRetention','labelingRetention',\n  'goodsReturns','tariffs','funnel','searchQueries','stockHistory',\n]\nfor(const stage of expected){\n  assert.equal(DAILY_READY_HEAVY_INTERVALS_SECONDS[stage], stage==='finance'||stage==='acquiring' ? 20*60*60 : 24*60*60, stage+' must have nightly cadence')\n}\n\nconst old='2026-08-23T01:00:00.000Z'\nconst states=expected.map(stage=>({stage,status:'success',last_success_at:old,next_allowed_at:null}))\nconst plan=dailyHeavyStagePlan({states,now:new Date('2026-08-25T00:30:00.000Z').getTime(),timeZone:'Europe/Moscow'})\nfor(const stage of expected) assert.ok(plan.includes(stage),stage+' should be eligible overnight when stale')\nassert.ok(plan.indexOf('finance') < plan.indexOf('measurementPenalties'),'finance must remain ahead of secondary nightly reports')\n\nconst daytime=dailyHeavyStagePlan({states,now:new Date('2026-08-25T09:00:00.000Z').getTime(),timeZone:'Europe/Moscow'})\nassert.deepEqual(daytime,[],'fresh heavy jobs must not start during seller daytime')\nconsole.log('ELISEI 5.15.8 Nightly Ready extended layer regression: OK')\n`)

for(const name of fs.readdirSync('backend/tests')){
  if(!name.endsWith('.test.mjs') || name=== 'wb-nightly-ready-5158.test.mjs') continue
  const path=`backend/tests/${name}`
  let s=fs.readFileSync(path,'utf8')
  s=s.replaceAll("frontendPackage.version, '5.15.7'","frontendPackage.version, '5.15.8'")
  s=s.replaceAll("backendPackage.version, '2.27.7'","backendPackage.version, '2.27.8'")
  fs.writeFileSync(path,s)
}
console.log('ELISEI 5.15.8 extended Nightly Ready patch applied')
