import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dashboard = readFileSync(resolve(__dirname,'../../src/pages/DashboardPage.jsx'),'utf8')

assert.match(dashboard,/const asArray = value => Array\.isArray\(value\) \? value : \[\]/,'chat renderer must guard array-like response fields')
assert.match(dashboard,/const chatText = value =>/,'chat renderer must coerce non-string message text')
assert.match(dashboard,/const normalizeElChatMessage = \(message = \{\}\) =>/,'El messages must be normalized before render/storage')
assert.match(dashboard,/stored\.slice\(-50\)\.map\(normalizeElChatMessage\)/,'stored chat history must be sanitized before React renders it')
assert.match(dashboard,/writeElMessagesStorage\(elMessagesStorageKey, messages\)/,'persisted chat history must use quota-safe sanitized storage')
assert.match(dashboard,/setMessages\(current => \[\.\.\.current\.map\(normalizeElChatMessage\), userMessage\]\)/,'user send path must keep message state sanitized')
assert.match(dashboard,/setMessages\(current => \[\.\.\.current\.map\(normalizeElChatMessage\), normalizeElChatMessage\(\{/,'El answer/error path must sanitize backend payloads')
assert.match(dashboard,/content:chatText\(item\.text\)/,'history sent back to El must use safe text content')

console.log('ELISEI frontend El chat render guard regression tests passed')
