import { ArrowRight, BarChart3, Check, ChevronRight, Clock3, Menu, MessageCircle, ShieldCheck, Sparkles, Store, TrendingUp, X } from 'lucide-react'
import { useState } from 'react'
import ElMascot from '../components/ElMascot'

const benefits = [
  ['Что произошло', 'ЭЛ собирает продажи, остатки, рекламу и деньги в одну картину.'],
  ['Почему это произошло', 'Объясняет изменения простыми словами, без перегруженных отчётов.'],
  ['Что делать дальше', 'Показывает до трёх действий с ожидаемым эффектом для бизнеса.'],
]

const day = [
  ['08:30', 'Утренний разбор', 'ЭЛ уже проверил бизнес и выбрал главное на сегодня.'],
  ['12:00', 'Контроль продаж', 'Предупреждение о товаре, который может закончиться раньше поставки.'],
  ['17:30', 'Итог дня', 'Что сработало, что изменилось и на чём сосредоточиться завтра.'],
]

export default function LandingPage({ onNavigate, isAuthenticated }) {
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <div className="landing">
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
        <section className="landing-hero">
          <div className="hero-aura"/>
          <div className="landing-copy">
            <div className="eyebrow"><Sparkles size={15}/> AI Operating System для маркетплейсов</div>
            <h1>Управляйте бизнесом<br/><em>спокойнее и увереннее</em></h1>
            <p>Елисей не просто показывает цифры. Он объясняет, что изменилось, почему это произошло и какое действие принесёт наибольший результат.</p>
            <div className="hero-actions">
              <button className="primary-btn large" onClick={() => onNavigate('/register')}>Попробовать 3 дня бесплатно <ArrowRight size={18}/></button>
              <button className="secondary-btn large" onClick={() => onNavigate('/app')}>Посмотреть кабинет <ChevronRight size={18}/></button>
            </div>
            <div className="trust-row"><span><Check size={15}/> Без банковской карты</span><span><Clock3 size={15}/> Подключение за несколько минут</span><span><ShieldCheck size={15}/> Данные защищены</span></div>
          </div>
          <div className="landing-visual">
            <ElMascot />
            <div className="floating-card card-one"><span>Решение на сегодня</span><strong>Поднять цену на 4 модели</strong><small>≈ +27 000 ₽ прибыли</small></div>
            <div className="floating-card card-two"><span>ЭЛ объясняет</span><strong>Продажи выросли благодаря 3 моделям</strong></div>
          </div>
        </section>

        <section className="logo-strip"><span>Первое подключение</span><strong><Store size={18}/> Wildberries</strong><small>Другие маркетплейсы будут добавляться поэтапно</small></section>

        <section className="public-section" id="product">
          <div className="section-kicker">Не очередной отчёт</div>
          <h2>От цифр — к понятным решениям</h2>
          <p className="section-intro">Вместо десятков таблиц Елисей показывает главное и помогает действовать вовремя.</p>
          <div className="benefit-grid">
            {benefits.map(([title,text],i)=><article className="benefit-card" key={title}><span>0{i+1}</span><div className="benefit-icon">{i===0?<BarChart3/>:i===1?<MessageCircle/>:<TrendingUp/>}</div><h3>{title}</h3><p>{text}</p></article>)}
          </div>
        </section>

        <section className="public-section story-section" id="how">
          <div className="story-copy"><div className="section-kicker">Один день с ЭЛом</div><h2>Помощник, который уже всё проверил</h2><p>ЭЛ не перегружает уведомлениями. Он выбирает только действительно важные изменения и говорит с вами простым языком.</p><button className="secondary-btn" onClick={()=>onNavigate('/register')}>Подключить Wildberries <ArrowRight size={17}/></button></div>
          <div className="timeline">{day.map(([time,title,text])=><div className="timeline-item" key={time}><time>{time}</time><i/><div><strong>{title}</strong><p>{text}</p></div></div>)}</div>
        </section>

        <section className="public-section demo-section">
          <div className="demo-window">
            <div className="demo-top"><span/><span/><span/><small>ELISEI — Доброе утро</small></div>
            <div className="demo-content">
              <aside><b>E</b><i/><i/><i/><i/></aside>
              <div><span className="demo-label">ЭЛ уже всё проверил</span><h3>Доброе утро, Мария</h3><p>Сегодня есть две хорошие новости и одна задача.</p><div className="demo-cards"><article><small>Цена</small><strong>Поднять цену на 4 модели</strong><em>+27 000 ₽</em></article><article><small>Остатки</small><strong>Пополнить 2 размера</strong><em>Сохранить 41 продажу</em></article><article><small>Карточка</small><strong>Обновить первое фото</strong><em>+8–12% переходов</em></article></div></div>
            </div>
          </div>
        </section>

        <section className="public-section pricing-section" id="pricing">
          <div className="section-kicker">Тарифы</div><h2>Выберите уровень поддержки бизнеса</h2><p className="section-intro">Первые 3 дня бесплатно. В пробном периоде AI-рекомендации отключены.</p>
          <div className="pricing-grid">
            <article className="price-card"><span>Professional</span><h3>18 000 ₽</h3><small>за 3 месяца</small><ul><li><Check/>Подключение Wildberries</li><li><Check/>Продажи, остатки и финансы</li><li><Check/>Основные отчёты и контроль рисков</li><li><Check/>История данных</li></ul><button className="secondary-btn" onClick={()=>onNavigate('/register')}>Начать бесплатно</button></article>
            <article className="price-card featured"><div className="popular">Выбор для роста</div><span>Premium</span><h3>30 000 ₽</h3><small>за 3 месяца</small><ul><li><Check/>Всё из Professional</li><li><Check/>AI-помощник ЭЛ</li><li><Check/>Персональные рекомендации</li><li><Check/>Объяснение причин изменений</li></ul><button className="primary-btn" onClick={()=>onNavigate('/register')}>Начать бесплатно</button></article>
          </div>
        </section>

        <section className="public-section faq-section" id="faq"><div><div className="section-kicker">Вопросы</div><h2>Перед подключением</h2></div><div className="faq-list"><details open><summary>Какие данные нужны для старта?</summary><p>Новый клиент создаёт аккаунт и подключает официальный API-ключ Wildberries. После этого система начинает загружать доступные данные.</p></details><details><summary>Елисей изменяет данные в кабинете маркетплейса?</summary><p>На первом этапе система работает в режиме аналитики и рекомендаций. Действия выполняются только после явного подтверждения пользователя.</p></details><details><summary>Что доступно в пробном периоде?</summary><p>Три дня можно изучать интерфейс и основные показатели. AI-функции ЭЛа включаются после выбора тарифа Premium.</p></details></div></section>

        <section className="final-cta"><ElMascot compact/><div><span>Ваш бизнес уже создаёт данные.</span><h2>Пора превратить их в решения.</h2></div><button className="primary-btn large" onClick={()=>onNavigate('/register')}>Попробовать бесплатно <ArrowRight size={18}/></button></section>
      </main>
      <footer className="public-footer"><button className="public-brand" onClick={()=>onNavigate('/')}><span>E</span><strong>ELISEI</strong></button><p>AI Operating System for marketplace business</p><small>© 2026 ELISEI</small></footer>
    </div>
  )
}
