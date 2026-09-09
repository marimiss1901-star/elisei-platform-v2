import fs from 'node:fs'

const file='src/pages/DashboardPage.jsx'
let source=fs.readFileSync(file,'utf8')

function replaceOnce(before,after,label){
  if(source.includes(after)) return
  if(!source.includes(before)) throw new Error(`ELISEI 5.19.5 UI patch: ${label} marker not found`)
  source=source.replace(before,after)
}

replaceOnce(
`            <span>{formatMoney(p.logistics)}<small>{p.logisticsSource === 'not_loaded' ? 'ожидает WB' : p.logisticsSource === 'manual' ? 'резервный расчёт' : p.logisticsSource === 'wb_api' ? 'WB финансы' : ''}</small></span>
            <span>{formatMoney(p.acquiring)}<small>{p.acquiringSource === 'not_loaded' ? 'ожидает WB' : ''}</small></span>`,
`            <span>{formatMoney(p.logistics)}<small>{p.logisticsSource === 'historical_finance' ? 'оценка по истории WB' : p.logisticsSource === 'manual' ? 'ручной резерв' : p.logisticsSource === 'not_loaded' ? 'ожидает WB' : p.logisticsSource === 'wb_api' ? 'WB финансы' : ''}</small></span>
            <span>{formatMoney(p.acquiring)}<small>{p.acquiringSource === 'historical_finance' ? 'оценка по истории WB' : p.acquiringSource === 'not_loaded' ? 'ожидает WB' : ''}</small></span>`,
'product P&L historical labels')

replaceOnce(
`<div className=\"finance-source-note\"><ShieldCheck size={16}/><span>{financeEstimateAvailable ? 'Предварительно: комиссия и логистика рассчитаны по резервным параметрам, остальные неподтверждённые удержания считаются нулём до ответа WB. Подтверждённая детализация заменит оценки автоматически.' : 'WB-расходы в P&L берутся из финансового реестра за выбранный период. Отдельные отчёты используются для детализации без двойного счёта.'}</span></div>`,
`<div className=\"finance-source-note\"><ShieldCheck size={16}/><span>{financeEstimateAvailable ? (coreData?.historicalFinanceFallback ? \`Предварительно: текущая детализация WB ещё не пришла. Логистика и эквайринг оценены по последнему подтверждённому периоду WB \${formatDate(coreData.historicalFinanceFallback.from)} — \${formatDate(coreData.historicalFinanceFallback.to)}; точные расходы заменят оценку автоматически.\` : 'Предварительно: текущая финансовая детализация WB ещё не пришла. Неподтверждённые расходы не считаются реальным нулём; точные данные заменят оценку автоматически.') : 'WB-расходы в P&L берутся из финансового реестра за выбранный период. Отдельные отчёты используются для детализации без двойного счёта.'}</span></div>`,
'finance estimate explanation')

fs.writeFileSync(file,source)
console.log('ELISEI 5.19.5 historical finance UI labels applied')
