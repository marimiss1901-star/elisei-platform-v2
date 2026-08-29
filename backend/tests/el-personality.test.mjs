import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { detectModules } = require('../src/services/elModuleRegistry.cjs')
const {
  normalizeElProfile, mergeElProfiles, createVoiceContext, humorLine, socialResponse,
} = require('../src/services/elPersonality.cjs')
const { createMemoryStore } = require('../src/services/elMemoryStore.cjs')
const { runElAnalyst } = require('../src/services/elAnalystEngine.cjs')
const { buildInstructions } = require('../src/services/elPrompt.cjs')

const migrated = normalizeElProfile({ character:'friendly', humor:true, support:false, address:'formal' })
assert.equal(migrated.character, 'friendly')
assert.equal(migrated.humor, 'light')
assert.equal(migrated.support, false)
assert.equal(migrated.address, 'formal')
assert.equal(migrated.noHumorInCritical, true)
assert.equal(normalizeElProfile({userName:'Алексей'}).preferredName, '', 'account name must not be silently persisted as El preferred name')
assert.equal(mergeElProfiles({preferredName:'Мария',character:'insider'},{preferredName:'',humor:'noticeable'}).preferredName, 'Мария', 'blank chat payload must not erase stored preferred name')

const criticalVoice = createVoiceContext({
  profile:{ character:'insider',humor:'noticeable' },
  message:'У нас убыток и штраф, что делать?',
  history:[], context:{}, seed:'critical',
})
assert.equal(criticalVoice.critical, true)
assert.equal(criticalVoice.humorAllowed, false)
assert.equal(humorLine(criticalVoice, 'finance'), '')

const firstVoice = createVoiceContext({ profile:{humor:'noticeable'},message:'реклама',history:[],context:{},seed:'same' })
const firstJoke = humorLine(firstVoice, 'ads')
assert.ok(firstJoke)
const secondVoice = createVoiceContext({ profile:{humor:'noticeable'},message:'реклама',history:[{role:'assistant',content:firstJoke}],context:{},seed:'same' })
const secondJoke = humorLine(secondVoice, 'ads')
assert.ok(secondJoke)
assert.notEqual(secondJoke, firstJoke, 'neighboring answers should avoid the same joke')

const support = socialResponse({
  message:'Эл, я устала', profile:{character:'insider',humor:'light',support:true},
  history:[], context:{}, identity:{userName:'Мария'},
})
assert.equal(support.kind, 'support')
assert.equal(support.reaction.mood, 'supportive')
assert.match(support.text, /Мария/i)
assert.match(support.text, /без героизма/i)


const playfulGreeting = socialResponse({
  message:'приветики', profile:{character:'insider',humor:'light',support:true,address:'informal'},
  history:[], context:{screen:{localHour:11}}, identity:{userName:'Мария'},
})
assert.equal(playfulGreeting.kind, 'social')
assert.equal(playfulGreeting.reaction.mood, 'happy')
assert.match(playfulGreeting.text, /Приветики, Мария/i)
assert.doesNotMatch(playfulGreeting.text, /подтверждённых данных/i)

const presence = socialResponse({
  message:'ты тут?', profile:{character:'friendly',humor:'off',support:true,address:'informal'},
  history:[], context:{}, identity:{userName:'Мария'},
})
assert.equal(presence.kind, 'social')
assert.match(presence.text, /здесь|на связи/i)

const noDataInsider = await runElAnalyst({
  message:'Проверь прибыль', history:[],context:{},identity:{userId:'u',cabinetId:'c',userName:'Мария'},
  personality:{character:'insider',humor:'light',support:true,address:'informal'},
  classification:{reason:'cabinet-question',modules:['finance']},
  dataBridge:{ async getMany(){ return { finance:{ok:false,warning:'Финансы ожидают синхронизацию'} } } },
})
assert.match(noDataInsider.text, /Мария/i)
assert.match(noDataInsider.text, /не буду изображать ясновидящего/i)
assert.doesNotMatch(noDataInsider.text, /^Я понял вопрос, но подтверждённых данных/i)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'elisei-el-profile-'))
const previousDataDir = process.env.ELISEI_DATA_DIR
process.env.ELISEI_DATA_DIR = tmp
try {
  const store = createMemoryStore()
  const identity = { userId:'test-user',cabinetId:'main' }
  await store.saveProfile(identity, migrated)
  const loaded = await store.getProfile(identity)
  assert.equal(loaded.character, 'friendly')
  assert.equal(loaded.humor, 'light')
} finally {
  if (previousDataDir == null) delete process.env.ELISEI_DATA_DIR
  else process.env.ELISEI_DATA_DIR = previousDataDir
  fs.rmSync(tmp, { recursive:true,force:true })
}

