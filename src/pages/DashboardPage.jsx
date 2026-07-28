import { useEffect, useMemo, useState } from 'react'
import { Bell, LogOut, ChevronRight, CircleDollarSign, Home, MessageCircle, PackageSearch, Search, ShieldCheck, Sparkles, TrendingUp, WalletCards, BarChart3, Megaphone, Boxes, FileText, Settings, Send, CheckCircle2, PlugZap, Eye, EyeOff, RefreshCw, Star, UsersRound, Clock3, AlertTriangle, ChevronUp, ChevronDown, SlidersHorizontal, X } from 'lucide-react'
import ElMascot from '../components/ElMascot'
import RecommendationCard from '../components/RecommendationCard'
import MetricCard from '../components/MetricCard'
import TrendChart from '../components/TrendChart'
import { wbApi } from '../lib/api'

const recommendations = [
  { eyebrow:'Цена', title:'Поднять цену на 4 модели', text:'Запас по спросу позволяет увеличить прибыль без заметного риска для продаж.', effect:'≈ +27 000 ₽ прибыли', tone:'violet' },
  { eyebrow:'Остатки', title:'Пополнить 2 ходовых размера', text:'При текущем темпе продаж запас закончится раньше следующей поставки.', effect:'Сохранить ≈ 41 продажу', tone:'blue' },
  { eyebrow:'Реклама', title:'Отключить неэффективную кампанию', text:'Расход растёт быстрее дополнительной выручки.', effect:'Экономия ≈ 8 600 ₽', tone:'amber' }
]

const products = [
  ['MP002XW0ZHS7','Кеды женские','286 740 ₽','124','В норме'],
  ['MP002XW0ZKQ2','Ботильоны','198 200 ₽','18','Нужна поставка'],
  ['MP002XW0P91A','Балетки','154 890 ₽','63','В норме'],
  ['MP002XW0L8TT','Полуботинки','122 420 ₽','9','Риск'],
]

const formatMoney = value => value == null ? '—' : new Intl.NumberFormat('ru-RU').format(value) + ' ₽'

