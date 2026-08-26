import fs from 'node:fs'

const file='src/server.js'
let source=fs.readFileSync(file,'utf8')

function replaceOnce(oldText,newText,label){
  if(source.includes(newText)) return
  if(!source.includes(oldText)) throw new Error(`Current stocks/wake patch: ${label} target not found`)
  source=source.replace(oldText,newText)
}

replaceOnce(
"import elDecisionEngine from './services/elDecisionEngine.cjs'",
"import elDecisionEngine from './services/elDecisionEngine.cjs'\nimport { loadCurrentWbStocks } from './wb/current-stocks.js'",
'current stocks import')

replaceOnce(
"stocks: { label: 'Остатки FBO', scope: 'analytics' }",
"stocks: { label: 'Склад WB', scope: 'analytics' }",
'WB consolidated stock label')

// FBS deliberately stays on the Marketplace API reader already present in
// server.js: GET /api/v3/warehouses + POST /api/v3/stocks/{warehouseId}.
// WB documents this stock family as Marketplace-token data. Do not replace it
// with Seller Analytics seller-warehouses, which can require a different token.

const wbPattern=/async function advanceWarehouseRemainsTask\(token, state, \{ deadlineAt = 0 \} = \{\}\) \{[\s\S]*?\n\}\n\n(?=async function|function|const )/
if(!source.includes("return loadCurrentWbStocks(token, { request:wbFetch, deadlineAt })")){
  const match=source.match(wbPattern)
  if(!match) throw new Error('Current stocks/wake patch: advanceWarehouseRemainsTask function not found')
  source=source.replace(wbPattern,`async function advanceWarehouseRemainsTask(token, _state, { deadlineAt = 0 } = {}) {
  return loadCurrentWbStocks(token, { request:wbFetch, deadlineAt })
}

`)
}

replaceOnce(
"app.get('/health', async (_req, res) => {\n  res.json({",
"app.get('/health', async (req, res) => {\n  const dailyReadyWake = String(req.query?.wake || '') === 'daily-ready'\n  if (dailyReadyWake && databaseState.ready) {\n    setTimeout(() => kickBackgroundWorkers('daily-ready-wake'), 100).unref?.()\n  }\n  res.json({\n    wakeAccepted:dailyReadyWake && databaseState.ready,",
'explicit Daily Ready wake')

fs.writeFileSync(file,source)
console.log('Current WB stocks and explicit Daily Ready wake applied')
