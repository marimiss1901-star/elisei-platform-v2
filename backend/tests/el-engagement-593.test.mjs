import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { buildElEngagementData } from '../src/services/elEngagement.js'

const require = createRequire(import.meta.url)
const { detectModules } = require('../src/services/elModuleRegistry.cjs')
const { FORMATTERS } = require('../src/services/elAnalystEngine.cjs')

const result = buildElEngagementData({
  period:{from:'2026-08-01',to:'2026-08-06',days:6},
  reviews:[
    {id:'r1',productValuation:2,text:'Маломерит',isAnswered:false,createdDate:'2026-08-05T10:00:00Z',productDetails:{nmId:101,supplierArticle:'A-101',productName:'Туфли'}},
    {id:'r2',productValuation:5,text:'Отлично',isAnswered:true,createdDate:'2026-08-04T10:00:00Z',productDetails:{nmId:102,supplierArticle:'A-102',productName:'Кеды'}},
  ],
  questions:[
    {id:'q1',text:'Есть ли размер 39?',isAnswered:false,createdDate:'2026-08-05T11:00:00Z',productDetails:{nmId:101,supplierArticle:'A-101',productName:'Туфли'}},
  ],
  chats:[
    {rowType:'chat',chatID:'c1',lastMessage:{text:'Здравствуйте'}},
    {rowType:'event',eventID:'e1',chatID:'c1',message:{text:'Когда отправите?'},createdAt:'2026-08-05T12:00:00Z'},
  ],
  totals:{reviews:2,questions:1,chats:2},
  summaries:{
    reviews:{total:2,answered:1,unanswered:1,archived:0},
    questions:{total:1,answered:0,unanswered:1},
    chats:{total:2,chatCount:1,eventCount:1},
  },
})

assert.equal(result.available,true)
assert.equal(result.summary.reviews.averageRating,3.5)
assert.equal(result.summary.reviews.lowRated,1)
assert.equal(result.summary.reviews.unanswered,1)
assert.equal(result.summary.questions.unanswered,1)
assert.equal(result.summary.chats.readOnly,true)
assert.equal(result.lowRatedReviews[0].vendorCode,'A-101')
assert.equal(result.unansweredQuestions[0].nmID,101)
assert.equal(result.productSignals[0].vendorCode,'A-101')
assert.equal(result.productSignals[0].lowRatedReviews,1)
assert.equal(result.productSignals[0].unansweredQuestions,1)
assert.equal(result.productSignals[0].attentionScore,6)

assert.deepEqual(detectModules('Покажи вопросы покупателей и чаты',3),['reviews'])
const answer = FORMATTERS.reviews(result,{})
assert.match(answer,/низких оценок 1–3/i)
assert.match(answer,/неотвеченные вопросы/i)
assert.match(answer,/только для анализа/i)

const empty = buildElEngagementData()
assert.equal(empty.available,false)
assert.match(empty.warning,/не синхронизированы/i)

console.log('ELISEI 5.9.3 engagement data tests passed')