export default function DashboardPage({ onNavigate, onLogout }) {
  const [active, setActive] = useState('Главная')
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState('')
  const [chat, setChat] = useState('')
  const [messages, setMessages] = useState([{role:'el', text:'Доброе утро, Мария. Я уже проверил продажи, рекламу и остатки. С чего начнём?'}])
  const [connection, setConnection] = useState({ connected:false, connectionId:'', scopes:[], lastSync:null })
  const [tokenDraft, setTokenDraft] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [checking, setChecking] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [dashboardData, setDashboardData] = useState(null)
  const [liveProducts, setLiveProducts] = useState([])
  const [syncHistory, setSyncHistory] = useState([])
  const [productFilter, setProductFilter] = useState('Все')
  const [productSort, setProductSort] = useState({ key:'title', direction:'asc' })
  const [selectedProduct, setSelectedProduct] = useState(null)

  useEffect(() => {
    if (!wbApi.configured) return
    wbApi.current().then(status => {
      if (!status.connected || !status.connectionId) return null
      const connectionId = status.connectionId
      setConnection({ connected:true, connectionId, scopes:status.scopes || [], lastSync:status.lastSync || null })
      setSyncHistory(status.syncHistory || [])
      return Promise.all([wbApi.dashboard(connectionId), wbApi.products(connectionId), wbApi.syncHistory(connectionId)])
    }).then(result => {
      if (!result) return
      const [dashboard, productResult, historyResult] = result
      setDashboardData(dashboard.dashboard || null)
      setLiveProducts(productResult.products || [])
      setSyncHistory(historyResult.history || [])
    }).catch(error => notify(error.message))
  }, [])

  const nav = [
    ['Главная', Home], ['Аналитика', BarChart3], ['Товары', PackageSearch], ['Реклама', Megaphone],
    ['Финансы', WalletCards], ['Остатки', Boxes], ['Отчёты', FileText], ['AI CRM', UsersRound],
    ['Отзывы', Star], ['Спросить ЭЛа', MessageCircle], ['Подключения', PlugZap], ['Синхронизации', Clock3], ['Настройки', Settings]
  ]

  const productRows = useMemo(() => {
    const source = liveProducts.length ? liveProducts : products.map((p, index) => ({ vendorCode:p[0], title:p[1], revenue:Number(String(p[2]).replace(/\D/g,'')) || 0, stock:Number(p[3]) || 0, status:p[4], nmID:`demo-${index}` }))
    return source.map((p, index) => {
      const stock = Number(p.stock || 0)
      const revenue = Number(p.revenue || 0)
      const status = stock <= 0 ? 'Нет остатка' : stock < 10 ? 'Заканчивается' : 'В наличии'
      return { ...p, id:String(p.nmID || p.vendorCode || index), article:String(p.vendorCode || p.nmID || '—'), title:p.title || 'Товар', brand:p.brand || 'Без бренда', photo:p.photo || '', revenue, stock, status }
    })
  }, [liveProducts])

  const filteredProducts = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = productRows.filter(p => {
      const matchesQuery = !needle || [p.article, p.title, p.brand, p.nmID].join(' ').toLowerCase().includes(needle)
      const matchesFilter = productFilter === 'Все' ||
        (productFilter === 'В наличии' && p.stock > 0) ||
        (productFilter === 'Нет остатка' && p.stock === 0) ||
        (productFilter === 'Заканчиваются' && p.stock > 0 && p.stock < 10) ||
        (productFilter === 'С продажами' && p.revenue > 0) ||
        (productFilter === 'Без продаж' && p.revenue === 0)
      return matchesQuery && matchesFilter
    })
    return [...filtered].sort((a,b) => {
      const av=a[productSort.key], bv=b[productSort.key]
      const result = typeof av === 'number' ? av-bv : String(av).localeCompare(String(bv), 'ru')
      return productSort.direction === 'asc' ? result : -result
    })
  }, [productRows, query, productFilter, productSort])

  const changeProductSort = key => setProductSort(current => current.key === key ? { key, direction:current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction:'asc' })
  const SortIcon = ({ column }) => productSort.key !== column ? null : productSort.direction === 'asc' ? <ChevronUp size={14}/> : <ChevronDown size={14}/>
  const notify = (text) => { setToast(text); window.clearTimeout(window.__eliseiToast); window.__eliseiToast=setTimeout(()=>setToast(''), 2600) }
  const sendChat = (e) => { e.preventDefault(); if(!chat.trim()) return; const q=chat.trim(); setMessages(m=>[...m,{role:'user',text:q},{role:'el',text:connection.connected?'Wildberries подключён. После синхронизации я использую реальные товары, заказы, продажи и остатки. Расчёт прибыли появится после добавления себестоимости и расходов.':'Сначала подключите официальный API Wildberries в разделе «Подключения». После этого я смогу анализировать реальные данные.'}]); setChat('') }

  const syncConnection = async (connectionId = connection.connectionId) => {
    if (!connectionId) return
    setSyncing(true)
    try {
      const result = await wbApi.sync(connectionId)
      setConnection(c => ({ ...c, connected:true, lastSync:result.lastSync }))
      setDashboardData(result.dashboard || null)
      const productResult = await wbApi.products(connectionId)
      setLiveProducts(productResult.products || [])
      setSyncHistory(result.syncHistory || [])
      notify(`Синхронизация завершена: ${result.counts.products} товаров, ${result.counts.orders} заказов`)
    } catch (error) { notify(error.message) }
    finally { setSyncing(false) }
  }

  const saveConnection = async (e) => {
    e.preventDefault()
    if (!wbApi.configured) return notify('Сначала добавьте VITE_API_BASE_URL в настройках Render')
    if (tokenDraft.trim().length < 40) return notify('Проверьте API-ключ: он выглядит слишком коротким')
    setChecking(true)
    try {
      const result = await wbApi.connect(tokenDraft.trim())
      const next = { connected:true, connectionId:result.connectionId, scopes:result.scopes || [], lastSync:null }
      setConnection(next)
      setTokenDraft('')
      notify('Wildberries подключён. Запускаю первую синхронизацию')
      await syncConnection(result.connectionId)
    } catch (error) { notify(error.message) }
    finally { setChecking(false) }
  }

  const disconnect = async () => {
    try { if (connection.connectionId && wbApi.configured) await wbApi.disconnect(connection.connectionId) } catch {}
    setConnection({ connected:false, connectionId:'', scopes:[], lastSync:null })
    setDashboardData(null); setLiveProducts([]); setSyncHistory([]); setTokenDraft('')
    notify('Подключение удалено')
  }

  const renderHome = () => <section className="command-home">
    <div className="command-topline">
      <div>
        <span className="command-kicker">ELISEI · центр управления</span>
        <h1>Доброе утро, Мария</h1>
        <p>{connection.connected ? 'Эл проверил продажи, остатки и рекламу. Ниже — главное, что требует внимания сегодня.' : 'Подключите Wildberries, чтобы Эл заменил демонстрационные показатели реальными данными.'}</p>
      </div>
      <div className="command-status"><span className="status-dot"/><div><strong>{connection.connected ? 'Данные актуальны' : 'Демо-режим'}</strong><small>{connection.lastSync ? `Обновлено ${new Date(connection.lastSync).toLocaleString('ru-RU')}` : 'Ожидается синхронизация'}</small></div></div>
    </div>

    <div className="command-grid">
      <article className="command-summary glass-panel">
        <div className="summary-head"><div><span>Фокус на сегодня</span><h2>{connection.connected ? '3 действия дадут максимальный эффект' : 'Подключите кабинет — и Эл соберёт план дня'}</h2></div><div className="el-orb"><ElMascot compact/></div></div>
        <div className="summary-score"><div><small>Потенциал результата</small><strong>{connection.connected ? '+35 600 ₽' : '—'}</strong><span>{connection.connected ? 'по текущим рекомендациям' : 'после первой синхронизации'}</span></div><button className="primary-btn" onClick={()=>connection.connected ? notify('Утренний разбор открыт') : setActive('Подключения')}><Sparkles size={17}/>{connection.connected ? 'Открыть разбор' : 'Подключить WB'}</button></div>
        <div className="summary-signal"><span className="signal-icon"><Sparkles size={16}/></span><p><strong>Эл:</strong> {connection.connected ? 'Сначала проверьте нулевые остатки. Затем — цены и рекламу: именно там сейчас самый быстрый эффект.' : 'После подключения я начну с остатков, продаж и рекламы, а затем расставлю задачи по приоритету.'}</p></div>
      </article>

      <div className="command-metrics">
        <article className="command-metric glass-panel"><div className="metric-top"><span>Выручка · 30 дней</span><TrendingUp size={18}/></div><strong>{dashboardData ? formatMoney(dashboardData.revenue) : '286 740 ₽'}</strong><small>{connection.connected ? `${dashboardData?.sales || 0} продаж` : '+12% к прошлому периоду'}</small></article>
        <article className="command-metric glass-panel"><div className="metric-top"><span>Заказы · 30 дней</span><PackageSearch size={18}/></div><strong>{dashboardData ? String(dashboardData.orders) : '156'}</strong><small>{connection.connected ? `${dashboardData?.returns || 0} возвратов` : '+9% к прошлому периоду'}</small></article>
        <article className="command-metric glass-panel"><div className="metric-top"><span>Остатки</span><Boxes size={18}/></div><strong>{dashboardData ? String(dashboardData.stockUnits) : '2 410'}</strong><small>{connection.connected ? 'единиц на складах' : 'демонстрационные данные'}</small></article>
        <article className="command-metric glass-panel muted-metric"><div className="metric-top"><span>Прибыль</span><CircleDollarSign size={18}/></div><strong>{connection.connected ? 'Нужна себестоимость' : '+47 200 ₽'}</strong><small onClick={()=>setActive('Финансы')}>Добавить данные →</small></article>
      </div>
    </div>

    <div className="command-section-head"><div><span>Главное на сегодня</span><h2>Решения с наибольшим эффектом</h2></div><button className="text-action" onClick={()=>setActive('Спросить ЭЛа')}>Обсудить с Элом <ChevronRight size={16}/></button></div>
    <div className="action-grid">
      {recommendations.map((r,index)=><article className={`action-card ${r.tone}`} key={r.title}><div className="action-card-top"><span>0{index+1}</span><b>{r.eyebrow}</b></div><h3>{r.title}</h3><p>{r.text}</p><div className="action-effect"><strong>{r.effect}</strong><button onClick={()=>notify(`Открыто: ${r.title}`)}><ChevronRight size={17}/></button></div></article>)}
    </div>

    <div className="command-lower-grid">
      <article className="performance-card glass-panel"><div className="panel-title"><div><span>Динамика бизнеса</span><h3>Выручка и прогноз</h3></div><button className="text-action" onClick={()=>setActive('Аналитика')}>Подробнее <ChevronRight size={15}/></button></div><TrendChart/><div className="performance-footer"><div><span>Текущий период</span><strong>{dashboardData ? formatMoney(dashboardData.revenue) : '286 740 ₽'}</strong></div><div><span>Прогноз</span><strong>{connection.connected ? 'После 2 синхронизаций' : '318 400 ₽'}</strong></div><div><span>Темп</span><strong className="positive">+12,4%</strong></div></div></article>
      <article className="el-brief-card glass-panel"><div className="brief-head"><div className="brief-avatar"><ElMascot compact/></div><div><span>Эл · AI-аналитик</span><h3>Короткий вывод</h3></div></div><p>{connection.connected ? 'Товары подключены. Следующий шаг — корректно загрузить остатки, затем добавить себестоимость. После этого я смогу считать реальную прибыль и находить точки роста.' : 'Сейчас интерфейс показывает сценарий работы. После подключения Wildberries карточки и рекомендации будут строиться на реальных данных.'}</p><div className="brief-list"><button onClick={()=>setActive('Остатки')}><Boxes size={16}/><span>Проверить остатки</span><ChevronRight size={15}/></button><button onClick={()=>setActive('Товары')}><PackageSearch size={16}/><span>Открыть товары</span><ChevronRight size={15}/></button><button onClick={()=>setActive('Спросить ЭЛа')}><MessageCircle size={16}/><span>Задать вопрос Элу</span><ChevronRight size={15}/></button></div></article>
    </div>
  </section>

  const renderAnalytics = () => <section className="app-page glass-panel"><div className="page-title"><span>Аналитика</span><h1>Центр показателей</h1><p>{connection.connected?'Показатели рассчитаны по данным последней синхронизации Wildberries. Прибыль и маржинальность появятся после загрузки себестоимости и расходов.':'Демо-данные показывают, как будет выглядеть аналитика после подключения API.'}</p></div><div className="metrics-grid"><MetricCard label="Выручка за 30 дней" value={dashboardData ? formatMoney(dashboardData.revenue) : '7,26 млн ₽'} delta={dashboardData ? `${dashboardData.sales} продаж` : '+14,2%'} icon={TrendingUp}/><MetricCard label="Заказы за 30 дней" value={dashboardData ? String(dashboardData.orders) : '156'} delta={dashboardData ? `${dashboardData.returns} возвратов` : '+9,8%'} icon={PackageSearch}/><MetricCard label="Остатки" value={dashboardData ? String(dashboardData.stockUnits) : '2 410'} delta="единиц на складах" icon={Boxes}/></div><div className="chart-card inner-chart"><div className="card-head"><div><span>Последние 30 дней</span><h3>Динамика выручки</h3></div></div><TrendChart/></div></section>

  const renderProducts = () => <section className="app-page glass-panel products-page"><div className="page-title product-title"><div><span>Каталог</span><h1>{active}</h1><p>Фото, бренд, остатки и продажи из последней синхронизации Wildberries.</p></div><div className="catalog-counter"><strong>{filteredProducts.length}</strong><span>товаров показано</span></div></div><div className="product-toolbar"><div className="filter-label"><SlidersHorizontal size={16}/> Фильтры</div>{['Все','В наличии','Заканчиваются','Нет остатка','С продажами','Без продаж'].map(filter=><button key={filter} className={productFilter===filter?'filter-chip active':'filter-chip'} onClick={()=>setProductFilter(filter)}>{filter}</button>)}</div><div className="data-table product-table"><div className="data-row head product-row"><span>Фото</span><button onClick={()=>changeProductSort('article')}>Артикул <SortIcon column="article"/></button><button onClick={()=>changeProductSort('title')}>Товар <SortIcon column="title"/></button><button onClick={()=>changeProductSort('revenue')}>Выручка <SortIcon column="revenue"/></button><button onClick={()=>changeProductSort('stock')}>Остаток <SortIcon column="stock"/></button><span>Статус</span></div>{filteredProducts.length===0?<div className="product-empty">По выбранным условиям товары не найдены.</div>:filteredProducts.map(p=><button className="data-row product-row product-item" key={p.id} onClick={()=>setSelectedProduct(p)}><span className="product-thumb">{p.photo?<img src={p.photo} alt="" loading="lazy"/>:<PackageSearch size={22}/>}</span><span className="product-article">{p.article}<small>nmID {p.nmID || '—'}</small></span><span className="product-name"><strong>{p.title}</strong><small>{p.brand}</small></span><span className="product-money">{formatMoney(p.revenue)}</span><span className={`stock-value ${p.stock===0?'zero':p.stock<10?'low':'good'}`}>{p.stock}</span><span><b className={`status-badge ${p.stock===0?'danger':p.stock<10?'warning':'success'}`}>{p.status}</b></span></button>)}</div>{selectedProduct&&<div className="product-drawer-backdrop" onClick={()=>setSelectedProduct(null)}><aside className="product-drawer" onClick={e=>e.stopPropagation()}><button className="drawer-close" onClick={()=>setSelectedProduct(null)}><X size={20}/></button><div className="drawer-photo">{selectedProduct.photo?<img src={selectedProduct.photo} alt={selectedProduct.title}/>:<PackageSearch size={44}/>}</div><span className="drawer-eyebrow">{selectedProduct.brand}</span><h2>{selectedProduct.title}</h2><p className="drawer-article">Артикул: {selectedProduct.article} · nmID: {selectedProduct.nmID || '—'}</p><div className="drawer-metrics"><div><span>Выручка</span><strong>{formatMoney(selectedProduct.revenue)}</strong></div><div><span>Остаток</span><strong>{selectedProduct.stock} шт.</strong></div></div><div className={`drawer-insight ${selectedProduct.stock===0?'danger':selectedProduct.stock<10?'warning':'success'}`}><Sparkles size={19}/><div><strong>Рекомендация ЭЛа</strong><p>{selectedProduct.stock===0?'Товар закончился. Проверьте доступность поставки и потенциально упущенные продажи.':selectedProduct.stock<10?'Запас подходит к критическому уровню. Рекомендуется запланировать поставку до следующего пика спроса.':'Остаток находится в рабочем диапазоне. Следите за темпом продаж после следующей синхронизации.'}</p></div></div></aside></div>}</section>

  const renderConnections = () => <section className="app-page glass-panel connections-page"><div className="page-title"><span>Интеграции</span><h1>Подключение маркетплейса</h1><p>Добавьте официальный API-ключ Wildberries. Ключ отправляется напрямую на backend и не сохраняется в браузере. Подключение сохраняется в защищённой базе и восстанавливается после повторного входа.</p></div><div className="connection-card"><div className="connection-logo">WB</div><div className="connection-copy"><div className="connection-title"><h3>Wildberries</h3><span className={connection.connected?'connection-status connected':'connection-status'}>{connection.connected?'Подключён':'Не подключён'}</span></div><p>Товары, остатки, заказы, продажи, реклама и финансовые отчёты.</p>{connection.connected?<><div className="connection-meta"><span>Последняя синхронизация</span><strong>{connection.lastSync ? new Date(connection.lastSync).toLocaleString('ru-RU') : 'Ещё не выполнялась'}</strong></div><div className="connection-actions"><button className="secondary-btn" disabled={syncing} onClick={()=>syncConnection()}><RefreshCw className={syncing?'spin':''} size={17}/> {syncing?'Синхронизация':'Синхронизировать'}</button><button className="danger-btn" onClick={disconnect}>Отключить</button></div></>:<form className="token-form" onSubmit={saveConnection}><label>API-ключ Wildberries</label><div className="token-input"><input type={showToken?'text':'password'} value={tokenDraft} onChange={e=>setTokenDraft(e.target.value)} placeholder="Вставьте официальный API-ключ" autoComplete="off"/><button type="button" onClick={()=>setShowToken(v=>!v)} aria-label={showToken?'Скрыть ключ':'Показать ключ'}>{showToken?<EyeOff size={18}/>:<Eye size={18}/>}</button></div><small>Мы рекомендуем использовать ключ только с необходимыми правами чтения.</small><button className="primary-btn" disabled={checking}>{checking?<><RefreshCw className="spin" size={17}/> Проверяем подключение</>:<><PlugZap size={17}/> Проверить и подключить</>}</button></form>}</div></div><div className="security-note"><ShieldCheck size={22}/><div><strong>Безопасная архитектура</strong><p>API-ключ шифруется алгоритмом AES-256-GCM и хранится отдельно для вашего аккаунта. Ключ никогда не возвращается в браузер и не отображается после сохранения.</p></div></div></section>

  const renderSyncHistory = () => <section className="app-page glass-panel"><div className="page-title"><span>Контроль данных</span><h1>Журнал синхронизаций</h1><p>Здесь отображаются последние загрузки данных из Wildberries и результаты каждой попытки.</p></div>{!connection.connected?<div className="empty-state"><Clock3 size={38}/><h3>Wildberries не подключён</h3><p>Подключите кабинет, чтобы начать синхронизацию данных.</p><button className="primary-btn" onClick={()=>setActive('Подключения')}>Подключить Wildberries</button></div>:<><div className="sync-summary"><div><span>Последняя синхронизация</span><strong>{connection.lastSync ? new Date(connection.lastSync).toLocaleString('ru-RU') : 'Ещё не выполнялась'}</strong></div><button className="secondary-btn" disabled={syncing} onClick={()=>syncConnection()}><RefreshCw className={syncing?'spin':''} size={17}/>{syncing?'Загрузка данных':'Запустить синхронизацию'}</button></div><div className="sync-log">{syncHistory.length===0?<div className="sync-empty">В журнале пока нет записей.</div>:syncHistory.map(item=><div className={`sync-log-row ${item.status}`} key={item.id}><div className="sync-log-icon">{item.status==='success'?<CheckCircle2 size={18}/>:<AlertTriangle size={18}/>}</div><div><strong>{item.status==='success'?'Синхронизация завершена':'Ошибка синхронизации'}</strong><span>{new Date(item.at).toLocaleString('ru-RU')}</span></div><div className="sync-log-details">{item.status==='success'?<><span>{item.counts?.products || 0} товаров</span><span>{item.counts?.orders || 0} заказов</span><span>{item.counts?.sales || 0} продаж</span><span>{Math.max(1, Math.round((item.durationMs || 0)/1000))} сек.</span></>:<span>{item.message || 'Неизвестная ошибка'}</span>}</div></div>)}</div></>}</section>

  const renderGeneric = () => <section className="app-page glass-panel"><div className="page-title"><span>Рабочий раздел</span><h1>{active}</h1><p>Интерфейс раздела подготовлен. После подключения и синхронизации здесь появятся реальные показатели Wildberries.</p></div><div className="empty-state"><ElMascot compact/><h3>{active} готов к подключению данных</h3><p>Сейчас открыт демонстрационный режим без изменения кабинета маркетплейса.</p><button className="primary-btn" onClick={()=>setActive('Подключения')}>Подключить Wildberries</button></div></section>

  const renderChat = () => <section className="app-page glass-panel chat-page"><div className="page-title"><span>AI-помощник</span><h1>Спросить ЭЛа</h1><p>Задайте вопрос о продажах, остатках, рекламе или прибыли.</p></div><div className="chat-stream">{messages.map((m,i)=><div key={i} className={`chat-message ${m.role}`}>{m.role==='el'&&<b>ЭЛ</b>}<p>{m.text}</p></div>)}</div><form className="chat-form" onSubmit={sendChat}><input value={chat} onChange={e=>setChat(e.target.value)} placeholder="Например: почему снизилась прибыль?"/><button className="primary-btn" aria-label="Отправить"><Send size={18}/></button></form></section>

  const content = active==='Главная' ? renderHome() : active==='Аналитика' ? renderAnalytics() : active==='Товары' ? renderProducts() : active==='Спросить ЭЛа' ? renderChat() : active==='Подключения' ? renderConnections() : active==='Синхронизации' ? renderSyncHistory() : renderGeneric()

  return <div className="shell"><aside className="sidebar glass-panel"><button className="brand brand-button" onClick={()=>onNavigate('/')}><div className="brand-mark">E</div><div><strong>ELISEI</strong><span>AI Operating System</span></div></button><nav>{nav.map(([label,Icon])=><button key={label} className={active===label?'nav-item active':'nav-item'} onClick={()=>setActive(label)}><Icon size={18}/><span>{label}</span></button>)}</nav><div className="sidebar-foot"><div className="status-dot"/><span>{connection.connected?'Wildberries подключён':'Демо-режим'}</span></div></aside><main className="main"><header className="topbar"><div className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Найти товар, модель или отчёт"/></div><div className="top-actions"><button className="icon-btn" onClick={()=>notify('Новых уведомлений нет')}><Bell size={18}/><span className="ping"/></button><button className="icon-btn" title="Подключения" onClick={()=>setActive('Подключения')}><PlugZap size={18}/></button><button className="icon-btn" title="Выйти" onClick={onLogout}><LogOut size={18}/></button><button className="profile">М</button></div></header>{content}</main>{toast&&<div className="app-toast"><CheckCircle2 size={18}/>{toast}</div>}</div>
}
