import fs from 'node:fs'

// ELISEI 5.19.10 — WB goods-labeling accepts at most 31 calendar days.
// Legacy sync state can contain a much wider period; clamp it immediately before request.
const serverUrl = new URL('./src/server.js', import.meta.url)
let source = fs.readFileSync(serverUrl, 'utf8')

const before = `  const period = definition.periodDays ? (state?.metadata?.period || reportPeriod(definition.periodDays)) : null\n  const syncId = String(state?.metadata?.syncId || crypto.randomUUID())`
const after = `  const requestedPeriod = definition.periodDays ? (state?.metadata?.period || reportPeriod(definition.periodDays)) : null\n  const period = requestedPeriod && definition.periodDays ? (() => {\n    const dateTo=String(requestedPeriod.dateTo || '').slice(0,10)\n    const endMs=Date.parse(\`${'${dateTo}'}T00:00:00.000Z\`)\n    if (!Number.isFinite(endMs)) return reportPeriod(definition.periodDays)\n    const maxDays=Math.max(1,Number(definition.periodDays || 31))\n    const earliestFrom=new Date(endMs-(maxDays-1)*86400000).toISOString().slice(0,10)\n    const originalFrom=String(requestedPeriod.dateFrom || earliestFrom).slice(0,10)\n    const dateFrom=originalFrom < earliestFrom ? earliestFrom : originalFrom\n    const actualDays=Math.floor((endMs-Date.parse(\`${'${dateFrom}'}T00:00:00.000Z\`))/86400000)+1\n    return {\n      ...requestedPeriod,dateFrom,dateTo,days:Math.max(1,actualDays),\n      limited:dateFrom !== originalFrom || Boolean(requestedPeriod.limited),\n      requestedFrom:requestedPeriod.requestedFrom || originalFrom,\n      requestedTo:requestedPeriod.requestedTo || dateTo,\n    }\n  })() : requestedPeriod\n  const syncId = String(state?.metadata?.syncId || crypto.randomUUID())`

if (!source.includes(after)) {
  if (!source.includes(before)) throw new Error('ELISEI 5.19.10 labelingRetention period marker not found')
  source = source.replace(before, after)
}

fs.writeFileSync(serverUrl, source)
console.log('ELISEI 5.19.10 labelingRetention 31-day clamp applied')
