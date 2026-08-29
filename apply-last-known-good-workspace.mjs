import fs from 'node:fs'

const file = 'src/pages/DashboardPage.jsx'
let source = fs.readFileSync(file, 'utf8')
if (source.includes('ELISEI_CANONICAL_FRONTEND_PATCHES')) process.exit(0)

function replaceOnce(oldText, newText, label) {
  if (source.includes(newText)) return
  if (!source.includes(oldText)) throw new Error(`Golden-path workspace patch: ${label} target not found`)
  source = source.replace(oldText, newText)
}

replaceOnce(
`const normalizeAnalyticsPeriod = value => {\n  const fallback = periodPresetValue('yesterday')\n  const from = String(value?.from || '').slice(0,10)\n  const to = String(value?.to || '').slice(0,10)\n  const days = periodDaysBetween({from,to})\n  return days > 0 && days <= 366 ? { preset:value?.preset || 'custom', from, to } : fallback\n}\n`,
`const normalizeAnalyticsPeriod = value => {\n  const fallback = periodPresetValue('yesterday')\n  const preset = String(value?.preset || '')\n  // Relative presets are intentions, not frozen dates. Re-resolve them from\n  // today's local date every time the workspace starts. Only a manual custom\n  // range is allowed to remain fixed across days.\n  if (['yesterday','7','30','90','month','prevMonth','year'].includes(preset)) return periodPresetValue(preset)\n  const from = String(value?.from || '').slice(0,10)\n  const to = String(value?.to || '').slice(0,10)\n  const days = periodDaysBetween({from,to})\n  return days > 0 && days <= 366 ? { preset:'custom', from, to } : fallback\n}\n`,
'relative period refresh')

replaceOnce(
`const ANALYTICS_PERIOD_KEY = 'elisei.analytics.period.v2'\nconst ANALYTICS_COMPARE_KEY = 'elisei.analytics.compare.v1'\n`,
`const ANALYTICS_PERIOD_KEY = 'elisei.analytics.period.v2'\nconst ANALYTICS_COMPARE_KEY = 'elisei.analytics.compare.v1'\nconst WORKSPACE_CACHE_PREFIX = 'elisei.workspace.lastgood.v2.'\nconst ANALYTICS_CACHE_PREFIX = 'elisei.analytics.lastgood.v2.'\n\nfunction readSessionJson(key, fallback = null) {\n  try {\n    const raw = localStorage.getItem(key)\n    return raw ? JSON.parse(raw) : fallback\n  } catch { return fallback }\n}\n\nfunction writeSessionJson(key, value) {\n  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* cache is best-effort */ }\n}\n\nconst workspaceCacheKey = connectionId => WORKSPACE_CACHE_PREFIX + String(connectionId || 'main')\nconst analyticsCacheKey = (connectionId, period) => ANALYTICS_CACHE_PREFIX + [connectionId || 'main', period?.from || '', period?.to || ''].join('|')\n`,
'persistent cache helpers')

replaceOnce(
`  const [analyticsCompare, setAnalyticsCompare] = useState(() => localStorage.getItem(ANALYTICS_COMPARE_KEY) !== 'false')\n`,
`  const [analyticsCompare, setAnalyticsCompare] = useState(() => localStorage.getItem(ANALYTICS_COMPARE_KEY) === 'true')\n`,
'comparison opt-in')

replaceOnce(
`  const analyticsRequestRef = useRef(0)\n`,
`  const analyticsRequestRef = useRef(0)\n  const analyticsPeriodKeyRef = useRef('')\n`,
'analytics period ref')

