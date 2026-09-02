import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const ledgerSource = fs.readFileSync(new URL('../src/wb/finance-ledger.js',import.meta.url),'utf8')
  .replace(/export function normalizeFinanceLedgerRows/,'function normalizeFinanceLedgerRows')
  .replace(/export function classifyFinanceSpecialOperation/,'function classifyFinanceSpecialOperation')
  .replace(/export function financeFulfillmentMode/,'function financeFulfillmentMode')
  .replace(/export async function ensureFinanceLedgerSchema[\s\S]*$/,'')
  .concat('\nresult=normalizeFinanceLedgerRows("finance",input,"row-1",0)')
const sandbox = { input:{ retailAmount:1000,forPay:700,vw:200,vwNds:40 },result:null }
vm.runInNewContext(ledgerSource,sandbox)
assert.ok(sandbox.result.length > 0)
assert.ok(sandbox.result.every(row => row.fulfillmentMode === 'FBO'),'finance rows without an FBS marker must persist the resolved FBO mode')

const page = fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx',import.meta.url),'utf8')
assert.match(page,/const financeScopeFiltered = \['fbs','fbo'/,'scheme and category tabs must be recognized as filtered scopes')
assert.match(page,/ledgerHasMovements \|\| financeScopeFiltered \? rawLedgerSummary/,'an empty filtered scope must never inherit whole-cabinet totals')
assert.match(page,/Итоги всего кабинета сюда не подставляются/,'empty filtered state must explain why totals are absent')

console.log('WB finance filter truth 5.18.5: OK')
