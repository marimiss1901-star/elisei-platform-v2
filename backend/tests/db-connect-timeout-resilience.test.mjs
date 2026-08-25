import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const here=path.dirname(fileURLToPath(import.meta.url))
const backendRoot=path.resolve(here,'..')
const repoRoot=path.resolve(backendRoot,'..')

const preload=fs.readFileSync(path.join(backendRoot,'src/db-resilience-preload.mjs'),'utf8')
const throttle=fs.readFileSync(path.join(repoRoot,'apply-secondary-read-throttle.mjs'),'utf8')
const packageJson=fs.readFileSync(path.join(repoRoot,'package.json'),'utf8')

assert.ok(preload.includes('timeout exceeded when trying to connect'),'node-postgres pool connection timeout must be classified as transient')
assert.ok(preload.includes("code:'DATABASE_RECONNECTING'"),'transient DB timeout must return DATABASE_RECONNECTING')
assert.ok(throttle.includes('const secondaryReaders = ['),'secondary workspace readers must be explicitly throttled')
assert.ok(throttle.includes('value:await read()'),'secondary workspace readers must execute sequentially')
assert.ok(throttle.includes('window.setTimeout(resolve, 180)'),'secondary reads need a small gap to release DB pressure')
assert.ok(packageJson.includes('node apply-secondary-read-throttle.mjs'),'frontend build must apply the secondary-read throttle')

console.log('DB connect timeout resilience regression passed')
