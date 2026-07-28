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

  const renderHome = () => {
    const revenue = dashboardData?.revenue || 0
    const orders = dashboardData?.orders || 0
    const stockUnits = dashboardData?.stockUnits || 0
    const sales = dashboardData?.sales || 0
    const returns = dashboardData?.returns || 0
    const criticalStock = productRows.filter(p => p.stock === 0).length
    const lowStock = productRows.filter(p => p.stock > 0 && p.stock < 10).length
    const now = new Date()
    const dateLabel = now.toLocaleDateString('ru-RU', { weekday:'long', day:'numeric', month:'long' })
    const timeLabel = now.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' })
    const events = connection.connected ? [
      {time:'сейчас', icon:RefreshCw, title:'Данные Wildberries проверены', text:connection.lastSync ? `Последняя синхронизация: ${new Date(connection.lastSync).toLocaleString('ru-RU')}` : 'Ожидается первая синхронизация', tone:'violet'},
      {time:'сегодня', icon:AlertTriangle, title:`${criticalStock} товаров без остатка`, text:criticalStock ? 'Эти позиции уже могут терять продажи.' : 'Критичных нулевых остатков не найдено.', tone:criticalStock ? 'danger' : 'success'},
      {time:'сегодня', icon:Boxes, title:`${lowStock} товаров заканчиваются`, text:lowStock ? 'Проверьте сроки следующей поставки.' : 'Запасы находятся в рабочем диапазоне.', tone:lowStock ? 'warning' : 'success'},
      {time:'30 дней', icon:TrendingUp, title:`${sales} продаж и ${orders} заказов`, text:`Возвратов: ${returns}. Выручка: ${formatMoney(revenue)}.`, tone:'blue'}
    ] : [
      {time:'09:14', icon:Sparkles, title:'Эл завершил утренний анализ', text:'Демонстрационный сценарий показывает будущую работу системы.', tone:'violet'},
      {time:'09:18', icon:Boxes, title:'Заканчиваются ходовые размеры', text:'2 модели требуют проверки поставки.', tone:'warning'},
      {time:'09:23', icon:TrendingUp, title:'Обнаружен потенциал роста', text:'Изменение цены может увеличить прибыль.', tone:'success'},
      {time:'09:28', icon:Megaphone, title:'Реклама требует внимания', text:'Одна кампания расходует бюджет без роста продаж.', tone:'danger'}
    ]

    return <section className="ops-home">
      <div className="ops-head">
        <div><span className="ops-kicker">ELISEI · командный центр</span><h1>Ваш бизнес — в одном экране</h1><p>{dateLabel} · {timeLabel} · Wildberries</p></div>
        <div className="ops-data-status"><span className={connection.connected?'status-dot':'status-dot idle'}/><div><strong>{connection.connected?'Система на связи':'Демо-режим'}</strong><small>{connection.lastSync?`Обновлено ${new Date(connection.lastSync).toLocaleString('ru-RU')}`:'Подключите кабинет для реальных данных'}</small></div></div>
      </div>

      <div className="ops-hero-grid">
        <article className="profit-stage">
          <div className="profit-glow"/>
          <div className="profit-label">Выручка за 30 дней</div>
          <div className="profit-value">{connection.connected ? formatMoney(revenue) : '1 592 500 ₽'}</div>
          <div className="profit-delta"><TrendingUp size={17}/>{connection.connected ? `${sales} продаж` : '+18,4% к прошлому периоду'}</div>
          <div className="profit-line"><span style={{width: connection.connected ? `${Math.min(100, Math.max(8, sales))}%` : '74%'}}/></div>
          <div className="profit-subgrid"><div><span>Заказы</span><strong>{connection.connected?orders:'842'}</strong></div><div><span>Остатки</span><strong>{connection.connected?stockUnits.toLocaleString('ru-RU'):'2 410'}</strong></div><div><span>Возвраты</span><strong>{connection.connected?returns:'31'}</strong></div></div>
        </article>

        <article className="el-live-panel glass-panel">
          <div className="el-live-head"><div className="el-live-avatar"><ElMascot compact/></div><div><span>ЭЛ · AI-директор</span><h2>{syncing?'Анализирую данные…':'Анализ завершён'}</h2></div><span className="live-badge">LIVE</span></div>
          <div className="el-checks"><div><CheckCircle2 size={16}/><span>Товары</span><strong>{productRows.length}</strong></div><div><CheckCircle2 size={16}/><span>Остатки</span><strong>{stockUnits}</strong></div><div><CheckCircle2 size={16}/><span>Заказы</span><strong>{orders}</strong></div></div>
          <div className="el-result"><small>Найдено задач</small><strong>{connection.connected ? criticalStock + lowStock : 3}</strong><span>{connection.connected ? `${criticalStock} критичных · ${lowStock} требуют внимания` : '1 критичная · 2 важных'}</span></div>
          <button className="primary-btn ops-primary" onClick={()=>connection.connected?setActive('Спросить ЭЛа'):setActive('Подключения')}><Sparkles size={17}/>{connection.connected?'Обсудить с Элом':'Подключить Wildberries'}</button>
        </article>
      </div>

      <div className="quick-strip">
        {[['Остатки',Boxes],['Товары',PackageSearch],['Реклама',Megaphone],['Финансы',WalletCards],['Отзывы',Star],['AI CRM',UsersRound],['Прогноз',BarChart3]].map(([label,Icon])=><button key={label} onClick={()=>setActive(label==='Прогноз'?'Аналитика':label)}><Icon size={19}/><span>{label}</span><ChevronRight size={14}/></button>)}
      </div>

      <div className="ops-content-grid">
        <section className="priority-zone">
          <div className="ops-section-title"><div><span>Приоритеты</span><h2>Что сделать сегодня</h2></div><button className="text-action" onClick={()=>setActive('Спросить ЭЛа')}>Обсудить план <ChevronRight size={15}/></button></div>
          <div className="priority-list">{recommendations.map((r,index)=><button className={`priority-row ${r.tone}`} key={r.title} onClick={()=>notify(`Открыто: ${r.title}`)}><span className="priority-index">0{index+1}</span><div><small>{r.eyebrow}</small><h3>{r.title}</h3><p>{r.text}</p></div><div className="priority-effect"><strong>{r.effect}</strong><ChevronRight size={18}/></div></button>)}</div>
        </section>

        <section className="event-zone glass-panel">
          <div className="ops-section-title compact"><div><span>Лента событий</span><h2>Что происходит</h2></div><button className="icon-btn" onClick={()=>connection.connected&&syncConnection()} disabled={syncing}><RefreshCw className={syncing?'spin':''} size={17}/></button></div>
          <div className="event-list">{events.map(({time,icon:Icon,title,text,tone})=><div className={`event-item ${tone}`} key={title}><div className="event-icon"><Icon size={17}/></div><div><span>{time}</span><strong>{title}</strong><p>{text}</p></div></div>)}</div>
        </section>
      </div>

      <section className="business-pulse glass-panel">
        <div className="ops-section-title"><div><span>Пульс бизнеса</span><h2>Динамика и прогноз</h2></div><button className="text-action" onClick={()=>setActive('Аналитика')}>Открыть аналитику <ChevronRight size={15}/></button></div>
        <div className="pulse-body"><div className="pulse-chart"><TrendChart/></div><div className="pulse-stats"><div><span>Выручка</span><strong>{connection.connected?formatMoney(revenue):'1,59 млн ₽'}</strong></div><div><span>Заказы</span><strong>{connection.connected?orders:'842'}</strong></div><div><span>Товары под риском</span><strong className={criticalStock?'danger-text':''}>{connection.connected?criticalStock:'7'}</strong></div><div><span>Статус</span><strong className="positive">{connection.connected?'Данные подключены':'Демо'}</strong></div></div></div>
      </section>
    </section>
  }

  const renderAnalytics = () => <section className="app-page glass-panel"><div className="page-title"><span>Аналитика</span><h1>Центр показателей</h1><p>{connection.connected?'Показатели рассчитаны по данным последней синхронизации Wildberries. Прибыль и маржинальность появятся после загрузки себестоимости и расходов.':'Демо-данные показывают, как будет выглядеть аналитика после подключения API.'}</p></div><div className="metrics-grid"><MetricCard label="Выручка за 30 дней" value={dashboardData ? formatMoney(dashboardData.revenue) : '7,26 млн ₽'} delta={dashboardData ? `${dashboardData.sales} продаж` : '+14,2%'} icon={TrendingUp}/><MetricCard label="Заказы за 30 дней" value={dashboardData ? String(dashboardData.orders) : '156'} delta={dashboardData ? `${dashboardData.returns} возвратов` : '+9,8%'} icon={PackageSearch}/><MetricCard label="Остатки" value={dashboardData ? String(dashboardData.stockUnits) : '2 410'} delta="единиц на складах" icon={Boxes}/></div><div className="chart-card inner-chart"><div className="card-head"><div><span>Последние 30 дней</span><h3>Динамика выручки</h3></div></div><TrendChart/></div></section>

  const renderProducts = () => <section className="app-page glass-panel products-page"><div className="page-title product-title"><div><span>Каталог</span><h1>{active}</h1><p>Фото, бренд, остатки и продажи из последней синхронизации Wildberries.</p></div><div className="catalog-counter"><strong>{filteredProducts.length}</strong><span>товаров показано</span></div></div><div className="product-toolbar"><div className="filter-label"><SlidersHorizontal size={16}/> Фильтры</div>{['Все','В наличии','Заканчиваются','Нет остатка','С продажами','Без продаж'].map(filter=><button key={filter} className={productFilter===filter?'filter-chip active':'filter-chip'} onClick={()=>setProductFilter(filter)}>{filter}</button>)}</div><div className="data-table product-table"><div className="data-row head product-row"><span>Фото</span><button onClick={()=>changeProductSort('article')}>Артикул <SortIcon column="article"/></button><button onClick={()=>changeProductSort('title')}>Товар <SortIcon column="title"/></button><button onClick={()=>changeProductSort('revenue')}>Выручка <SortIcon column="revenue"/></button><button onClick={()=>changeProductSort('stock')}>Остаток <SortIcon column="stock"/></button><span>Статус</span></div>{filteredProducts.length===0?<div className="product-empty">По выбранным условиям товары не найдены.</div>:filteredProducts.map(p=><button className="data-row product-row product-item" key={p.id} onClick={()=>setSelectedProduct(p)}><span className="product-thumb">{p.photo?<img src={p.photo} alt="" loading="lazy"/>:<PackageSearch size={22}/>}</span><span className="product-article">{p.article}<small>nmID {p.nmID || '—'}</small></span><span className="product-name"><strong>{p.title}</strong><small>{p.brand}</small></span><span className="product-money">{formatMoney(p.revenue)}</span><span className={`stock-value ${p.stock===0?'zero':p.stock<10?'low':'good'}`}>{p.stock}</span><span><b className={`status-badge ${p.stock===0?'danger':p.stock<10?'warning':'success'}`}>{p.status}</b></span></button>)}</div>{selectedProduct&&<div className="product-drawer-backdrop" onClick={()=>setSelectedProduct(null)}><aside className="product-drawer" onClick={e=>e.stopPropagation()}><button className="drawer-close" onClick={()=>setSelectedProduct(null)}><X size={20}/></button><div className="drawer-photo">{selectedProduct.photo?<img src={selectedProduct.photo} alt={selectedProduct.title}/>:<PackageSearch size={44}/>}</div><span className="drawer-eyebrow">{selectedProduct.brand}</span><h2>{selectedProduct.title}</h2><p className="drawer-article">Артикул: {selectedProduct.article} · nmID: {selectedProduct.nmID || '—'}</p><div className="drawer-metrics"><div><span>Выручка</span><strong>{formatMoney(selectedProduct.revenue)}</strong></div><div><span>Остаток</span><strong>{selectedProduct.stock} шт.</strong></div></div><div className={`drawer-insight ${selectedProduct.stock===0?'danger':selectedProduct.stock<10?'warning':'success'}`}><Sparkles size={19}/><div><strong>Рекомендация ЭЛа</strong><p>{selectedProduct.stock===0?'Товар закончился. Проверьте доступность поставки и потенциально упущенные продажи.':selectedProduct.stock<10?'Запас подходит к критическому уровню. Рекомендуется запланировать поставку до следующего пика спроса.':'Остаток находится в рабочем диапазоне. Следите за темпом продаж после следующей синхронизации.'}</p></div></div></aside></div>}</section>

  const renderConnections = () => <section className="app-page glass-panel connections-page"><div className="page-title"><span>Интеграции</span><h1>Подключение маркетплейса</h1><p>Добавьте официальный API-ключ Wildberries. Ключ отправляется напрямую на backend и не сохраняется в браузере. Подключение сохраняется в защищённой базе и восстанавливается после повторного входа.</p></div><div className="connection-card"><div className="connection-logo">WB</div><div className="connection-copy"><div className="connection-title"><h3>Wildberries</h3><span className={connection.connected?'connection-status connected':'connection-status'}>{connection.connected?'Подключён':'Не подключён'}</span></div><p>Товары, остатки, заказы, продажи, реклама и финансовые отчёты.</p>{connection.connected?<><div className="connection-meta"><span>Последняя синхронизация</span><strong>{connection.lastSync ? new Date(connection.lastSync).toLocaleString('ru-RU') : 'Ещё не выполнялась'}</strong></div><div className="connection-actions"><button className="secondary-btn" disabled={syncing} onClick={()=>syncConnection()}><RefreshCw className={syncing?'spin':''} size={17}/> {syncing?'Синхронизация':'Синхронизировать'}</button><button className="danger-btn" onClick={disconnect}>Отключить</button></div></>:<form className="token-form" onSubmit={saveConnection}><label>API-ключ Wildberries</label><div className="token-input"><input type={showToken?'text':'password'} value={tokenDraft} onChange={e=>setTokenDraft(e.target.value)} placeholder="Вставьте официальный API-ключ" autoComplete="off"/><button type="button" onClick={()=>setShowToken(v=>!v)} aria-label={showToken?'Скрыть ключ':'Показать ключ'}>{showToken?<EyeOff size={18}/>:<Eye size={18}/>}</button></div><small>Мы рекомендуем использовать ключ только с необходимыми правами чтения.</small><button className="primary-btn" disabled={checking}>{checking?<><RefreshCw className="spin" size={17}/> Проверяем подключение</>:<><PlugZap size={17}/> Проверить и подключить</>}</button></form>}</div></div><div className="security-note"><ShieldCheck size={22}/><div><strong>Безопасная архитектура</strong><p>API-ключ шифруется алгоритмом AES-256-GCM и хранится отдельно для вашего аккаунта. Ключ никогда не возвращается в браузер и не отображается после сохранения.</p></div></div></section>

  const renderSyncHistory = () => <section className="app-page glass-panel"><div className="page-title"><span>Контроль данных</span><h1>Журнал синхронизаций</h1><p>Здесь отображаются последние загрузки данных из Wildberries и результаты каждой попытки.</p></div>{!connection.connected?<div className="empty-state"><Clock3 size={38}/><h3>Wildberries не подключён</h3><p>Подключите кабинет, чтобы начать синхронизацию данных.</p><button className="primary-btn" onClick={()=>setActive('Подключения')}>Подключить Wildberries</button></div>:<><div className="sync-summary"><div><span>Последняя синхронизация</span><strong>{connection.lastSync ? new Date(connection.lastSync).toLocaleString('ru-RU') : 'Ещё не выполнялась'}</strong></div><button className="secondary-btn" disabled={syncing} onClick={()=>syncConnection()}><RefreshCw className={syncing?'spin':''} size={17}/>{syncing?'Загрузка данных':'Запустить синхронизацию'}</button></div><div className="sync-log">{syncHistory.length===0?<div className="sync-empty">В журнале пока нет записей.</div>:syncHistory.map(item=><div className={`sync-log-row ${item.status}`} key={item.id}><div className="sync-log-icon">{item.status==='success'?<CheckCircle2 size={18}/>:<AlertTriangle size={18}/>}</div><div><strong>{item.status==='success'?'Синхронизация завершена':'Ошибка синхронизации'}</strong><span>{new Date(item.at).toLocaleString('ru-RU')}</span></div><div className="sync-log-details">{item.status==='success'?<><span>{item.counts?.products || 0} товаров</span><span>{item.counts?.orders || 0} заказов</span><span>{item.counts?.sales || 0} продаж</span><span>{Math.max(1, Math.round((item.durationMs || 0)/1000))} сек.</span></>:<span>{item.message || 'Неизвестная ошибка'}</span>}</div></div>)}</div></>}</section>

  const renderGeneric = () => <section className="app-page glass-panel"><div className="page-title"><span>Рабочий раздел</span><h1>{active}</h1><p>Интерфейс раздела подготовлен. После подключения и синхронизации здесь появятся реальные показатели Wildberries.</p></div><div className="empty-state"><ElMascot compact/><h3>{active} готов к подключению данных</h3><p>Сейчас открыт демонстрационный режим без изменения кабинета маркетплейса.</p><button className="primary-btn" onClick={()=>setActive('Подключения')}>Подключить Wildberries</button></div></section>

  const renderChat = () => <section className="app-page glass-panel chat-page"><div className="page-title"><span>AI-помощник</span><h1>Спросить ЭЛа</h1><p>Задайте вопрос о продажах, остатках, рекламе или прибыли.</p></div><div className="chat-stream">{messages.map((m,i)=><div key={i} className={`chat-message ${m.role}`}>{m.role==='el'&&<b>ЭЛ</b>}<p>{m.text}</p></div>)}</div><form className="chat-form" onSubmit={sendChat}><input value={chat} onChange={e=>setChat(e.target.value)} placeholder="Например: почему снизилась прибыль?"/><button className="primary-btn" aria-label="Отправить"><Send size={18}/></button></form></section>

  const content = active==='Главная' ? renderHome() : active==='Аналитика' ? renderAnalytics() : active==='Товары' ? renderProducts() : active==='Спросить ЭЛа' ? renderChat() : active==='Подключения' ? renderConnections() : active==='Синхронизации' ? renderSyncHistory() : renderGeneric()

  return <div className="shell"><aside className="sidebar glass-panel"><button className="brand brand-button" onClick={()=>onNavigate('/')}><div className="brand-mark">E</div><div><strong>ELISEI</strong><span>AI Operating System</span></div></button><nav>{nav.map(([label,Icon])=><button key={label} className={active===label?'nav-item active':'nav-item'} onClick={()=>setActive(label)}><Icon size={18}/><span>{label}</span></button>)}</nav><div className="sidebar-foot"><div className="status-dot"/><span>{connection.connected?'Wildberries подключён':'Демо-режим'}</span></div></aside><main className="main"><header className="topbar"><div className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Найти товар, модель или отчёт"/></div><div className="top-actions"><button className="icon-btn" onClick={()=>notify('Новых уведомлений нет')}><Bell size={18}/><span className="ping"/></button><button className="icon-btn" title="Подключения" onClick={()=>setActive('Подключения')}><PlugZap size={18}/></button><button className="icon-btn" title="Выйти" onClick={onLogout}><LogOut size={18}/></button><button className="profile">М</button></div></header>{content}</main>{toast&&<div className="app-toast"><CheckCircle2 size={18}/>{toast}</div>}</div>
}
