import fs from 'node:fs'

// ELISEI 5.19.15 — generated stock-history watchdog.
// WB can leave an asynchronous STOCK_HISTORY_DAILY_CSV report in PROCESSING
// indefinitely. Polling the same dead report forever keeps the stream stale and
// also consumes Analytics rate-limit budget. After 24 successful status polls,
// abandon the dead report and create a fresh rolling 90-day report with a new
// reportId/syncId. This is deliberately different from HTTP 429/503 handling:
// real WB next_allowed_at windows remain authoritative and are never bypassed.

const serverFile = 'src/server.js'
let source = fs.readFileSync(serverFile,'utf8')

const before = `  const reportStatus = String(report?.status || '').toUpperCase()\n  if (!report || ['NEW','PROCESSING','PENDING','IN_PROGRESS','QUEUED'].includes(reportStatus)) {\n    const pollAttempts = Math.max(0,Number(state?.metadata?.pollAttempts || 0))+1\n    return {\n      pending:true,status:'pending',taskId:reportId,\n      nextAllowedAt:new Date(Date.now()+cooldown).toISOString(),\n      metadata:{...(state?.metadata||{}),period,syncId,reportId,phase:'poll',pollAttempts,reportStatus:reportStatus||'PROCESSING',persistedCount:Number(state?.metadata?.persistedCount||0)},\n    }\n  }`

const after = `  const reportStatus = String(report?.status || '').toUpperCase()\n  if (!report || ['NEW','PROCESSING','PENDING','IN_PROGRESS','QUEUED'].includes(reportStatus)) {\n    const pollAttempts = Math.max(0,Number(state?.metadata?.pollAttempts || 0))+1\n    const staleReportResetCount = Math.max(0,Number(state?.metadata?.staleReportResetCount || 0))\n    if (pollAttempts >= 24 && staleReportResetCount < 3) {\n      const freshPeriod = stockHistoryRetainedPeriod(reportPeriod(90))\n      const nextReportId = crypto.randomUUID()\n      return {\n        pending:true,status:'queued',taskId:nextReportId,\n        nextAllowedAt:new Date(Date.now()+cooldown).toISOString(),\n        metadata:{\n          ...(state?.metadata||{}),\n          period:freshPeriod,syncId:crypto.randomUUID(),reportId:nextReportId,phase:'create',pollAttempts:0,persistedCount:0,\n          reportType:'STOCK_HISTORY_DAILY_CSV',createAttempted:false,\n          staleReportResetCount:staleReportResetCount+1,staleReportResetAt:new Date().toISOString(),\n          staleReportPreviousId:reportId,staleReportPreviousStatus:reportStatus||'PROCESSING',staleReportPreviousPollAttempts:pollAttempts,\n        },\n      }\n    }\n    return {\n      pending:true,status:'pending',taskId:reportId,\n      nextAllowedAt:new Date(Date.now()+cooldown).toISOString(),\n      metadata:{...(state?.metadata||{}),period,syncId,reportId,phase:'poll',pollAttempts,reportStatus:reportStatus||'PROCESSING',persistedCount:Number(state?.metadata?.persistedCount||0)},\n    }\n  }`

if (source.includes('staleReportPreviousPollAttempts:pollAttempts')) {
  console.log('ELISEI 5.19.15 stock-history stale-report watchdog already applied')
  process.exit(0)
}
if (!source.includes(before)) {
  throw new Error('ELISEI 5.19.15 could not find stock-history PROCESSING block')
}
source = source.replace(before,after)
fs.writeFileSync(serverFile,source)
console.log('ELISEI 5.19.15 stock-history stale-report watchdog applied')
