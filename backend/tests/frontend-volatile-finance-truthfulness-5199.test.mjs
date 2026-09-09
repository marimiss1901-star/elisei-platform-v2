import assert from 'node:assert/strict'
import fs from 'node:fs'

const patch=fs.readFileSync(new URL('../../apply-volatile-finance-truthfulness-ui.mjs',import.meta.url),'utf8')
const pkg=JSON.parse(fs.readFileSync(new URL('../../package.json',import.meta.url),'utf8'))

assert.match(patch,/value !== 0 \|\| selectedPeriodCovered \? value : null/,
  'volatile finance categories must stay unconfirmed until finance covers the selected period')
assert.match(patch,/penalties:volatileFinanceAmount\('penalties'\)/)
assert.match(patch,/deductions:volatileFinanceAmount\('deductions'\)/)
assert.match(patch,/subscriptions:volatileFinanceAmount\('subscriptions'\)/)
assert.match(patch,/otherWbExpenses:volatileComputedAmount\(otherWbExpenses\)/)
assert.match(patch,/additionalPayment:volatileComputedAmount\(pnlCompensations\)/)
assert.ok(pkg.scripts.prebuild.includes('apply-volatile-finance-truthfulness-ui.mjs'),
  'frontend prebuild must apply volatile finance truthfulness patch')
assert.equal(pkg.version,'5.15.9','canonical frontend version guard must remain unchanged')

console.log('ELISEI 5.19.9 volatile finance truthfulness regression: OK')
