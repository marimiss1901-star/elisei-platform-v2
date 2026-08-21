import fs from 'node:fs'

function replaceOnce(source,from,to,label){
  if(source.includes(to)) return source
  const count=source.split(from).length-1
  if(count!==1) throw new Error(`${label}: expected one marker, found ${count}`)
  return source.replace(from,to)
}

const dailyPath='backend/src/wb/daily-ready.js'
let daily=fs.readFileSync(dailyPath,'utf8')
daily=replaceOnce(daily,`export const AUTOMATIC_REFRESH_INTERVALS_SECONDS = Object.freeze({
  orders: 30 * 60,
  sales: 30 * 60,
  stocks: 60 * 60,
  sellerStocks: 60 * 60,
  products: 6 * 60 * 60,
  advertising: 60 * 60,
  reviews: 3 * 60 * 60,
  questions: 3 * 60 * 60,
  chats: 60 * 60,
})`,`export const AUTOMATIC_REFRESH_INTERVALS_SECONDS = Object.freeze({
  // 5.15.1 adaptive base cadence. live-sync.js slows these values further
  // overnight and uses webhook events as a reason to poll less, not more.
  orders: 30 * 60,
  sales: 30 * 60,
  stocks: 60 * 60,
  sellerStocks: 30 * 60,
  products: 6 * 60 * 60,
  advertising: 30 * 60,
  reviews: 60 * 60,
  questions: 60 * 60,
  chats: 15 * 60,
})`,'daily cadence')
fs.writeFileSync(dailyPath,daily)

const serverPath='backend/src/server.js'
let server=fs.readFileSync(serverPath,'utf8')
const policyMatches=server.split("'automaticPolicyVersion',1").length-1
if(policyMatches===2) server=server.replaceAll("'automaticPolicyVersion',1","'automaticPolicyVersion',2")
else if(!server.includes("'automaticPolicyVersion',2")) throw new Error(`policy version markers: ${policyMatches}`)
server=replaceOnce(server,
  "dueLiveStages({settings:{...(row.settings || {}),enabled:true,intervals:{...AUTOMATIC_REFRESH_INTERVALS_SECONDS}},states,now:Date.now()})",
  "dueLiveStages({settings:{...(row.settings || {}),enabled:true,intervals:{...AUTOMATIC_REFRESH_INTERVALS_SECONDS}},states,now:Date.now(),timeZone:dailyReadyTimezone})",
  'live cadence timezone')
server=replaceOnce(server,
  'automaticPolicyVersion:1})])',
  'automaticPolicyVersion:2})])',
  'persisted automatic policy version')
fs.writeFileSync(serverPath,server)

console.log('ELISEI 5.15.1 adaptive cadence source patch applied')
