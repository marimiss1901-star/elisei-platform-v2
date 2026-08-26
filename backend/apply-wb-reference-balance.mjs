import fs from 'node:fs'

function edit(path, mutate) {
  const before = fs.readFileSync(path,'utf8')
  const after = mutate(before)
  fs.writeFileSync(path,after)
}

function replaceOnce(source, oldText, newText, label) {
  if (source.includes(newText)) return source
  if (!source.includes(oldText)) throw new Error(`WB reference/balance patch: ${label} target not found`)
  return source.replace(oldText,newText)
}

edit('src/wb/stream-store.js', source => {
  source = replaceOnce(source,
    "  'finance',\n  'paidStorage',",
    "  'finance',\n  'balance',\n  'paidStorage',",
    'balance stream registration')
  source = replaceOnce(source,
    "const OBJECT_STREAMS = new Set(['advertising', 'finance', 'acquiring'",
    "const OBJECT_STREAMS = new Set(['advertising', 'finance', 'balance', 'acquiring'",
    'balance object stream')
  source = replaceOnce(source,
    "  if (stream === 'acquiring') {",
    "  if (stream === 'balance') {\n    return payload && typeof payload === 'object' && !Array.isArray(payload)\n      ? { currency:'RUB', current:null, for_withdraw:null, updatedAt:null, complete:true, ...payload }\n      : { currency:'RUB', current:null, for_withdraw:null, updatedAt:null, complete:false }\n  }\n  if (stream === 'acquiring') {",
    'balance payload normalization')
  source = replaceOnce(source,
    "  if (OBJECT_STREAMS.has(stream)) return Number(payload?.totalRows ?? (Array.isArray(payload?.rows) ? payload.rows.length : 0)) || 0",
    "  if (stream === 'balance') return payload && (payload.current != null || payload.for_withdraw != null) ? 1 : 0\n  if (OBJECT_STREAMS.has(stream)) return Number(payload?.totalRows ?? (Array.isArray(payload?.rows) ? payload.rows.length : 0)) || 0",
    'balance stream count')
  source = replaceOnce(source,
    "'advertising','finance','paidStorage'",
    "'advertising','finance','balance','paidStorage'",
    'balance DB stream constraint')
  return source
})

edit('src/wb/smart-scheduler.js', source => {
  source = replaceOnce(source,
    "  stocks: 35,\n  finance: 40,",
    "  stocks: 35,\n  balance: 38,\n  finance: 40,",
    'balance scheduler priority')
  source = replaceOnce(source,
    "  finance:'finance', acquiring:'finance'",
    "  balance:'finance', finance:'finance', acquiring:'finance'",
    'balance scheduler group')
  return source
})

edit('src/wb/daily-ready.js', source => {
  source = replaceOnce(source,
    "export const DAILY_READY_HEAVY_INTERVALS_SECONDS = Object.freeze({\n  // Nightly Ready:",
    "export const DAILY_READY_HEAVY_INTERVALS_SECONDS = Object.freeze({\n  // Current WB balance is a light snapshot, but by product policy it belongs\n  // to the nightly lane rather than competing with seller-day operations.\n  // 20h guarantees it becomes eligible again in the next business-night window.\n  balance: 20 * 60 * 60,\n\n  // Nightly Ready:",
    'nightly balance cadence')
  return source
})

edit('src/wb/data-quality.js', source => {
  source = replaceOnce(source,
    "  finance:{ label:'Финансы WB',weight:18,freshSeconds:14*3600,critical:true },",
    "  finance:{ label:'Финансы WB',weight:18,freshSeconds:14*3600,critical:true },\n  balance:{ label:'Баланс WB',weight:2,freshSeconds:30*3600,mode:'snapshot' },",
    'balance data quality passport')
  return source
})

