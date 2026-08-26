import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOrderFeedRequest, orderFeedRateLimitSeconds, orderFeedMigrationPolicy } from '../src/wb/order-feed.js'
import { normalizeRequiredMeta, fbsCustomsDeclarationState, classifyFbsStickerError } from '../src/wb/fbs-required-meta.js'
import { upstreamUnavailableState, preserveLastConfirmedValue } from '../src/wb/wb-temporary-availability.js'

test('order-feed builder enforces the 31-day contract and analytics endpoint', () => {
  const request = buildOrderFeedRequest({
    start:'2026-08-01T00:00:00Z', end:'2026-08-24T00:00:00Z', offset:20, limit:500,
  })
  assert.equal(request.method,'POST')
  assert.match(request.url,/seller-analytics-api\.wildberries\.ru\/api\/analytics\/v1\/order-feed$/)
  const body = JSON.parse(request.body)
  assert.equal(body.pagination.offset,20)
  assert.equal(body.pagination.limit,500)
  assert.deepEqual(body.nmIds,[])
  assert.throws(() => buildOrderFeedRequest({start:'2026-07-01T00:00:00Z',end:'2026-08-24T00:00:00Z'}), /31/)
})

test('order-feed migration keeps historical data outside new API window', () => {
  const policy = orderFeedMigrationPolicy()
  assert.equal(policy.maxPeriodDays,31)
  assert.equal(policy.strategy,'shadow-then-primary')
  assert.equal(orderFeedRateLimitSeconds('personal'),60)
  assert.equal(orderFeedRateLimitSeconds('basic'),10800)
})

test('FBS requiredMeta is preserved and customs declaration is only attachable in confirm', () => {
  assert.deepEqual(normalizeRequiredMeta(['customsDeclaration','customsDeclaration']),['customsDeclaration'])
  const confirm = fbsCustomsDeclarationState({status:'confirm',requiredMeta:['customsDeclaration']})
  assert.equal(confirm.customsRequired,true)
  assert.equal(confirm.canAttachCustomsDeclaration,true)
  const newOrder = fbsCustomsDeclarationState({status:'new',requiredMeta:['customsDeclaration']})
  assert.equal(newOrder.canAttachCustomsDeclaration,false)
  const classified = classifyFbsStickerError({status:409,code:'CustomsDeclarationIsRequired'})
  assert.equal(classified.code,'WB_FBS_CUSTOMS_DECLARATION_REQUIRED')
  assert.equal(classified.retryable,false)
})

test('temporary WB absence never becomes a false zero', () => {
  const state = upstreamUnavailableState({stream:'wbWarehouseTariffs',lastConfirmedValue:125})
  assert.equal(state.displayValue,null)
  assert.equal(state.lastConfirmedValue,125)
  assert.equal(state.mustNotCoerceToZero,true)
  assert.equal(preserveLastConfirmedValue(null,125),125)
})
