import fs from 'node:fs'

const file='src/pages/DashboardPage.jsx'
let source=fs.readFileSync(file,'utf8')

function replaceOnce(oldText,newText,label){
  if(source.includes(newText)) return
  if(!source.includes(oldText)) throw new Error(`Order Feed UI patch: ${label} target not found`)
  source=source.replace(oldText,newText)
}

replaceOnce(
`<p>Заказы и продажи обновляются примерно раз в 30 минут, реклама и остатки — раз в час. Тяжёлые финансовые потоки идут по отдельному безопасному расписанию и лимитам WB. Вход пользователя ничего не запускает.</p>`,
`<p>Заказы и продажи обновляются из единой Ленты заказов WB примерно раз в 3 часа. Склад WB и FBS — примерно раз в 2 часа. Финансы, реклама, документы, отзывы и другие фоновые данные готовятся ночью. Вход пользователя ничего не запускает.</p>`,
'live sync description')

replaceOnce(
`<div className="live-sync-grid"><div><small>Заказы и продажи</small><strong>≈ 30 мин.</strong><span>инкрементально</span></div><div><small>Реклама и остатки</small><strong>≈ 60 мин.</strong><span>по расписанию</span></div><div><small>Вчерашний день</small><strong>до входа</strong><span>готовый снимок</span></div><div><small>Финансы</small><strong>по окну WB</strong><span>без лишних повторов</span></div></div>`,
`<div className="live-sync-grid"><div><small>Заказы и продажи</small><strong>≈ 3 часа</strong><span>единый Order Feed</span></div><div><small>Остатки</small><strong>≈ 2 часа</strong><span>Склад WB + FBS</span></div><div><small>Ночные данные</small><strong>к утру</strong><span>без дневной очереди</span></div><div><small>Финансы</small><strong>Nightly Ready</strong><span>последний подтверждённый снимок</span></div></div>`,
'live sync cadence grid')

fs.writeFileSync(file,source)
console.log('Order Feed seller-day UI applied')
