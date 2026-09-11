import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const { runElAnalyst, asksAntiCrisisGoal, parseAntiCrisisGoalAmount, parseAntiCrisisGoalDays } = require('../src/services/elAnalystEngine.cjs')

const question='Нужно высвободить 1 млн за 30 дней из бизнеса. Где взять деньги?'
assert.equal(asksAntiCrisisGoal(question),true)
assert.equal(parseAntiCrisisGoalAmount(question),1000000)
assert.equal(parseAntiCrisisGoalDays(question),30)
assert.equal(parseAntiCrisisGoalDays('Хочу высвободить 800 тыс за 2 недели'),14)

const period={from:'2026-08-01',to:'2026-08-31',days:31}
const finance={
  available:true,period,
  summary:{revenue:2718854,operatingProfit:-573567,margin:-21.1},
  balance:{current:1082041.35,for_withdraw:0},
  lossMakingProducts:[
    {vendorCode:'2505 чер 3м',title:'Кабель',profit:-200000,revenue:300000,stock:120,unitCost:900},
    {vendorCode:'T-503',title:'Тройник',profit:-100000,revenue:120000,stock:80,unitCost:500},
  ],
}
const advertising={
  available:true,period,
  advertising:{
    statsAvailable:true,
    campaigns:[
      {advertId:1,name:'Слив без заказов',spend:100000,revenue:0,orders:0},
      {advertId:2,name:'Рабочая реклама',spend:50000,revenue:200000,orders:20},
    ],
  },
}
const stocks={
  available:true,period,summary:{stockUnits:1000},
  slowStockProducts:[
    {vendorCode:'SLOW-1',title:'Зависший товар',stock:100,unitCost:2500},
    {vendorCode:'SLOW-2',title:'Без себеса',stock:200,unitCost:0},
  ],
}
const pricing={available:true,period,lossMakingProducts:finance.lossMakingProducts}
const procurement={available:true,period,exclusions:[...finance.lossMakingProducts,{vendorCode:'SLOW-1',title:'Зависший товар'}]}

const data={finance,advertising,stocks,pricing,procurement}
const answer=await runElAnalyst({
  message:question,
  history:[],
  context:{period,screen:{period,summary:finance.summary,balance:finance.balance}},
  identity:{userId:'u1',userName:'Мария'},
  personality:{character:'insider',humor:'off',support:true,celebrations:true,address:'informal'},
  classification:{modules:['overview'],reason:'cabinet-question'},
  dataBridge:{async getMany(modules){
    return Object.fromEntries(modules.map(module=>[module,data[module]?{ok:true,data:data[module]}:{ok:false,warning:'Нет '+module}]))
  }},
})

assert.deepEqual(answer.modulesUsed,['finance','advertising','stocks','pricing','procurement'])
assert.match(answer.text,/антикризисная цель/i)
assert.match(answer.text,/1[\s ]000[\s ]000 ₽/)
assert.match(answer.text,/33[\s ]333 ₽ в день/)
assert.match(answer.text,/300[\s ]000 ₽ отрицательного результата/)
assert.match(answer.text,/100[\s ]000 ₽ за доступный рекламный срез/)
assert.match(answer.text,/250[\s ]000 ₽ по себестоимости/)
assert.match(answer.text,/НЕ складываю/)
assert.match(answer.text,/не гарантия/i)
assert.doesNotMatch(answer.text,/650[\s ]000 ₽.*(?:общ|итог|потенциал)/i,'overlapping loss/ad/stock lanes must not be summed as one cash potential')

const prompt=fs.readFileSync(new URL('../src/services/elPrompt.cjs',import.meta.url),'utf8')
assert.match(prompt,/антикризисную денежную цель/)
assert.match(prompt,/Не складывай пересекающиеся суммы/)

console.log('ELISEI 5.19.17 El anti-crisis cash goal regression: OK')
