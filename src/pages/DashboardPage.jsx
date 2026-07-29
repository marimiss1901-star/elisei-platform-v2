import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, BarChart3, Bell, Boxes, Calculator, CalendarDays, CheckCircle2, ChevronDown,
  ChevronRight, ChevronUp, CircleDollarSign, Download, Eye, EyeOff, FileText, Home, LogOut,
  Megaphone, MessageCircle, PackageSearch, Percent, PlugZap, RefreshCw, Save, Search, Send,
  Settings, ShieldCheck, SlidersHorizontal, Sparkles, Star, Tag, TrendingUp, UsersRound,
  Upload, WalletCards, Warehouse, X
} from 'lucide-react'
import ElMascot from '../components/ElMascot'
import MetricCard from '../components/MetricCard'
import TrendChart from '../components/TrendChart'
import { businessApi, wbApi } from '../lib/api'

const formatMoney = value => value == null ? 'Нужна себестоимость' : `${new Intl.NumberFormat('ru-RU').format(Math.round(Number(value || 0)))} ₽`
const formatNumber = value => new Intl.NumberFormat('ru-RU').format(Math.round(Number(value || 0)))
const formatPercent = value => value == null ? '—' : `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits:1 }).format(Number(value || 0))}%`
const csvCell = value => `"${String(value ?? '').replaceAll('"','""')}"`

const defaultSettings = {
  commissionPercent:20, logisticsPerSale:0, storageMonthly:0, advertisingMonthly:0,
  fixedMonthly:0, taxPercent:0, defaultCostPercent:0, targetMarginPercent:20, productCosts:{}
}

const demoProducts = [
  { key:'demo-1', nmID:'1234567', vendorCode:'DEMO-01', title:'Товар для демонстрации', brand:'ELISEI Demo', revenue:286740, stock:124, salesCount:38, returnsCount:2, returnRate:5.3, stockCoverDays:98, stockStatus:'В наличии', abc:'A', xyz:'X', recommendation:'Контролировать динамику', profit:null, margin:null, unitCost:0, averagePrice:7546, breakevenPrice:null, targetPrice:null },
  { key:'demo-2', nmID:'7654321', vendorCode:'DEMO-02', title:'Ходовой товар', brand:'ELISEI Demo', revenue:198200, stock:8, salesCount:31, returnsCount:1, returnRate:3.2, stockCoverDays:8, stockStatus:'Заканчивается', abc:'A', xyz:'Y', recommendation:'Запланировать поставку', profit:null, margin:null, unitCost:0, averagePrice:6394, breakevenPrice:null, targetPrice:null },
]

function stockTone(status) {
  if (status === 'Нет остатка') return 'danger'
  if (status === 'Заканчивается') return 'warning'
  if (status === 'Избыток' || status === 'Без движения') return 'info'
  return 'success'
}

function recommendationTone(type) {
  if (type === 'price') return 'amber'
  if (type === 'stock') return 'blue'
  if (type === 'quality') return 'pink'
  return 'violet'
}

