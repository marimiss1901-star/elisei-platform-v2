export const WB_API_POLICY = Object.freeze({
  metadata: Object.freeze({
    dbs: Object.freeze({
      endpoint: 'https://marketplace-api.wildberries.ru/api/marketplace/v3/dbs/orders/meta/details',
      method: 'POST',
      deprecated: 'POST /api/marketplace/v3/dbs/orders/meta/info',
      disabledAt: '2026-07-27T00:00:00.000Z',
    }),
    dbw: Object.freeze({
      endpoint: 'https://marketplace-api.wildberries.ru/api/marketplace/v3/dbw/orders/meta/details',
      method: 'POST',
      deprecated: 'GET /api/v3/dbw/orders/{orderId}/meta',
      disabledAt: '2026-07-27T00:00:00.000Z',
    }),
    clickCollect: Object.freeze({
      endpoint: 'https://marketplace-api.wildberries.ru/api/marketplace/v3/click-collect/orders/meta/details',
      method: 'POST',
      deprecated: 'POST /api/marketplace/v3/click-collect/orders/meta/info',
      disabledAt: '2026-07-15T00:00:00.000Z',
    }),
  }),
  sellerWarehouses: Object.freeze({
    sgtCargoType: 2,
    apiWriteCutoff: '2026-08-05T00:00:00+03:00',
    management: 'seller-cabinet-only',
    readEndpoint: 'https://marketplace-api.wildberries.ru/api/v3/warehouses',
  }),
  orderFeed: Object.freeze({
    endpoint:'https://seller-analytics-api.wildberries.ru/api/analytics/v1/order-feed',
    method:'POST',
    scope:'analytics',
    maxPeriodDays:31,
    role:'primary-current-orders-and-sales',
    legacyHistory:Object.freeze([
      'GET /api/v1/supplier/orders',
      'GET /api/v1/supplier/sales',
    ]),
  }),
  fbsShipping: Object.freeze({
    requiredFrom:'2026-10-01T00:00:00+03:00',
    shippingPointsEndpoint:'https://marketplace-api.wildberries.ru/api/marketplace/v3/fbs/shipping-points',
    shippingMethodEndpoint:'https://marketplace-api.wildberries.ru/api/marketplace/v3/fbs/supplies/shipping-method',
    deliverPath:'/api/v3/supplies/{supplyId}/deliver',
    etrnRequiredForTransportCompany:true,
  }),
})

function requestMethod(options = {}) {
  return String(options.method || 'GET').trim().toUpperCase()
}

function requestBody(options = {}) {
  if (options.body == null) return null
  if (typeof options.body === 'object') return options.body
  try { return JSON.parse(String(options.body)) } catch { return null }
}

function apiPath(url) {
  try { return new URL(String(url)).pathname } catch { return String(url || '').split('?')[0] }
}

export function orderMetaDetailsEndpoint(model) {
  const rawKey = String(model || '').trim().toLowerCase()
  const key = ['click-collect','click_collect','clickcollect','pickup','самовывоз'].includes(rawKey) ? 'clickCollect' : rawKey
  const definition = WB_API_POLICY.metadata[key]
  if (!definition) throw Object.assign(new Error(`Неизвестная модель заказов WB: ${model}`), { status:400 })
  return definition.endpoint
}

export function buildOrderMetaDetailsRequest(model, orderIds = []) {
  const ids = [...new Set((Array.isArray(orderIds) ? orderIds : []).map(Number).filter(Number.isFinite))]
  if (!ids.length) throw Object.assign(new Error('Для meta/details не переданы ID сборочных заданий'), { status:400 })
  return {
    url: orderMetaDetailsEndpoint(model),
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ orders:ids }),
  }
}

export function fbsShippingReadiness(value = {}, now = new Date()) {
  const activeFrom = Date.parse(WB_API_POLICY.fbsShipping.requiredFrom)
  const active = Number.isFinite(activeFrom) && new Date(now).getTime() >= activeFrom
  const method = String(value?.shippingMethod || value?.method || '').trim()
  const date = String(value?.shippingDate || value?.date || '').trim()
  const pointId = String(value?.shippingPointId || value?.pointId || '').trim()
  const etrnId = String(value?.etrnId || value?.eTrnId || value?.transportDocumentId || '').trim()
  const transportCompany = Boolean(value?.transportCompany) || /transport|carrier|тк|транспорт/i.test(method)
  const missing = []
  if (!method) missing.push('shippingMethod')
  if (!date) missing.push('shippingDate')
  if (!pointId) missing.push('shippingPointId')
  if (transportCompany && !etrnId) missing.push('etrnId')
  return {
    active,
    ready:!active || missing.length === 0,
    missing,
    transportCompany,
    etrnRequired:transportCompany,
    requiredFrom:WB_API_POLICY.fbsShipping.requiredFrom,
  }
}

