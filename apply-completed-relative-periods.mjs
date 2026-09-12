import fs from 'node:fs'

// ELISEI 5.19.20 — completed relative periods.
// Relative rolling presets must use fully completed days only.
// 7/30/90 end yesterday; month/year stay period-to-date by design.
const file='src/pages/DashboardPage.jsx'
let source=fs.readFileSync(file,'utf8')

function replaceOnce(before,after,label){
  if(source.includes(after)) return
  if(!source.includes(before)) throw new Error(`ELISEI 5.19.20 completed periods: ${label} marker not found`)
  source=source.replace(before,after)
}

replaceOnce(
`  if (preset === '90') return { preset, from:addDays(to,-89), to }\n  if (preset === 'month') return { preset, from:isoLocalDate(new Date(today.getFullYear(),today.getMonth(),1)), to }`,
`  if (preset === '30' || preset === '90') {\n    const completedTo = addDays(to,-1)\n    const days = preset === '30' ? 30 : 90\n    return { preset, from:addDays(completedTo,-days+1), to:completedTo }\n  }\n  if (preset === 'month') return { preset, from:isoLocalDate(new Date(today.getFullYear(),today.getMonth(),1)), to }`,
'30/90 rolling presets')

replaceOnce(
`  return { preset:'30', from:addDays(to,-29), to }`,
`  const completedTo = addDays(to,-1)\n  return { preset:'30', from:addDays(completedTo,-29), to:completedTo }`,
'default 30-day preset')

// ELISEI 5.19.21 — stock scope truthfulness.
// A fresh FBS sellerStocks snapshot must not be presented as complete cabinet
// stock while the FBO WB-warehouse snapshot is unavailable.
replaceOnce(
`    const stockAvailable = Boolean(coreData?.availability?.stocks)\n    const stockDetailsAvailable = Boolean(coreData?.availability?.stockDetails)`,
`    const stockAvailable = Boolean(coreData?.availability?.stocks)\n    const sellerStockAvailable = Boolean(coreData?.availability?.sellerStocks)\n    const fboStockAvailable = Boolean(coreData?.availability?.fboStocks)\n    const stockScopePartial = sellerStockAvailable && !fboStockAvailable\n    const stockDetailsAvailable = Boolean(coreData?.availability?.stockDetails)`,
'FBS/FBO availability flags')

replaceOnce(
`      {renderSharedPeriodControls({ note:'Остаток берётся из последнего официального снимка WB, а продажи, скорость и дни запаса пересчитываются по единому выбранному периоду.' })}\n      <div className="workspace-filter-bar">`,
`      {renderSharedPeriodControls({ note:stockScopePartial ? 'Сейчас подтверждён FBS-остаток продавца. FBO-остаток на складах WB ожидает доступного снимка и не подменяется старым значением.' : 'Остаток берётся из последнего официального снимка WB, а продажи, скорость и дни запаса пересчитываются по единому выбранному периоду.' })}\n      {stockScopePartial && <div className="notice warning"><AlertTriangle size={20}/><div><strong>Остаток сейчас неполный: подтверждён FBS</strong><p>FBO-остаток на складах WB сейчас недоступен в свежем снимке. Показанные количества относятся только к подтверждённой доступной части; ELISEI не добавляет старый FBO-снимок и не выдаёт его за текущий.</p></div><button onClick={() => setActive('История остатков')}>Открыть историю</button></div>}\n      <div className="workspace-filter-bar">`,
'partial stock scope notice')

fs.writeFileSync(file,source)
console.log('ELISEI 5.19.20 completed relative periods applied')
console.log('ELISEI 5.19.21 stock scope truthfulness applied')
