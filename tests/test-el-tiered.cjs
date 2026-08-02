'use strict';

const assert = require('node:assert/strict');
const { classifyElRequest } = require('../backend/src/services/elModeRouter.cjs');
const { canUseMode, tierFeatures } = require('../backend/src/services/elPlans.cjs');
const { runElAnalyst } = require('../backend/src/services/elAnalystEngine.cjs');
const { functionTools } = require('../backend/src/services/elAgent.cjs');

async function main() {
  assert.equal(classifyElRequest({ message:'Какие кампании съедают прибыль?', requestedMode:'pro' }).mode, 'analyst');
  assert.equal(classifyElRequest({ message:'Найди свежие изменения правил Wildberries', requestedMode:'pro' }).mode, 'pro');
  assert.equal(classifyElRequest({ message:'Напиши ответ покупателю', requestedMode:'gpt' }).mode, 'gpt');

  assert.equal(canUseMode({ tier:'analyst' }, 'analyst'), true);
  assert.equal(canUseMode({ tier:'analyst' }, 'gpt'), false);
  assert.equal(canUseMode({ tier:'gpt' }, 'pro'), false);
  assert.equal(canUseMode({ tier:'pro' }, 'pro'), true);
  assert.deepEqual(tierFeatures('analyst').webSearch, false);

  const toolsWithoutMemory = functionTools({ allowMemory:false });
  assert.equal(toolsWithoutMemory.some(item => item.name === 'remember_user_preference'), false);
  assert.equal(functionTools().some(item => item.name === 'remember_user_preference'), true);

  let openAiCalls = 0;
  const dataBridge = {
    getMany: async () => ({
      advertising: {
        ok:true,
        data:{
          available:true,
          period:{ from:'2026-07-27', to:'2026-08-02' },
          summary:{ spend:50000, operatingProfit:120000, margin:18 },
          advertising:{
            statsAvailable:true,
            totals:{ spend:50000, revenue:180000, orders:40, crr:27.8 },
            campaigns:[
              { advertId:1, name:'Кеды', spend:30000, revenue:60000, orders:10, clicks:100, statsStatus:'loaded' },
              { advertId:2, name:'Ботинки', spend:20000, revenue:120000, orders:30, clicks:200, statsStatus:'loaded' },
            ],
          },
          productsWithAds:[{ title:'Кеды', vendorCode:'A1', advertising:30000, profit:-5000, margin:-4 }],
        },
      },
    }),
  };
  const answer = await runElAnalyst({
    message:'Какие рекламные кампании съедают прибыль?',
    tone:'adaptive_playful',
    dataBridge,
    classification:{ modules:['advertising'], reason:'cabinet-question' },
    requestResponses:async () => { openAiCalls += 1; },
  });
  assert.equal(openAiCalls, 0);
  assert.equal(answer.apiUsed, false);
  assert.equal(answer.model, 'elisei-analyst-local');
  assert.match(answer.text, /Кеды/);
  assert.match(answer.text, /ДРР/);

  console.log('ELISEI 5.4.3 tiered El tests: OK');
}

main().catch(error => { console.error(error); process.exit(1); });
