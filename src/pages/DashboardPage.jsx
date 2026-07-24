import { useMemo, useState } from 'react'
import { Bell, LogOut, ChevronRight, CircleDollarSign, Home, LineChart, MessageCircle, PackageSearch, Search, ShieldCheck, Sparkles, TrendingUp, WalletCards, BarChart3, Megaphone, Boxes, FileText, Settings, Send, CheckCircle2 } from 'lucide-react'
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

export default function DashboardPage({ onNavigate, onLogout }) {
  const [active, setActive] = useState('Главная')
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState('')
  const [chat, setChat] = useState('')
  const [messages, setMessages] = useState([{role:'el', text:'Доброе утро, Мария. Я уже проверил продажи, рекламу и остатки. С чего начнём?'}])

  const nav = [
    ['Главная', Home], ['Аналитика', BarChart3], ['Товары', PackageSearch], ['Реклама', Megaphone],
    ['Финансы', WalletCards], ['Остатки', Boxes], ['Отчёты', FileText], ['Спросить ЭЛа', MessageCircle], ['Настройки', Settings]
  ]

  const filteredProducts = useMemo(() => products.filter(p => p.join(' ').toLowerCase().includes(query.toLowerCase())), [query])
  const notify = (text) => { setToast(text); setTimeout(()=>setToast(''), 2600) }
  const sendChat = (e) => { e.preventDefault(); if(!chat.trim()) return; const q=chat.trim(); setMessages(m=>[...m,{role:'user',text:q},{role:'el',text:'Я подготовил демо-ответ. После подключения API здесь появится анализ ваших реальных данных Wildberries.'}]); setChat('') }

  const renderHome = () => <>
    <section className="hero glass-panel"><div className="hero-copy"><div className="eyebrow"><Sparkles size={15}/> ЭЛ уже всё проверил</div><h1>Доброе утро, Мария</h1><p>Сегодня есть две хорошие новости и одна задача, которую лучше решить до обеда.</p><button className="primary-btn" onClick={()=>notify('Утренний разбор открыт')}><CheckCircle2 size={18}/> Открыть утренний разбор</button></div><ElMascot /></section>
    <section className="section-head"><div><span>Главное на сегодня</span><h2>3 решения с наибольшим эффектом</h2></div><button className="ghost-btn" onClick={()=>setActive('Аналитика')}>Все рекомендации <ChevronRight size={17}/></button></section>
    <section className="recommend-grid">{recommendations.map((item,i)=><div key={item.title} onClick={()=>notify(`Рекомендация «${item.title}» добавлена в план`)}><RecommendationCard index={i+1} {...item}/></div>)}</section>
    <section className="metrics-grid"><MetricCard label="Выручка за 7 дней" value="1,84 млн ₽" delta="+12,6%" icon={LineChart}/><MetricCard label="Операционная прибыль" value="426 300 ₽" delta="+8,4%" icon={WalletCards}/><MetricCard label="Товары под риском" value="7 моделей" delta="−3 за неделю" icon={ShieldCheck}/></section>
    <section className="workspace-grid"><div className="chart-card glass-panel"><div className="card-head"><div><span>Динамика</span><h3>Выручка и прогноз</h3></div><div className="legend"><i/> Факт <i className="forecast"/> Прогноз</div></div><TrendChart /></div><div className="ai-card glass-panel"><div className="mini-el"><ElMascot compact/></div><span className="ai-label">Спросить ЭЛа</span><h3>Почему прибыль выросла медленнее выручки?</h3><p>Я сравню цены, рекламу, логистику и себестоимость и покажу главную причину простыми словами.</p><button className="secondary-btn" onClick={()=>setActive('Спросить ЭЛа')}>Получить объяснение <ChevronRight size={17}/></button></div></section>
  </>

  const renderAnalytics = () => <section className="app-page glass-panel"><div className="page-title"><span>Аналитика</span><h1>Центр прибыли</h1><p>Демо-данные показывают, как будет выглядеть аналитика после подключения API.</p></div><div className="metrics-grid"><MetricCard label="Выручка" value="7,26 млн ₽" delta="+14,2%" icon={TrendingUp}/><MetricCard label="Прибыль" value="1,17 млн ₽" delta="+9,8%" icon={CircleDollarSign}/><MetricCard label="Маржинальность" value="16,1%" delta="−0,7 п.п." icon={BarChart3}/></div><div className="chart-card inner-chart"><div className="card-head"><div><span>Последние 30 дней</span><h3>Динамика прибыли</h3></div></div><TrendChart/></div></section>

  const renderProducts = () => <section className="app-page glass-panel"><div className="page-title"><span>Каталог</span><h1>{active}</h1><p>Поиск работает по артикулу, модели и названию.</p></div><div className="data-table"><div className="data-row head"><span>Артикул</span><span>Товар</span><span>Выручка</span><span>Остаток</span><span>Статус</span></div>{filteredProducts.map(p=><div className="data-row" key={p[0]}>{p.map((v,i)=><span key={i} className={i===4 ? (v==='В норме'?'status-ok':'status-risk'):''}>{v}</span>)}</div>)}</div></section>

  const renderGeneric = () => <section className="app-page glass-panel"><div className="page-title"><span>Рабочий раздел</span><h1>{active}</h1><p>Интерфейс раздела подготовлен. Реальные показатели появятся после подключения Wildberries API.</p></div><div className="empty-state"><ElMascot compact/><h3>{active} готов к подключению данных</h3><p>Сейчас открыт демонстрационный режим без изменения кабинета маркетплейса.</p><button className="primary-btn" onClick={()=>notify('Мастер подключения будет добавлен на следующем этапе')}>Подключить Wildberries</button></div></section>

  const renderChat = () => <section className="app-page glass-panel chat-page"><div className="page-title"><span>AI-помощник</span><h1>Спросить ЭЛа</h1><p>Задайте вопрос о продажах, остатках, рекламе или прибыли.</p></div><div className="chat-stream">{messages.map((m,i)=><div key={i} className={`chat-message ${m.role}`}>{m.role==='el'&&<b>ЭЛ</b>}<p>{m.text}</p></div>)}</div><form className="chat-form" onSubmit={sendChat}><input value={chat} onChange={e=>setChat(e.target.value)} placeholder="Например: почему снизилась прибыль?"/><button className="primary-btn" aria-label="Отправить"><Send size={18}/></button></form></section>

  const content = active==='Главная' ? renderHome() : active==='Аналитика' ? renderAnalytics() : active==='Товары' ? renderProducts() : active==='Спросить ЭЛа' ? renderChat() : renderGeneric()

  return <div className="shell"><aside className="sidebar glass-panel"><button className="brand brand-button" onClick={()=>onNavigate('/')}><div className="brand-mark">E</div><div><strong>ELISEI</strong><span>AI Operating System</span></div></button><nav>{nav.map(([label,Icon])=><button key={label} className={active===label?'nav-item active':'nav-item'} onClick={()=>setActive(label)}><Icon size={18}/><span>{label}</span></button>)}</nav><div className="sidebar-foot"><div className="status-dot"/><span>Демо-режим</span></div></aside><main className="main"><header className="topbar"><div className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Найти товар, модель или отчёт"/></div><div className="top-actions"><button className="icon-btn" onClick={()=>notify('Новых уведомлений нет')}><Bell size={18}/><span className="ping"/></button><button className="icon-btn" title="Выйти" onClick={onLogout}><LogOut size={18}/></button><button className="profile">М</button></div></header>{content}</main>{toast&&<div className="app-toast"><CheckCircle2 size={18}/>{toast}</div>}</div>
}
