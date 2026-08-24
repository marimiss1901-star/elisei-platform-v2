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
    legacyEndpoints:Object.freeze([
      'GET /api/v1/supplier/orders',
      'GET /api/v1/supplier/sales',
    ]),
    migration:'shadow-then-primary',
    legacyDisableDate:null,
  }),
  temporaryAvailability: Object.freeze({
    wbWarehouseSupplyData: Object.freeze({
      since:'2026-08-15',
      state:'temporarily-unavailable-upstream',
      zeroIsForbidden:true,
    }),
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
