import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertFbsSupplyReadyForDelivery,
  fbsShippingReadiness,
} from '../src/wb/api-policy.js'
import { jamEvidenceFromFinanceRows } from '../src/wb/finance-core.js'

test('FBS shipping metadata is enforced from 1 October 2026', () => {
  const before = fbsShippingReadiness({},new Date('2026-09-30T20:59:59.000Z'))
  assert.equal(before.ready,true)

  const after = fbsShippingReadiness({},new Date('2026-10-01T00:00:00+03:00'))
  assert.equal(after.ready,false)
  assert.deepEqual(after.missing,['shippingMethod','shippingDate','shippingPointId'])

  assert.throws(() => assertFbsSupplyReadyForDelivery({
    shippingMethod:'transport-company',
    shippingDate:'2026-10-02',
    shippingPointId:'123',
  },new Date('2026-10-01T00:00:00+03:00')), error => {
    assert.equal(error.code,'WB_FBS_SHIPPING_METADATA_REQUIRED')
    assert.deepEqual(error.missing,['etrnId'])
    return true
  })

  const ready = assertFbsSupplyReadyForDelivery({
    shippingMethod:'transport-company',
    shippingDate:'2026-10-02',
    shippingPointId:'123',
    etrnId:'etrn-001',
  },new Date('2026-10-01T00:00:00+03:00'))
  assert.equal(ready.ready,true)
})

test('Jam subscription is detected even when old ledger code is deduction', () => {
  const result = jamEvidenceFromFinanceRows([
    {
      movementKey:'finance:1:deduction',
      operationCode:'deduction',
      operationGroup:'deductions',
      operationName:'Удержание WB',
      sellerOperation:'Списание за подписку Джем',
      amount:-1990,
      operationDate:'2026-09-08',
      includedInPnl:true,
      detailOnly:false,
    },
    {
      movementKey:'finance:2:deduction',
      operationCode:'deduction',
      operationName:'Прочее удержание',
      amount:-500,
      operationDate:'2026-09-08',
    },
  ])
  assert.equal(result.confirmed,true)
  assert.equal(result.amount,1990)
  assert.equal(result.operations.length,1)
})

test('Jam evidence avoids duplicate movement keys', () => {
  const row = {
    movementKey:'finance:jam:1',
    operationCode:'jam_subscription',
    operationName:'Подписка «Джем»',
    amount:-990,
  }
  const result = jamEvidenceFromFinanceRows([row,row])
  assert.equal(result.amount,990)
  assert.equal(result.operations.length,1)
})