export default function DashboardPage({ onNavigate, onLogout, user }) {
  const rawName = String(user?.name || '').trim()
  const displayName = rawName ? rawName.split(/\s+/)[0] : ''
  const profileInitial = displayName ? displayName.slice(0,1).toUpperCase() : 'Э'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер'

  const [active, setActive] = useState('Главная')
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState('')
  const [chat, setChat] = useState('')
  const [messages, setMessages] = useState([{ role:'el', text:`${greeting}${displayName ? `, ${displayName}` : ''}. Я готов разобрать продажи, остатки и прибыль.` }])
  const [connection, setConnection] = useState({ connected:false, connectionId:'', scopes:[], lastSync:null })
  const [tokenDraft, setTokenDraft] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [checking, setChecking] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [dashboardData, setDashboardData] = useState(null)
  const [coreData, setCoreData] = useState(null)
  const [liveProducts, setLiveProducts] = useState([])
  const [syncHistory, setSyncHistory] = useState([])
  const [settingsDraft, setSettingsDraft] = useState(defaultSettings)
  const [productFilter, setProductFilter] = useState('Все')
  const [productSort, setProductSort] = useState({ key:'revenue', direction:'desc' })
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [importResult, setImportResult] = useState(null)

  const notify = (text, duration = 4200) => {
    setToast(text)
    window.clearTimeout(window.__eliseiToast)
    window.__eliseiToast = window.setTimeout(() => setToast(''), duration)
  }

  const loadConnectionData = async connectionId => {
    const [dashboard, productResult, historyResult, coreResult] = await Promise.all([
      wbApi.dashboard(connectionId), wbApi.products(connectionId), wbApi.syncHistory(connectionId), wbApi.core(connectionId)
    ])
    setDashboardData(dashboard.dashboard || null)
    setLiveProducts(productResult.products || [])
    setSyncHistory(historyResult.history || [])
    setCoreData(coreResult.core || null)
    if (coreResult.core?.settings) setSettingsDraft(coreResult.core.settings)
  }

  useEffect(() => {
    if (!wbApi.configured) return
    Promise.all([wbApi.current(), businessApi.settings()]).then(async ([status, settingsResult]) => {
      if (settingsResult?.settings) setSettingsDraft(settingsResult.settings)
      if (!status.connected || !status.connectionId) return
      setConnection({ connected:true, connectionId:status.connectionId, scopes:status.scopes || [], lastSync:status.lastSync || null })
      setSyncHistory(status.syncHistory || [])
      await loadConnectionData(status.connectionId)
    }).catch(error => notify(error.message, 8000))
  }, [])

  const nav = [
    ['Главная', Home], ['Аналитика', BarChart3], ['Товары', PackageSearch], ['Остатки', Boxes],
    ['Финансы', WalletCards], ['Цены и акции', Tag], ['Реклама', Megaphone], ['Отзывы', Star],
    ['Сезонность', CalendarDays], ['Отчёты', FileText], ['Импорт данных', Upload], ['AI CRM', UsersRound], ['Спросить ЭЛа', MessageCircle],
    ['Подключения', PlugZap], ['Синхронизации', RefreshCw], ['Настройки', Settings]
  ]

  const summary = coreData?.summary || dashboardData || {
    revenue:0, orders:0, sales:0, returns:0, returnRate:0, stockUnits:0, activeProducts:liveProducts.length,
    zeroStock:0, lowStock:0, slowStock:0, stockCoverDays:null, operatingProfit:null, margin:null,
    cogs:null, commission:0, logistics:0, advertising:0, storage:0, fixed:0, tax:0
  }

  const coreProducts = useMemo(() => {
    if (coreData?.products?.length) return coreData.products
    if (liveProducts.length) return liveProducts.map((p,index) => ({
      ...p, key:String(p.nmID || p.vendorCode || index), salesCount:0, returnsCount:0, returnRate:0,
      stockStatus:Number(p.stock || 0) <= 0 ? 'Нет остатка' : Number(p.stock || 0) < 10 ? 'Заканчивается' : 'В наличии',
      recommendation:'Контролировать динамику', abc:'C', xyz:'Z', profit:null, margin:null, averagePrice:0, unitCost:0
    }))
    return demoProducts
  }, [coreData, liveProducts])

  const productRows = useMemo(() => coreProducts.map((p,index) => ({
    ...p,
    id:String(p.key || p.nmID || p.vendorCode || index),
    article:String(p.vendorCode || p.nmID || '—'),
    title:p.title || 'Товар', brand:p.brand || 'Без бренда', photo:p.photo || '',
    revenue:Number(p.revenue || 0), stock:Number(p.stock || 0),
    status:p.stockStatus || (Number(p.stock || 0) <= 0 ? 'Нет остатка' : Number(p.stock || 0) < 10 ? 'Заканчивается' : 'В наличии')
  })), [coreProducts])

  const filteredProducts = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = productRows.filter(p => {
      const matchesQuery = !needle || [p.article,p.title,p.brand,p.nmID,p.key].join(' ').toLowerCase().includes(needle)
      const matchesFilter = productFilter === 'Все' ||
        (productFilter === 'В наличии' && p.status === 'В наличии') ||
        (productFilter === 'Заканчиваются' && p.status === 'Заканчивается') ||
        (productFilter === 'Нет остатка' && p.status === 'Нет остатка') ||
        (productFilter === 'Избыток' && ['Избыток','Без движения'].includes(p.status)) ||
        (productFilter === 'С продажами' && Number(p.salesCount || 0) > 0) ||
        (productFilter === 'Без продаж' && Number(p.salesCount || 0) === 0)
      return matchesQuery && matchesFilter
    })
    return [...rows].sort((a,b) => {
      const av = a[productSort.key], bv = b[productSort.key]
      const result = typeof av === 'number' ? av-bv : String(av ?? '').localeCompare(String(bv ?? ''),'ru')
      return productSort.direction === 'asc' ? result : -result
    })
  }, [productRows, query, productFilter, productSort])

  const changeProductSort = key => setProductSort(current => current.key === key
    ? { key, direction:current.direction === 'asc' ? 'desc' : 'asc' }
    : { key, direction:'desc' })
  const SortIcon = ({ column }) => productSort.key !== column ? null : productSort.direction === 'asc' ? <ChevronUp size={14}/> : <ChevronDown size={14}/>

  const recommendations = coreData?.recommendations?.length ? coreData.recommendations : [
    { id:'demo-stock', type:'stock', title:'Синхронизировать остатки', text:'После синхронизации Эл рассчитает дни запаса и точки пополнения.', effect:'Контроль дефицита' },
    { id:'demo-cost', type:'price', title:'Добавить себестоимость', text:'Введите себестоимость, комиссию и расходы для расчёта чистой прибыли.', effect:'P&L по каждому товару' },
    { id:'demo-quality', type:'quality', title:'Проверить возвраты', text:'Эл выделит товары с повышенной долей возвратов.', effect:'Улучшение качества' },
  ]

  const syncConnection = async (connectionId = connection.connectionId) => {
    if (!connectionId || syncing) return
    setSyncing(true)
    try {
      const result = await wbApi.sync(connectionId)
      setConnection(current => ({ ...current, connected:true, lastSync:result.lastSync }))
      setDashboardData(result.dashboard || null)
      setCoreData(result.core || null)
      setSyncHistory(result.syncHistory || [])
      const productResult = await wbApi.products(connectionId)
      setLiveProducts(productResult.products || [])
      notify(result.warnings?.length
        ? `Синхронизация завершена частично: ${result.warnings[0]}`
        : `Готово: ${result.counts.products} товаров, ${result.counts.orders} заказов, ${result.counts.sales} продаж`,
      result.warnings?.length ? 9000 : 5200)
    } catch (error) { notify(error.message, 9000) }
    finally { setSyncing(false) }
  }

  const saveConnection = async event => {
    event.preventDefault()
    if (!wbApi.configured) return notify('Добавьте VITE_API_BASE_URL в Render')
    if (tokenDraft.trim().length < 40) return notify('API-ключ выглядит слишком коротким')
    setChecking(true)
    try {
      const result = await wbApi.connect(tokenDraft.trim())
      setConnection({ connected:true, connectionId:result.connectionId, scopes:result.scopes || [], lastSync:result.lastSync || null })
      setTokenDraft('')
      notify('Wildberries подключён. Теперь запустите синхронизацию один раз.')
    } catch (error) { notify(error.message, 9000) }
    finally { setChecking(false) }
  }

  const disconnect = async () => {
    if (!window.confirm('Отключить Wildberries? Загруженные данные этого подключения будут удалены.')) return
    try {
      await wbApi.disconnect(connection.connectionId)
      setConnection({ connected:false, connectionId:'', scopes:[], lastSync:null })
      setDashboardData(null); setCoreData(null); setLiveProducts([]); setSyncHistory([])
      notify('Wildberries отключён')
    } catch (error) { notify(error.message, 8000) }
  }

  const updateSetting = (key,value) => setSettingsDraft(current => ({ ...current, [key]:Math.max(0, Number(value || 0)) }))
  const updateProductCost = (product,value) => {
    const key = String(product.key || product.nmID || product.vendorCode)
    setSettingsDraft(current => ({ ...current, productCosts:{ ...(current.productCosts || {}), [key]:Math.max(0, Number(value || 0)) } }))
  }
  const saveSettings = async () => {
    setSavingSettings(true)
    try {
      const result = await businessApi.saveSettings(settingsDraft)
      setSettingsDraft(result.settings || settingsDraft)
      if (result.core) setCoreData(result.core)
      notify('Финансовые настройки сохранены. Прибыль пересчитана.')
    } catch (error) { notify(error.message, 8000) }
    finally { setSavingSettings(false) }
  }

  const downloadCsv = (name, headers, rows) => {
    const content = '\uFEFF' + [headers, ...rows].map(row => row.map(csvCell).join(';')).join('\n')
    const blob = new Blob([content], { type:'text/csv;charset=utf-8' })
    const href = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = href; link.download = `${name}_${new Date().toISOString().slice(0,10)}.csv`; link.click()
    URL.revokeObjectURL(href)
  }

  const importCostsCsv = event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text = String(reader.result || '').replace(/^\uFEFF/, '')
        const lines = text.split(/\r?\n/).filter(line => line.trim())
        if (lines.length < 2) throw new Error('Файл пустой или не содержит строк данных')
        const delimiter = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ','
        const parse = line => line.split(delimiter).map(value => value.trim().replace(/^"|"$/g, '').replace(/""/g, '"'))
        const headers = parse(lines[0]).map(value => value.toLowerCase())
        const articleIndex = headers.findIndex(value => /артикул|vendor|nm.?id|sku/.test(value))
        const costIndex = headers.findIndex(value => /себестоим|cost/.test(value))
        if (articleIndex < 0 || costIndex < 0) throw new Error('Нужны колонки «Артикул» и «Себестоимость»')
        const productIndex = new Map()
        for (const product of productRows) {
          for (const key of [product.article, product.nmID, product.key, product.vendorCode]) if (key) productIndex.set(String(key).trim().toLowerCase(), product)
        }
        const nextCosts = { ...(settingsDraft.productCosts || {}) }
        let imported = 0, skipped = 0
        for (const line of lines.slice(1)) {
          const row = parse(line)
          const article = String(row[articleIndex] || '').trim().toLowerCase()
          const cost = Number(String(row[costIndex] || '').replace(/\s/g, '').replace(',', '.'))
          const product = productIndex.get(article)
          if (!product || !Number.isFinite(cost) || cost < 0) { skipped += 1; continue }
          nextCosts[String(product.key || product.nmID || product.vendorCode)] = cost
          imported += 1
        }
        setSettingsDraft(current => ({ ...current, productCosts:nextCosts }))
        setImportResult({ type:'success', text:`Подготовлено к сохранению: ${imported} товаров. Пропущено: ${skipped}.` })
      } catch (error) { setImportResult({ type:'error', text:error.message }) }
    }
    reader.readAsText(file, 'utf-8')
  }

  const reportDefinitions = [
    { title:'Товары и экономика', text:'Продажи, остатки, ABC/XYZ, себестоимость, прибыль и рекомендации.', action:() => downloadCsv('elisei_products', ['Артикул','nmID','Товар','Бренд','Выручка','Продажи','Возвраты','Остаток','Дней запаса','ABC','XYZ','Себестоимость','Прибыль','Маржа','Рекомендация'], productRows.map(p => [p.article,p.nmID,p.title,p.brand,p.revenue,p.salesCount,p.returnsCount,p.stock,p.stockCoverDays,p.abc,p.xyz,p.unitCost,p.profit,p.margin,p.recommendation])) },
    { title:'P&L за 30 дней', text:'Выручка, COGS, комиссия, логистика, реклама, хранение и прибыль.', action:() => downloadCsv('elisei_pnl', ['Показатель','Значение'], [['Выручка',summary.revenue],['Себестоимость',summary.cogs],['Комиссия',summary.commission],['Логистика',summary.logistics],['Реклама',summary.advertising],['Хранение',summary.storage],['Постоянные расходы',summary.fixed],['Налог',summary.tax],['Операционная прибыль',summary.operatingProfit],['Маржа',summary.margin]]) },
    { title:'Остатки и пополнение', text:'Статусы запасов, покрытие и товары без движения.', action:() => downloadCsv('elisei_stocks', ['Артикул','Товар','Остаток','Дней запаса','Статус','Продажи 30 дней','Рекомендация'], productRows.map(p => [p.article,p.title,p.stock,p.stockCoverDays,p.status,p.salesCount,p.recommendation])) },
    { title:'Рекомендации ЭЛа', text:'Готовый список действий по цене, запасам и качеству.', action:() => downloadCsv('elisei_recommendations', ['Приоритет','Тип','Действие','Причина','Эффект'], recommendations.map((r,index) => [index+1,r.type,r.title,r.text,r.effect])) },
  ]

  const answerFromCore = question => {
    const q = question.toLowerCase()
    if (!connection.connected) return 'Сначала подключите Wildberries. После синхронизации я смогу отвечать по реальным данным кабинета.'
    if (q.includes('прибыл') || q.includes('марж')) return summary.operatingProfit == null
      ? 'Для расчёта прибыли добавьте себестоимость в разделе «Финансы». Комиссию, логистику, рекламу и постоянные расходы тоже можно настроить там.'
      : `Операционная прибыль за 30 дней: ${formatMoney(summary.operatingProfit)}, маржа ${formatPercent(summary.margin)}. Основные расходы: комиссия ${formatMoney(summary.commission)}, себестоимость ${formatMoney(summary.cogs)}.`
    if (q.includes('остат') || q.includes('постав')) return `На складах ${formatNumber(summary.stockUnits)} единиц. Без остатка: ${summary.zeroStock || 0} товаров, заканчиваются: ${summary.lowStock || 0}, избыток/без движения: ${summary.slowStock || 0}.`
    if (q.includes('возврат') || q.includes('качеств')) return `За 30 дней отмечено ${formatNumber(summary.returns)} возвратов, доля — ${formatPercent(summary.returnRate)}. В разделе «Отзывы» я выделил товары с повышенным риском качества.`
    if (q.includes('цен')) {
      const item = productRows.find(p => p.targetPrice != null)
      return item ? `Для «${item.title}» расчётная цена в ноль — ${formatMoney(item.breakevenPrice)}, целевая цена — ${formatMoney(item.targetPrice)}.` : 'Добавьте себестоимость, чтобы я рассчитал цену в ноль, целевую цену и сценарии скидок.'
    }
    const top = recommendations[0]
    return top ? `Главное действие сейчас: ${top.title}. ${top.text}` : `За 30 дней выручка составила ${formatMoney(summary.revenue)}, продаж — ${formatNumber(summary.sales)}, остаток — ${formatNumber(summary.stockUnits)} единиц.`
  }

  const sendChat = event => {
    event.preventDefault()
    if (!chat.trim()) return
    const question = chat.trim()
    setMessages(current => [...current, { role:'user', text:question }, { role:'el', text:answerFromCore(question) }])
    setChat('')
  }

  const requireConnection = children => connection.connected ? children : <div className="empty-state compact-empty"><PlugZap size={34}/><h3>Подключите Wildberries</h3><p>Раздел использует реальные данные кабинета, а не демонстрационные цифры.</p><button className="primary-btn" onClick={() => setActive('Подключения')}>Открыть подключения</button></div>

  const renderHome = () => <>
    <section className="brand-hero glass-panel">
      <div className="brand-hero-copy">
        <span className="brand-kicker"><Sparkles size={14}/> ЭЛ уже всё проверил</span>
        <h1>{greeting},<br/><em>{displayName || 'рады вас видеть'}</em></h1>
        <p>{connection.connected
          ? `Я проверил ${formatNumber(summary.activeProducts || productRows.length)} товаров, продажи и остатки. Нашёл ${recommendations.length} действий для роста.`
          : 'Подключите Wildberries — я соберу продажи, остатки и подготовлю план действий.'}</p>
        <div className="brand-hero-actions">
          <button className="primary-btn brand-primary" onClick={() => setActive('Спросить ЭЛа')}><MessageCircle size={18}/> Обсудить с ЭЛом</button>
          <button className="brand-secondary" onClick={() => setActive(connection.connected ? 'Аналитика' : 'Подключения')}>{connection.connected ? 'Открыть аналитику' : 'Подключить WB'} <ChevronRight size={17}/></button>
        </div>
        <div className="brand-sync"><span className="status-dot"/>{connection.connected ? `Данные обновлены ${connection.lastSync ? new Date(connection.lastSync).toLocaleString('ru-RU') : '—'}` : 'Кабинет пока не подключён'}</div>
      </div>
      <div className="brand-mascot-stage"><span className="brand-orbit one"/><span className="brand-orbit two"/><ElMascot/><div className="el-speech"><strong>ЭЛ</strong><span>{recommendations[0]?.title || 'Я подготовил план на сегодня ✨'}</span></div></div>
    </section>
    <section className="brand-metrics">
      <button className="brand-metric" onClick={() => setActive('Аналитика')}><span className="brand-3d-icon"><TrendingUp/></span><span><small>Выручка · 30 дней</small><strong>{formatMoney(summary.revenue)}</strong><em>{formatNumber(summary.sales)} продаж</em></span><ChevronRight/></button>
      <button className="brand-metric pink" onClick={() => setActive('Финансы')}><span className="brand-3d-icon"><CircleDollarSign/></span><span><small>Операционная прибыль</small><strong>{formatMoney(summary.operatingProfit)}</strong><em>{summary.operatingProfit == null ? 'Добавьте себестоимость' : `Маржа ${formatPercent(summary.margin)}`}</em></span><ChevronRight/></button>
      <button className="brand-metric blue" onClick={() => setActive('Товары')}><span className="brand-3d-icon"><PackageSearch/></span><span><small>Товары</small><strong>{formatNumber(summary.activeProducts || productRows.length)}</strong><em>{summary.zeroStock || 0} без остатка</em></span><ChevronRight/></button>
      <button className="brand-metric cyan" onClick={() => setActive('Остатки')}><span className="brand-3d-icon"><Boxes/></span><span><small>Остатки</small><strong>{formatNumber(summary.stockUnits)}</strong><em>{summary.lowStock || 0} заканчиваются</em></span><ChevronRight/></button>
    </section>
    <section className="brand-grid">
      <div className="el-recommendations glass-panel"><div className="brand-section-head"><div><span>ЭЛ рекомендует</span><h2>Что сделать сегодня</h2></div><button onClick={() => setActive('Спросить ЭЛа')}>Спросить ЭЛа <ChevronRight size={16}/></button></div><div className="recommendation-cards">{recommendations.slice(0,3).map((item,index) => <button className={`recommendation-tile ${recommendationTone(item.type)}`} key={item.id || index} onClick={() => setActive(item.type === 'stock' ? 'Остатки' : item.type === 'price' ? 'Цены и акции' : item.type === 'quality' ? 'Отзывы' : 'Аналитика')}><span className="rec-number">0{index+1}</span><div><small>{item.type || 'Рекомендация'}</small><h3>{item.title}</h3><p>{item.text}</p><strong>{item.effect}</strong></div><ChevronRight className="rec-arrow" size={18}/></button>)}</div></div>
      <aside className="el-profile-card glass-panel"><div className="el-profile-top"><span className="mini-el"><ElMascot compact/></span><div><span>ЭЛ · AI-помощник</span><h2>Я на связи</h2></div><b className="live-pill">LIVE</b></div><p>Я связываю продажи, запасы, возвраты и экономику, чтобы подсказать конкретное действие.</p><div className="el-profile-stats"><div><span>Проверено товаров</span><strong>{formatNumber(summary.activeProducts || productRows.length)}</strong></div><div><span>Задач найдено</span><strong>{recommendations.length}</strong></div><div><span>Дней запаса</span><strong>{summary.stockCoverDays ?? '—'}</strong></div></div><button className="primary-btn brand-primary" onClick={() => setActive('Спросить ЭЛа')}>Задать вопрос</button></aside>
    </section>
  </>

  const renderAnalytics = () => <section className="app-page glass-panel"><div className="page-title"><span>Аналитика</span><h1>Центр показателей</h1><p>Реальная динамика за 30 дней, ABC/XYZ-классификация, возвраты и здоровье ассортимента.</p></div>{requireConnection(<><div className="metrics-grid four"><MetricCard label="Выручка" value={formatMoney(summary.revenue)} delta={`${formatNumber(summary.sales)} продаж`} icon={TrendingUp}/><MetricCard label="Заказы" value={formatNumber(summary.orders)} delta={`${formatNumber(summary.returns)} возвратов`} icon={PackageSearch}/><MetricCard label="Остатки" value={formatNumber(summary.stockUnits)} delta={`${summary.stockCoverDays ?? '—'} дней покрытия`} icon={Boxes}/><MetricCard label="Опер. прибыль" value={formatMoney(summary.operatingProfit)} delta={summary.operatingProfit == null ? 'Нужна себестоимость' : `Маржа ${formatPercent(summary.margin)}`} icon={CircleDollarSign}/></div><div className="analytics-layout"><div className="chart-card inner-chart"><div className="card-head"><div><span>Последние 30 дней</span><h3>Динамика выручки</h3></div></div><TrendChart data={coreData?.dailyTrend || []}/></div><div className="analytics-side"><h3>Ассортимент</h3><div className="insight-list"><div><span>ABC A</span><strong>{productRows.filter(p => p.abc === 'A').length}</strong><small>основная выручка</small></div><div><span>XYZ X</span><strong>{productRows.filter(p => p.xyz === 'X').length}</strong><small>стабильный спрос</small></div><div><span>Без движения</span><strong>{summary.slowStock || 0}</strong><small>нужно решение</small></div><div><span>Возвраты</span><strong>{formatPercent(summary.returnRate)}</strong><small>{formatNumber(summary.returns)} шт.</small></div></div></div></div><div className="section-title-row"><div><span>ABC/XYZ</span><h2>Приоритет товаров</h2></div></div><div className="data-table compact-table"><div className="data-row head analytics-row"><span>Товар</span><span>ABC</span><span>XYZ</span><span>Выручка</span><span>Продажи</span><span>Возвраты</span><span>Дней запаса</span></div>{productRows.slice(0,30).map(p => <div className="data-row analytics-row" key={p.id}><span><strong>{p.title}</strong><small>{p.article}</small></span><span><b className={`class-pill class-${String(p.abc || 'C').toLowerCase()}`}>{p.abc}</b></span><span><b className="class-pill">{p.xyz}</b></span><span>{formatMoney(p.revenue)}</span><span>{formatNumber(p.salesCount)}</span><span>{formatPercent(p.returnRate)}</span><span>{p.stockCoverDays ?? '—'}</span></div>)}</div></>)}</section>

  const renderProducts = () => <section className="app-page glass-panel products-page"><div className="page-title product-title"><div><span>Каталог</span><h1>Товары</h1><p>Поиск, фильтры, сортировка, экономика и рекомендации по каждому артикулу.</p></div><div className="catalog-counter"><strong>{filteredProducts.length}</strong><span>товаров показано</span></div></div><div className="product-toolbar"><div className="filter-label"><SlidersHorizontal size={16}/> Фильтры</div>{['Все','В наличии','Заканчиваются','Нет остатка','Избыток','С продажами','Без продаж'].map(filter => <button key={filter} className={productFilter===filter?'filter-chip active':'filter-chip'} onClick={() => setProductFilter(filter)}>{filter}</button>)}</div><div className="data-table product-table"><div className="data-row head product-row extended"><span>Фото</span><button onClick={() => changeProductSort('article')}>Артикул <SortIcon column="article"/></button><button onClick={() => changeProductSort('title')}>Товар <SortIcon column="title"/></button><button onClick={() => changeProductSort('revenue')}>Выручка <SortIcon column="revenue"/></button><button onClick={() => changeProductSort('salesCount')}>Продажи <SortIcon column="salesCount"/></button><button onClick={() => changeProductSort('stock')}>Остаток <SortIcon column="stock"/></button><button onClick={() => changeProductSort('profit')}>Прибыль <SortIcon column="profit"/></button><span>Статус</span></div>{filteredProducts.length === 0 ? <div className="product-empty">По выбранным условиям товары не найдены.</div> : filteredProducts.map(p => <button className="data-row product-row extended product-item" key={p.id} onClick={() => setSelectedProduct(p)}><span className="product-thumb">{p.photo ? <img src={p.photo} alt="" loading="lazy"/> : <PackageSearch size={22}/>}</span><span className="product-article">{p.article}<small>nmID {p.nmID || '—'}</small></span><span className="product-name"><strong>{p.title}</strong><small>{p.brand} · {p.abc}{p.xyz}</small></span><span className="product-money">{formatMoney(p.revenue)}</span><span>{formatNumber(p.salesCount)}</span><span className={`stock-value ${p.stock===0?'zero':p.stock<10?'low':'good'}`}>{p.stock}</span><span className={p.profit != null && p.profit < 0 ? 'negative' : 'positive'}>{formatMoney(p.profit)}</span><span><b className={`status-badge ${stockTone(p.status)}`}>{p.status}</b></span></button>)}</div>{selectedProduct && <div className="product-drawer-backdrop" onClick={() => setSelectedProduct(null)}><aside className="product-drawer wide" onClick={event => event.stopPropagation()}><button className="drawer-close" onClick={() => setSelectedProduct(null)}><X size={20}/></button><div className="drawer-photo">{selectedProduct.photo ? <img src={selectedProduct.photo} alt={selectedProduct.title}/> : <PackageSearch size={44}/>}</div><span className="drawer-eyebrow">{selectedProduct.brand} · {selectedProduct.abc}{selectedProduct.xyz}</span><h2>{selectedProduct.title}</h2><p className="drawer-article">Артикул: {selectedProduct.article} · nmID: {selectedProduct.nmID || '—'}</p><div className="drawer-metrics grid"><div><span>Выручка</span><strong>{formatMoney(selectedProduct.revenue)}</strong></div><div><span>Продажи</span><strong>{formatNumber(selectedProduct.salesCount)}</strong></div><div><span>Остаток</span><strong>{selectedProduct.stock} шт.</strong></div><div><span>Дней запаса</span><strong>{selectedProduct.stockCoverDays ?? '—'}</strong></div><div><span>Прибыль</span><strong>{formatMoney(selectedProduct.profit)}</strong></div><div><span>Маржа</span><strong>{formatPercent(selectedProduct.margin)}</strong></div></div><div className={`drawer-insight ${stockTone(selectedProduct.status)}`}><Sparkles size={19}/><div><strong>Рекомендация ЭЛа</strong><p>{selectedProduct.recommendation}</p></div></div><div className="price-scenarios"><h3>Ценообразование</h3><div><span>Средняя цена<strong>{formatMoney(selectedProduct.averagePrice)}</strong></span><span>Цена в ноль<strong>{formatMoney(selectedProduct.breakevenPrice)}</strong></span><span>Целевая цена<strong>{formatMoney(selectedProduct.targetPrice)}</strong></span><span>Цена пика<strong>{formatMoney(selectedProduct.peakPrice)}</strong></span></div></div></aside></div>}</section>

  const renderStocks = () => <section className="app-page glass-panel"><div className="page-title"><span>Управление запасами</span><h1>Остатки</h1><p>Дни запаса, дефицит, излишки, замороженные деньги и план пополнения.</p></div>{requireConnection(<><div className="metrics-grid four"><MetricCard label="Всего единиц" value={formatNumber(summary.stockUnits)} delta={`${summary.activeProducts || productRows.length} товаров`} icon={Boxes}/><MetricCard label="Нет остатка" value={formatNumber(summary.zeroStock)} delta="потенциально упущенные продажи" icon={AlertTriangle}/><MetricCard label="Заканчиваются" value={formatNumber(summary.lowStock)} delta="запас менее 14 дней" icon={Warehouse}/><MetricCard label="Избыток" value={formatNumber(summary.slowStock)} delta="запас выше нормы" icon={PackageSearch}/></div>{coreData?.warehouses?.length > 0 && <div className="warehouse-grid">{coreData.warehouses.slice(0,8).map(row => <div className="warehouse-card" key={row.name}><Warehouse size={18}/><span>{row.name}</span><strong>{formatNumber(row.quantity)} шт.</strong></div>)}</div>}<div className="data-table stock-table"><div className="data-row head stock-row"><span>Товар</span><span>Продажи</span><span>Остаток</span><span>Дней запаса</span><span>Заморожено</span><span>Статус</span><span>Что делать</span></div>{[...productRows].sort((a,b) => (a.stockCoverDays ?? 99999) - (b.stockCoverDays ?? 99999)).map(p => <div className="data-row stock-row" key={p.id}><span><strong>{p.title}</strong><small>{p.article}</small></span><span>{formatNumber(p.salesCount)}</span><span>{formatNumber(p.stock)}</span><span>{p.stockCoverDays ?? '—'}</span><span>{formatMoney(p.frozenMoney || 0)}</span><span><b className={`status-badge ${stockTone(p.status)}`}>{p.status}</b></span><span>{p.recommendation}</span></div>)}</div></>)}</section>

  const renderFinance = () => <section className="app-page glass-panel"><div className="page-title"><span>Финансы / P&L</span><h1>Чистая экономика бизнеса</h1><p>Введите свои расходы один раз. Эл пересчитает прибыль, маржу и цену в ноль по каждому товару.</p></div><div className="finance-layout"><div className="settings-card"><h3><Calculator size={19}/> Финансовые параметры за 30 дней</h3><div className="settings-grid"><label>Комиссия WB, %<input type="number" min="0" max="100" value={settingsDraft.commissionPercent ?? 0} onChange={e => updateSetting('commissionPercent',e.target.value)}/></label><label>Логистика за продажу, ₽<input type="number" min="0" value={settingsDraft.logisticsPerSale ?? 0} onChange={e => updateSetting('logisticsPerSale',e.target.value)}/></label><label>Реклама, ₽/мес.<input type="number" min="0" value={settingsDraft.advertisingMonthly ?? 0} onChange={e => updateSetting('advertisingMonthly',e.target.value)}/></label><label>Хранение, ₽/мес.<input type="number" min="0" value={settingsDraft.storageMonthly ?? 0} onChange={e => updateSetting('storageMonthly',e.target.value)}/></label><label>Постоянные расходы, ₽/мес.<input type="number" min="0" value={settingsDraft.fixedMonthly ?? 0} onChange={e => updateSetting('fixedMonthly',e.target.value)}/></label><label>Налог с выручки, %<input type="number" min="0" max="100" value={settingsDraft.taxPercent ?? 0} onChange={e => updateSetting('taxPercent',e.target.value)}/></label><label>Себестоимость по умолчанию, % цены<input type="number" min="0" max="100" value={settingsDraft.defaultCostPercent ?? 0} onChange={e => updateSetting('defaultCostPercent',e.target.value)}/></label><label>Целевая маржа, %<input type="number" min="0" max="90" value={settingsDraft.targetMarginPercent ?? 20} onChange={e => updateSetting('targetMarginPercent',e.target.value)}/></label></div><button className="primary-btn" disabled={savingSettings} onClick={saveSettings}>{savingSettings ? <RefreshCw className="spin" size={17}/> : <Save size={17}/>} Сохранить и пересчитать</button></div><div className="pnl-card"><h3>P&L за 30 дней</h3>{[['Выручка',summary.revenue],['Себестоимость',summary.cogs],['Комиссия WB',summary.commission],['Логистика',summary.logistics],['Реклама',summary.advertising],['Хранение',summary.storage],['Постоянные расходы',summary.fixed],['Налог',summary.tax]].map(([label,value]) => <div className="pnl-line" key={label}><span>{label}</span><strong>{formatMoney(value)}</strong></div>)}<div className={`pnl-line total ${summary.operatingProfit != null && summary.operatingProfit < 0 ? 'negative' : ''}`}><span>Операционная прибыль</span><strong>{formatMoney(summary.operatingProfit)}</strong></div><div className="pnl-margin"><span>Операционная маржа</span><strong>{formatPercent(summary.margin)}</strong></div></div></div><div className="section-title-row"><div><span>Себестоимость</span><h2>По товарам</h2></div><button className="secondary-btn" onClick={saveSettings}><Save size={16}/> Сохранить</button></div><div className="data-table cost-table"><div className="data-row head cost-row"><span>Товар</span><span>Средняя цена</span><span>Себестоимость за единицу</span><span>Цена в ноль</span><span>Прибыль</span><span>Маржа</span></div>{productRows.slice(0,100).map(p => { const costKey=String(p.key || p.nmID || p.vendorCode); const cost=settingsDraft.productCosts?.[costKey] ?? p.unitCost ?? 0; return <div className="data-row cost-row" key={p.id}><span><strong>{p.title}</strong><small>{p.article}</small></span><span>{formatMoney(p.averagePrice)}</span><span><input className="inline-cost" type="number" min="0" value={cost} onChange={e => updateProductCost(p,e.target.value)} /></span><span>{formatMoney(p.breakevenPrice)}</span><span className={p.profit != null && p.profit < 0 ? 'negative' : 'positive'}>{formatMoney(p.profit)}</span><span>{formatPercent(p.margin)}</span></div>})}</div></section>

  const renderPricing = () => <section className="app-page glass-panel"><div className="page-title"><span>Ценообразование</span><h1>Цены и акции</h1><p>Цена в ноль, целевая цена, цена пика и безопасные сценарии скидок.</p></div>{summary.cogs == null && <div className="notice warning"><AlertTriangle size={20}/><div><strong>Добавьте себестоимость</strong><p>Без неё невозможно честно определить убыточные скидки.</p></div><button onClick={() => setActive('Финансы')}>Открыть финансы</button></div>}<div className="data-table pricing-table"><div className="data-row head pricing-row"><span>Товар</span><span>Текущая/средняя</span><span>Цена в 0</span><span>Целевая</span><span>Пик</span><span>−20%</span><span>−40%</span><span>Решение</span></div>{productRows.map(p => { const base=p.averagePrice || p.targetPrice || 0; const discount20=base*.8; const discount40=base*.6; return <div className="data-row pricing-row" key={p.id}><span><strong>{p.title}</strong><small>{p.article}</small></span><span>{formatMoney(base)}</span><span>{formatMoney(p.breakevenPrice)}</span><span>{formatMoney(p.targetPrice)}</span><span>{formatMoney(p.peakPrice)}</span><span className={p.breakevenPrice && discount20 < p.breakevenPrice ? 'negative' : 'positive'}>{formatMoney(discount20)}</span><span className={p.breakevenPrice && discount40 < p.breakevenPrice ? 'negative' : 'positive'}>{formatMoney(discount40)}</span><span>{p.profit != null && p.profit < 0 ? 'Повысить цену / снизить расходы' : p.status === 'Избыток' ? 'Допустима контролируемая акция' : 'Сохранять цену'}</span></div>})}</div></section>

  const renderAdvertising = () => {
    const spend = Number(settingsDraft.advertisingMonthly || 0)
    const crr = summary.revenue > 0 ? spend / summary.revenue * 100 : 0
    const romi = summary.operatingProfit != null && spend > 0 ? (summary.operatingProfit + spend) / spend * 100 : null
    return <section className="app-page glass-panel"><div className="page-title"><span>Реклама</span><h1>Эффективность продвижения</h1><p>Расходы рекламы связаны с общей выручкой и P&L. Детализация по кампаниям появится после подключения рекламного API WB.</p></div><div className="metrics-grid"><MetricCard label="Расходы на рекламу" value={formatMoney(spend)} delta="за 30 дней" icon={Megaphone}/><MetricCard label="CRR" value={formatPercent(crr)} delta="доля расходов в выручке" icon={Percent}/><MetricCard label="ROMI (оценка)" value={romi == null ? 'Нужна прибыль' : formatPercent(romi)} delta="на основе текущего P&L" icon={TrendingUp}/></div><div className="settings-card ad-input-card"><h3>Расходы на рекламу</h3><p>До прямой детализации кампаний укажите сумму из финансового отчёта WB — она сразу попадёт в прибыль.</p><div className="inline-setting"><input type="number" min="0" value={settingsDraft.advertisingMonthly ?? 0} onChange={e => updateSetting('advertisingMonthly',e.target.value)}/><button className="primary-btn" onClick={saveSettings}><Save size={17}/> Сохранить</button></div></div><div className="notice"><Sparkles size={20}/><div><strong>Рекомендация ЭЛа</strong><p>{crr > 20 ? `CRR ${formatPercent(crr)} выглядит высоким. Проверьте кампании, которые не создают дополнительной прибыли.` : spend > 0 ? `CRR ${formatPercent(crr)} находится в контролируемом диапазоне. Следующий шаг — загрузить детализацию по кампаниям.` : 'Добавьте рекламные расходы, чтобы Эл включил их в P&L и рассчитал CRR.'}</p></div></div></section>
  }

  const renderReviews = () => {
    const qualityRows = [...productRows].filter(p => Number(p.returnsCount || 0) > 0 || Number(p.returnRate || 0) > 0).sort((a,b) => Number(b.returnRate || 0)-Number(a.returnRate || 0))
    return <section className="app-page glass-panel"><div className="page-title"><span>Качество</span><h1>Отзывы и возвраты</h1><p>На этом этапе качество оценивается по возвратам. Тексты отзывов и рейтинг подключаются отдельным разрешённым методом WB.</p></div><div className="metrics-grid"><MetricCard label="Возвраты" value={formatNumber(summary.returns)} delta="за 30 дней" icon={RefreshCw}/><MetricCard label="Доля возвратов" value={formatPercent(summary.returnRate)} delta="от количества продаж" icon={Percent}/><MetricCard label="Товаров в зоне риска" value={formatNumber(qualityRows.filter(p => p.returnRate >= 20).length)} delta="возвраты от 20%" icon={AlertTriangle}/></div><div className="data-table quality-table"><div className="data-row head quality-row"><span>Товар</span><span>Продажи</span><span>Возвраты</span><span>Доля</span><span>Риск</span><span>Рекомендация</span></div>{qualityRows.length ? qualityRows.map(p => <div className="data-row quality-row" key={p.id}><span><strong>{p.title}</strong><small>{p.article}</small></span><span>{formatNumber(p.salesCount)}</span><span>{formatNumber(p.returnsCount)}</span><span>{formatPercent(p.returnRate)}</span><span><b className={`status-badge ${p.returnRate >= 20 ? 'danger' : p.returnRate >= 10 ? 'warning' : 'success'}`}>{p.returnRate >= 20 ? 'Высокий' : p.returnRate >= 10 ? 'Внимание' : 'Норма'}</b></span><span>{p.returnRate >= 20 ? 'Проверить фото, описание, размер/комплектацию и причины возврата' : 'Контролировать динамику'}</span></div>) : <div className="product-empty">Возвраты в загруженных данных не обнаружены.</div>}</div></section>
  }

  const renderSeasonality = () => {
    const month = new Date().getMonth()+1
    const stages = {
      1:['После праздников','Распродажа остатков и осторожное пополнение базовых товаров'],2:['Подготовка к весне','Проверить весенний ассортимент и рекламные ставки'],3:['Рост весеннего спроса','Держать цену на ходовых товарах, пополнять дефицит'],4:['Переход к лету','Ускорять летние категории, контролировать закрытый ассортимент'],5:['Летний спрос','Поддерживать ходовые товары, очищать слабые позиции'],6:['Пик летнего периода','Не уценять дефицит, готовить осень'],7:['Сезонная распродажа','Распродавать медленные летние остатки, заводить осень'],8:['Подготовка к осени','Пополнять демисезон и тестировать цены'],9:['Пик осеннего спроса','Защищать маржу ходовых товаров, пополнять размеры'],10:['Переход к зиме','Ускорять зимние категории, сокращать осенний неликвид'],11:['Высокий сезон','Контролировать дефицит и рекламную эффективность'],12:['Праздничный спрос','Сохранять наличие, не допускать убыточных скидок']
    }
    const [stage,action]=stages[month]
    return <section className="app-page glass-panel"><div className="page-title"><span>Коммерческий календарь</span><h1>Сезонность</h1><p>Месячный ориентир объединён с реальными продажами и запасами.</p></div><div className="season-hero"><CalendarDays size={40}/><div><span>{new Date().toLocaleDateString('ru-RU',{month:'long',year:'numeric'})}</span><h2>{stage}</h2><p>{action}</p></div></div><div className="season-grid">{productRows.slice(0,12).map(p => <div className="season-card" key={p.id}><span className={`status-badge ${stockTone(p.status)}`}>{p.status}</span><h3>{p.title}</h3><p>{p.recommendation}</p><div><span>Продажи: {formatNumber(p.salesCount)}</span><span>Дней запаса: {p.stockCoverDays ?? '—'}</span></div></div>)}</div></section>
  }

  const renderReports = () => <section className="app-page glass-panel"><div className="page-title"><span>Выгрузка данных</span><h1>Отчёты</h1><p>Выгружайте уже отфильтрованные и рассчитанные данные в CSV для Excel.</p></div><div className="report-grid">{reportDefinitions.map(report => <button className="report-card" key={report.title} onClick={report.action}><span><FileText size={25}/></span><div><h3>{report.title}</h3><p>{report.text}</p></div><Download size={20}/></button>)}</div><div className="notice"><ShieldCheck size={20}/><div><strong>Данные каждого клиента изолированы</strong><p>Выгрузка формируется только из кабинета текущего пользователя.</p></div></div></section>

  const renderImport = () => <section className="app-page glass-panel"><div className="page-title"><span>Ручные данные</span><h1>Импорт себестоимости</h1><p>API WB не знает закупочную себестоимость. Загрузите CSV из Excel, чтобы получить честный P&L и цены в ноль.</p></div><div className="import-grid"><div className="settings-card import-card"><Upload size={34}/><h3>Загрузить CSV</h3><p>Колонки: «Артикул» и «Себестоимость». Поддерживаются артикул продавца, nmID и внутренний ключ товара.</p><label className="file-button"><Upload size={17}/> Выбрать CSV<input type="file" accept=".csv,text/csv" onChange={importCostsCsv}/></label></div><div className="settings-card import-card"><FileText size={34}/><h3>Шаблон для Excel</h3><p>Скачайте шаблон, заполните себестоимость и сохраните его в формате CSV UTF-8.</p><button className="secondary-btn" onClick={() => downloadCsv('elisei_cost_template',['Артикул','Себестоимость'],productRows.map(p => [p.article, settingsDraft.productCosts?.[String(p.key || p.nmID || p.vendorCode)] ?? p.unitCost ?? '']))}><Download size={17}/> Скачать шаблон</button></div></div>{importResult && <div className={`notice ${importResult.type === 'error' ? 'warning' : ''}`}><CheckCircle2 size={20}/><div><strong>{importResult.type === 'error' ? 'Импорт не выполнен' : 'Файл прочитан'}</strong><p>{importResult.text}</p></div></div>}<div className="import-actions"><button className="primary-btn" disabled={savingSettings} onClick={saveSettings}><Save size={17}/> Сохранить импорт и пересчитать</button></div><div className="security-note"><ShieldCheck size={22}/><div><strong>Файл обрабатывается в браузере</strong><p>В базу отправляются только сопоставленные значения себестоимости текущего пользователя.</p></div></div></section>

  const renderCrm = () => <section className="app-page glass-panel"><div className="page-title"><span>AI CRM</span><h1>Центр коммуникаций</h1><p>Рабочая основа модуля: приоритеты, правила ответов и задачи. Отправка сообщений включается только через разрешённые методы маркетплейса.</p></div><div className="crm-grid"><div className="crm-card"><UsersRound size={26}/><h3>Очередь внимания</h3><strong>{formatNumber(summary.returns)}</strong><p>Возвраты за 30 дней — потенциальные точки для проверки качества и коммуникаций.</p></div><div className="crm-card"><Star size={26}/><h3>Контроль качества</h3><strong>{productRows.filter(p => p.returnRate >= 20).length}</strong><p>Товаров с высокой долей возвратов.</p></div><div className="crm-card"><Sparkles size={26}/><h3>Правила ЭЛа</h3><strong>Готово</strong><p>Эл не отправляет сообщения без разрешённого API и подтверждённых правил.</p></div></div><div className="notice"><AlertTriangle size={20}/><div><strong>Безопасный режим</strong><p>Массовые сообщения и промокоды не запускаются самовольно. Здесь будут история, статусы и аналитика эффективности.</p></div></div></section>

  const renderConnections = () => <section className="app-page glass-panel connections-page"><div className="page-title"><span>Интеграции</span><h1>Подключение маркетплейса</h1><p>API-ключ отправляется на backend, шифруется и хранится отдельно для аккаунта.</p></div><div className="connection-card"><div className="connection-logo">WB</div><div className="connection-copy"><div className="connection-title"><h3>Wildberries</h3><span className={connection.connected?'connection-status connected':'connection-status'}>{connection.connected?'Подключён':'Не подключён'}</span></div><p>Товары, остатки, заказы и продажи. Финансовые допущения задаются отдельно и не смешиваются между клиентами.</p>{connection.connected ? <><div className="connection-meta"><span>Последняя синхронизация</span><strong>{connection.lastSync ? new Date(connection.lastSync).toLocaleString('ru-RU') : 'Ещё не выполнялась'}</strong></div><div className="connection-actions"><button className="secondary-btn" disabled={syncing} onClick={() => syncConnection()}><RefreshCw className={syncing?'spin':''} size={17}/>{syncing?'Синхронизация':'Синхронизировать'}</button><button className="danger-btn" onClick={disconnect}>Отключить</button></div></> : <form className="token-form" onSubmit={saveConnection}><label>API-ключ Wildberries</label><div className="token-input"><input type={showToken?'text':'password'} value={tokenDraft} onChange={e => setTokenDraft(e.target.value)} placeholder="Вставьте официальный API-ключ" autoComplete="off"/><button type="button" onClick={() => setShowToken(value => !value)}>{showToken?<EyeOff size={18}/>:<Eye size={18}/>}</button></div><small>Нужны категории «Контент», «Аналитика» и «Статистика».</small><button className="primary-btn" disabled={checking}>{checking?<><RefreshCw className="spin" size={17}/> Проверяем</>:<><PlugZap size={17}/> Проверить и подключить</>}</button></form>}</div></div><div className="security-note"><ShieldCheck size={22}/><div><strong>Безопасная архитектура</strong><p>Ключ шифруется AES-256-GCM, не возвращается в браузер и не попадает в GitHub.</p></div></div></section>

  const renderSyncHistory = () => <section className="app-page glass-panel"><div className="page-title"><span>Контроль данных</span><h1>Журнал синхронизаций</h1><p>Точный статус, длительность, количество строк и предупреждения каждого этапа.</p></div>{!connection.connected ? <div className="empty-state"><RefreshCw size={38}/><h3>Wildberries не подключён</h3><button className="primary-btn" onClick={() => setActive('Подключения')}>Подключить</button></div> : <><div className="sync-summary"><div><span>Последняя синхронизация</span><strong>{connection.lastSync ? new Date(connection.lastSync).toLocaleString('ru-RU') : 'Ещё не выполнялась'}</strong></div><button className="secondary-btn" disabled={syncing} onClick={() => syncConnection()}><RefreshCw className={syncing?'spin':''} size={17}/>{syncing?'Загрузка данных':'Запустить синхронизацию'}</button></div>{coreData?.syncWarnings?.length > 0 && <div className="warning-stack">{coreData.syncWarnings.map((warning,index) => <div key={index}><AlertTriangle size={17}/>{warning}</div>)}</div>}<div className="sync-log">{syncHistory.length === 0 ? <div className="sync-empty">В журнале пока нет записей.</div> : syncHistory.map(item => { const warnings=Boolean(item.warnings?.length); return <div className={`sync-log-row ${warnings?'warning':item.status}`} key={item.id}><div className="sync-log-icon">{item.status==='success'&&!warnings?<CheckCircle2 size={18}/>:<AlertTriangle size={18}/>}</div><div><strong>{item.status==='success'?(warnings?'Завершено частично':'Завершено успешно'):'Ошибка'}</strong><span>{new Date(item.at).toLocaleString('ru-RU')}</span></div><div className="sync-log-details">{item.status==='success'?<><span>{item.counts?.products || 0} товаров</span><span>{item.counts?.orders || 0} заказов</span><span>{item.counts?.sales || 0} продаж</span><span>{Math.max(1,Math.round((item.durationMs || 0)/1000))} сек.</span>{warnings&&<span className="sync-warning-text">{item.warnings[0]}</span>}</>:<span>{item.message || 'Неизвестная ошибка'}</span>}</div></div>})}</div></>}</section>

  const renderSettings = () => <section className="app-page glass-panel"><div className="page-title"><span>Настройки</span><h1>Параметры бизнеса</h1><p>Финансовые допущения сохраняются отдельно для вашего аккаунта.</p></div><div className="settings-card standalone"><h3><Settings size={20}/> Основные параметры</h3><div className="settings-grid"><label>Комиссия WB, %<input type="number" value={settingsDraft.commissionPercent ?? 0} onChange={e => updateSetting('commissionPercent',e.target.value)}/></label><label>Логистика за продажу, ₽<input type="number" value={settingsDraft.logisticsPerSale ?? 0} onChange={e => updateSetting('logisticsPerSale',e.target.value)}/></label><label>Налог, %<input type="number" value={settingsDraft.taxPercent ?? 0} onChange={e => updateSetting('taxPercent',e.target.value)}/></label><label>Целевая маржа, %<input type="number" value={settingsDraft.targetMarginPercent ?? 20} onChange={e => updateSetting('targetMarginPercent',e.target.value)}/></label></div><button className="primary-btn" onClick={saveSettings} disabled={savingSettings}><Save size={17}/> Сохранить</button></div><div className="security-note"><ShieldCheck size={22}/><div><strong>MAXADORRE и ELISEI не связаны данными</strong><p>В ELISEI перенесена проверенная бизнес-логика, но репозитории, базы, API-ключи и клиентские данные полностью раздельны.</p></div></div></section>

  const renderChat = () => <section className="app-page glass-panel chat-page"><div className="page-title"><span>AI-помощник</span><h1>Спросить ЭЛа</h1><p>Спросите о прибыли, остатках, возвратах, цене или следующем действии.</p></div><div className="chat-suggestions">{['Что сделать сегодня?','Какие товары заканчиваются?','Почему нет прибыли?','Где высокий возврат?'].map(text => <button key={text} onClick={() => { setChat(text) }}>{text}</button>)}</div><div className="chat-stream">{messages.map((message,index) => <div key={index} className={`chat-message ${message.role}`}>{message.role==='el'&&<b>ЭЛ</b>}<p>{message.text}</p></div>)}</div><form className="chat-form" onSubmit={sendChat}><input value={chat} onChange={e => setChat(e.target.value)} placeholder="Например: какие товары нужно пополнить?"/><button className="primary-btn" aria-label="Отправить"><Send size={18}/></button></form></section>

  const renderers = {
    'Главная':renderHome, 'Аналитика':renderAnalytics, 'Товары':renderProducts, 'Остатки':renderStocks,
    'Финансы':renderFinance, 'Цены и акции':renderPricing, 'Реклама':renderAdvertising, 'Отзывы':renderReviews,
    'Сезонность':renderSeasonality, 'Отчёты':renderReports, 'Импорт данных':renderImport, 'AI CRM':renderCrm, 'Спросить ЭЛа':renderChat,
    'Подключения':renderConnections, 'Синхронизации':renderSyncHistory, 'Настройки':renderSettings,
  }
  const content = (renderers[active] || renderHome)()

  return <div className="shell"><aside className="sidebar glass-panel"><button className="brand brand-button" onClick={() => onNavigate('/')}><div className="brand-mark">E</div><div><strong>ELISEI</strong><span>AI Operating System</span></div></button><nav>{nav.map(([label,Icon]) => <button key={label} className={active===label?'nav-item active':'nav-item'} onClick={() => setActive(label)}><Icon size={18}/><span>{label}</span></button>)}</nav><div className="sidebar-foot"><div className="status-dot"/><span>{connection.connected?'Wildberries подключён':'Демо-режим'}</span></div></aside><main className="main"><header className="topbar"><div className="search"><Search size={17}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Найти товар, артикул или модель"/></div><div className="top-actions"><button className="icon-btn" onClick={() => notify(recommendations[0]?.title || 'Новых уведомлений нет')}><Bell size={18}/><span className="ping"/></button><button className="icon-btn" title="Подключения" onClick={() => setActive('Подключения')}><PlugZap size={18}/></button><button className="icon-btn" title="Выйти" onClick={onLogout}><LogOut size={18}/></button><button className="profile" title={rawName || 'Профиль'}>{profileInitial}</button></div></header>{content}</main>{toast&&<div className="app-toast"><CheckCircle2 size={18}/>{toast}</div>}</div>
}
