import { ArrowRight, BarChart3, Check, ChevronRight, Clock3, Menu, MessageCircle, ShieldCheck, Sparkles, Store, TrendingUp, X, Zap, PackageSearch, BadgeDollarSign } from 'lucide-react'
import { useState } from 'react'
import ElMascot from '../components/ElMascot'

const benefits = [
  ['Понимает бизнес', 'Собирает продажи, рекламу, остатки и финансы в единую картину.'],
  ['Объясняет причины', 'Показывает, почему изменились показатели, без сложных BI-терминов.'],
  ['Предлагает действия', 'Даёт до трёх приоритетных шагов с ожидаемым финансовым эффектом.'],
]

const actions = [
  ['Поднять цену', '4 модели', '+47 200 ₽', BadgeDollarSign],
  ['Пополнить остатки', '7 позиций', 'Сохранить 68 продаж', PackageSearch],
  ['Остановить рекламу', '1 кампания', '−12% лишних расходов', Zap],
]

export default function LandingPage({ onNavigate, isAuthenticated }) {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <div className="landing landing-v1">
      <header className="public-header">
        <button className="public-brand" onClick={() => onNavigate('/')}><span>E</span><strong>ELISEI</strong></button>
        <nav className={menuOpen ? 'public-nav open' : 'public-nav'}>
          <a href="#product" onClick={()=>setMenuOpen(false)}>Продукт</a>
          <a href="#how" onClick={()=>setMenuOpen(false)}>Как работает</a>
          <a href="#pricing" onClick={()=>setMenuOpen(false)}>Тарифы</a>
          <a href="#faq" onClick={()=>setMenuOpen(false)}>Вопросы</a>
        </nav>
        <div className="header-actions">
          <button className="text-button" onClick={() => onNavigate(isAuthenticated ? '/app' : '/login')}>{isAuthenticated ? 'Открыть кабинет' : 'Войти'}</button>
          <button className="primary-btn" onClick={() => onNavigate('/register')}>Попробовать бесплатно <ArrowRight size={17}/></button>
        </div>
        <button className="mobile-menu" onClick={()=>setMenuOpen(v=>!v)}>{menuOpen ? <X/> : <Menu/>}</button>
      </header>

      <main>
        <section className="landing-hero hero-v2">
          <div className="hero-grid-glow"/>
          <div className="hero-v2-copy">
            <div className="eyebrow"><Sparkles size={15}/> Ваш AI-директор для роста прибыли</div>
            <h1>Пока вы<br/>развиваете бизнес,<br/><em>ЭЛ увеличивает<br/>прибыль.</em></h1>
            <p>AI анализирует продажи, рекламу, остатки и финансы каждый день и предлагает конкретные действия, которые увеличивают вашу прибыль.</p>
            <div className="hero-actions">
              <button className="primary-btn large" onClick={() => onNavigate('/register')}>Попробовать бесплатно <ArrowRight size={18}/></button>
              <button className="secondary-btn large" onClick={() => onNavigate('/app')}>Посмотреть демо <ChevronRight size={18}/></button>
            </div>
            <div className="trust-cards">
              <span><Sparkles size={15}/><b>3 дня бесплатно</b><small>Без ограничений</small></span>
              <span><ShieldCheck size={15}/><b>Без карты</b><small>Никаких платежей</small></span>
              <span><Check size={15}/><b>Безопасно</b><small>Данные под защитой</small></span>
            </div>
          </div>

          <div className="hero-v2-visual">
            <div className="dashboard-shell">
              <aside className="dash-sidebar">
                <div className="dash-brand"><span>E</span><b>ELISEI</b></div>
                {['Главная','Аналитика','Товары','Реклама','Финансы','Остатки','Отчёты','Настройки'].map((item,i)=><div className={i===0?'dash-nav active':'dash-nav'} key={item}><i/>{item}</div>)}
              </aside>
              <div className="dash-main">
                <div className="dash-head"><div><h3>Доброе утро, Мария! 👋</h3><p>Сегодня 22 мая, четверг</p></div><span>Обновлено 5 мин назад <i/></span></div>
                <div className="dash-kpis">
                  <article><small>Прибыль за сегодня</small><strong>+42 800 ₽</strong><em>↑ 18% к вчера</em><svg viewBox="0 0 120 35"><path d="M2 30 L18 25 L29 29 L43 18 L57 22 L70 12 L83 17 L98 7 L118 10"/></svg></article>
                  <article><small>Выручка за сегодня</small><strong>286 740 ₽</strong><em>↑ 12% к вчера</em><svg viewBox="0 0 120 35"><path d="M2 28 L16 22 L28 26 L42 16 L54 20 L67 11 L82 15 L96 5 L118 8"/></svg></article>
                  <article><small>Заказы за сегодня</small><strong>156 шт.</strong><em>↑ 9% к вчера</em><svg viewBox="0 0 120 35"><path d="M2 29 L15 24 L28 27 L41 17 L53 22 L68 13 L81 16 L96 8 L118 4"/></svg></article>
                </div>
                <div className="dash-charts">
                  <article className="profit-chart"><small>Динамика прибыли</small><strong>1 172 230 ₽</strong><div className="chart-lines"><span/><span/><span/><svg viewBox="0 0 420 130" preserveAspectRatio="none"><defs><linearGradient id="heroArea" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#9f67ff" stopOpacity=".42"/><stop offset="1" stopColor="#9f67ff" stopOpacity="0"/></linearGradient></defs><path className="area" d="M0 115 C45 108,55 92,95 98 S155 72,195 80 S245 52,292 60 S352 20,420 26 L420 130 L0 130Z"/><path className="line" d="M0 115 C45 108,55 92,95 98 S155 72,195 80 S245 52,292 60 S352 20,420 26"/></svg></div></article>
                  <article className="ad-chart"><small>Расходы на рекламу</small><strong>28 540 ₽</strong><div className="donut"><div/><ul><li>Wildberries <b>48%</b></li><li>Ozon <b>28%</b></li><li>Яндекс <b>16%</b></li></ul></div></article>
                </div>
                <div className="ai-list"><div><b>AI-рекомендации на сегодня</b><small>Все рекомендации →</small></div>{[['Поднять цену на 4 модели','Ожидаемая доп. прибыль','+27 000 ₽'],['Пополнить остатки на 3 складах','Упущенная выручка','+31 200 ₽'],['Отключить неэффективную рекламу','Экономия бюджета','+8 600 ₽']].map(([a,b,c],i)=><article key={a}><span className={`rec-dot r${i}`}/><p><b>{a}</b><small>{b}</small></p><em>{c}</em><button>Применить</button></article>)}</div>
              </div>
            </div>
            <div className="mascot-stage-v2"><ElMascot mood="happy"/></div>
            <div className="hero-ring ring-one"/><div className="hero-ring ring-two"/>
          </div>
        </section>

        <section className="logo-strip"><span>Первое подключение</span><strong><Store size={18}/> Wildberries</strong><small>Другие маркетплейсы будут добавляться поэтапно</small></section>

        <section className="public-section soft-section" id="product">
          <div className="section-kicker">Не очередной отчёт</div>
          <h2>У вас появился AI-директор</h2>
          <p className="section-intro">ЭЛ не заставляет изучать десятки графиков. Он сам выбирает главное, объясняет ситуацию и показывает следующий шаг.</p>
          <div className="benefit-grid">
            {benefits.map(([title,text],i)=><article className="benefit-card" key={title}><span>0{i+1}</span><div className="benefit-icon">{i===0?<BarChart3/>:i===1?<MessageCircle/>:<TrendingUp/>}</div><h3>{title}</h3><p>{text}</p></article>)}
          </div>
        </section>

        <section className="public-section story-section" id="how">
          <div className="story-copy"><div className="section-kicker">Как это работает</div><h2>Три шага до первых решений</h2><p>Подключение не требует сложного внедрения. Система начинает работать на доступных данных Wildberries.</p><button className="secondary-btn" onClick={()=>onNavigate('/register')}>Подключить Wildberries <ArrowRight size={17}/></button></div>
          <div className="timeline">
            <div className="timeline-item"><time>01</time><i/><div><strong>Подключите официальный API</strong><p>Ключ добавляется в защищённой форме и используется только для разрешённых операций.</p></div></div>
            <div className="timeline-item"><time>02</time><i/><div><strong>ЭЛ соберёт единую картину</strong><p>Продажи, остатки, реклама и финансы объединяются в один контекст.</p></div></div>
            <div className="timeline-item"><time>03</time><i/><div><strong>Получайте конкретные действия</strong><p>Каждая рекомендация содержит причину, приоритет и ожидаемый эффект.</p></div></div>
          </div>
        </section>

        <section className="public-section demo-section">
          <div className="demo-window">
            <div className="demo-top"><span/><span/><span/><small>ELISEI — Кабинет</small></div>
            <div className="demo-content">
              <aside><b>E</b><i/><i/><i/><i/></aside>
              <div><span className="demo-label">ЭЛ уже всё проверил</span><h3>Сегодня есть две хорошие новости и одна задача</h3><p>Фокус — только на решениях, которые действительно влияют на прибыль.</p><div className="demo-cards"><article><small>Цена</small><strong>Поднять цену на 4 модели</strong><em>+27 000 ₽</em></article><article><small>Остатки</small><strong>Пополнить 2 размера</strong><em>Сохранить 41 продажу</em></article><article><small>Карточка</small><strong>Обновить первое фото</strong><em>+8–12% переходов</em></article></div></div>
            </div>
          </div>
        </section>

        <section className="public-section pricing-section" id="pricing">
          <div className="section-kicker">Тарифы</div><h2>Выберите уровень поддержки бизнеса</h2><p className="section-intro">Первые 3 дня бесплатно. В пробном периоде AI-рекомендации отключены.</p>
          <div className="pricing-grid">
            <article className="price-card"><span>Professional</span><h3>18 000 ₽</h3><small>за 3 месяца</small><ul><li><Check/>Подключение Wildberries</li><li><Check/>Продажи, остатки и финансы</li><li><Check/>Основные отчёты и контроль рисков</li><li><Check/>История данных</li></ul><button className="secondary-btn" onClick={()=>onNavigate('/register')}>Начать бесплатно</button></article>
            <article className="price-card featured"><div className="popular">Выбор для роста</div><span>Premium</span><h3>30 000 ₽</h3><small>за 3 месяца</small><ul><li><Check/>Всё из Professional</li><li><Check/>AI-директор ЭЛ</li><li><Check/>Персональные рекомендации</li><li><Check/>Объяснение причин изменений</li></ul><button className="primary-btn" onClick={()=>onNavigate('/register')}>Начать бесплатно</button></article>
          </div>
        </section>

        <section className="public-section faq-section" id="faq"><div><div className="section-kicker">Вопросы</div><h2>Перед подключением</h2></div><div className="faq-list"><details open><summary>Какие данные нужны для старта?</summary><p>Новый клиент создаёт аккаунт и подключает официальный API-ключ Wildberries. После этого система начинает загружать доступные данные.</p></details><details><summary>ELISEI изменяет данные в кабинете маркетплейса?</summary><p>На первом этапе система работает в режиме аналитики и рекомендаций. Действия выполняются только после явного подтверждения пользователя.</p></details><details><summary>Что доступно в пробном периоде?</summary><p>Три дня можно изучать интерфейс и основные показатели. AI-функции ЭЛа включаются после выбора тарифа Premium.</p></details></div></section>

        <section className="final-cta"><ElMascot compact/><div><span>Ваш бизнес уже создаёт данные.</span><h2>Пора превратить их в решения.</h2></div><button className="primary-btn large" onClick={()=>onNavigate('/register')}>Попробовать бесплатно <ArrowRight size={18}/></button></section>
      </main>
      <footer className="public-footer"><button className="public-brand" onClick={()=>onNavigate('/')}><span>E</span><strong>ELISEI</strong></button><p>AI Operating System for marketplace business</p><small>© 2026 ELISEI</small></footer>
    </div>
  )
}
