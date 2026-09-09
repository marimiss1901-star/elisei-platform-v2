import fs from 'node:fs'

// ELISEI 5.19.14 — current balance and heavy Finance read window.
// Balance is an account snapshot, not a period metric. Prefer the balance bundled
// with the finance-ledger response (backend serves the dedicated balance stream),
// while the P&L and forPay remain strictly selected-period data.
const dashboardFile='src/pages/DashboardPage.jsx'
let dashboard=fs.readFileSync(dashboardFile,'utf8')

function replaceDashboard(before,after,label){
  if(dashboard.includes(after)) return
  if(!dashboard.includes(before)) throw new Error(`ELISEI 5.19.14 current balance: ${label} marker not found`)
  dashboard=dashboard.replace(before,after)
}

replaceDashboard(
`    const financeBalance = financeAnalyticsPeriodAligned ? analyticsCore?.finance?.balance : null`,
`    const financeBalance = rawFinanceLedger?.balance || analyticsCore?.finance?.balance || null`,
'current balance source')

replaceDashboard(
`delta={financeBalance?.updatedAt ? \`обновлено \${formatLocalDateTime(financeBalance.updatedAt)}\` : financeAnalyticsPeriodAligned ? 'ночной снимок ещё не загружен' : 'ждём актуальное чтение; старый баланс скрыт'}`,
`delta={financeBalance?.updatedAt ? \`обновлено \${formatLocalDateTime(financeBalance.updatedAt)}\` : 'текущий снимок баланса WB ещё не загружен'}`,
'current balance freshness label')

fs.writeFileSync(dashboardFile,dashboard)

const apiFile='src/lib/api.js'
let api=fs.readFileSync(apiFile,'utf8')
const oldFinanceRead=`  financeLedger: (connectionId, params = {}) => {\n    const suffix = querySuffix(params)\n    return cachedRead(\`finance:\${connectionId}:\${suffix || 'overview'}\`, \`/api/wb/finance-ledger/\${encodeURIComponent(connectionId)}\${suffix}\`)\n  },`
const newFinanceRead=`  financeLedger: (connectionId, params = {}) => {\n    const suffix = querySuffix(params)\n    // Finance ledger may need to validate/backfill durable rows before serving.\n    // Do not abort it at the generic 15-second GET limit.\n    return cachedRead(\n      \`finance:\${connectionId}:\${suffix || 'overview'}\`,\n      \`/api/wb/finance-ledger/\${encodeURIComponent(connectionId)}\${suffix}\`,\n      { signal:AbortSignal.timeout(45000) },\n    )\n  },`
if(!api.includes(newFinanceRead)){
  if(!api.includes(oldFinanceRead)) throw new Error('ELISEI 5.19.14 finance read-window marker not found')
  api=api.replace(oldFinanceRead,newFinanceRead)
}
fs.writeFileSync(apiFile,api)
console.log('ELISEI 5.19.14 current balance + Finance 45s read window applied')
