import assert from 'node:assert/strict'
import { applyPaidStorageBreakdown, queryPaidStorageBreakdown } from '../src/wb/storage-ledger.js'

const fakePool = {
  async query(sql,params){
    assert.match(sql,/source_stream='paidStorage'/)
    assert.deepEqual(params,['c1','2026-08-31','2026-09-06'])
    return { rows:[{
      nmId:'271964857',vendorCode:'2505 чер 3м',warehouse:'Склад WB РФ',days:7,amount:700,
      dateFrom:'2026-08-31',dateTo:'2026-09-06',warehouseAggregated:true,
    }] }
  },
}

const rows = await queryPaidStorageBreakdown(fakePool,{connectionId:'c1',from:'2026-08-31',to:'2026-09-06'})
assert.equal(rows.length,1)
assert.equal(rows[0].rubPerDay,100)
assert.equal(rows[0].warehouseAggregated,true)

const core = {
  products:[{
    nmID:271964857,vendorCode:'2505 чер 3м',title:'Сетевой фильтр',revenue:10000,
    storage:0,expenses:8000,profit:2000,margin:20,
  }],
  summary:{revenue:10000,storage:0,operatingProfit:2000,margin:20},
}
applyPaidStorageBreakdown(core,rows)
assert.equal(core.products[0].storage,700)
assert.equal(core.products[0].storageSource,'paid_storage_ledger')
assert.equal(core.products[0].expenses,8700)
assert.equal(core.products[0].profit,1300)
assert.equal(core.products[0].margin,13)
assert.equal(core.summary.storage,700)
assert.equal(core.summary.operatingProfit,1300)
assert.equal(core.storageBreakdown[0].shareOfRevenue,7)
assert.equal(core.storageBreakdown[0].rubPerDay,100)
assert.equal(core.storageBreakdownSummary.total,700)

console.log('storage ledger product/warehouse regression passed')
