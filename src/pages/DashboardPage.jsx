import { useState } from 'react'
import { Bell, LogOut, ChevronRight, CircleDollarSign, Command, Home, LineChart, MessageCircle, PackageSearch, Search, ShieldCheck, Sparkles, TrendingUp, WalletCards } from 'lucide-react'
import ElMascot from '../components/ElMascot'
import RecommendationCard from '../components/RecommendationCard'
import MetricCard from '../components/MetricCard'
import TrendChart from '../components/TrendChart'

const recommendations = [
  {
    eyebrow: 'Цена',
    title: 'Поднять цену на 4 модели',
    text: 'Запас по спросу позволяет увеличить прибыль без заметного риска для продаж.',
    effect: '≈ +27 000 ₽ прибыли',
    tone: 'violet'
  },
  {
    eyebrow: 'Остатки',
    title: 'Пополнить 2 ходовых размера',
    text: 'При текущем темпе продаж запас закончится раньше следующей поставки.',
    effect: 'Сохранить ≈ 41 продажу',
    tone: 'blue'
  },
  {
    eyebrow: 'Карточка товара',
    title: 'Обновить первое фото',
    text: 'Покупатели стали реже открывать карточку после показа в каталоге.',
    effect: 'Потенциал +8–12% переходов',
    tone: 'amber'
  }
]

export default function DashboardPage({ onNavigate, onLogout }) {
  const [active, setActive] = useState('Доброе утро')
  const [query, setQuery] = useState('')

  const nav = [
    ['Доброе утро', Home],
    ['Центр прибыли', CircleDollarSign],
    ['Рост продаж', TrendingUp],
    ['Деньги компании', WalletCards],
    ['Не потеряйте продажи', PackageSearch],
    ['Спросить ЭЛа', MessageCircle],
  ]

  return (
    <div className="shell">
      <aside className="sidebar glass-panel">
        <div className="brand"><div className="brand-mark">E</div><div><strong>ELISEI</strong><span>AI Operating System</span></div></div>
        <nav>
          {nav.map(([label, Icon]) => (
            <button key={label} className={active===label?'nav-item active':'nav-item'} onClick={()=>setActive(label)}>
              <Icon size={18}/><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="status-dot"/><span>Wildberries подключён</span>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Найти товар, модель или отчёт"/></div>
          <div className="top-actions"><button className="icon-btn"><Bell size={18}/><span className="ping"/></button><button className="icon-btn" title="Выйти" onClick={onLogout}><LogOut size={18}/></button><button className="profile">М</button></div>
        </header>

        <section className="hero glass-panel">
          <div className="hero-copy">
            <div className="eyebrow"><Sparkles size={15}/> ЭЛ уже всё проверил</div>
            <h1>Доброе утро, Мария</h1>
            <p>Сегодня есть две хорошие новости и одна задача, которую лучше решить до обеда.</p>
            <button className="primary-btn"><Command size={18}/> Открыть утренний разбор</button>
          </div>
          <ElMascot />
        </section>

        <section className="section-head"><div><span>Главное на сегодня</span><h2>3 решения с наибольшим эффектом</h2></div><button className="ghost-btn">Все рекомендации <ChevronRight size={17}/></button></section>
        <section className="recommend-grid">
          {recommendations.map((item, i)=><RecommendationCard key={item.title} index={i+1} {...item}/>) }
        </section>

        <section className="metrics-grid">
          <MetricCard label="Выручка за 7 дней" value="1,84 млн ₽" delta="+12,6%" icon={LineChart}/>
          <MetricCard label="Операционная прибыль" value="426 300 ₽" delta="+8,4%" icon={WalletCards}/>
          <MetricCard label="Товары под риском" value="7 моделей" delta="−3 за неделю" icon={ShieldCheck}/>
        </section>

        <section className="workspace-grid">
          <div className="chart-card glass-panel">
            <div className="card-head"><div><span>Динамика</span><h3>Выручка и прогноз</h3></div><div className="legend"><i/> Факт <i className="forecast"/> Прогноз</div></div>
            <TrendChart />
          </div>
          <div className="ai-card glass-panel">
            <div className="mini-el"><ElMascot compact/></div>
            <span className="ai-label">Спросить ЭЛа</span>
            <h3>Почему прибыль выросла медленнее выручки?</h3>
            <p>Я сравню цены, рекламу, логистику и себестоимость, а затем покажу главную причину простыми словами.</p>
            <button className="secondary-btn">Получить объяснение <ChevronRight size={17}/></button>
          </div>
        </section>
      </main>
    </div>
  )
}

