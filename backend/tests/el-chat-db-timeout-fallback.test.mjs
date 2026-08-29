import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
const route = fs.readFileSync(path.join(root,'backend/src/routes/elCore.cjs'),'utf8')
const dashboard = fs.readFileSync(path.join(root,'src/pages/DashboardPage.jsx'),'utf8')

assert.ok(route.includes('function isTransientStorageError'),'El route must classify transient DB/storage errors')
assert.match(route,/timeout exceeded when trying to connect/,'El route must recognize PostgreSQL connect timeout')
assert.ok(route.includes("code: transient ? 'EL_STORAGE_RECONNECTING'"),'raw storage timeouts must get a stable frontend code')
assert.ok(route.includes("bestEffort('el-conversation', () => memoryStore.loadConversation(identity, conversationId), [])"),'conversation history must not block El answers during DB reconnects')
assert.ok(route.includes("bestEffort('el-memories', () => memoryStore.listMemories(identity), [])"),'memory list must be optional during DB reconnects')
assert.ok(route.includes("bestEffort('el-save-conversation', () => memoryStore.appendMessages"),'conversation persistence must not turn a good answer into an error')
assert.ok(route.includes("bestEffort('el-prefetch', () => dataBridge.prefetchForQuestion(message)"),'module prefetch must not block screen-context fallback')

assert.ok(dashboard.includes('function friendlyElErrorMessage'),'frontend must translate El technical failures')
assert.ok(dashboard.includes("code === 'EL_STORAGE_RECONNECTING'"),'frontend must handle transient El storage reconnects explicitly')
assert.ok(!dashboard.includes("text:error.message || 'Не удалось получить ответ Эла"),'frontend must not show raw El error text first')

console.log('ELISEI El chat DB timeout fallback tests passed')