replaceOnce(
`  const loadConnectionData = async connectionId => {\n    const [dashboard, productResult, historyResult, coreResult, advertisingResult, diagnosticsResult] = await Promise.all([\n      wbApi.dashboard(connectionId), wbApi.products(connectionId), wbApi.syncHistory(connectionId), wbApi.core(connectionId), wbApi.advertising(connectionId,{ from:analyticsPeriod.from,to:analyticsPeriod.to }), wbApi.diagnostics(connectionId)\n    ])\n    setDashboardData(dashboard.dashboard || null)\n    setLiveProducts(productResult.products || [])\n    setSyncHistory(historyResult.history || [])\n    setCoreData(coreResult.core || null)\n    setAdvertisingSnapshot(advertisingResult.advertising || coreResult.core?.advertising || null)\n    setAdvertisingCoverage(advertisingResult.coverage || null)\n    setIntegrationDiagnostics(diagnosticsResult || null)\n    if (coreResult.core?.settings) setSettingsDraft(coreResult.core.settings)\n  }\n`,
`  const loadConnectionData = async connectionId => {\n    const cacheKey = workspaceCacheKey(connectionId)\n    const cached = readSessionJson(cacheKey, {}) || {}\n    const nextCache = { ...cached, savedAt:new Date().toISOString() }\n\n    // First meaningful paint: products only. The selected-period core is loaded\n    // exactly once by loadAnalyticsData, so the same 20+ WB streams are not\n    // hydrated twice on every entry.\n    try {\n      const productResult = await wbApi.products(connectionId)\n      const incomingProducts = Array.isArray(productResult?.products) ? productResult.products : null\n      if (incomingProducts && (incomingProducts.length > 0 || !Array.isArray(cached.products) || cached.products.length === 0)) {\n        setLiveProducts(incomingProducts)\n        nextCache.products = incomingProducts\n      } else if (Array.isArray(cached.products) && cached.products.length) {\n        setLiveProducts(current => current.length ? current : cached.products)\n      }\n      writeSessionJson(cacheKey,nextCache)\n    } catch (error) {\n      if (Array.isArray(cached.products) && cached.products.length) setLiveProducts(current => current.length ? current : cached.products)\n      else throw error\n    }\n\n    // Secondary workspace readers wait until the business core had a chance to\n    // paint. They are independent and can never blank the main business screen.\n    window.setTimeout(async () => {\n      const secondary = await Promise.allSettled([\n        wbApi.dashboard(connectionId),\n        wbApi.syncHistory(connectionId),\n        wbApi.advertising(connectionId,{ from:analyticsPeriod.from,to:analyticsPeriod.to }),\n        wbApi.diagnostics(connectionId),\n      ])\n      const value = index => secondary[index]?.status === 'fulfilled' ? secondary[index].value : null\n      const dashboard = value(0)\n      const historyResult = value(1)\n      const advertisingResult = value(2)\n      const diagnosticsResult = value(3)\n      const refreshedCache = { ...(readSessionJson(cacheKey,{}) || {}), savedAt:new Date().toISOString() }\n      if (dashboard?.dashboard) { setDashboardData(dashboard.dashboard); refreshedCache.dashboard=dashboard.dashboard }\n      else if (cached.dashboard) setDashboardData(current => current || cached.dashboard)\n      if (Array.isArray(historyResult?.history)) { setSyncHistory(historyResult.history); refreshedCache.history=historyResult.history }\n      else if (Array.isArray(cached.history)) setSyncHistory(current => current.length ? current : cached.history)\n      if (advertisingResult?.advertising) { setAdvertisingSnapshot(advertisingResult.advertising); refreshedCache.advertising=advertisingResult.advertising }\n      else if (cached.advertising) setAdvertisingSnapshot(current => current || cached.advertising)\n      if (advertisingResult?.coverage) { setAdvertisingCoverage(advertisingResult.coverage); refreshedCache.advertisingCoverage=advertisingResult.coverage }\n      else if (cached.advertisingCoverage) setAdvertisingCoverage(current => current || cached.advertisingCoverage)\n      if (diagnosticsResult) { setIntegrationDiagnostics(diagnosticsResult); refreshedCache.diagnostics=diagnosticsResult }\n      else if (cached.diagnostics) setIntegrationDiagnostics(current => current || cached.diagnostics)\n      if (secondary.some(item => item.status === 'fulfilled')) writeSessionJson(cacheKey,refreshedCache)\n    }, 1200)\n  }\n`,
'one-core workspace bootstrap')

