import fs from 'node:fs'

const file='src/pages/DashboardPage.jsx'
let source=fs.readFileSync(file,'utf8')
if (source.includes('ELISEI_CANONICAL_FRONTEND_PATCHES')) process.exit(0)

function replaceOnce(oldText,newText,label){
  if(source.includes(newText)) return
  if(!source.includes(oldText)) throw new Error(`Last-good sync status patch: ${label} target not found`)
  source=source.replace(oldText,newText)
}

replaceOnce(
`    const stageLabel = state => {
      if (!state) return 'Будет загружено автоматически'
      if (state.status === 'success') return \`Загружено: \${formatNumber(state.lastCount)}\``,
`    const stageLabel = state => {
      if (!state) return 'Будет загружено автоматически'
      if (state.lastSuccessAt && ['orders','sales','stocks','sellerStocks'].includes(String(state.stage || '')) && ['queued','rate_limited','retry_scheduled'].includes(String(state.status || ''))) {
        return state.lastCount == null ? 'Последние данные сохранены' : \`Последние данные: \${formatNumber(state.lastCount)}\`
      }
      if (state.status === 'success') return \`Загружено: \${formatNumber(state.lastCount)}\``,
'compact stage label')

replaceOnce(
`    const statusCopy = (state, stage) => {
      if (!state) return { tone:'idle', title:'Не запускалось', text:'Данные этого раздела ещё не запрашивались.' }
      if (state.status === 'success') {`,
`    const statusCopy = (state, stage) => {
      if (!state) return { tone:'idle', title:'Не запускалось', text:'Данные этого раздела ещё не запрашивались.' }
      const operationalLastGood = ['orders','sales','stocks','sellerStocks'].includes(stage)
        && state.lastSuccessAt
        && ['queued','rate_limited','retry_scheduled'].includes(String(state.status || ''))
      if (operationalLastGood) {
        const title = state.lastCount == null ? 'Последние данные сохранены' : \`Последние данные: \${formatNumber(state.lastCount)}\`
        const next = state.nextAllowedAt ? \`Следующее обновление \${formatSchedulerWait(state.nextAllowedAt)}.\` : 'ELISEI обновит данные автоматически.'
        return { tone:'idle', title, text:\`Обновлено \${new Date(state.lastSuccessAt).toLocaleString('ru-RU')}. \${next}\` }
      }
      if (state.status === 'success') {`,
'operational last-good card')

fs.writeFileSync(file,source)
console.log('Last-good sync status UI applied')
