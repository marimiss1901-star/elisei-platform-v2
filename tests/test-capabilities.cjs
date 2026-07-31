'use strict';
const assert=require('node:assert/strict');
const r=require('../backend/payload/backend/src/services/elModuleRegistry.cjs');
assert.equal(r.publicCapabilities().length,12);
assert.deepEqual(r.detectModules('Разбери рекламу и прибыль').sort(),['advertising','finance'].sort());
assert.ok(r.detectModules('Что с возвратами и отзывами?').includes('reviews'));
console.log('capabilities ok');
