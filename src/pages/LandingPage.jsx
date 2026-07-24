import {
  ArrowRight, BarChart3, Check, ChevronRight, Clock3, Menu, MessageCircle,
  ShieldCheck, Sparkles, Store, TrendingUp, X, Boxes, BadgeRussianRuble,
  Megaphone, BrainCircuit, LineChart, Zap, CircleCheckBig
} from 'lucide-react'
import { useState } from 'react'
import ElMascot from '../components/ElMascot'

const abilities = [
  { icon: BadgeRussianRuble, title: 'Прибыль и цены', text: 'Показывает, где теряется маржа и какие модели можно продавать дороже.' },
  { icon: Boxes, title: 'Остатки и поставки', text: 'Предупреждает о дефиците заранее и помогает не замораживать деньги.' },
  { icon: Megaphone, title: 'Реклама', text: 'Находит неэффективные кампании и точки роста рекламной отдачи.' },
  { icon: BrainCircuit, title: 'AI-рекомендации', text: 'Выбирает главное и предлагает конкретные действия с ожидаемым эффектом.' },
  { icon: LineChart, title: 'Продажи и динамика', text: 'Объясняет изменения простым языком, а не просто рисует графики.' },
  { icon: MessageCircle, title: 'AI CRM', text: 'Будущий модуль для коммуникаций, промокодов и истории работы с клиентами.' },
]

