function textValue(value) {
  if (value == null) return ''
  return String(value).trim().toLowerCase()
}

function flag(row, ...keys) {
  return keys.some(key => row?.[key] === true || row?.[key] === 1 || textValue(row?.[key]) === 'true')
}

export function classifyOrderFulfillment(row = {}) {
  if (flag(row, 'isFbs', 'is_fbs', 'fbs', 'sellerWarehouse', 'seller_warehouse')) return 'FBS'
  if (flag(row, 'isFbo', 'is_fbo', 'fbo', 'wbWarehouse', 'wb_warehouse')) return 'FBO'

  const raw = [
    row.fulfillmentMode, row.fulfillment_mode,
    row.deliveryMethod, row.delivery_method,
    row.deliveryType, row.delivery_type,
    row.deliveryModel, row.delivery_model,
    row.warehouseType, row.warehouse_type,
    row.orderType, row.order_type,
    row.scheme, row.model,
    row.warehouseName, row.warehouse_name, row.warehouse,
  ].map(textValue).filter(Boolean).join(' | ')

  if (/(^|[^a-zа-я0-9])(fbs|фбс)([^a-zа-я0-9]|$)/i.test(raw) || /склад\s+продавц|со\s+склада\s+продавц|продавец\s+достав/i.test(raw)) return 'FBS'
  if (/(^|[^a-zа-я0-9])(fbo|фбо|fbw)([^a-zа-я0-9]|$)/i.test(raw) || /склад\s+(?:wb|wildberries)|со\s+склада\s+(?:wb|wildberries)/i.test(raw)) return 'FBO'

  // Сборочное задание и стикер существуют у поставки со склада продавца.
  if (row.assemblyId != null || row.assembly_id != null || row.stickerId != null || row.sticker_id != null) return 'FBS'
  return 'UNKNOWN'
}

export function splitOrdersByFulfillment(rows = []) {
  const result = { total:0, fbs:0, fbo:0, unknown:0 }
  for (const row of Array.isArray(rows) ? rows : []) {
    result.total += 1
    const mode = classifyOrderFulfillment(row)
    if (mode === 'FBS') result.fbs += 1
    else if (mode === 'FBO') result.fbo += 1
    else result.unknown += 1
  }
  result.classified = result.fbs + result.fbo
  result.available = result.total > 0
  return result
}
