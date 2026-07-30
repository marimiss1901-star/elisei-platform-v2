'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const client = require(path.resolve(__dirname, '../payload/backend/src/integrations/wb/promotionClient.cjs'));
assert.deepEqual(client.splitDateRange('2026-01-01', '2026-02-05'), [
  { from: '2026-01-01', to: '2026-01-31' },
  { from: '2026-02-01', to: '2026-02-05' },
]);
const flattened = client.flattenCampaigns({ adverts: [{ type: 9, status: 9, advert_list: [{ advertId: 1 }, { advertId: 2 }] }] });
assert.equal(flattened.length, 2);
assert.equal(flattened[0].status, 9);
assert.throws(() => client.requireToken(''), (error) => error.code === 'WB_CABINET_TOKEN_MISSING');
console.log('client: ok');
