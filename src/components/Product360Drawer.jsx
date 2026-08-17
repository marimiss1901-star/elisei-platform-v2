import {
  AlertTriangle, Boxes, CheckCircle2, CircleDollarSign, Clock3, Megaphone,
  PackageSearch, RefreshCw, Search, ShieldCheck, Sparkles, Star, Tag, TrendingUp, X,
} from 'lucide-react'

const fmtMoney = value => value == null ? 'Не загружено' : `${new Intl.NumberFormat('ru-RU').format(Math.round(Number(value || 0)))} ₽`
const fmtNum = value => value == null ? 'Не загружено' : new Intl.NumberFormat('ru-RU').format(Math.round(Number(value || 0)))
const fmtPercent = (value,missing='—') => value == null ? missing : `${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(Number(value || 0))}%`
const fmtDate = value => {
  if (!value) return '—'
  const date = new Date(String(value).length === 10 ? `${value}T00:00:00` : value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('ru-RU')
}
const tone = value => Number(value || 0) < 0 ? 'negative' : 'positive'

const readinessText = state => state === 'ready' ? 'готово' : state === 'partial' ? 'частично' : state === 'waiting' ? 'ожидается' : 'нет данных'
const readinessSuffix = state => state === 'partial' ? ' · предварительно' : ''

function CoveragePill({ label, state = 'missing' }) {
  const Icon = state === 'ready' ? CheckCircle2 : state === 'partial' || state === 'waiting' ? Clock3 : AlertTriangle
  return <span className={`sku360-coverage-pill ${state}`} title={`${label}: ${readinessText(state)}`}>
    <Icon size={13}/> {label}<small>{readinessText(state)}</small>
  </span>
}

function MiniTrend({ rows = [], metric = 'revenue' }) {
  const values = rows.map(row=>Math.max(0,Number(row?.[metric] || 0)))
  const max = Math.max(1,...values)
  if (!rows.length) return <div className="sku360-empty compact">История за период пока не загружена.</div>
  return <div className="sku360-mini-trend" aria-label="Динамика товара">
    {rows.slice(-31).map((row,index)=><span key={`${row.date}-${index}`} title={`${fmtDate(row.date)} · ${metric==='revenue'?fmtMoney(row[metric]):fmtNum(row[metric])}`} style={{'--h':`${Math.max(6,Math.round(Number(row?.[metric] || 0)/max*100))}%`}}/>) }
  </div>
}

function Section({ icon:Icon, eyebrow, title, children, side }) {
  return <section className="sku360-section">
    <div className="sku360-section-head"><div><span>{Icon && <Icon size={15}/>} {eyebrow}</span><h3>{title}</h3></div>{side}</div>
    {children}
  </section>
}

export default function Product360Drawer({ product, data, loading, error, period, onClose }) {
  const hasPayload = Boolean(data)
  const view = data || {}
  const item = view.product || product || {}
  const overview = view.overview || {}
  const economics = view.economics || {}
  const demand = view.demand || {daily:[],advertising:{rows:[],summary:{}},search:{rows:[],summary:{}}}
  const quality = view.quality || {reviews:[],questions:[],reviewSummary:{},questionSummary:{},lowRatedTexts:[]}
  const stock = view.stock || {current:[],history:{daily:[],latest:[]}}
  const pricing = view.pricing || {}
  const readiness = view.readiness || {}
  const streams = view.coverage?.streams || {}
  const readinessSummary = view.readinessSummary || {}
  const primarySignal = view.signals?.[0]
  const stockCurrent = Array.isArray(stock.current) ? stock.current : []
  const searchRows = Array.isArray(demand.search?.rows) ? demand.search.rows : []
  const adRows = Array.isArray(demand.advertising?.rows) ? demand.advertising.rows : []
  const reviewRows = Array.isArray(quality.reviews) ? quality.reviews : []
  const questionRows = Array.isArray(quality.questions) ? quality.questions : []
  const financeRows = Array.isArray(economics.financeMovements) ? economics.financeMovements : []
  const penaltiesAndDeductions = economics.penalties == null && economics.deductions == null ? null : Number(economics.penalties || 0) + Number(economics.deductions || 0)
  const unansweredTotal = quality.reviewSummary?.unanswered == null && quality.questionSummary?.unanswered == null ? null : Number(quality.reviewSummary?.unanswered || 0) + Number(quality.questionSummary?.unanswered || 0)

  return <div className="sku360-backdrop" onClick={onClose}>
    <aside className="sku360-drawer" onClick={event=>event.stopPropagation()}>
      <button className="sku360-close" onClick={onClose} aria-label="Закрыть SKU 360"><X size={20}/></button>

      <header className="sku360-hero">
        <div className="sku360-photo">{item.photo ? <img src={item.photo} alt={item.title || ''}/> : <PackageSearch size={38}/>}</div>
        <div className="sku360-hero-copy">
          <span className="sku360-kicker"><Sparkles size={14}/> SKU 360 · единый рентген товара</span>
          <h2>{item.title || 'Товар WB'}</h2>
          <p>{item.brand || 'Без бренда'}{item.category ? ` · ${item.category}` : ''}</p>
          <div className="sku360-identifiers">
            <span>nmID <b>{item.nmID || '—'}</b></span><span>Артикул <b>{item.vendorCode || '—'}</b></span><span>Схема <b>{item.fulfillmentMode || '—'}</b></span>
          </div>
          <div className="sku360-period">{period?.from && period?.to ? `${fmtDate(period.from)} — ${fmtDate(period.to)}` : 'Текущий период кабинета'}</div>
        </div>
        <div className="sku360-health">
          <span>Главный сигнал</span>
          <strong>{hasPayload ? (primarySignal?.title || 'Проверяю подтверждённые данные') : 'Собираю SKU 360'}</strong>
          <small>{hasPayload ? (primarySignal?.text || 'ELISEI использует только подтверждённые потоки.') : 'Сначала проверю доступность потоков. Нулевые значения до подтверждения не показываю.'}</small>
        </div>
      </header>

      {loading && !hasPayload && <div className="sku360-loading"><RefreshCw className="spin" size={19}/> Собираю продажи, финансы, рекламу, поиск, отзывы и остатки по одному товару…</div>}
      {error && <div className="sku360-alert danger"><AlertTriangle size={18}/><div><strong>Не удалось собрать SKU 360</strong><span>{error}</span></div></div>}

      {!hasPayload && !error && <div className="sku360-preload"><div><RefreshCw className="spin" size={22}/><span><b>Готовлю рентген товара</b><small>Пока ответ сервера не готов, ELISEI не подставляет нули из общей карточки.</small></span></div><div className="sku360-skeleton-grid">{Array.from({length:6}).map((_,index)=><i key={index}/>)}</div></div>}

      {hasPayload && <>
      <div className="sku360-readiness-banner"><span><ShieldCheck size={16}/><b>Покрытие SKU:</b> {readinessSummary.ready || 0} готово{readinessSummary.partial ? ` · ${readinessSummary.partial} частично` : ''}{readinessSummary.waiting ? ` · ${readinessSummary.waiting} ожидают` : ''}</span><small>Частичные нули скрываются до завершения потока.</small></div>
      <div className="sku360-coverage">
        <CoveragePill label="Продажи" state={readiness.sales}/>
        <CoveragePill label="Финансы" state={readiness.finance}/>
        <CoveragePill label="Реклама" state={readiness.advertising}/>
        <CoveragePill label="Поиск" state={readiness.search}/>
        <CoveragePill label="Отзывы" state={readiness.reviews}/>
        <CoveragePill label="Остатки" state={readiness.stocks}/>
      </div>

      <div className="sku360-kpis">
        <div><span>Выручка</span><strong>{fmtMoney(overview.revenue)}</strong><small>{overview.sales == null ? readinessText(readiness.sales) : `${fmtNum(overview.sales)} продаж${readinessSuffix(readiness.sales)}`}</small></div>
        <div><span>Опер. прибыль</span><strong className={overview.profit == null ? '' : tone(overview.profit)}>{fmtMoney(overview.profit)}</strong><small>{overview.margin == null ? readinessText(economics.state) : `маржа ${fmtPercent(overview.margin)}${readinessSuffix(economics.state)}`}</small></div>
        <div><span>Возвраты</span><strong>{fmtPercent(overview.returnRate,'Не загружено')}</strong><small>{overview.returns == null ? readinessText(readiness.sales) : `${fmtNum(overview.returns)} шт.${readinessSuffix(readiness.sales)}`}</small></div>
        <div><span>Остаток</span><strong>{overview.stock == null ? 'Не загружено' : `${fmtNum(overview.stock)} шт.`}</strong><small>{overview.stockCoverDays == null ? readinessText(readiness.stocks) : `≈ ${fmtNum(overview.stockCoverDays)} дней${readinessSuffix(readiness.stocks)}`}</small></div>
        <div><span>Реклама</span><strong>{fmtMoney(demand.advertising?.summary?.spend ?? overview.advertising)}</strong><small>{demand.advertising?.summary?.crr == null ? readinessText(readiness.advertising) : `ДРР ${fmtPercent(demand.advertising?.summary?.crr)}${readinessSuffix(readiness.advertising)}`}</small></div>
        <div><span>Средняя цена</span><strong>{fmtMoney(pricing.averagePrice ?? overview.averagePrice)}</strong><small>{pricing.breakevenPrice == null ? readinessText(pricing.state) : `цена в 0 ${fmtMoney(pricing.breakevenPrice)}${readinessSuffix(economics.state)}`}</small></div>
      </div>

      <div className="sku360-grid two">
        <Section icon={CircleDollarSign} eyebrow="Экономика" title="Куда уходят деньги">
          <div className="sku360-money-list">
            {[['Выручка',economics.revenue,'plus'],['К перечислению',economics.sellerPayable,'plus'],['Себестоимость',economics.cogs],['Комиссия WB',economics.commission],['Логистика',economics.logistics],['Хранение',economics.storage],['Приёмка',economics.acceptance],['Эквайринг',economics.acquiring],['Реклама',economics.advertising],['Штрафы + удержания',penaltiesAndDeductions],['Налог',economics.tax],['Общие расходы',economics.fixedExpenses]].map(([label,value,kind])=><div key={label}><span>{label}</span><strong className={kind==='plus'?'positive':''}>{fmtMoney(value)}</strong></div>)}
            <div className="total"><span>Операционная прибыль</span><strong className={economics.profit == null ? '' : tone(economics.profit)}>{fmtMoney(economics.profit)}</strong></div>
          </div>
          {economics.modeBreakdown && <div className="sku360-mode-grid">{['FBS','FBO'].map(mode=>{const row=economics.modeBreakdown?.[mode]; return row?.active?<div key={mode}><b>{mode}</b><span>{fmtNum(row.sales)} продаж · {fmtMoney(row.revenue)}</span><strong className={row.profit == null?'':tone(row.profit)}>{fmtMoney(row.profit)}</strong></div>:null})}</div>}
        </Section>

        <Section icon={TrendingUp} eyebrow="Динамика" title="Продажи по дням" side={<span className="sku360-side-note">до 31 дня</span>}>
          <MiniTrend rows={demand.daily || []} metric="revenue"/>
          <div className="sku360-daily-tail">{(demand.daily || []).slice(-7).map(row=><div key={row.date}><span>{fmtDate(row.date)}</span><b>{fmtMoney(row.revenue)}</b><small>{fmtNum(row.sales)} продаж · {fmtNum(row.returns)} возв.</small></div>)}</div>
        </Section>
      </div>

      <div className="sku360-grid two">
        <Section icon={Megaphone} eyebrow="Реклама" title="Эффективность кампаний">
          <div className="sku360-inline-metrics"><span>Расход <b>{fmtMoney(demand.advertising?.summary?.spend)}</b></span><span>Заказы <b>{fmtNum(demand.advertising?.summary?.orders)}</b></span><span>CTR <b>{fmtPercent(demand.advertising?.summary?.ctr)}</b></span><span>CPC <b>{fmtMoney(demand.advertising?.summary?.cpc)}</b></span><span>ДРР <b>{fmtPercent(demand.advertising?.summary?.crr)}</b></span></div>
          {adRows.length ? <div className="sku360-list">{adRows.slice(0,8).map((row,index)=><div key={`${row.advertId}-${index}`}><span><strong>{row.campaignName || `Кампания ${row.advertId || ''}`}</strong><small>{fmtNum(row.orders)} заказов · {fmtPercent(row.crr)}</small></span><b>{fmtMoney(row.spend)}</b></div>)}</div> : <div className="sku360-empty">По этому товару рекламная статистика пока не подтверждена.</div>}
        </Section>

        <Section icon={Search} eyebrow="Поисковая видимость" title="Что приводит покупателей" side={streams.searchQueries?.periodExact===false?<span className="sku360-warning-chip">снимок другого периода</span>:null}>
          {searchRows.length ? <div className="sku360-search-table"><div className="head"><span>Запрос</span><span>Позиция</span><span>Заказы</span><span>Выручка</span></div>{searchRows.slice(0,12).map(row=><div key={row.id}><span><strong>{row.phrase || 'Запрос'}</strong><small>{row.frequency!=null?`частотность ${fmtNum(row.frequency)}`:''}</small></span><b>{row.avgPosition==null?'—':fmtNum(row.avgPosition)}</b><b>{fmtNum(row.orders)}</b><b>{fmtMoney(row.revenue)}</b></div>)}</div> : <div className="sku360-empty">Фразы по этому SKU ещё не загружены или не совпадают с выбранным периодом.</div>}
        </Section>
      </div>

      <div className="sku360-grid two">
        <Section icon={Star} eyebrow="Качество" title="Отзывы, вопросы и возвраты">
          <div className="sku360-inline-metrics"><span>Отзывы <b>{fmtNum(quality.reviewSummary?.total)}</b></span><span>Рейтинг <b>{quality.reviewSummary?.averageRating==null?'—':`${Number(quality.reviewSummary.averageRating).toFixed(1)} ★`}</b></span><span>1–3 ★ <b>{fmtNum(quality.reviewSummary?.lowRated)}</b></span><span>Без ответа <b>{fmtNum(unansweredTotal)}</b></span></div>
          {quality.lowRatedTexts?.length ? <div className="sku360-complaints">{quality.lowRatedTexts.slice(0,5).map((line,index)=><p key={index}>“{line}”</p>)}</div> : <div className="sku360-empty compact">Негативных текстов по выбранной выборке нет или отзывы ещё не загружены.</div>}
          {(reviewRows.length || questionRows.length) ? <div className="sku360-feedback-tail">{[...reviewRows.map(row=>({...row,kind:'Отзыв'})),...questionRows.map(row=>({...row,kind:'Вопрос'}))].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,8).map((row,index)=><div key={`${row.kind}-${row.id}-${index}`}><span><b>{row.kind}{row.rating!=null?` · ${row.rating} ★`:''}</b><small>{fmtDate(row.createdAt)} · {row.answered?'ответ есть':'без ответа'}</small></span><p>{row.text || 'Текст не передан WB'}</p></div>)}</div>:null}
        </Section>

        <Section icon={Boxes} eyebrow="Запасы" title="Размеры, склады и история">
          <div className="sku360-inline-metrics"><span>FBS <b>{fmtNum(stock.fbsStock)}</b></span><span>FBO <b>{fmtNum(stock.fboStock)}</b></span><span>Всего <b>{overview.stock==null?'—':fmtNum(overview.stock)}</b></span></div>
          {stockCurrent.length ? <div className="sku360-stock-table"><div className="head"><span>Размер / ШК</span><span>Склад</span><span>Остаток</span></div>{stockCurrent.slice(0,18).map((row,index)=><div key={row.key || index}><span><strong>{row.techSize || '—'}</strong><small>{row.barcode || row.nmID || '—'}</small></span><span>{row.warehouseName || '—'}</span><b>{fmtNum(row.quantity)}</b></div>)}</div> : <div className="sku360-empty compact">Текущая детализация по размерам ещё не подтверждена.</div>}
          <div className="sku360-history"><span>История остатка</span><MiniTrend rows={stock.history?.daily || []} metric="quantity"/></div>
        </Section>
      </div>

      <div className="sku360-grid two">
        <Section icon={Tag} eyebrow="Цена" title="Безопасный коридор">
          <div className="sku360-price-grid"><div><span>Средняя по продажам</span><strong>{fmtMoney(pricing.averagePrice)}</strong></div><div><span>Цена в 0</span><strong>{fmtMoney(pricing.breakevenPrice)}</strong></div><div><span>Целевая</span><strong>{fmtMoney(pricing.targetPrice)}</strong></div><div><span>Пиковая</span><strong>{fmtMoney(pricing.peakPrice)}</strong></div></div>
          <p className="sku360-note">{pricing.note || 'Live-цена WB пока не подключена отдельным потоком и не подменяется средней ценой.'}</p>
        </Section>

        <Section icon={ShieldCheck} eyebrow="Финансовый след" title="Последние операции WB">
          {financeRows.length ? <div className="sku360-finance-list">{financeRows.slice(0,12).map((row,index)=><div key={`${row.operationDate}-${row.operationCode}-${index}`}><span><strong>{row.operationName || row.operationCode || 'Операция WB'}</strong><small>{fmtDate(row.operationDate)} · {row.fulfillmentMode || '—'}</small></span><b className={Number(row.amount||0)<0?'negative':'positive'}>{fmtMoney(row.amount)}</b></div>)}</div> : <div className="sku360-empty">Финансовые операции по товару ещё не найдены в загруженной части реестра.</div>}
        </Section>
      </div>

      <section className="sku360-decision">
        <div><Sparkles size={20}/><span><b>Что делать первым</b><strong>{primarySignal?.title || 'Дождаться подтверждения данных'}</strong><p>{primarySignal?.text || 'ELISEI не делает выводов по неподтверждённым значениям.'}</p></span></div>
        <small>{view.matchingPolicy || 'SKU сопоставляется только по подтверждённым идентификаторам.'}</small>
      </section>
      </>}
    </aside>
  </div>
}