export function assertFbsSupplyReadyForDelivery(value = {}, now = new Date()) {
  const readiness = fbsShippingReadiness(value,now)
  if (!readiness.ready) {
    throw Object.assign(new Error(`FBS-поставка не готова к передаче в доставку: не заполнено ${readiness.missing.join(', ')}.`), {
      status:409,
      code:'WB_FBS_SHIPPING_METADATA_REQUIRED',
      missing:readiness.missing,
      requiredFrom:readiness.requiredFrom,
    })
  }
  return readiness
}

export function assertWbApiRequestAllowed(url, options = {}, now = new Date()) {
  const method = requestMethod(options)
  const path = apiPath(url)

  if (method === 'POST' && path === '/api/marketplace/v3/dbs/orders/meta/info') {
    throw Object.assign(new Error('Устаревший метод DBS meta/info отключён WB. Используйте POST /api/marketplace/v3/dbs/orders/meta/details.'), {
      status:410, code:'WB_DEPRECATED_META_ENDPOINT', replacement:WB_API_POLICY.metadata.dbs.endpoint,
    })
  }
  if (method === 'GET' && /^\/api\/v3\/dbw\/orders\/[^/]+\/meta$/.test(path)) {
    throw Object.assign(new Error('Устаревший метод DBW {orderId}/meta отключён WB. Используйте POST /api/marketplace/v3/dbw/orders/meta/details.'), {
      status:410, code:'WB_DEPRECATED_META_ENDPOINT', replacement:WB_API_POLICY.metadata.dbw.endpoint,
    })
  }
  if (method === 'POST' && path === '/api/marketplace/v3/click-collect/orders/meta/info') {
    throw Object.assign(new Error('Устаревший метод Самовывоза meta/info отключён WB. Используйте POST /api/marketplace/v3/click-collect/orders/meta/details.'), {
      status:410, code:'WB_DEPRECATED_META_ENDPOINT', replacement:WB_API_POLICY.metadata.clickCollect.endpoint,
    })
  }

  const cutoff = Date.parse(WB_API_POLICY.sellerWarehouses.apiWriteCutoff)
  const afterCutoff = Number.isFinite(cutoff) && new Date(now).getTime() >= cutoff
  const isWarehouseCreate = method === 'POST' && path === '/api/v3/warehouses'
  const isWarehouseUpdate = method === 'PUT' && /^\/api\/v3\/warehouses\/[^/]+$/.test(path)
  if (isWarehouseCreate || isWarehouseUpdate) {
    const body = requestBody(options)
    const declaredCargoType = Number(options.warehouseCargoType ?? body?.cargoType)
    if (declaredCargoType === WB_API_POLICY.sellerWarehouses.sgtCargoType) {
      throw Object.assign(new Error('Создание и редактирование СГТ-складов через API закрыто с 5 августа 2026 года. Используйте личный кабинет Wildberries.'), {
        status:410, code:'WB_SGT_WAREHOUSE_API_DISABLED',
      })
    }
    if (afterCutoff && !Number.isFinite(declaredCargoType)) {
      throw Object.assign(new Error('После 5 августа 2026 года ELISEI не выполняет изменение склада продавца без явно подтверждённого типа груза. СГТ-склады управляются только в кабинете WB.'), {
        status:409, code:'WB_WAREHOUSE_CARGO_TYPE_REQUIRED',
      })
    }
  }

  if (method === 'PATCH' && /^\/api\/v3\/supplies\/[^/]+\/deliver$/.test(path)) {
    const body = requestBody(options) || {}
    const shipping = options.fbsShipping || body.fbsShipping || body.shipping || body
    assertFbsSupplyReadyForDelivery(shipping,now)
  }
  return true
}

export function sellerWarehouseReadSummary(warehouses = []) {
  const rows = Array.isArray(warehouses) ? warehouses : []
  const sgtWarehouses = rows.filter(row => Number(row?.cargoType) === WB_API_POLICY.sellerWarehouses.sgtCargoType)
  return {
    totalWarehouses: rows.length,
    sgtWarehouses: sgtWarehouses.length,
    sgtWarehouseIds: sgtWarehouses.map(row => Number(row?.id ?? row?.warehouseId)).filter(Number.isFinite),
    sgtManagement: WB_API_POLICY.sellerWarehouses.management,
    sgtApiWriteCutoff: WB_API_POLICY.sellerWarehouses.apiWriteCutoff,
  }
}
