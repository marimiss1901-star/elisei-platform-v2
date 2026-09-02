import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
const dashboard = fs.readFileSync(path.join(root,'src/pages/DashboardPage.jsx'),'utf8')
const api = fs.readFileSync(path.join(root,'src/lib/api.js'),'utf8')

assert.ok(dashboard.includes('function safeSetLocalStorage'),'dashboard must wrap localStorage writes')
assert.ok(dashboard.includes('function safeGetLocalStorage'),'dashboard must wrap localStorage reads that affect initial render')
assert.ok(dashboard.includes('function writeElMessagesStorage'),'El chat history must have quota-safe persistence')
assert.ok(dashboard.includes('compactElMessageForStorage'),'El messages must be compacted before persistence')
assert.ok(dashboard.includes('normalized.slice(-24)'),'El chat storage must keep a bounded history')
assert.ok(dashboard.includes('normalized.slice(-2)'),'El chat storage must have an emergency tiny fallback')
assert.ok(dashboard.includes('pruneOldElMessageStorage(key)'),'quota fallback must prune old El message keys')
assert.ok(dashboard.includes("key?.startsWith('elisei_read_cache_v1:')"),'quota fallback must clear read caches before crashing the app')
assert.ok(dashboard.includes('writeElMessagesStorage(elMessagesStorageKey, messages)'),'messages effect must not write directly to localStorage')
assert.ok(!dashboard.includes("localStorage.setItem(elMessagesStorageKey"),'El messages must not use raw localStorage.setItem')
assert.ok(dashboard.includes('safeGetLocalStorage(elConversationStorageKey)'),'El conversation id must not read storage directly during render')
assert.ok(dashboard.includes('safeGetLocalStorage(ANALYTICS_COMPARE_KEY)'),'compare flag must not read storage directly during render')
assert.ok(dashboard.includes("writeSessionJson(ANALYTICS_PERIOD_KEY, analyticsPeriod)"),'analytics period persistence must be best-effort')
assert.ok(dashboard.includes("safeSetLocalStorage(ANALYTICS_COMPARE_KEY"),'compare flag persistence must be best-effort')
assert.ok(api.includes('auth persistence is best-effort when browser storage is full'),'auth token persistence must not crash the app on quota errors')

console.log('ELISEI frontend localStorage quota guard tests passed')
