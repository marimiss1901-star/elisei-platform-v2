import assert from 'node:assert/strict'
import fs from 'node:fs'
import { coreMartRevision } from '../src/wb/core-mart.js'

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
const mart=fs.readFileSync(new URL('../src/wb/core-mart.js',import.meta.url),'utf8')

assert.ok(mart.includes('CREATE TABLE IF NOT EXISTS wb_core_marts'),'period mart schema must exist')
assert.ok(mart.includes('PRIMARY KEY(connection_id,period_from,period_to)'),'one durable result per cabinet and period')
assert.ok(server.includes('const cachedMart = range ? await loadCoreMart'),'core must read a ready period before hydrating WB streams')
assert.ok(server.indexOf('const cachedMart = range ? await loadCoreMart') < server.indexOf('const { data, sources, recovered, recoveryQueued } = await canonicalConnectionData(connection)'),
  'mart lookup must happen before the expensive canonical hydration')
assert.ok(server.includes("mart:{ hit:true,source:'wb_core_marts'"),'cache hits must be observable')
assert.ok(server.includes('await saveCoreMart(pool'),'computed periods must be persisted')

const settings={ taxRate:6,costs:{'123':450} }
const states=[{stage:'sales',last_success_at:'2026-09-01T10:00:00Z',last_count:10}]
const first=coreMartRevision(states,settings)
assert.equal(first,coreMartRevision([...states],{...settings}),'same inputs must keep the same revision')
assert.notEqual(first,coreMartRevision([{...states[0],last_count:11}],settings),'new WB data must invalidate the period mart')
assert.notEqual(first,coreMartRevision(states,{...settings,taxRate:7}),'business settings must invalidate the period mart')

console.log('ELISEI 5.18.0 WB core period mart regression: OK')
