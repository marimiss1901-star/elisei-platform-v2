import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  normalizeElProfile, createVoiceContext, humorLine, socialResponse,
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
