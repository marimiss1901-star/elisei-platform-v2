import fs from 'node:fs'

// ELISEI 5.19.25 — join organic WB search texts with paid keyword economics.
const file='src/pages/DashboardPage.jsx'
let source=fs.readFileSync(file,'utf8')

function replaceOnce(before,after,label){
  if(source.includes(after)) return
  if(!source.includes(before)) throw new Error(`ELISEI 5.19.25 organic keyword opportunities: ${label} marker not found`)
  source=source.replace(before,after)
}

replaceOnce(
`function buildProfitableKeywordRows(advertising = {}, products = []) {`,
`function normalizeKeywordText(value='') {\n  return String(value || '').normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/[^\\p{L}\\p{N}]+/gu,' ').replace(/\\s+/g,' ').trim()\n}\n\nfunction buildOrganicKeywordOpportunities(searchRows = [], advertising = {}, products = []) {\n  const productMap=new Map()\n  for (const product of Array.isArray(products) ? products : []) {\n    const nm=String(product?.nmID ?? product?.nmId ?? '').trim()\n    if (nm) productMap.set(nm,product)\n  }\n  const paidKeys=new Set((Array.isArray(advertising?.keywordRows) ? advertising.keywordRows : []).map(row=>\`${'${'}String(row?.nmId ?? row?.nmID ?? '').trim()}|${'${'}normalizeKeywordText(row?.normQuery)}\`))\n  return (Array.isArray(searchRows) ? searchRows : []).map((row,index)=>{\n    const nmID=String(row?.nmId ?? row?.nmID ?? row?.sourceNmID ?? '').trim()\n    const phrase=String(row?.searchText ?? row?.searchQuery ?? row?.query ?? row?.keyword ?? row?.text ?? row?.phrase ?? '').trim()\n    if (!nmID || !phrase || String(row?.rowType || 'query').toLowerCase()!=='query' || row?.isSubstitutedSKU===true) return null\n    const product=productMap.get(nmID) || null\n    const orders=Math.max(0,Number(row?.orders ?? row?.orderCount ?? 0))\n    const openCard=Math.max(0,Number(row?.openCard ?? row?.openCardCount ?? row?.views ?? 0))\n    const addToCart=Math.max(0,Number(row?.addToCart ?? row?.addToCartCount ?? row?.cart ?? 0))\n    const frequency=Math.max(0,Number(row?.frequency ?? row?.requestCount ?? row?.searchCount ?? row?.count ?? 0))\n    const avgPosition=Number(row?.avgPosition ?? row?.averagePosition ?? row?.position)\n    const sales=Math.max(0,Number(product?.salesCount || 0))\n    const productProfit=product?.profit == null ? null : Number(product.profit)\n    const productAdvertising=Math.max(0,Number(product?.advertising || product?.adSpend || 0))\n    const profitBeforeAdsPerUnit=productProfit != null && Number.isFinite(productProfit) && sales>0 ? (productProfit+productAdvertising)/sales : null\n    const averagePrice=Number(product?.averagePrice || (sales>0 ? Number(product?.revenue || 0)/sales : 0)) || null\n    const potentialRevenue=averagePrice!=null ? orders*averagePrice : null\n    const contributionBeforeAds=profitBeforeAdsPerUnit!=null ? orders*profitBeforeAdsPerUnit : null\n    const advertised=paidKeys.has(\`${'${'}nmID}|${'${'}normalizeKeywordText(phrase)}\`)\n    const orderConversion=openCard>0 ? orders/openCard*100 : null\n    let opportunity='watch',opportunityLabel='Наблюдать'\n    if (advertised) { opportunity='already'; opportunityLabel='Уже в рекламе' }\n    else if (orders>=3 && contributionBeforeAds>0 && (!Number.isFinite(avgPosition) || avgPosition>10)) { opportunity='gem'; opportunityLabel='💎 Добавить в рекламу' }\n    else if (orders>=1 && contributionBeforeAds>0 && (frequency>=20 || openCard>=5)) { opportunity='test'; opportunityLabel='🧪 Тестировать' }\n    else if (orders===0 && openCard>=10) { opportunity='weak'; opportunityLabel='⚠️ Не лить пока' }\n    return { ...row,key:\`organic|${'${'}nmID}|${'${'}normalizeKeywordText(phrase)}|${'${'}index}\`,nmID,phrase,product,advertised,orders,openCard,addToCart,frequency,avgPosition:Number.isFinite(avgPosition)?avgPosition:null,orderConversion,potentialRevenue,contributionBeforeAds,profitBeforeAdsPerUnit,provisional:Boolean(product?.profitProvisional || contributionBeforeAds==null),opportunity,opportunityLabel,vendorCode:product?.vendorCode || '',title:product?.title || 'Товар WB' }\n  }).filter(Boolean).sort((a,b)=>{\n    const rank={gem:0,test:1,already:2,watch:3,weak:4}\n    return (rank[a.opportunity]??9)-(rank[b.opportunity]??9) || Number(b.contributionBeforeAds ?? -Infinity)-Number(a.contributionBeforeAds ?? -Infinity) || Number(b.orders||0)-Number(a.orders||0)\n  })\n}\n\nfunction buildProfitableKeywordRows(advertising = {}, products = []) {`,
'organic helper')

