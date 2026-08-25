import fs from 'node:fs'

const file='src/server.js'
let source=fs.readFileSync(file,'utf8')

function replaceOnce(oldText,newText,label){
  if(source.includes(newText)) return
  if(!source.includes(oldText)) throw new Error(`Period coverage patch: ${label} target not found`)
  source=source.replace(oldText,newText)
}

replaceOnce(
`  const stageStatus = data?.stageStatus && typeof data.stageStatus === 'object' ? data.stageStatus : {}
  const availability = {
    products: streamDataAvailable(stageStatus, 'products', rawProducts.length),
    orders: streamDataAvailable(stageStatus, 'orders', orders.length),
    sales: streamDataAvailable(stageStatus, 'sales', salesRows.length),
`,
`  const stageStatus = data?.stageStatus && typeof data.stageStatus === 'object' ? data.stageStatus : {}
  const periodCoverage = data?.__periodCoverage || null
  const requestedCoverage = periodCoverage?.requested || null
  const periodCoverageConfirms = stage => {
    if (!data?.__periodFiltered || !requestedCoverage?.from || !requestedCoverage?.to) return false
    const coverage = periodCoverage?.[stage]
    if (!coverage?.from || !coverage?.to) return false
    return String(coverage.from) <= String(requestedCoverage.from) && String(coverage.to) >= String(requestedCoverage.to)
  }
  const availability = {
    products: streamDataAvailable(stageStatus, 'products', rawProducts.length),
    orders: periodCoverageConfirms('orders') || streamDataAvailable(stageStatus, 'orders', orders.length),
    sales: periodCoverageConfirms('sales') || streamDataAvailable(stageStatus, 'sales', salesRows.length),
`,
'orders/sales availability')

replaceOnce(
`    advertising: streamDataAvailable(stageStatus, 'advertising', Array.isArray(advertisingData.campaigns) ? advertisingData.campaigns.length : 0),
    finance: streamDataAvailable(stageStatus, 'finance', financeRows.length),
`,
`    advertising: periodCoverageConfirms('advertising') || streamDataAvailable(stageStatus, 'advertising', Array.isArray(advertisingData.campaigns) ? advertisingData.campaigns.length : 0),
    finance: periodCoverageConfirms('finance') || streamDataAvailable(stageStatus, 'finance', financeRows.length),
`,
'finance/advertising availability')

fs.writeFileSync(file,source)
console.log('Period coverage availability fix applied')
