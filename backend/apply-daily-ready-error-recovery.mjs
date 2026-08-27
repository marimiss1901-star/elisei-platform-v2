import fs from 'node:fs'

function replaceOnce(source,oldText,newText,label){
  if(source.includes(newText)) return source
  if(!source.includes(oldText)) throw new Error(`Daily Ready error recovery patch: ${label} target not found`)
  return source.replace(oldText,newText)
}

const dailyFile='src/wb/daily-ready.js'
let daily=fs.readFileSync(dailyFile,'utf8')
daily=replaceOnce(
  daily,
  "const blocked = new Set(['running','pending','queued','rate_limited','retry_scheduled','missing_token','token_invalid','forbidden','subscription_required','optional_unavailable','error'])",
  "const blocked = new Set(['running','pending','queued','rate_limited','retry_scheduled','missing_token','token_invalid','forbidden','subscription_required','optional_unavailable'])",
  'daily recovery error unblock',
)
fs.writeFileSync(dailyFile,daily)

const serverFile='src/server.js'
let server=fs.readFileSync(serverFile,'utf8')
server=replaceOnce(
  server,
  "const hardBlockedStatuses = new Set(['running','pending','missing_token','token_invalid','forbidden','subscription_required','optional_unavailable','error'])",
  "const hardBlockedStatuses = new Set(['running','pending','missing_token','token_invalid','forbidden','subscription_required','optional_unavailable'])",
  'server recovery error unblock',
)
server=replaceOnce(
  server,
  "        if(hardBlockedStatuses.has(status)) continue\n        const existingNext=current?.next_allowed_at || current?.nextAllowedAt || null",
  "        if(hardBlockedStatuses.has(status)) continue\n        const lastFailureAt=Math.max(\n          current?.last_attempt_at ? new Date(current.last_attempt_at).getTime() : 0,\n          current?.updated_at ? new Date(current.updated_at).getTime() : 0,\n        )\n        if(status==='error' && lastFailureAt && now-lastFailureAt<5*60*1000) continue\n        const existingNext=current?.next_allowed_at || current?.nextAllowedAt || null",
  'server transient error cooldown',
)
fs.writeFileSync(serverFile,server)

console.log('Daily Ready transient error recovery applied')