edit('src/server.js', source => {
  source = replaceOnce(source,
    "  finance: { label: 'Финансы WB', scope: 'finance' },",
    "  finance: { label: 'Финансы WB', scope: 'finance' },\n  balance: { label: 'Баланс WB', scope: 'finance' },",
    'balance stage definition')

  source = replaceOnce(source,
    "  if (stage === 'finance') return value && typeof value === 'object' ? value : { rows:[], totals:{}, period:null, balance:null, complete:true }",
    "  if (stage === 'finance') return value && typeof value === 'object' ? value : { rows:[], totals:{}, period:null, balance:null, complete:true }\n  if (stage === 'balance') return value && typeof value === 'object' && !Array.isArray(value) ? value : { currency:'RUB',current:null,for_withdraw:null,updatedAt:null,complete:false }",
    'balance previous value')

  source = replaceOnce(source,
    "  if (stage === 'finance' || stage === 'acquiring') return Array.isArray(value?.rows) ? value.rows.length : 0",
    "  if (stage === 'finance' || stage === 'acquiring') return Array.isArray(value?.rows) ? value.rows.length : 0\n  if (stage === 'balance') return value && (value.current != null || value.for_withdraw != null) ? 1 : 0",
    'balance stage count')

  source = replaceOnce(source,
    "  const financeData = data?.finance && typeof data.finance === 'object' && !Array.isArray(data.finance) ? data.finance : { rows:[], totals:{}, balance:null, period:null }\n  const financeRows",
    "  const financeData = data?.finance && typeof data.finance === 'object' && !Array.isArray(data.finance) ? data.finance : { rows:[], totals:{}, balance:null, period:null }\n  const separateBalance = data?.balance && typeof data.balance === 'object' && !Array.isArray(data.balance) ? data.balance : null\n  const accountBalanceData = separateBalance && (separateBalance.current != null || separateBalance.for_withdraw != null) ? separateBalance : (financeData?.balance || null)\n  const financeRows",
    'canonical account balance selection')

  source = replaceOnce(source,
    "      balance: financeData?.balance || null,",
    "      balance: accountBalanceData,",
    'core finance balance source')

  source = replaceOnce(source,
    "    paidStorage: streamDataAvailable(stageStatus, 'paidStorage', paidStorageRows.length),",
    "    balance: streamDataAvailable(stageStatus, 'balance', accountBalanceData && (accountBalanceData.current != null || accountBalanceData.for_withdraw != null) ? 1 : 0),\n    paidStorage: streamDataAvailable(stageStatus, 'paidStorage', paidStorageRows.length),",
    'balance analytics availability')

  const loader = `async function loadSellerBalance(token, { deadlineAt = 0 } = {}) {\n  const raw = await wbFetch('https://finance-api.wildberries.ru/api/v1/account/balance', token, {\n    label:'Баланс WB', timeoutMs:20000, maxAttempts:2, maxRetryDelayMs:65000, deadlineAt,\n  })\n  const money = value => {\n    if (value === null || value === undefined || value === '') return null\n    const number = Number(value)\n    return Number.isFinite(number) ? Math.round(number * 100) / 100 : null\n  }\n  const value = {\n    currency:String(raw?.currency || 'RUB'),\n    current:money(raw?.current),\n    for_withdraw:money(raw?.for_withdraw),\n    updatedAt:new Date().toISOString(),\n    complete:true,\n  }\n  if (value.current == null && value.for_withdraw == null) {\n    throw Object.assign(new Error('Баланс WB: ответ не содержит current/for_withdraw'), { status:502 })\n  }\n  return {\n    value,\n    endpoint:'https://finance-api.wildberries.ru/api/v1/account/balance',\n    validation:{accessConfirmed:true,currency:value.currency,currentAvailable:value.current != null,withdrawAvailable:value.for_withdraw != null},\n  }\n}\n\n`
  if (!source.includes('async function loadSellerBalance(')) {
    const marker = 'async function runSyncStage({ connection, tokens, data, stage, deadlineAt }) {'
    if (!source.includes(marker)) throw new Error('WB reference/balance patch: balance loader insertion target not found')
    source = source.replace(marker,loader+marker)
  }

  source = replaceOnce(source,
    "    } else if (stage === 'financeReports' || stage === 'acquiringReports') {",
    "    } else if (stage === 'balance') {\n      const loaded = await loadSellerBalance(selected.token, { deadlineAt })\n      value = loaded.value\n      meta = loaded.validation || null\n      snapshot = loaded\n    } else if (stage === 'financeReports' || stage === 'acquiringReports') {",
    'balance runner branch')

  return source
})

console.log('WB working-reference balance stream applied')
