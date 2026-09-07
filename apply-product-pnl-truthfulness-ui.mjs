import fs from 'node:fs'

// ELISEI 5.19.3 — product P&L truthfulness in Analytics.
// Never render an unavailable WB cost as a real 0 ₽. The backend returns null
// for not-yet-loaded logistics/acquiring/storage and exposes source metadata.

const pageUrl = new URL('./src/pages/DashboardPage.jsx', import.meta.url)
let source = fs.readFileSync(pageUrl, 'utf8')

function replaceOnce(before, after, label) {
  if (source.includes(after)) return
  if (!source.includes(before)) throw new Error(`ELISEI 5.19.3 could not find ${label} marker in DashboardPage.jsx`)
  source = source.replace(before, after)
}

replaceOnce(
`            <span>{formatMoney(p.logistics)}</span>`,
`            <span>{formatMoney(p.logistics)}<small>{p.logisticsSource === 'not_loaded' ? 'ожидает WB' : p.logisticsSource === 'manual' ? 'резервный расчёт' : p.logisticsSource === 'wb_api' ? 'WB финансы' : ''}</small></span>`,
  'product logistics cell',
)

replaceOnce(
`            <span>{formatMoney(p.storage)}<small>{p.acceptance ? \`приёмка \${formatMoney(p.acceptance)}\` : ''}</small></span>`,
`            <span>{formatMoney(p.storage)}<small>{p.storageSource === 'paid_storage_report_partial' ? 'WB · период догружается' : ['paid_storage_report','finance_report'].includes(p.storageSource) ? 'WB' : p.storageSource === 'not_loaded' ? 'ожидает WB' : p.storageSource === 'manual' ? 'резервный расчёт' : p.acceptance ? \`приёмка \${formatMoney(p.acceptance)}\` : ''}</small></span>`,
  'product storage cell',
)

replaceOnce(
`<small>{p.margin == null ? 'маржа не рассчитана' : \`маржа \${formatPercent(p.margin)}\`}</small>`,
`<small>{p.profitProvisional ? \`предварительно · \${p.margin == null ? 'маржа не рассчитана' : \`маржа \${formatPercent(p.margin)}\`}\` : p.margin == null ? 'маржа не рассчитана' : \`маржа \${formatPercent(p.margin)}\`}</small>`,
  'product provisional profit label',
)

fs.writeFileSync(pageUrl, source)
console.log('ELISEI 5.19.3 product P&L truthfulness UI applied')
