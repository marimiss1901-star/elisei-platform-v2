import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const { detectModules } = require('../src/services/elModuleRegistry.cjs')
const { runElAnalyst, asksCashSafety, parseCashWithdrawal } = require('../src/services/elAnalystEngine.cjs')

const period = { from:'2026-08-01', to:'2026-08-31', days:31 }
const finance = {
  available:true,
  period,
  summary:{
    revenue:2718854,
    operatingProfit:-573567,
    margin:-21.1,
    cogs:0,
    commission:839120,
    logistics:594154,
    advertising:258894,
    storage:27146,
    acquiring:127756,
    penalties:5526,
    deductions:22990,
    tax:326265,
  },
  balance:{ current:1082041.35, for_withdraw:0, updatedAt:'2026-09-11T07:23:48.322Z' },
  productPnlRows:[],
  lossMakingProducts:[],
  missingCostProducts:[],
}
const stocks = { available:true, period, summary:{ stockUnits:1867, zeroStock:2, lowStock:8, slowStock:11 } }
const sync = { available:true, period, syncStates:[], syncWarnings:[] }

function bridge() {
  return {
    async getMany(modules) {
      const data = { finance, stocks, sync }
      return Object.fromEntries(modules.map(module => [module, data[module] ? { ok:true, data:data[module] } : { ok:false, warning:`Нет ${module}` }]))
    },
  }
}

const cashQuestion = 'За этот период вывели почти 4 ляма, бизнесу пизда?'
assert.equal(asksCashSafety(cashQuestion), true)
assert.equal(parseCashWithdrawal(cashQuestion), 4000000)
const detected = detectModules('Можно ли вывести из бизнеса 4 млн?',4)
assert.ok(detected.includes('finance'),'cash withdrawal must route to finance')
assert.ok(!detected.includes('advertising'),'generic word money must not hijack cash withdrawal into advertising')

const answer = await runElAnalyst({
  message:cashQuestion,
  history:[
    { role:'user', content:'Долгов поставщикам нет.' },
    { role:'assistant', content:'Принял.' },
    { role:'user', content:'К выводу висит на WB 719957, это уже банком обрабатывается.' },
  ],
  context:{ period, screen:{ period, summary:finance.summary, balance:finance.balance } },
  identity:{ userId:'u1', userName:'Мария' },
  personality:{ character:'insider', humor:'off', support:true, celebrations:true, address:'informal' },
  classification:{ modules:detectModules(cashQuestion,4), reason:'cabinet-question' },
  dataBridge:bridge(),
})

assert.match(answer.text,/кассовая безопасность/i)
assert.match(answer.text,/4[\s ]000[\s ]000 ₽/)
assert.match(answer.text,/573[\s ]567 ₽/)
assert.match(answer.text,/4[\s ]573[\s ]567 ₽/)
assert.match(answer.text,/1[\s ]082[\s ]041 ₽/)
assert.match(answer.text,/719[\s ]957 ₽/)
assert.match(answer.text,/долгов поставщикам нет/i)
assert.match(answer.text,/Риск вывода денег: ВЫСОКИЙ/)
assert.match(answer.text,/58[,.]5 дн/)
assert.match(answer.text,/Баланс WB не считаю прибылью|Баланс WB сам по себе не является/i)
assert.deepEqual(answer.modulesUsed,['finance','stocks','sync'])
assert.ok(!answer.modulesUsed.includes('advertising'))

const safeAmount = await runElAnalyst({
  message:'Сколько можно безопасно вывести из бизнеса?',
  history:[],
  context:{ period, screen:{ period, summary:{...finance.summary,operatingProfit:300000,margin:11}, balance:finance.balance } },
  identity:{ userId:'u1', userName:'Мария' },
  personality:{ character:'insider', humor:'off', support:true, celebrations:true, address:'informal' },
  classification:{ modules:detectModules('Сколько можно безопасно вывести из бизнеса?',4), reason:'cabinet-question' },
  dataBridge:{ async getMany(modules) {
    const data = { finance:{...finance,summary:{...finance.summary,operatingProfit:300000,margin:11}}, stocks, sync }
    return Object.fromEntries(modules.map(module => [module,{ok:true,data:data[module]}]))
  }},
})
assert.match(safeAmount.text,/Точную «безопасную сумму к выводу» не называю без денежного резерва бизнеса/)
assert.match(safeAmount.text,/Баланс WB сам по себе не является суммой, которую можно забрать без риска/)

const prompt = fs.readFileSync(new URL('../src/services/elPrompt.cjs',import.meta.url),'utf8')
assert.match(prompt,/Баланс WB не равен свободным деньгам/)
const server = fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
assert.match(server,/balance: core\?\.finance\?\.balance \|\| null/)

console.log('ELISEI 5.19.16 El cash safety regression: OK')
