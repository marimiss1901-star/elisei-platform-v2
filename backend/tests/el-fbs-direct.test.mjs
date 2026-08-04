import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { classifyOrderFulfillment, splitOrdersByFulfillment } from '../src/services/elFulfillment.js'

const require = createRequire(import.meta.url)
const { detectModules } = require('../src/services/elModuleRegistry.cjs')
const { classifyElRequest } = require('../src/services/elModeRouter.cjs')
const { runElAnalyst } = require('../src/services/elAnalystEngine.cjs')

assert.equal(classifyOrderFulfillment({ warehouseType:'Склад продавца' }), 'FBS')
assert.equal(classifyOrderFulfillment({ deliveryMethod:'FBS' }), 'FBS')
assert.equal(classifyOrderFulfillment({ assemblyId:123 }), 'FBS')
assert.equal(classifyOrderFulfillment({ warehouseType:'Склад WB' }), 'FBO')
assert.equal(classifyOrderFulfillment({ fulfillmentMode:'FBW' }), 'FBO')
assert.equal(classifyOrderFulfillment({ warehouseName:'Коледино' }), 'UNKNOWN')

const split = splitOrdersByFulfillment([
  { deliveryMethod:'FBS' },
  { warehouseType:'Склад продавца' },
  { fulfillmentMode:'FBO' },
  { warehouseName:'Коледино' },
])
assert.deepEqual(split,{ total:4,fbs:2,fbo:1,unknown:1,classified:3,available:true })

assert.deepEqual(detectModules('сколько из них заказов фбс'), ['sales'])
assert.deepEqual(classifyElRequest({message:'сколько из них заказов фбс',requestedMode:'analyst',history:[]}).modules,['sales'])

const targeted = await runElAnalyst({
  message:'сколько из них заказов фбс',
  history:[],
  context:{
    period:{from:'2026-07-29',to:'2026-08-04',days:7},
    conversationFollowup:{isFollowup:true,metric:'fbs_orders',inheritedModules:[]},
    screen:{period:{from:'2026-07-29',to:'2026-08-04',days:7},summary:{orders:9111,revenue:6592685,sales:9691,returns:107}},
  },
  identity:{userId:'u',cabinetId:'c',userName:'Мария'},
  personality:{character:'insider',humor:'light',support:true,address:'informal'},
  classification:{reason:'cabinet-question',modules:['sales']},
  dataBridge:{async getMany(){return {sales:{ok:false,warning:'temporary bridge failure'}}}},
})
assert.match(targeted.text,/9[\s\u00a0]?111 заказов/i)
assert.match(targeted.text,/(?:разбивку|схема) FBS\/FBO/i)
assert.doesNotMatch(targeted.text,/проверим подключение WB|поток притормозил/i)

const routeSource = fs.readFileSync(new URL('../src/routes/elCore.cjs', import.meta.url),'utf8')
assert.match(routeSource,/salesFollowupMetrics\.has\(conversationFollowup\.metric\)/)
assert.match(routeSource,/direct-sales-metric/)

console.log('ELISEI direct FBS/FBO routing tests passed')
