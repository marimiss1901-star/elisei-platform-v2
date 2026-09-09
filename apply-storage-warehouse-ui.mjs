import fs from 'node:fs'

// ELISEI 5.19.8 — paid storage by product and warehouse.
const pageFile='src/pages/DashboardPage.jsx'
const cssFile='src/styles/app.css'
let source=fs.readFileSync(pageFile,'utf8')

function replaceOnce(before,after,label){
  if(source.includes(after)) return
  if(!source.includes(before)) throw new Error(`ELISEI 5.19.8 storage UI: ${label} marker not found`)
  source=source.replace(before,after)
}

replaceOnce(
`  const analyticsFiltersActive = Boolean(query.trim() || analyticsBrand !== 'Все' || analyticsCategory !== 'Все' || analyticsAbc !== 'Все' || analyticsXyz !== 'Все' || analyticsStock !== 'Все')`,
`  const analyticsFiltersActive = Boolean(query.trim() || analyticsBrand !== 'Все' || analyticsCategory !== 'Все' || analyticsAbc !== 'Все' || analyticsXyz !== 'Все' || analyticsStock !== 'Все')\n  const analyticsStorageBreakdown = useMemo(() => {\n    const rows = Array.isArray(analyticsCore?.storageBreakdown) ? analyticsCore.storageBreakdown : []\n    if (!analyticsFiltersActive) return rows\n    const allowedNm = new Set(analyticsFilteredProducts.map(row => String(row.nmID || row.nmId || '').trim()).filter(Boolean))\n    const allowedVendor = new Set(analyticsFilteredProducts.map(row => String(row.vendorCode || row.article || '').trim().toLowerCase()).filter(Boolean))\n    return rows.filter(row => {\n      const nm = String(row.nmId || row.nmID || '').trim()\n      const vendor = String(row.vendorCode || '').trim().toLowerCase()\n      return (nm && allowedNm.has(nm)) || (vendor && allowedVendor.has(vendor))\n    })\n  }, [analyticsCore,analyticsFiltersActive,analyticsFilteredProducts])`,
'storage breakdown derived rows')

replaceOnce(
`            <span>{formatMoney(p.storage)}<small>{p.storageSource === 'paid_storage_report_partial' ? 'WB · период догружается' : ['paid_storage_report','finance_report'].includes(p.storageSource) ? 'WB' : p.storageSource === 'not_loaded' ? 'ожидает WB' : p.storageSource === 'manual' ? 'резервный расчёт' : p.acceptance ? \`приёмка \${formatMoney(p.acceptance)}\` : ''}</small></span>`,
`            <span>{formatMoney(p.storage)}<small>{p.storageSource === 'paid_storage_ledger' ? 'WB · по nmID' : p.storageSource === 'paid_storage_report_partial' ? 'WB · период догружается' : ['paid_storage_report','finance_report'].includes(p.storageSource) ? 'WB' : p.storageSource === 'not_loaded' ? 'ожидает WB' : p.storageSource === 'manual' ? 'резервный расчёт' : p.acceptance ? \`приёмка \${formatMoney(p.acceptance)}\` : ''}</small></span>`,
'product storage ledger label')

replaceOnce(
`        <div className="section-title-row"><div><span>ABC/XYZ</span><h2>Приоритет товаров</h2></div><small>{formatNumber(filteredCount)} из {formatNumber(analyticsBaseProducts.length)}</small></div>`,
`        <div className="section-title-row storage-breakdown-title"><div><span>Хранение WB</span><h2>Хранение по товарам и складам</h2></div><small>{selectedPeriodLabel}</small></div>\n        <div className="storage-breakdown-note">WB-отчёт платного хранения привязан к nmID. Если WB возвращает общий склад «Склад WB РФ», ELISEI честно показывает агрегат и не придумывает конкретный склад.</div>\n        <div className="data-table compact-table storage-breakdown-table">\n          <div className="data-row head storage-breakdown-row"><span>Товар</span><span>Склад</span><span>Дней</span><span>Хранение</span><span>₽ / день</span><span>% выручки</span></div>\n          {analyticsStorageBreakdown.length ? analyticsStorageBreakdown.slice(0,250).map((row,index) => <div className="data-row storage-breakdown-row" key={\`storage-\${row.nmId || row.vendorCode || index}-\${row.warehouse}-\${index}\`}>\n            <span><strong>{row.title || row.vendorCode || (row.nmId ? \`nmID \${row.nmId}\` : 'Товар WB')}</strong><small>{row.vendorCode || 'без артикула'} · nmID {row.nmId || '—'}</small></span>\n            <span><strong>{row.warehouse || 'Склад WB РФ'}</strong><small>{row.warehouseAggregated ? 'WB агрегирует склады' : 'склад из отчёта WB'}</small></span>\n            <span>{formatNumber(row.days || 0)}</span>\n            <span><strong>{formatMoney(row.amount)}</strong></span>\n            <span>{formatMoney(row.rubPerDay)}</span>\n            <span>{row.shareOfRevenue == null ? '—' : formatPercent(row.shareOfRevenue)}</span>\n          </div>) : <div className="product-empty">За выбранный период WB не вернул строк платного хранения.</div>}\n        </div>\n\n        <div className="section-title-row"><div><span>ABC/XYZ</span><h2>Приоритет товаров</h2></div><small>{formatNumber(filteredCount)} из {formatNumber(analyticsBaseProducts.length)}</small></div>`,
'storage warehouse table')

fs.writeFileSync(pageFile,source)

let css=fs.readFileSync(cssFile,'utf8')
const marker='/* ELISEI 5.19.8 storage warehouse analytics */'
if(!css.includes(marker)) css += `\n\n${marker}\n.storage-breakdown-title{margin-top:28px}.storage-breakdown-note{margin:-8px 0 14px;padding:10px 12px;border:1px solid var(--border,rgba(148,163,184,.2));border-radius:12px;font-size:12px;line-height:1.45;opacity:.78}.storage-breakdown-row{grid-template-columns:minmax(250px,2.2fr) minmax(190px,1.45fr) .55fr .9fr .8fr .8fr;align-items:center}.storage-breakdown-row>span{min-width:0}.storage-breakdown-row strong{display:block}.storage-breakdown-row small{display:block;margin-top:4px;opacity:.65;font-size:11px}@media(max-width:1100px){.storage-breakdown-table{overflow-x:auto}.storage-breakdown-row{min-width:980px}}\n`
fs.writeFileSync(cssFile,css)
console.log('ELISEI 5.19.8 storage by product/warehouse UI applied')
