import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')
const main = fs.readFileSync(path.join(root,'src/main.jsx'),'utf8')
const boundary = fs.readFileSync(path.join(root,'src/components/AppErrorBoundary.jsx'),'utf8')
const dashboard = fs.readFileSync(path.join(root,'src/pages/DashboardPage.jsx'),'utf8')
const css = fs.readFileSync(path.join(root,'src/styles/app.css'),'utf8')

assert.ok(main.includes("import AppErrorBoundary from './components/AppErrorBoundary'"),'main must import the global render guard')
assert.ok(main.includes('<AppErrorBoundary>') && main.includes('</AppErrorBoundary>'),'app must be wrapped in the global render guard')
assert.ok(boundary.includes('getDerivedStateFromError'),'error boundary must catch render failures')
assert.ok(boundary.includes('ELISEI восстановил интерфейс'),'error boundary must show a recovery screen instead of a black screen')
assert.ok(boundary.includes('Вернуться в кабинет'),'error boundary must provide a user recovery action')
assert.ok(css.includes('.app-crash-shell') && css.includes('.app-crash-card'),'recovery screen must have visible styles')
assert.ok(dashboard.includes('messages.map((rawMessage,index) => {'),'El chat must normalize messages at render time')
assert.ok(dashboard.includes('const message = normalizeElChatMessage(rawMessage)'),'El chat render must guard malformed API/localStorage messages')
assert.ok(!dashboard.includes('{messages.map((message,index) => (\\n            <div'),'El chat must not render raw messages directly')

console.log('ELISEI frontend global render guard tests passed')