const benefits = [
  ['Что произошло', 'ЭЛ собирает продажи, остатки, рекламу и деньги в одну понятную картину.'],
  ['Почему это произошло', 'Объясняет причины изменений простыми словами, без перегруженных отчётов.'],
  ['Что делать дальше', 'Показывает до трёх приоритетных действий с ожидаемым эффектом для бизнеса.'],
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
          <a href="#product" onClick={() => setMenuOpen(false)}>Продукт</a>
          <a href="#how" onClick={() => setMenuOpen(false)}>Как работает</a>
          <a href="#pricing" onClick={() => setMenuOpen(false)}>Тарифы</a>
          <a href="#faq" onClick={() => setMenuOpen(false)}>Вопросы</a>
        </nav>
        <div className="header-actions">
          <button className="text-button" onClick={() => onNavigate(isAuthenticated ? '/app' : '/login')}>{isAuthenticated ? 'Открыть кабинет' : 'Войти'}</button>
          <button className="primary-btn" onClick={() => onNavigate('/register')}>Попробовать бесплатно <ArrowRight size={17} /></button>
        </div>
        <button className="mobile-menu" onClick={() => setMenuOpen(v => !v)}>{menuOpen ? <X /> : <Menu />}</button>
      </header>

      <main>
        <section className="landing-hero premium-hero">
          <div className="hero-grid-lines" />
          <div className="hero-aura" />
          <div className="landing-copy">
            <div className="eyebrow"><Sparkles size={15} /> Ваш AI-директор для маркетплейсов</div>
            <h1>Пока вы развиваете бизнес,<br /><em>ЭЛ уже ищет прибыль</em></h1>
            <p>ELISEI ежедневно анализирует продажи, рекламу, остатки и финансы, а затем показывает конкретные действия: что изменить, почему именно сейчас и какой результат это может дать.</p>
            <div className="hero-actions">
              <button className="primary-btn large" onClick={() => onNavigate('/register')}>Попробовать 3 дня бесплатно <ArrowRight size={18} /></button>
              <button className="secondary-btn large" onClick={() => document.getElementById('demo')?.scrollIntoView({ behavior: 'smooth' })}>Посмотреть демонстрацию <ChevronRight size={18} /></button>
            </div>
            <div className="trust-row"><span><Check size={15} /> Без банковской карты</span><span><Clock3 size={15} /> Подключение за несколько минут</span><span><ShieldCheck size={15} /> Данные защищены</span></div>
          </div>

          <div className="landing-visual premium-visual">
            <div className="el-stage"><ElMascot mood="welcome" /></div>
            <div className="floating-card card-profit"><span>Потенциальная прибыль</span><strong>+48 200 ₽</strong><small><TrendingUp size={13} /> найдено за сегодня</small></div>
            <div className="floating-card card-stock"><span>Остатки</span><strong>7 моделей требуют внимания</strong><small><CircleCheckBig size={13} /> риск рассчитан</small></div>
            <div className="floating-card card-action"><span>Рекомендация ЭЛа</span><strong>Поднять цену на 4 модели</strong><small>Ожидаемый эффект +27 000 ₽</small></div>
          </div>
        </section>

        <section className="logo-strip"><span>Первое подключение</span><strong><Store size={18} /> Wildberries</strong><small>Другие маркетплейсы будут добавляться поэтапно</small></section>

        <section className="public-section stats-band">
          <article><strong>24/7</strong><span>контроль бизнеса</span></article>
          <article><strong>100+</strong><span>метрик в единой логике</span></article>
          <article><strong>3</strong><span>главных действия вместо сотен таблиц</span></article>
          <article><strong>5 минут</strong><span>до первого понятного результата</span></article>
        </section>

        <section className="public-section" id="product">
          <div className="section-kicker">Не очередной отчёт</div>
          <h2>От цифр — к решениям,<br />которые можно выполнить сегодня</h2>
          <p className="section-intro">ELISEI не заставляет вас самостоятельно искать смысл в десятках вкладок. ЭЛ уже проверил данные и показывает главное.</p>
          <div className="benefit-grid">
            {benefits.map(([title, text], i) => <article className="benefit-card" key={title}><span>0{i + 1}</span><div className="benefit-icon">{i === 0 ? <BarChart3 /> : i === 1 ? <MessageCircle /> : <TrendingUp />}</div><h3>{title}</h3><p>{text}</p></article>)}
          </div>
        </section>

        <section className="public-section abilities-section">
          <div className="section-kicker">Что умеет ЭЛ</div>
          <h2>Один AI-помощник.<br />Вся операционная картина бизнеса.</h2>
          <div className="ability-grid">
            {abilities.map(({ icon: Icon, title, text }) => <article className="ability-card" key={title}><div><Icon size={22} /></div><h3>{title}</h3><p>{text}</p></article>)}
          </div>
        </section>

        <section className="public-section story-section" id="how">
          <div className="story-copy"><div className="section-kicker">Один день с ЭЛом</div><h2>Помощник, который уже всё проверил</h2><p>ЭЛ не перегружает уведомлениями. Он выбирает только действительно важные изменения и говорит с вами простым языком.</p><button className="secondary-btn" onClick={() => onNavigate('/register')}>Подключить Wildberries <ArrowRight size={17} /></button></div>
          <div className="timeline">{day.map(([time, title, text]) => <div className="timeline-item" key={time}><time>{time}</time><i /><div><strong>{title}</strong><p>{text}</p></div></div>)}</div>
        </section>

        <section className="public-section demo-section" id="demo">
          <div className="demo-caption"><div><div className="section-kicker">Демонстрация продукта</div><h2>Каждое утро начинается с ответа: «Что делать?»</h2></div><span><Zap size={16} /> Живой сценарий ELISEI</span></div>
          <div className="demo-window premium-demo">
            <div className="demo-top"><span /><span /><span /><small>ELISEI — AI Operating System</small></div>
            <div className="demo-content">
              <aside><b>E</b><i /><i /><i /><i /></aside>
              <div className="demo-dashboard">
                <div className="demo-greeting"><div><span className="demo-label">ЭЛ уже всё проверил</span><h3>Доброе утро, Мария</h3><p>Сегодня есть две хорошие возможности и одна задача, которую лучше не откладывать.</p></div><ElMascot compact mood="success" /></div>
                <div className="demo-cards"><article><small>Цена</small><strong>Поднять цену на 4 модели</strong><em>+27 000 ₽ прибыли</em></article><article><small>Остатки</small><strong>Пополнить 2 размера</strong><em>Сохранить 41 продажу</em></article><article><small>Реклама</small><strong>Остановить 1 кампанию</strong><em>Снизить расход на 18%</em></article></div>
                <div className="demo-bottom"><div><span>Прогноз прибыли</span><strong>1 248 400 ₽</strong></div><div className="spark-chart"><i /><i /><i /><i /><i /><i /><i /></div></div>
              </div>
            </div>
          </div>
        </section>

        <section className="public-section pricing-section" id="pricing">
          <div className="section-kicker">Тарифы</div><h2>Выберите уровень поддержки бизнеса</h2><p className="section-intro">Первые 3 дня бесплатно. В пробном периоде AI-рекомендации отключены.</p>
          <div className="pricing-grid">
            <article className="price-card"><span>Professional</span><h3>18 000 ₽</h3><small>за 3 месяца</small><ul><li><Check />Подключение Wildberries</li><li><Check />Продажи, остатки и финансы</li><li><Check />Основные отчёты и контроль рисков</li><li><Check />История данных</li></ul><button className="secondary-btn" onClick={() => onNavigate('/register')}>Начать бесплатно</button></article>
            <article className="price-card featured"><div className="popular">Выбор для роста</div><span>Premium</span><h3>30 000 ₽</h3><small>за 3 месяца</small><ul><li><Check />Всё из Professional</li><li><Check />AI-помощник ЭЛ</li><li><Check />Персональные рекомендации</li><li><Check />Объяснение причин изменений</li></ul><button className="primary-btn" onClick={() => onNavigate('/register')}>Начать бесплатно</button></article>
          </div>
        </section>

        <section className="public-section faq-section" id="faq"><div><div className="section-kicker">Вопросы</div><h2>Перед подключением</h2></div><div className="faq-list"><details open><summary>Какие данные нужны для старта?</summary><p>Новый клиент создаёт аккаунт и подключает официальный API-ключ Wildberries. После этого система начинает загружать доступные данные.</p></details><details><summary>ELISEI изменяет данные в кабинете маркетплейса?</summary><p>На первом этапе система работает в режиме аналитики и рекомендаций. Действия выполняются только после явного подтверждения пользователя.</p></details><details><summary>Что доступно в пробном периоде?</summary><p>Три дня можно изучать интерфейс и основные показатели. AI-функции ЭЛа включаются после выбора тарифа Premium.</p></details></div></section>

        <section className="final-cta"><ElMascot compact mood="success" /><div><span>Ваш бизнес уже создаёт данные.</span><h2>Пора превратить их в решения.</h2></div><button className="primary-btn large" onClick={() => onNavigate('/register')}>Попробовать бесплатно <ArrowRight size={18} /></button></section>
      </main>
      <footer className="public-footer"><button className="public-brand" onClick={() => onNavigate('/')}><span>E</span><strong>ELISEI</strong></button><p>AI Operating System for marketplace business</p><small>© 2026 ELISEI</small></footer>
    </div>
  )
}
