import fs from 'node:fs'

const file='src/wb/daily-ready.js'
let source=fs.readFileSync(file,'utf8')

function replaceOnce(oldText,newText,label){
  if(source.includes(newText)) return
  if(!source.includes(oldText)) throw new Error(`Nightly load policy patch: ${label} target not found`)
  source=source.replace(oldText,newText)
}

replaceOnce(
"export const DAILY_READY_OPERATIONAL_RECOVERY_STAGES = Object.freeze(['orders','sales','advertising'])",
"export const DAILY_READY_OPERATIONAL_RECOVERY_STAGES = Object.freeze(['orders'])",
'keep daytime recovery on the single Order Feed source only')

replaceOnce(
`  documents: 24 * 60 * 60,\n\n  // Secondary nightly layer. These reports are valuable for morning analytics`,
`  documents: 24 * 60 * 60,\n\n  // Seller-day policy: these streams are useful by the next morning, but do not\n  // need to compete with Order Feed or stock refreshes during the day.\n  products: 24 * 60 * 60,\n  advertising: 24 * 60 * 60,\n  reviews: 24 * 60 * 60,\n  questions: 24 * 60 * 60,\n  chats: 24 * 60 * 60,\n  financeReports: 24 * 60 * 60,\n  acquiringReports: 24 * 60 * 60,\n  jamSubscription: 24 * 60 * 60,\n\n  // Secondary nightly layer. These reports are valuable for morning analytics`,
'move non-operational streams to nightly')

fs.writeFileSync(file,source)
console.log('Nightly seller-day load policy applied')
