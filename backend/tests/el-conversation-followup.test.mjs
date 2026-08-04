import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { resolveConversationFollowup, metricFromText, isFollowupMessage } = require('../src/services/elConversationContext.cjs')
const { runElAnalyst } = require('../src/services/elAnalystEngine.cjs')

assert.equal(isFollowupMessage('сколько из них заказов фбс'), true)
assert.equal(metricFromText('сколько из них заказов фбс'), 'fbs_orders')
assert.equal(metricFromText('а возвратов?'), 'returns')

const inherited = resolveConversationFollowup({
  message:'а сколько из них FBS?',
  history:[
    { role:'user',content:'что с выручкой за вчера?',resolvedPeriod:{from:'2026-08-03',to:'2026-08-03',days:1} },
    { role:'assistant',content:'За 3 августа...',modulesUsed:['sales'],analysisContext:{period:{from:'2026-08-03',to:'2026-08-03',days:1},modules:['sales'],metric:'revenue'} },
  ],
  clock:{localDate:'2026-08-04'},
  defaultPeriod:{from:'2026-07-29',to:'2026-08-04',days:7},
})
assert.equal(inherited.isFollowup,true)
assert.deepEqual(inherited.inheritedPeriod,{from:'2026-08-03',to:'2026-08-03',days:1})
assert.deepEqual(inherited.inheritedModules,['sales'])
assert.equal(inherited.antecedentMetric,'revenue')

const answer = await runElAnalyst({
  message:'сколько из них заказов фбс',
  history:[
    {role:'user',content:'Сколько заказов и продаж за неделю?'},
    {role:'assistant',content:'Заказов — 9 111.',modulesUsed:['sales'],analysisContext:{period:{from:'2026-07-29',to:'2026-08-04',days:7},modules:['sales'],metric:'orders'}},
  ],
  context:{
    period:{from:'2026-07-29',to:'2026-08-04',days:7},
    conversationFollowup:{isFollowup:true,metric:'fbs_orders',inheritedModules:['sales']},
  },
  identity:{userId:'u',cabinetId:'c',userName:'Мария'},
  personality:{character:'insider',humor:'light',support:true,address:'informal'},
  classification:{reason:'conversation-followup',modules:['sales']},
  dataBridge:{ async getMany(){ return { sales:{ok:true,data:{
    available:true,
    period:{from:'2026-07-29',to:'2026-08-04',days:7},
    summary:{revenue:6592685,orders:9111,sales:9691,returns:107,returnRate:1.1},
    fulfillment:{FBS:{orders:2480},FBO:{orders:6500},classifiedOrders:8980,unknownOrders:131,ordersAvailable:true},
    topByRevenue:[],topBySales:[],
  }} } } },
})
assert.match(answer.text,/Из 9[\s\u00a0]?111 заказов/i)
assert.match(answer.text,/FBS — 2[\s\u00a0]?480/i)
assert.match(answer.text,/FBO — 6[\s\u00a0]?500/i)
assert.match(answer.text,/Без подтверждённой схемы — 131/i)
assert.doesNotMatch(answer.text,/Продажи за|выручка —/i)
assert.equal(2480 + 6500 + 131, 9111, 'FBS/FBO/unknown split must not double-count orders')

const returnsAnswer = await runElAnalyst({
  message:'а возвратов?',
  history:[{role:'assistant',content:'Заказов — 9 111.',analysisContext:{period:{from:'2026-07-29',to:'2026-08-04',days:7},modules:['sales'],metric:'orders'}}],
  context:{period:{from:'2026-07-29',to:'2026-08-04',days:7},conversationFollowup:{isFollowup:true,metric:'returns'}},
  identity:{userId:'u',cabinetId:'c',userName:'Мария'},
  personality:{character:'friendly',humor:'off',support:true,address:'informal'},
  classification:{reason:'conversation-followup',modules:['sales']},
  dataBridge:{async getMany(){return {sales:{ok:true,data:{available:true,period:{from:'2026-07-29',to:'2026-08-04',days:7},summary:{orders:9111,sales:9691,returns:107,returnRate:1.1}}}}}},
})
assert.match(returnsAnswer.text,/возвратов — 107 шт/i)
assert.doesNotMatch(returnsAnswer.text,/Продажи за|заказов — 9/i)

const unavailableSplit = await runElAnalyst({
  message:'а сколько FBS?',history:[],
  context:{period:{from:'2026-07-29',to:'2026-08-04',days:7},conversationFollowup:{isFollowup:true,metric:'fbs_orders'}},
  identity:{userId:'u',cabinetId:'c',userName:'Мария'},
  personality:{character:'insider',humor:'off',support:true,address:'informal'},
  classification:{reason:'conversation-followup',modules:['sales']},
  dataBridge:{async getMany(){return {sales:{ok:true,data:{available:true,period:{from:'2026-07-29',to:'2026-08-04',days:7},summary:{orders:9111,sales:9691,returns:107},fulfillment:{FBS:{orders:0},FBO:{orders:0},classifiedOrders:0,unknownOrders:9111,ordersAvailable:true}}}}}},
})
assert.match(unavailableSplit.text,/схема FBS\/FBO.*не подтверждена/i)
assert.doesNotMatch(unavailableSplit.text,/FBS — 0 \(0/i)

console.log('ELISEI conversational follow-up tests passed')
