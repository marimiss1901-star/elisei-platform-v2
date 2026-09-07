import assert from 'node:assert/strict'
import fs from 'node:fs'

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'))

assert.ok(server.includes('PARTITION BY marketplace,seller_id'),'duplicate guard must rank one active pipeline per WB seller cabinet globally')
assert.ok(!server.includes('PARTITION BY user_id,marketplace,seller_id'),'different ELISEI test users must not create duplicate background pipelines for the same WB seller')
assert.ok(server.includes("WHERE status='connected' AND seller_id IS NOT NULL AND BTRIM(seller_id)<>''"),'only real connected seller identities should be deduplicated')
assert.ok(server.includes("SET status='superseded',updated_at=NOW()"),'older duplicate connections must be preserved but deactivated')
assert.ok(server.includes("SET status='superseded',next_allowed_at=NULL"),'active retry queues of superseded connections must be stopped')
assert.ok(server.includes("UPDATE wb_webhooks\n      SET enabled=FALSE,status='superseded'"),'webhooks of superseded connections must be disabled')
assert.ok(server.includes("[ELISEI 5.18.8] Superseded duplicate WB seller connection(s):"),'startup must log duplicate cleanup')
assert.ok(pkg.scripts.prestart.includes('apply-duplicate-seller-connection-guard.mjs'),'production startup must apply duplicate seller guard')
assert.ok(pkg.scripts.pretest.includes('apply-duplicate-seller-connection-guard.mjs'),'tests must run against duplicate-guarded server')

console.log('ELISEI 5.18.8 duplicate WB seller connection regression: OK')
