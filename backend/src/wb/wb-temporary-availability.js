export const WB_TEMPORARY_AVAILABILITY = Object.freeze({
  wbWarehouseSupplyData: Object.freeze({
    since:'2026-08-15',
    status:'temporarily-unavailable-upstream',
    userMessage:'Часть данных по складам и поставкам временно недоступна со стороны Wildberries.',
  }),
})

export function upstreamUnavailableState({ stream, lastConfirmedAt = null, lastConfirmedValue = null, reason = '' } = {}) {
  return {
    stream:String(stream || ''),
    available:false,
    confirmed:false,
    status:'temporarily-unavailable-upstream',
    reason:String(reason || WB_TEMPORARY_AVAILABILITY.wbWarehouseSupplyData.userMessage),
    lastConfirmedAt:lastConfirmedAt || null,
    lastConfirmedValue:lastConfirmedValue ?? null,
    displayValue:null,
    mustNotCoerceToZero:true,
  }
}

export function preserveLastConfirmedValue(current, fallback) {
  if (current !== undefined && current !== null) return current
  return fallback !== undefined ? fallback : null
}