replaceOnce(
`  const [advertisingSnapshot, setAdvertisingSnapshot] = useState(null)\n  const [advertisingCoverage, setAdvertisingCoverage] = useState(null)`,
`  const [advertisingSnapshot, setAdvertisingSnapshot] = useState(null)\n  const [advertisingCoverage, setAdvertisingCoverage] = useState(null)\n  const [organicSearchRows, setOrganicSearchRows] = useState([])\n  const [organicSearchLoading, setOrganicSearchLoading] = useState(false)\n  const [organicSearchError, setOrganicSearchError] = useState('')`,
'organic state')

replaceOnce(
`  const loadAdvertisingData = async (connectionId = connection.connectionId, period = analyticsPeriod) => {\n    if (!connectionId || !period?.from || !period?.to) return\n    const result = await wbApi.advertising(connectionId,{ from:period.from,to:period.to })\n    setAdvertisingSnapshot(result.advertising || null)\n    setAdvertisingCoverage(result.coverage || null)\n  }`,
`  const loadAdvertisingData = async (connectionId = connection.connectionId, period = analyticsPeriod) => {\n    if (!connectionId || !period?.from || !period?.to) return\n    const result = await wbApi.advertising(connectionId,{ from:period.from,to:period.to })\n    setAdvertisingSnapshot(result.advertising || null)\n    setAdvertisingCoverage(result.coverage || null)\n  }\n\n  const loadOrganicSearchRows = async (connectionId = connection.connectionId) => {\n    if (!connectionId || organicSearchLoading) return\n    setOrganicSearchLoading(true)\n    setOrganicSearchError('')\n    try {\n      const collected=[]\n      let afterKey=''\n      for (let page=0;page<8;page+=1) {\n        const result=await wbApi.extended('searchQueries',connectionId,{ limit:500,...(afterKey?{afterKey}:{}) })\n        const rows=Array.isArray(result?.rows) ? result.rows : Array.isArray(result?.items) ? result.items : []\n        collected.push(...rows)\n        const next=String(result?.nextKey || result?.nextAfterKey || result?.pagination?.nextKey || '').trim()\n        if (!next || !rows.length || next===afterKey) break\n        afterKey=next\n      }\n      setOrganicSearchRows(collected)\n      if (!collected.length) {\n        const state=(connectionRef.current?.syncStates || []).find(item=>item.stage==='searchQueries')\n        if (state?.lastError) setOrganicSearchError(String(state.lastError))\n      }\n    } catch(error) {\n      setOrganicSearchError(error?.message || 'Поисковые запросы WB пока недоступны.')\n    } finally { setOrganicSearchLoading(false) }\n  }`,
'organic loader')

