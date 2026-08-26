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
"import elDecisionEngine from './services/elDecisionEngine.cjs'\nimport { loadCurrentWbStocks, loadCurrentSellerStocks } from './wb/current-stocks.js'",
'current stocks import')

replaceOnce(
"sellerStocks: { label: 'Остатки FBS', scope: 'marketplace' }",
"sellerStocks: { label: 'Остатки FBS', scope: 'analytics' }",
'FBS analytics scope')

const sellerPattern=/async function loadSellerStocks\(token, products = \[\], \{ deadlineAt = 0 \} = \{\}\) \{[\s\S]*?\n\}\n\n(?=function firstDefined)/
if(!source.includes("return loadCurrentSellerStocks(token, products, { request:wbFetch, deadlineAt })")){
  const match=source.match(sellerPattern)
  if(!match) throw new Error('Current stocks/wake patch: loadSellerStocks function not found')
  source=source.replace(sellerPattern,`async function loadSellerStocks(token, products = [], { deadlineAt = 0 } = {}) {
  return loadCurrentSellerStocks(token, products, { request:wbFetch, deadlineAt })
}

`)
}

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
