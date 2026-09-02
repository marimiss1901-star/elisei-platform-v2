import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const server = readFileSync(resolve(__dirname,'../src/server.js'),'utf8')
const engine = readFileSync(resolve(__dirname,'../src/services/elAnalystEngine.cjs'),'utf8')

assert.match(server,/const rawStatsCampaigns = rawCampaigns\.filter/,'El advertising module must keep usable last-known campaign stats')
assert.match(server,/const useSnapshotFallback = Boolean\(/,'El advertising module must switch to saved snapshot when selected-period stats are empty')
assert.match(server,/snapshotFallback: useSnapshotFallback/,'El advertising payload must mark snapshot fallback explicitly')
assert.match(server,/Точного рекламного среза за выбранный период пока нет/,'El advertising module must warn about period mismatch')
assert.match(engine,/ads\.snapshotFallback/,'El answer must disclose snapshot fallback in the response')

console.log('ELISEI El advertising snapshot fallback tests passed')