replaceOnce(
`  useEffect(() => {\n    if (active !== 'Остатки' || !connection.connected || !connection.connectionId) return\n    loadConnectionData(connection.connectionId).catch(() => {})\n  }, [active, connection.connected, connection.connectionId])`,
`  useEffect(() => {\n    if (active !== 'Остатки' || !connection.connected || !connection.connectionId) return\n    loadConnectionData(connection.connectionId).catch(() => {})\n  }, [active, connection.connected, connection.connectionId])\n\n  useEffect(() => {\n    if (active !== 'Реклама' || advertisingTab !== 'keywords' || !connection.connected || !connection.connectionId) return\n    loadOrganicSearchRows(connection.connectionId).catch(() => {})\n  }, [active,advertisingTab,connection.connected,connection.connectionId,connection.lastSync])`,
'organic effect')

replaceOnce(
`    const profitableKeywords=buildProfitableKeywordRows(advertising,analyticsBaseProducts)\n    const filteredKeywords=profitableKeywords.filter(row => !needle || [row.normQuery,row.campaignName,row.advertId,row.nmID,row.vendorCode,row.title].some(value=>String(value || '').toLowerCase().includes(needle)))`,
`    const profitableKeywords=buildProfitableKeywordRows(advertising,analyticsBaseProducts)\n    const organicOpportunities=buildOrganicKeywordOpportunities(organicSearchRows,advertising,analyticsBaseProducts)\n    const filteredOrganicOpportunities=organicOpportunities.filter(row=>!needle || [row.phrase,row.nmID,row.vendorCode,row.title].some(value=>String(value || '').toLowerCase().includes(needle)))\n    const organicGems=organicOpportunities.filter(row=>row.opportunity==='gem').length\n    const organicTests=organicOpportunities.filter(row=>row.opportunity==='test').length\n    const filteredKeywords=profitableKeywords.filter(row => !needle || [row.normQuery,row.campaignName,row.advertId,row.nmID,row.vendorCode,row.title].some(value=>String(value || '').toLowerCase().includes(needle)))`,
'organic economics')

replaceOnce(
`            profitableKeywords:buildProfitableKeywordRows(advertisingSnapshot,analyticsBaseProducts).slice(0,120),\n            keywordStatsAvailable:Boolean(advertisingSnapshot.keywordStatsAvailable),`,
`            profitableKeywords:buildProfitableKeywordRows(advertisingSnapshot,analyticsBaseProducts).slice(0,120),\n            organicKeywordOpportunities:buildOrganicKeywordOpportunities(organicSearchRows,advertisingSnapshot,analyticsBaseProducts).slice(0,120),\n            keywordStatsAvailable:Boolean(advertisingSnapshot.keywordStatsAvailable),`,
'El organic context')

