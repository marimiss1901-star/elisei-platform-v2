import fs from 'node:fs'

// ELISEI 5.19.11 — goods-labeling accepts at most 31 days.
// Guard twice: normalize legacy state and overwrite the actual query params
// immediately before wbFetch. This makes a stale 66-day period impossible to send.
const serverUrl = new URL('./src/server.js', import.meta.url)
let source = fs.readFileSync(serverUrl, 'utf8')

const periodBefore = `  const period = definition.periodDays ? (state?.metadata?.period || reportPeriod(definition.periodDays)) : null\n  const syncId = String(state?.metadata?.syncId || crypto.randomUUID())`
const periodAfter = `  const requestedPeriod = definition.periodDays ? (state?.metadata?.period || reportPeriod(definition.periodDays)) : null\n  const period = stage === 'labelingRetention' ? (() => {\n    const requestedTo=String(requestedPeriod?.dateTo || new Date().toISOString().slice(0,10)).slice(0,10)\n    const endMs=Date.parse(\`${'${requestedTo}'}T00:00:00.000Z\`)\n    const safeTo=Number.isFinite(endMs) ? requestedTo : new Date().toISOString().slice(0,10)\n    const safeEndMs=Date.parse(\`${'${safeTo}'}T00:00:00.000Z\`)\n    const safeFrom=new Date(safeEndMs-29*86400000).toISOString().slice(0,10)\n    return {\n      ...(requestedPeriod || {}),dateFrom:safeFrom,dateTo:safeTo,days:30,limited:true,\n      requestedFrom:requestedPeriod?.requestedFrom || requestedPeriod?.dateFrom || safeFrom,\n      requestedTo:requestedPeriod?.requestedTo || requestedPeriod?.dateTo || safeTo,\n      labelingRequestWindowVersion:2,\n    }\n  })() : requestedPeriod\n  const syncId = String(state?.metadata?.syncId || crypto.randomUUID())`

if (!source.includes(periodAfter)) {
  if (!source.includes(periodBefore)) throw new Error('ELISEI 5.19.11 labelingRetention period marker not found')
  source = source.replace(periodBefore, periodAfter)
}

const paramsBefore = `  const params = new URLSearchParams()\n  if (period) { params.set('dateFrom',period.dateFrom); params.set('dateTo',period.dateTo) }`
const paramsAfter = `  const params = new URLSearchParams()\n  if (period) { params.set('dateFrom',period.dateFrom); params.set('dateTo',period.dateTo) }\n  if (stage === 'labelingRetention') {\n    const safeTo=String(period?.dateTo || new Date().toISOString().slice(0,10)).slice(0,10)\n    const safeEndMs=Date.parse(\`${'${safeTo}'}T00:00:00.000Z\`)\n    const safeFrom=new Date(safeEndMs-29*86400000).toISOString().slice(0,10)\n    params.set('dateFrom',safeFrom)\n    params.set('dateTo',safeTo)\n  }`

if (!source.includes(paramsAfter)) {
  if (!source.includes(paramsBefore)) throw new Error('ELISEI 5.19.11 labelingRetention params marker not found')
  source = source.replace(paramsBefore, paramsAfter)
}

fs.writeFileSync(serverUrl, source)
console.log('ELISEI 5.19.11 labelingRetention request-boundary 30-day guard applied')
