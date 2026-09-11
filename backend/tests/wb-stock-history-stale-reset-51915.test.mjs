import assert from 'node:assert/strict'
import fs from 'node:fs'

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
const migration=fs.readFileSync(new URL('../migrate-stock-history-stale-reset.mjs',import.meta.url),'utf8')
const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'))

for(const marker of [
  'pollAttempts >= 24',
  'staleReportResetCount',
  "phase:'create'",
  "reportType:'STOCK_HISTORY_DAILY_CSV'",
  'staleReportPreviousPollAttempts:pollAttempts',
]) assert.ok(server.includes(marker),`stockHistory runtime watchdog must contain ${marker}`)

assert.ok(migration.includes("COALESCE((metadata->>'pollAttempts')::int,0) >= 24"),
  'startup migration must find long-running stockHistory reports')
assert.ok(migration.includes("status='queued'"),'startup migration must requeue the stale report')
assert.ok(migration.includes("next_allowed_at=GREATEST"),'startup migration must preserve a real WB cooldown')
assert.ok(migration.includes("purpose:'stock_history_recovery'"),'startup recovery must use a fresh rolling period')
assert.ok(pkg.scripts.prestart.includes('migrate-stock-history-stale-reset.mjs'),
  'production startup must run the stale stockHistory recovery migration')

console.log('ELISEI 5.19.15 stock-history stale-report recovery regression: OK')
