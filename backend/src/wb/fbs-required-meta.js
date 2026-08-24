export function normalizeRequiredMeta(value) {
  if (!value) return []
  if (Array.isArray(value)) return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))]
  if (typeof value === 'object') {
    return [...new Set(Object.entries(value).filter(([,enabled]) => Boolean(enabled)).map(([key]) => String(key).trim()).filter(Boolean))]
  }
  return [String(value).trim()].filter(Boolean)
}

export function hasRequiredMeta(order, needle) {
  const target = String(needle || '').trim().toLowerCase()
  if (!target) return false
  return normalizeRequiredMeta(order?.requiredMeta).some(item => item.toLowerCase().includes(target))
}

export function fbsCustomsDeclarationState(order = {}) {
  const status = String(order?.status || order?.wbStatus || '').trim().toLowerCase()
  const requiredMeta = normalizeRequiredMeta(order?.requiredMeta)
  const customsRequired = requiredMeta.some(item => /customs|declar|дт|тамож/i.test(item))
  return {
    requiredMeta,
    customsRequired,
    status,
    canAttachCustomsDeclaration: customsRequired && status === 'confirm',
  }
}

export function classifyFbsStickerError(error = {}) {
  const status = Number(error?.status || error?.statusCode || 0)
  const code = String(error?.code || error?.response?.code || '')
  const message = String(error?.message || error?.response?.message || '')
  const customsRequired = status === 409 && /CustomsDeclarationIsRequired|customs declaration|декларац/i.test(`${code} ${message}`)
  if (!customsRequired) return null
  return {
    code:'WB_FBS_CUSTOMS_DECLARATION_REQUIRED',
    status:409,
    retryable:false,
    userMessage:'WB требует номер таможенной декларации для этого сборочного задания. Перед получением стикера проверьте requiredMeta и статус confirm.',
  }
}
