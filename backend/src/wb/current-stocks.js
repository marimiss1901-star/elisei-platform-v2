// Current WB warehouse inventory reader (2026 API).
// Only inventory physically held by WB is read through Seller Analytics here.
// FBS inventory stays in server.js on the official Marketplace API flow:
// GET /api/v3/warehouses + POST /api/v3/stocks/{warehouseId}.

const WB_STOCKS_ENDPOINT = 'https://seller-analytics-api.wildberries.ru/api/analytics/v1/stocks-report/wb-warehouses'
const MAX_ROWS = 250000

function itemsFrom(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.items)) return payload.items
  if (Array.isArray(payload?.data?.items)) return payload.data.items
  if (Array.isArray(payload?.data)) return payload.data
  return []
}

function positiveNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function cleanId(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

function normalizeCurrentItem(item = {}, fallbackWarehouse = 'Склад WB') {
  return {
    nmId:cleanId(item.nmId ?? item.nmID),
    chrtId:cleanId(item.chrtId ?? item.chrtID),
    warehouseId:Number.isFinite(Number(item.warehouseId)) ? Number(item.warehouseId) : null,
    warehouseName:String(item.warehouseName || fallbackWarehouse),
    regionName:String(item.regionName || ''),
    quantity:positiveNumber(item.quantity),
    inWayToClient:positiveNumber(item.inWayToClient),
    inWayFromClient:positiveNumber(item.inWayFromClient),
  }
}

export function aggregateWbWarehouseItems(items = []) {
  // Since WB's August 2026 warehouse consolidation the seller-facing Russian
  // stock is represented as one virtual WB warehouse (-999999 / "Склад WB").
  // Aggregate defensively so ELISEI does not resurrect obsolete per-office FBO
  // detail if a mixed response is temporarily returned during the migration.
  const grouped = new Map()
  for (const raw of Array.isArray(items) ? items : []) {
    const item = normalizeCurrentItem(raw, 'Склад WB')
    if (!item.nmId) continue
    const key = `${item.nmId}:${item.chrtId || ''}`
    const current = grouped.get(key) || {
      nmId:item.nmId,
      chrtId:item.chrtId,
      warehouseId:-999999,
      warehouseName:'Склад WB',
      regionName:'Склад WB',
      quantity:0,
      inWayToClient:0,
      inWayFromClient:0,
    }
    current.quantity += item.quantity
    current.inWayToClient += item.inWayToClient
    current.inWayFromClient += item.inWayFromClient
    grouped.set(key,current)
  }
  return [...grouped.values()].map(row => ({
    ...row,
    quantity:Math.round(row.quantity),
    inWayToClient:Math.round(row.inWayToClient),
    inWayFromClient:Math.round(row.inWayFromClient),
  }))
}

async function requestCurrentInventory(request, endpoint, token, body, label, deadlineAt) {
  const payload = await request(endpoint, token, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body),
    label,
    timeoutMs:60000,
    maxAttempts:2,
    maxRetryDelayMs:3000,
    deadlineAt,
  })
  return { payload, items:itemsFrom(payload) }
}

export async function loadCurrentWbStocks(token, { request, deadlineAt = 0 } = {}) {
  if (typeof request !== 'function') throw new Error('WB stocks request transport is required')
  const rawPages=[]
  const collected=[]
  let offset=0
  while (true) {
    const {payload,items}=await requestCurrentInventory(
      request,WB_STOCKS_ENDPOINT,token,
      {nmIds:[],chrtIds:[],limit:MAX_ROWS,offset},
      'Текущие остатки · Склад WB',deadlineAt,
    )
    rawPages.push(payload)
    collected.push(...items)
    if (items.length < MAX_ROWS) break
    offset += items.length
    if (offset > 2000000) throw new Error('WB stocks pagination safety limit exceeded')
  }
  const rows=aggregateWbWarehouseItems(collected)
  const totalQuantity=rows.reduce((sum,row)=>sum+positiveNumber(row.quantity),0)
  return {
    pending:false,
    rows,
    rawPayload:rawPages,
    endpoint:WB_STOCKS_ENDPOINT,
    stockMeta:{
      schemaVersion:6,
      source:'wb_current_stocks_report',
      sourceProfile:'wb-warehouses-v1',
      consolidatedWarehouse:true,
      warehouseId:-999999,
      warehouseName:'Склад WB',
      rows:rows.length,
      sourceRows:collected.length,
      totalQuantity:Math.round(totalQuantity),
      nonZeroRows:rows.filter(row=>row.quantity>0).length,
      warehouses:rows.length ? 1 : 0,
      receivedAt:new Date().toISOString(),
    },
    validation:{rows:rows.length,totalQuantity:Math.round(totalQuantity),consolidatedWarehouse:true},
  }
}

export const CURRENT_STOCK_ENDPOINTS = Object.freeze({
  wb:WB_STOCKS_ENDPOINT,
})
