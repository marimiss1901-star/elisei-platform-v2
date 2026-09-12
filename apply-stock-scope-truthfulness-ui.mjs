import fs from 'node:fs'

// ELISEI 5.19.21 — stock scope truthfulness.
// A fresh FBS sellerStocks snapshot must not be presented as the complete
// cabinet stock while the FBO WB-warehouse snapshot is unavailable.
const file='src/pages/DashboardPage.jsx'
let source=fs.readFileSync(file,'utf8')

function replaceOnce(before,after,label){
  if(source.includes(after)) return
  if(!source.includes(before)) throw new Error(`ELISEI 5.19.21 stock scope truthfulness: ${label} marker not found`)
  source=source.replace(before,after)
}

replaceOnce(
`    const stockAvailable = Boolean(coreData?.availability?.stocks)\n    const stockDetailsAvailable = Boolean(coreData?.availability?.stockDetails)`,
`    const stockAvailable = Boolean(coreData?.availability?.stocks)\n    const sellerStockAvailable = Boolean(coreData?.availability?.sellerStocks)\n    const fboStockAvailable = Boolean(coreData?.availability?.fboStocks)\n    const stockScopePartial = sellerStockAvailable && !fboStockAvailable\n    const stockDetailsAvailable = Boolean(coreData?.availability?.stockDetails)`,
'FBS/FBO availability flags')

replaceOnce(
`      {renderSharedPeriodControls({ note:'Остаток берётся из последнего официального снимка WB, а продажи, скорость и дни запаса пересчитываются по единому выбранному периоду.' })}\n      <div className="workspace-filter-bar">`,
`      {renderSharedPeriodControls({ note:stockScopePartial ? 'Сейчас подтверждён FBS-остаток продавца. FBO-остаток на складах WB ожидает доступного снимка и не подменяется старым значением.' : 'Остаток берётся из последнего официального снимка WB, а продажи, скорость и дни запаса пересчитываются по единому выбранному периоду.' })}\n      {stockScopePartial && <div className="notice warning"><AlertTriangle size={20}/><div><strong>Остаток сейчас неполный: подтверждён FBS</strong><p>FBO-остаток на складах WB сейчас недоступен в свежем снимке. Показанные количества относятся только к подтверждённой доступной части; ELISEI не добавляет старый FBO-снимок и не выдаёт его за текущий.</p></div><button onClick={() => setActive('История остатков')}>Открыть историю</button></div>}\n      <div className="workspace-filter-bar">`,
'partial stock scope notice')

fs.writeFileSync(file,source)
console.log('ELISEI 5.19.21 stock scope truthfulness applied')
