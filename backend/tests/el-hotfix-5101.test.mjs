import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const conversation = require('../src/services/elConversationContext.cjs')
assert.equal(typeof conversation.shouldForceSalesModule,'function','conversation helper must export shouldForceSalesModule')
assert.equal(conversation.shouldForceSalesModule({metric:'orders',detectedModules:['sales']}),true)
assert.equal(conversation.shouldForceSalesModule({metric:'returns',detectedModules:['returns','reviews']}),false,'multi-module request must not collapse to sales')

const route = fs.readFileSync(new URL('../src/routes/elCore.cjs',import.meta.url),'utf8')
assert.ok(route.includes("typeof conversationContext.shouldForceSalesModule === 'function'"),'elCore must keep a safe mixed-deploy fallback')
assert.ok(route.includes("version: '5.13.0'"),'El Core status must report current release 5.13.0')

const server = fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
assert.ok(server.includes("version: '2.25.0'"),'backend health must report current release 2.25.0')
assert.ok(server.includes('ELISEI/2.25.0'),'WB User-Agent must use backend release version')

console.log('ELISEI 5.10.1 conversation hotfix tests passed')
