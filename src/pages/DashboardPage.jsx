import { useMemo, useState } from 'react'
import { Bell, LogOut, ChevronRight, CircleDollarSign, Home, LineChart, MessageCircle, PackageSearch, Search, ShieldCheck, Sparkles, TrendingUp, WalletCards, BarChart3, Megaphone, Boxes, FileText, Settings, Send, CheckCircle2, PlugZap, Eye, EyeOff, RefreshCw, Star, UsersRound } from 'lucide-react'
import ElMascot from '../components/ElMascot'
import RecommendationCard from '../components/RecommendationCard'
import MetricCard from '../components/MetricCard'
import TrendChart from '../components/TrendChart'

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

const STORAGE_KEY = 'elisei_wb_connection'

export default function DashboardPage({ onNavigate, onLogout }) {
  const [active, setActive] = useState('Главная')
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState('')
  const [chat, setChat] = useState('')
  const [messages, setMessages] = useState([{role:'el', text:'Доброе утро, Мария. Я уже проверил продажи, рекламу и остатки. С чего начнём?'}])
  const [connection, setConnection] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { connected:false, token:'', name:'Wildberries' } }
    catch { return { connected:false, token:'', name:'Wildberries' } }
  })
  const [tokenDraft, setTokenDraft] = useState(connection.token || '')
  const [showToken, setShowToken] = useState(false)
  const [checking, setChecking] = useState(false)

  const nav = [
    ['Главная', Home], ['Аналитика', BarChart3], ['Товары', PackageSearch], ['Реклама', Megaphone],
    ['Финансы', WalletCards], ['Остатки', Boxes], ['Отчёты', FileText], ['AI CRM', UsersRound],
    ['Отзывы', Star], ['Спросить ЭЛа', MessageCircle], ['Подключения', PlugZap], ['Настройки', Settings]
  ]

  const filteredProducts = useMemo(() => products.filter(p => p.join(' ').toLowerCase().includes(query.toLowerCase())), [query])
  const notify = (text) => { setToast(text); window.clearTimeout(window.__eliseiToast); window.__eliseiToast=setTimeout(()=>setToast(''), 2600) }
  const sendChat = (e) => { e.preventDefault(); if(!chat.trim()) return; const q=chat.trim(); setMessages(m=>[...m,{role:'user',text:q},{role:'el',text:connection.connected?'Я анализирую подключённые данные. В этой версии ответы пока демонстрационные; серверная интеграция будет подключена следующим шагом.':'Сначала подключите официальный API Wildberries в разделе «Подключения». После этого я смогу анализировать реальные данные.'}]); setChat('') }

  const saveConnection = async (e) => {
    e.preventDefault()
    if (tokenDraft.trim().length < 20) return notify('Проверьте API-ключ: он выглядит слишком коротким')
    setChecking(true)
    await new Promise(r=>setTimeout(r,900))
    const next = { connected:true, token:tokenDraft.trim(), name:'Wildberries', connectedAt:new Date().toISOString(), lastSync:new Date().toISOString() }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setConnection(next)
    setChecking(false)
    notify('Wildberries подключён в защищённом демо-режиме')
  }

  const disconnect = () => {
    localStorage.removeItem(STORAGE_KEY)
    setConnection({ connected:false, token:'', name:'Wildberries' })
    setTokenDraft('')
    notify('Подключение удалено')
  }

  const renderHome = () => <>
    <section className="hero glass-panel dashboard-welcome"><div className="hero-copy"><div className="eyebrow"><Sparkles size={15}/> ЭЛ уже всё проверил</div><h1>Доброе утро, Мария</h1><p>{connection.connected?'Данные Wildberries подключены. Сегодня есть две хорошие новости и одна задача, которую лучше решить до обеда.':'Сейчас открыт демонстрационный режим. Подключите Wildberries, чтобы заменить примеры реальными показателями.'}</p><div className="hero-actions"><button className="primary-btn" onClick={()=>notify('Утренний разбор открыт')}><CheckCircle2 size={18}/> Открыть утренний разбор</button>{!connection.connected&&<button className="secondary-btn" onClick={()=>setActive('Подключения')}><PlugZap size={18}/> Подключить Wildberries</button>}</div></div><ElMascot /></section>
    <section className="dashboard-kpi-row"><MetricCard label="Прибыль сегодня" value="+47 200 ₽" delta="+18% к вчера" icon={CircleDollarSign}/><MetricCard label="Заказы" value="156" delta="+9% к вчера" icon={PackageSearch}/><MetricCard label="Выручка" value="286 740 ₽" delta="+12% к вчера" icon={TrendingUp}/><MetricCard label="Маржинальность" value="31,7%" delta="+1,4 п.п." icon={BarChart3}/></section>
    <section className="section-head"><div><span>Главное на сегодня</span><h2>3 решения с наибольшим эффектом</h2></div><button className="ghost-btn" onClick={()=>setActive('Аналитика')}>Все рекомендации <ChevronRight size={17}/></button></section>
    <section className="recommend-grid">{recommendations.map((item,i)=><div key={item.title} onClick={()=>notify(`Рекомендация «${item.title}» добавлена в план`)}><RecommendationCard index={i+1} {...item}/></div>)}</section>
    <section className="workspace-grid"><div className="chart-card glass-panel"><div className="card-head"><div><span>Динамика</span><h3>Выручка и прогноз</h3></div><div className="legend"><i/> Факт <i className="forecast"/> Прогноз</div></div><TrendChart /></div><div className="ai-card glass-panel"><div className="mini-el"><ElMascot compact/></div><span className="ai-label">Спросить ЭЛа</span><h3>Почему прибыль выросла медленнее выручки?</h3><p>Я сравню цены, рекламу, логистику и себестоимость и покажу главную причину простыми словами.</p><button className="secondary-btn" onClick={()=>setActive('Спросить ЭЛа')}>Получить объяснение <ChevronRight size={17}/></button></div></section>
  </>

  const renderAnalytics = () => <section className="app-page glass-panel"><div className="page-title"><span>Аналитика</span><h1>Центр прибыли</h1><p>{connection.connected?'Структура готова к загрузке реальных показателей из API Wildberries.':'Демо-данные показывают, как будет выглядеть аналитика после подключения API.'}</p></div><div className="metrics-grid"><MetricCard label="Выручка" value="7,26 млн ₽" delta="+14,2%" icon={TrendingUp}/><MetricCard label="Прибыль" value="1,17 млн ₽" delta="+9,8%" icon={CircleDollarSign}/><MetricCard label="Маржинальность" value="16,1%" delta="−0,7 п.п." icon={BarChart3}/></div><div className="chart-card inner-chart"><div className="card-head"><div><span>Последние 30 дней</span><h3>Динамика прибыли</h3></div></div><TrendChart/></div></section>

  const renderProducts = () => <section className="app-page glass-panel"><div className="page-title"><span>Каталог</span><h1>{active}</h1><p>Поиск работает по артикулу, модели и названию.</p></div><div className="data-table"><div className="data-row head"><span>Артикул</span><span>Товар</span><span>Выручка</span><span>Остаток</span><span>Статус</span></div>{filteredProducts.map(p=><div className="data-row" key={p[0]}>{p.map((v,i)=><span key={i} className={i===4 ? (v==='В норме'?'status-ok':'status-risk'):''}>{v}</span>)}</div>)}</div></section>

  const renderConnections = () => <section className="app-page glass-panel connections-page"><div className="page-title"><span>Интеграции</span><h1>Подключение маркетплейса</h1><p>Добавьте официальный API-ключ Wildberries. В этой фронтенд-версии ключ сохраняется только в вашем браузере; для коммерческого запуска его нужно перенести на защищённый backend.</p></div><div className="connection-card"><div className="connection-logo">WB</div><div className="connection-copy"><div className="connection-title"><h3>Wildberries</h3><span className={connection.connected?'connection-status connected':'connection-status'}>{connection.connected?'Подключён':'Не подключён'}</span></div><p>Товары, остатки, заказы, продажи, реклама и финансовые отчёты.</p>{connection.connected?<><div className="connection-meta"><span>Последняя синхронизация</span><strong>{new Date(connection.lastSync).toLocaleString('ru-RU')}</strong></div><div className="connection-actions"><button className="secondary-btn" onClick={()=>{setConnection(c=>({...c,lastSync:new Date().toISOString()}));notify('Демо-синхронизация завершена')}}><RefreshCw size={17}/> Синхронизировать</button><button className="danger-btn" onClick={disconnect}>Отключить</button></div></>:<form className="token-form" onSubmit={saveConnection}><label>API-ключ Wildberries</label><div className="token-input"><input type={showToken?'text':'password'} value={tokenDraft} onChange={e=>setTokenDraft(e.target.value)} placeholder="Вставьте официальный API-ключ" autoComplete="off"/><button type="button" onClick={()=>setShowToken(v=>!v)} aria-label={showToken?'Скрыть ключ':'Показать ключ'}>{showToken?<EyeOff size={18}/>:<Eye size={18}/>}</button></div><small>Мы рекомендуем использовать ключ только с необходимыми правами чтения.</small><button className="primary-btn" disabled={checking}>{checking?<><RefreshCw className="spin" size={17}/> Проверяем подключение</>:<><PlugZap size={17}/> Проверить и подключить</>}</button></form>}</div></div><div className="security-note"><ShieldCheck size={22}/><div><strong>Безопасная архитектура</strong><p>В production-версии ключи будут шифроваться на сервере и никогда не передаваться в клиентский интерфейс после сохранения.</p></div></div></section>

  const renderGeneric = () => <section className="app-page glass-panel"><div className="page-title"><span>Рабочий раздел</span><h1>{active}</h1><p>Интерфейс раздела подготовлен. Реальные показатели появятся после подключения Wildberries API.</p></div><div className="empty-state"><ElMascot compact/><h3>{active} готов к подключению данных</h3><p>Сейчас открыт демонстрационный режим без изменения кабинета маркетплейса.</p><button className="primary-btn" onClick={()=>setActive('Подключения')}>Подключить Wildberries</button></div></section>

  const renderChat = () => <section className="app-page glass-panel chat-page"><div className="page-title"><span>AI-помощник</span><h1>Спросить ЭЛа</h1><p>Задайте вопрос о продажах, остатках, рекламе или прибыли.</p></div><div className="chat-stream">{messages.map((m,i)=><div key={i} className={`chat-message ${m.role}`}>{m.role==='el'&&<b>ЭЛ</b>}<p>{m.text}</p></div>)}</div><form className="chat-form" onSubmit={sendChat}><input value={chat} onChange={e=>setChat(e.target.value)} placeholder="Например: почему снизилась прибыль?"/><button className="primary-btn" aria-label="Отправить"><Send size={18}/></button></form></section>

  const content = active==='Главная' ? renderHome() : active==='Аналитика' ? renderAnalytics() : active==='Товары' ? renderProducts() : active==='Спросить ЭЛа' ? renderChat() : active==='Подключения' ? renderConnections() : renderGeneric()

  return <div className="shell"><aside className="sidebar glass-panel"><button className="brand brand-button" onClick={()=>onNavigate('/')}><div className="brand-mark">E</div><div><strong>ELISEI</strong><span>AI Operating System</span></div></button><nav>{nav.map(([label,Icon])=><button key={label} className={active===label?'nav-item active':'nav-item'} onClick={()=>setActive(label)}><Icon size={18}/><span>{label}</span></button>)}</nav><div className="sidebar-foot"><div className="status-dot"/><span>{connection.connected?'Wildberries подключён':'Демо-режим'}</span></div></aside><main className="main"><header className="topbar"><div className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Найти товар, модель или отчёт"/></div><div className="top-actions"><button className="icon-btn" onClick={()=>notify('Новых уведомлений нет')}><Bell size={18}/><span className="ping"/></button><button className="icon-btn" title="Подключения" onClick={()=>setActive('Подключения')}><PlugZap size={18}/></button><button className="icon-btn" title="Выйти" onClick={onLogout}><LogOut size={18}/></button><button className="profile">М</button></div></header>{content}</main>{toast&&<div className="app-toast"><CheckCircle2 size={18}/>{toast}</div>}</div>
}
