import fs from 'node:fs'

const file='src/pages/DashboardPage.jsx'
let source=fs.readFileSync(file,'utf8')
const before=`<div className="sync-summary"><div><span>Автоматическое обновление</span><strong>{connection.lastSync ? \`Последнее успешное: ${'${'}new Date(connection.lastSync).toLocaleString('ru-RU')}\` : 'ELISEI запустит доступные потоки сам'}</strong><small>Эта кнопка нужна только для диагностики — обычная работа кабинета не требует ручного запуска.</small></div>`
const after=`<div className="sync-summary"><div><span>Автоматическое обновление</span><strong>{connection.lastSync ? \`Последний успешно обновлённый поток: ${'${'}new Date(connection.lastSync).toLocaleString('ru-RU')}\` : 'ELISEI запустит доступные потоки сам'}</strong><small>Это время относится к последнему успешно обновившемуся источнику, а не ко всему кабинету. Актуальность каждого потока указана на карточках ниже.</small></div>`
if (!source.includes(after)) {
  if (!source.includes(before)) throw new Error('ELISEI sync truth UI marker not found')
  source=source.replace(before,after)
}
fs.writeFileSync(file,source)
console.log('ELISEI sync freshness summary truthfulness applied')