replaceOnce(
`        <div className="notice info"><Info size={20}/><div><strong>Это атрибутированная прибыль ключа</strong><p>ELISEI берёт экономику SKU до рекламы, умножает её на заказы/штуки по кластеру и вычитает рекламный расход ключа. Если Finance ещё не закрыл период, результат помечается «предварительно».</p></div></div>\n        <div className="data-table ad-table">`,
`        <div className="notice info"><Info size={20}/><div><strong>Это атрибутированная прибыль ключа</strong><p>ELISEI берёт экономику SKU до рекламы, умножает её на заказы/штуки по кластеру и вычитает рекламный расход ключа. Если Finance ещё не закрыл период, результат помечается «предварительно».</p></div></div>\n        <div className="section-heading"><div><span className="eyebrow">Органический поиск WB</span><h3>Новые ключи, которых ещё нет в рекламе</h3><p>Ищем запросы, которые уже дают переходы и заказы без рекламы, и выделяем кандидатов для запуска.</p></div><div className="inline-actions"><span className="status-badge success">💎 ${'${'}formatNumber(organicGems)} добавить</span><span className="status-badge info">🧪 ${'${'}formatNumber(organicTests)} тестировать</span></div></div>\n        {organicSearchLoading && <div className="notice info"><RefreshCw size={20}/><div><strong>Читаю органические запросы</strong><p>ELISEI использует уже сохранённый поток поисковой аналитики WB — отдельный рекламный запрос для этого не нужен.</p></div></div>}\n        {organicSearchError && <div className="notice warning"><AlertTriangle size={20}/><div><strong>Органические запросы пока недоступны</strong><p>{organicSearchError}. Поисковые запросы WB требуют категории Analytics и активной подписки «Джем»; рекламные кластеры выше продолжают работать отдельно.</p></div></div>}\n        {!organicSearchLoading && !organicSearchError && <div className="data-table ad-table"><div className="data-row head ad-full-campaign-row"><span>Запрос / товар</span><span>Решение</span><span>Заказы</span><span>Переходы</span><span>Частота</span><span>Позиция</span><span>Конверсия</span><span>Потенциал*</span><span>Реклама</span></div>{filteredOrganicOpportunities.length ? filteredOrganicOpportunities.slice(0,300).map(item=><div className="data-row ad-full-campaign-row" key={item.key}><span><strong>{item.phrase}</strong><small>{item.vendorCode || item.nmID || '—'} · {item.title}</small></span><span><b className={\`status-badge ${'${'}item.opportunity==='gem'?'success':item.opportunity==='test'?'info':item.opportunity==='weak'?'warning':''}\`}>{item.opportunityLabel}</b>{item.provisional&&<small>экономика предварительная</small>}</span><span>{formatNumber(item.orders)}</span><span>{formatNumber(item.openCard)}</span><span>{formatNumber(item.frequency)}</span><span>{item.avgPosition==null?'—':new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(item.avgPosition)}</span><span>{formatPercent(item.orderConversion)}</span><span>{item.contributionBeforeAds==null?'—':formatMoney(item.contributionBeforeAds)}<small>до новой рекламы</small></span><span>{item.advertised?'есть':'нет'}</span></div>) : <div className="product-empty">Сохранённых органических поисковых запросов пока нет.</div>}</div>}\n        <div className="section-heading"><div><span className="eyebrow">Действующая реклама</span><h3>Ключи, которые уже используются</h3></div></div>\n        <div className="data-table ad-table">`,
'organic table')

replaceOnce(
`          'Какие рекламные ключи реально приносят прибыль и какие масштабировать?',`,
`          'Какие новые поисковые запросы стоит добавить в рекламу?',\n          'Какие рекламные ключи реально приносят прибыль и какие масштабировать?',`,
'El organic suggestion')

fs.writeFileSync(file,source)

const identityBefore='  const preferredElName = elSettings.preferredName || displayName'
const identityAfter='  const preferredElName = displayName || elSettings.preferredName'
if(source.includes(identityBefore)){
  source=source.replace(identityBefore,identityAfter)
  fs.writeFileSync(file,source)
}

const cssFile='src/styles/app.css'
let css=fs.readFileSync(cssFile,'utf8')
if(!css.includes('/* ELISEI 5.19.27 — readable El conversation */')){
  css+=`\n\n/* ELISEI 5.19.27 — readable El conversation */
.el-embedded-chat .chat-stream{max-height:none;min-height:420px;overflow:visible;padding:12px 0 24px}
.el-embedded-chat .chat-message.el{width:min(860px,82%);max-width:82%;box-sizing:border-box}
.el-embedded-chat .chat-message.user{width:auto;max-width:72%;box-sizing:border-box}
@media(max-width:850px){.el-embedded-chat .chat-message.el,.el-embedded-chat .chat-message.user{width:auto;max-width:94%}}
`
  fs.writeFileSync(cssFile,css)
}
console.log('ELISEI 5.19.27 organic keywords and El chat UI applied')
