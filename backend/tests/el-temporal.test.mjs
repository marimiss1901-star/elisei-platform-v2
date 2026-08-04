import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { parseElTemporalRange, formatRuPeriod } = require('../src/services/elTemporal.cjs')
const { runElAnalyst } = require('../src/services/elAnalystEngine.cjs')

const localDate = '2026-08-04'

assert.deepEqual(
  parseElTemporalRange('что с выручкой за вчерашний день?', { localDate }),
  { from:'2026-08-03',to:'2026-08-03',days:1,source:'message',kind:'yesterday',matchedText:'вчера' },
)
assert.equal(parseElTemporalRange('покажи продажи сегодня', { localDate }).from, '2026-08-04')
assert.equal(parseElTemporalRange('а что было позавчера?', { localDate }).from, '2026-08-02')
assert.deepEqual(
  parseElTemporalRange('выручка на этой неделе', { localDate }),
  { from:'2026-08-03',to:'2026-08-04',days:2,source:'message',kind:'current-week',matchedText:'текущая неделя' },
)
assert.deepEqual(
  parseElTemporalRange('покажи прошлую неделю', { localDate }),
  { from:'2026-07-27',to:'2026-08-02',days:7,source:'message',kind:'previous-week',matchedText:'прошлая неделя' },
)
assert.equal(parseElTemporalRange('с начала месяца', { localDate }).from, '2026-08-01')
assert.deepEqual(
  parseElTemporalRange('за прошлый месяц', { localDate }),
  { from:'2026-07-01',to:'2026-07-31',days:31,source:'message',kind:'previous-month',matchedText:'прошлый месяц' },
)
assert.deepEqual(
  parseElTemporalRange('за последние 14 дней', { localDate }),
  { from:'2026-07-22',to:'2026-08-04',days:14,source:'message',kind:'last-days',matchedText:'за последние 14 дней' },
)
assert.equal(parseElTemporalRange('выручка 3 августа', { localDate }).from, '2026-08-03')
assert.deepEqual(
  parseElTemporalRange('период с 1 по 3 августа', { localDate }),
  { from:'2026-08-01',to:'2026-08-03',days:3,source:'message',kind:'explicit-range',matchedText:'с 1 по 3 августа' },
)
assert.equal(formatRuPeriod({from:'2026-08-03',to:'2026-08-03'}), '3 августа 2026 года')
assert.equal(formatRuPeriod({from:'2026-07-29',to:'2026-08-04'}), '29 июля — 4 августа 2026 года')

const revenueAnswer = await runElAnalyst({
  message:'что с выручкой за вчерашний день?',
  history:[],
  context:{ period:{from:'2026-08-03',to:'2026-08-03',days:1}, temporalIntent:{kind:'yesterday'} },
  identity:{userId:'u',cabinetId:'c',userName:'Мария'},
  personality:{character:'insider',humor:'light',support:true,address:'informal'},
  classification:{reason:'cabinet-question',modules:['sales']},
  dataBridge:{ async getMany(){ return { sales:{ok:true,data:{available:true,period:{from:'2026-08-03',to:'2026-08-03',days:1},summary:{revenue:915400,orders:1270,sales:1388,returns:14,returnRate:1.0},topByRevenue:[]}} } } },
})
assert.match(revenueAnswer.text, /Мария, за 3 августа 2026 года выручка составила 915[\s\u00a0]?400 ₽/)
assert.match(revenueAnswer.text, /Заказов — 1[\s\u00a0]?270/)
assert.match(revenueAnswer.text, /проданных единиц — 1[\s\u00a0]?388/)
assert.doesNotMatch(revenueAnswer.text, /продаж из/i)
assert.doesNotMatch(revenueAnswer.text, /Товарная детализация/i)

const noWrongScreenFallback = await runElAnalyst({
  message:'что с выручкой за вчерашний день?',
  history:[],
  context:{
    period:{from:'2026-08-03',to:'2026-08-03',days:1},
    screen:{period:{from:'2026-07-29',to:'2026-08-04',days:7},summary:{revenue:6592685,orders:9111,sales:9691,returns:107,returnRate:1.1}},
  },
  identity:{userId:'u',cabinetId:'c',userName:'Мария'},
  personality:{character:'insider',humor:'off',support:true,address:'informal'},
  classification:{reason:'cabinet-question',modules:['sales']},
  dataBridge:{ async getMany(){ return { sales:{ok:false,warning:'Нет строк за выбранный день'} } } },
})
assert.doesNotMatch(noWrongScreenFallback.text, /6[\s\u00a0]?592[\s\u00a0]?685/)
assert.match(noWrongScreenFallback.text, /цифр пока маловато|данных.*недостаточно/i)



const exactScreenDaily = await runElAnalyst({
  message:'что с выручкой за вчерашний день?',history:[],
  context:{
    period:{from:'2026-08-03',to:'2026-08-03',days:1},temporalIntent:{kind:'yesterday'},
    screen:{
      period:{from:'2026-07-29',to:'2026-08-04',days:7},
      dailyTrend:[{date:'2026-08-03',revenue:438200,orders:612,sales:655,returns:7}],
      periodCoverage:{orders:{from:'2026-07-01',to:'2026-08-03'},sales:{from:'2026-07-01',to:'2026-08-03'}},
      summary:{revenue:6592685,orders:9111,sales:9691,returns:107,returnRate:1.1},
    },
  },
  identity:{userId:'u',cabinetId:'c',userName:'Мария'},
  personality:{character:'insider',humor:'off',support:true,address:'informal'},
  classification:{reason:'cabinet-question',modules:['sales']},
  dataBridge:{ async getMany(){ return { sales:{ok:false,warning:'Внутренний мост временно недоступен'} } } },
})
assert.match(exactScreenDaily.text,/Мария, за 3 августа 2026 года выручка составила 438[\s\u00a0]?200 ₽/)
assert.match(exactScreenDaily.text,/Заказов — 612/)
assert.doesNotMatch(exactScreenDaily.text,/цифр пока маловато|6[\s\u00a0]?592[\s\u00a0]?685/i)

const laggedDaily = await runElAnalyst({
  message:'что с выручкой за вчерашний день?',history:[],
  context:{
    period:{from:'2026-08-03',to:'2026-08-03',days:1},temporalIntent:{kind:'yesterday'},
    screen:{
      dailyTrend:[{date:'2026-08-02',revenue:300000,orders:400,sales:420,returns:3}],
      periodCoverage:{orders:{from:'2026-07-01',to:'2026-08-02'},sales:{from:'2026-07-01',to:'2026-08-02'}},
    },
  },
  identity:{userId:'u',cabinetId:'c',userName:'Мария'},
  personality:{character:'insider',humor:'light',support:true,address:'informal'},
  classification:{reason:'cabinet-question',modules:['sales']},
  dataBridge:{ async getMany(){ return { sales:{ok:false,warning:'Нет строк за выбранный день'} } } },
})
assert.match(laggedDaily.text,/за 3 августа 2026 года подтверждённые строки/i)
assert.match(laggedDaily.text,/Последняя подтверждённая дата[^.]+2 августа 2026 года/i)
assert.doesNotMatch(laggedDaily.text,/подключение WB|кофе-брейк/i)

console.log('ELISEI El temporal intent tests passed')