const financeBridge = {
  async getMany() {
    return {
      finance:{ ok:true,data:{ available:true,period:{from:'2026-08-01',to:'2026-08-04'},summary:{
        revenue:1200000,cogs:500000,commission:200000,logistics:90000,advertising:60000,storage:10000,fixed:0,tax:0,operatingProfit:340000,margin:28.3,
      },missingCostProducts:[],lossMakingProducts:[] } },
    }
  },
}
const analyst = await runElAnalyst({
  message:'Покажи финансы', history:[],context:{},identity:{userId:'u',cabinetId:'c',userName:'Мария'},
  personality:{character:'insider',humor:'noticeable',support:true},
  classification:{reason:'cabinet-question',modules:['finance']}, dataBridge:financeBridge,
})
assert.equal(analyst.apiUsed, false)
assert.equal(analyst.modulesUsed[0], 'finance')
assert.ok(analyst.reaction)
assert.ok(analyst.grounding.facts.some(item => String(item).startsWith('Финансы')))
assert.match(analyst.text, /P&L/)

const criticalAnalyst = await runElAnalyst({
  message:'У нас убыток и штраф, проверь финансы', history:[],context:{},identity:{userId:'u',cabinetId:'c'},
  personality:{character:'insider',humor:'noticeable',support:true},
  classification:{reason:'cabinet-question',modules:['finance']}, dataBridge:financeBridge,
})
assert.equal(criticalAnalyst.reaction.mood, 'concerned')
assert.doesNotMatch(criticalAnalyst.text, /лям двести|показать чеки|вся компания в сборе/i)

const prompt = buildInstructions({
  identity:{userId:'u',cabinetId:'c',cabinetName:'WB',userName:'Мария'},context:{},memories:[],allowWeb:false,
  personality:{character:'insider',humor:'noticeable',support:true,celebrations:true,address:'informal'},
})
assert.match(prompt, /В критических ситуациях[^\n]+юмор всегда запрещён/i)
assert.match(prompt, /не повторяй одну и ту же шутку/i)
assert.match(prompt, /имя: Мария/i)

console.log('ELISEI living El personality tests passed')

const preferredProfile = normalizeElProfile({ character:'insider', preferredName:'  Мария 123 ' })
assert.equal(preferredProfile.preferredName, 'Мария')

const screenFallbackAnalyst = await runElAnalyst({
  message:'Сколько у нас продаж и заказов?', history:[],
  context:{ screen:{ period:{from:'2026-08-01',to:'2026-08-04'}, summary:{ revenue:6511633,orders:9022,sales:9573,returns:107,returnRate:1.1 } } },
  identity:{userId:'u',cabinetId:'c',userName:'Мария'},
  personality:{character:'insider',humor:'off',support:true,address:'informal'},
  classification:{reason:'cabinet-question',modules:['sales']},
  dataBridge:{ async getMany(){ return { sales:{ok:false,warning:'Внутренний мост временно недоступен'} } } },
})
assert.match(screenFallbackAnalyst.text, /9[\s\u00a0]?573|9573/)
assert.match(screenFallbackAnalyst.text, /9[\s\u00a0]?022|9022/)
assert.doesNotMatch(screenFallbackAnalyst.text, /Продажи и заказы.*недоступны/i)
assert.match(screenFallbackAnalyst.text, /текущего экрана ELISEI/i)

assert.equal(detectModules('Покажи по каждому артикулу рекламу эквайринг комиссию и прибыль')[0], 'finance')

const productPnlAnswer = await runElAnalyst({
  message:'Покажи по каждому артикулу рекламу, эквайринг, комиссию и прибыль',
  history:[],context:{ period:{from:'2026-08-28',to:'2026-08-28',days:1} },
  identity:{userId:'u',cabinetId:'c',userName:'Мария'},
  personality:{character:'professional',humor:'off',support:false,address:'informal'},
  classification:{reason:'cabinet-question',modules:['finance']},
  dataBridge:{ async getMany(){ return { finance:{ok:true,data:{ available:true,period:{from:'2026-08-28',to:'2026-08-28',days:1},summary:{revenue:109257,operatingProfit:44139,margin:40.4},productPnlRows:[
    {nmID:2505,vendorCode:'2505',title:'Удлинитель 3м',revenue:109257,sales:164,returns:4,advertising:8907,commission:21851,logistics:0,acquiring:0,storage:0,penalties:0,deductions:0,expenses:65118,profit:44139,margin:40.4,financeSource:'wb_finance_api'},
  ],missingCostProducts:[]} } } } },
})
assert.match(productPnlAnswer.text,/Товарный P&L/)
assert.match(productPnlAnswer.text,/2505/)
assert.match(productPnlAnswer.text,/эквайринг/)
assert.match(productPnlAnswer.text,/комиссия/)
assert.match(productPnlAnswer.text,/Источник: WB финансы/)
assert.doesNotMatch(productPnlAnswer.text,/P&L за 28\.08\.2026:/)
