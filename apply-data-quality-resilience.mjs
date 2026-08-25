import fs from 'node:fs'

const file = 'src/pages/DashboardPage.jsx'
let source = fs.readFileSync(file, 'utf8')

function replaceOnce(oldText, newText, label) {
  if (source.includes(newText)) return
  if (!source.includes(oldText)) throw new Error(`Data Quality resilience patch: ${label} target not found`)
  source = source.replace(oldText, newText)
}

replaceOnce(
`  const [dataQuality, setDataQuality] = useState(null)
  const [dataQualityLoading, setDataQualityLoading] = useState(false)
`,
`  const [dataQuality, setDataQuality] = useState(null)
  const [dataQualityLoading, setDataQualityLoading] = useState(false)
  const [dataQualityError, setDataQualityError] = useState('')
`,
'state')

replaceOnce(
`    setDataQualityLoading(true)
    try {
      const result=await wbApi.dataQuality(connectionId,{ from:period?.from,to:period?.to })
      setDataQuality(result?.quality || null)
    } catch (error) {
      notify(error.message,8000)
    } finally {
`,
`    setDataQualityLoading(true)
    setDataQualityError('')
    try {
      const result=await wbApi.dataQuality(connectionId,{ from:period?.from,to:period?.to })
      setDataQuality(result?.quality || null)
      setDataQualityError('')
    } catch (error) {
      setDataQualityError(error?.message || 'Проверка качества временно недоступна.')
      notify(error.message,8000)
    } finally {
`,
'loader error state')

replaceOnce(
`          <strong>{dataQualityLoading && !dataQuality ? '…' : \`${'${formatNumber(dataQuality?.score || 0)}'}%\`}</strong>
`,
`          <strong>{dataQualityLoading && !dataQuality ? '…' : dataQuality ? \`${'${formatNumber(dataQuality?.score ?? 0)}'}%\` : '—'}</strong>
`,
'score')

replaceOnce(
`          <ShieldCheck size={21}/><div><strong>{dataQuality?.profitConfidence?.label || 'Проверяем качество'}</strong><span>{dataQuality?.profitConfidence?.text || 'Собираем паспорта источников.'}</span></div>
`,
`          <ShieldCheck size={21}/><div><strong>{dataQuality?.profitConfidence?.label || (dataQualityError ? 'Проверка временно недоступна' : 'Проверяем качество')}</strong><span>{dataQuality?.profitConfidence?.text || (dataQualityError ? 'Сохранённые данные не удалены. ELISEI повторит проверку после восстановления соединения с базой.' : 'Собираем паспорта источников.')}</span></div>
`,
'confidence')

for (const [oldText,newText] of [
  ["{formatNumber(dataQuality?.summary?.ready || 0)}", "{dataQuality ? formatNumber(dataQuality?.summary?.ready ?? 0) : '—'}"],
  ["{formatNumber(dataQuality?.summary?.partial || 0)}", "{dataQuality ? formatNumber(dataQuality?.summary?.partial ?? 0) : '—'}"],
  ["{formatNumber(dataQuality?.summary?.critical || 0)}", "{dataQuality ? formatNumber(dataQuality?.summary?.critical ?? 0) : '—'}"],
  ["{formatNumber(dataQuality?.summary?.warnings || 0)}", "{dataQuality ? formatNumber(dataQuality?.summary?.warnings ?? 0) : '—'}"],
]) {
  if (source.includes(newText)) continue
  if (!source.includes(oldText)) throw new Error(`Data Quality resilience patch: KPI target not found: ${oldText}`)
  source = source.replace(oldText,newText)
}

replaceOnce(
`        {dataQualityLoading && !dataQuality ? <div className="quality-empty"><RefreshCw className="spin" size={22}/>Собираем покрытие источников…</div> : dataQuality?.issues?.length ? dataQuality.issues.map(item=>`,
`        {dataQualityLoading && !dataQuality ? <div className="quality-empty"><RefreshCw className="spin" size={22}/>Собираем покрытие источников…</div> : dataQualityError && !dataQuality ? <div className="quality-empty"><AlertTriangle size={22}/>Проверка качества временно недоступна. Данные сохранены; повторим после восстановления базы.</div> : dataQuality?.issues?.length ? dataQuality.issues.map(item=>`,
'problem fallback')

fs.writeFileSync(file, source)
console.log('Data Quality DB reconnect resilience applied')
