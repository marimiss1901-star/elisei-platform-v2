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
        <section className="landing-hero hero-v1">
          <div className="hero-aura aura-left"/><div className="hero-aura aura-right"/>
          <div className="landing-copy">
            <div className="eyebrow"><Sparkles size={15}/> Ваш AI-директор для маркетплейсов</div>
            <h1>Пока вы развиваете бизнес,<br/><em>ЭЛ увеличивает прибыль.</em></h1>
            <p>ELISEI ежедневно анализирует продажи, рекламу, остатки и финансы — и превращает данные в понятные действия.</p>
            <div className="hero-actions">
              <button className="primary-btn large" onClick={() => onNavigate('/register')}>Попробовать 3 дня бесплатно <ArrowRight size={18}/></button>
              <button className="secondary-btn large" onClick={() => onNavigate('/app')}>Посмотреть кабинет <ChevronRight size={18}/></button>
            </div>
            <div className="trust-row"><span><Check size={15}/> Без банковской карты</span><span><Clock3 size={15}/> Подключение за несколько минут</span><span><ShieldCheck size={15}/> Официальный API</span></div>
          </div>

          <div className="hero-product-stage">
            <div className="dashboard-preview">
              <div className="preview-top"><span/><span/><span/><small>ELISEI · Сегодня</small></div>
              <div className="preview-body">
                <div className="preview-greeting"><small>ЭЛ уже всё проверил</small><strong>Доброе утро, Мария</strong><p>Сегодня есть три возможности увеличить прибыль.</p></div>
                <div className="preview-actions">
                  {actions.map(([title,count,effect,Icon])=><article key={title}><div><Icon size={16}/></div><small>{title}</small><strong>{count}</strong><em>{effect}</em></article>)}
                </div>
                <div className="preview-chart"><div className="chart-copy"><small>Потенциал на 30 дней</small><strong>+340 000 ₽</strong></div><svg viewBox="0 0 420 120" preserveAspectRatio="none"><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#8b5cf6" stopOpacity=".45"/><stop offset="1" stopColor="#8b5cf6" stopOpacity="0"/></linearGradient></defs><path d="M0 100 C55 94,62 70,110 75 S170 55,215 60 S275 22,330 32 S380 18,420 8 L420 120 L0 120Z" fill="url(#area)"/><path d="M0 100 C55 94,62 70,110 75 S170 55,215 60 S275 22,330 32 S380 18,420 8" fill="none" stroke="#8b5cf6" strokeWidth="4"/></svg></div>
              </div>
            </div>
            <div className="mascot-stage"><ElMascot mood="happy"/></div>
            <div className="signal-card signal-profit"><span>Прибыль</span><strong>+47 200 ₽</strong><small>найдено сегодня</small></div>
            <div className="signal-card signal-risk"><span>Риск</span><strong>7 товаров</strong><small>нужно пополнить</small></div>
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