replaceOnce(
`  const loadAnalyticsData = async (connectionId, period = analyticsPeriod, compare = analyticsCompare) => {\n    if (!connectionId || !period?.from || !period?.to) return\n    const requestId = ++analyticsRequestRef.current\n    setAnalyticsLoading(true)\n    setAnalyticsError('')\n    setAnalyticsCore(null)\n    setAnalyticsCompareCore(null)\n    try {\n      const previous = previousPeriodFor(period)\n      const [currentResult, previousResult] = await Promise.all([\n        wbApi.core(connectionId,{ from:period.from,to:period.to }),\n        compare ? wbApi.core(connectionId,{ from:previous.from,to:previous.to }) : Promise.resolve(null),\n      ])\n      if (requestId !== analyticsRequestRef.current) return\n      setAnalyticsCore(currentResult?.core || null)\n      setAnalyticsCompareCore(previousResult?.core || null)\n    } catch (error) {\n      if (requestId !== analyticsRequestRef.current) return\n      setAnalyticsError(error.message || 'Не удалось пересчитать аналитику за выбранный период.')\n    } finally {\n      if (requestId === analyticsRequestRef.current) setAnalyticsLoading(false)\n    }\n  }\n`,
`  const loadAnalyticsData = async (connectionId, period = analyticsPeriod, compare = analyticsCompare) => {\n    if (!connectionId || !period?.from || !period?.to) return\n    const requestId = ++analyticsRequestRef.current\n    const cacheKey = analyticsCacheKey(connectionId, period)\n    const cached = readSessionJson(cacheKey, null)\n    const previousKey = analyticsPeriodKeyRef.current\n    setAnalyticsLoading(true)\n    setAnalyticsError('')\n\n    if (previousKey !== cacheKey) {\n      if (cached?.core) {\n        setAnalyticsCore(cached.core)\n        setCoreData(cached.core)\n        setAnalyticsCompareCore(cached.compareCore || null)\n        analyticsPeriodKeyRef.current = cacheKey\n      } else if (previousKey) {\n        setAnalyticsCore(null)\n        setCoreData(null)\n        setAnalyticsCompareCore(null)\n      }\n    }\n\n    try {\n      const currentResult = await wbApi.core(connectionId,{ from:period.from,to:period.to })\n      if (requestId !== analyticsRequestRef.current) return\n      const nextCore = currentResult?.core || null\n      if (nextCore) {\n        setAnalyticsCore(nextCore)\n        setCoreData(nextCore)\n        analyticsPeriodKeyRef.current = cacheKey\n        writeSessionJson(cacheKey,{ core:nextCore, compareCore:cached?.compareCore || null, savedAt:new Date().toISOString() })\n      }\n      if (compare && nextCore) {\n        const previous = previousPeriodFor(period)\n        try {\n          const previousResult = await wbApi.core(connectionId,{ from:previous.from,to:previous.to })\n          if (requestId !== analyticsRequestRef.current) return\n          const nextCompareCore = previousResult?.core || null\n          setAnalyticsCompareCore(nextCompareCore)\n          writeSessionJson(cacheKey,{ core:nextCore, compareCore:nextCompareCore, savedAt:new Date().toISOString() })\n        } catch (compareError) {\n          if (cached?.compareCore) setAnalyticsCompareCore(current => current || cached.compareCore)\n        }\n      } else if (!compare) {\n        setAnalyticsCompareCore(null)\n      }\n    } catch (error) {\n      if (requestId !== analyticsRequestRef.current) return\n      if (cached?.core) {\n        setAnalyticsCore(current => current || cached.core)\n        setCoreData(current => current || cached.core)\n        setAnalyticsCompareCore(current => current || cached.compareCore || null)\n        analyticsPeriodKeyRef.current = cacheKey\n      }\n      setAnalyticsError(error.message || 'Не удалось пересчитать аналитику за выбранный период. Показываем последние подтверждённые данные.')\n    } finally {\n      if (requestId === analyticsRequestRef.current) setAnalyticsLoading(false)\n    }\n  }\n`,
'single current-period core')

replaceOnce(
`      await Promise.all([loadDailyReady(status.connectionId),loadConnectionData(status.connectionId),loadLiveSync(status.connectionId)])\n`,
`      await Promise.allSettled([loadDailyReady(status.connectionId),loadConnectionData(status.connectionId),loadLiveSync(status.connectionId)])\n`,
'initial independent loading')

replaceOnce(
`        if (shouldReload) await Promise.all([loadDailyReady(connectionId),loadConnectionData(connectionId)])\n`,
`        if (shouldReload) await Promise.allSettled([loadDailyReady(connectionId),loadConnectionData(connectionId)])\n`,
'background independent loading')

const financeEffectStart = "  useEffect(() => {\n    if (!['Главная','Финансы'].includes(active) || !connection.connected || !connection.connectionId) return undefined\n"
const nextEffectMarker = "\n\n  useEffect(() => {\n    if (active !== 'Документы WB'"
const financeStart = source.indexOf(financeEffectStart)
if (financeStart >= 0) {
  const financeEnd = source.indexOf(nextEffectMarker,financeStart)
  if (financeEnd < 0) throw new Error('Golden-path workspace patch: finance effect end not found')
  const financeEffect = "  useEffect(() => {\n" +
    "    // Detailed ledger belongs to the Finance page. The main screen uses the core finance summary.\n" +
    "    if (active !== 'Финансы' || !connection.connected || !connection.connectionId) return undefined\n" +
    "    const timer = window.setTimeout(() => {\n" +
    "      loadFinanceLedger(connection.connectionId).catch(() => {})\n" +
    "    }, 450)\n" +
    "    return () => window.clearTimeout(timer)\n" +
    "  }, [active, connection.connected, connection.connectionId, financeTab, query, financePage, analyticsPeriod.from, analyticsPeriod.to,\n" +
    "      (connection.syncStates || []).filter(item => ['finance','acquiring','paidStorage','acceptance','documents','jamSubscription'].includes(item.stage)).map(item => item.stage + ':' + (item.lastSuccessAt || item.nextAllowedAt || '')).join('|')])"
  source = source.slice(0,financeStart) + financeEffect + source.slice(financeEnd)
} else if (!source.includes("if (active !== 'Финансы' || !connection.connected")) {
  throw new Error('Golden-path workspace patch: finance-only effect target not found')
}

fs.writeFileSync(file, source)
console.log('Golden-path workspace stability applied')
