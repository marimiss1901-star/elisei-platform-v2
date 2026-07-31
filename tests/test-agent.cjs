'use strict';
const assert=require('node:assert/strict');
const {functionTools}=require('../backend/payload/backend/src/services/elAgent.cjs');
const names=functionTools().map(x=>x.name);
assert.ok(names.includes('get_elisei_module_data'));
assert.ok(names.includes('compare_elisei_modules'));
console.log('agent ok');
