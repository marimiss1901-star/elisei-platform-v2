import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Download, Eye, HelpCircle, MessageCircle, PackageSearch, RefreshCw,
  Search, ShieldCheck, Star, Warehouse,
} from 'lucide-react'
import MetricCard from './MetricCard'
import { wbApi } from '../lib/api'

const number = value => Number.isFinite(Number(value)) ? Number(value) : null
const formatNumber = value => value == null ? 'Не загружено' : new Intl.NumberFormat('ru-RU').format(Math.round(Number(value || 0)))
const formatMoney = value => value == null ? '—' : `${new Intl.NumberFormat('ru-RU').format(Math.round(Number(value || 0)))} ₽`
const formatPercent = value => value == null ? '—' : `${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(Number(value || 0))}%`
const formatDateTime = value => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('ru-RU')
}
const formatDate = value => {
  if (!value) return '—'
  const date = new Date(`${String(value).slice(0,10)}T00:00:00`)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('ru-RU')
}
const csvCell = value => `"${String(value ?? '').replaceAll('"','""')}"`

function atPath(row, path) {
  return String(path).split('.').reduce((value,key)=>value?.[key],row)
}

function pick(row, keys, fallback = null) {
  for (const key of keys) {
    const value = atPath(row,key)
    if (value !== undefined && value !== null && String(value).trim() !== '') return value
  }
  return fallback
}

function productInfo(row = {}) {
  const details = row.productDetails || row.product || row.details || {}
  return {
    nmID:pick(row,['nmID','nmId','nm_id','productDetails.nmId','product.nmId'],pick(details,['nmId','nmID'])),
    vendorCode:pick(row,['vendorCode','supplierArticle','sa_name','productDetails.supplierArticle','product.vendorCode'],pick(details,['supplierArticle','vendorCode'])),
    title:pick(row,['title','name','productName','productDetails.productName','productDetails.name'],pick(details,['productName','name'],'Товар WB')),
  }
}

function rowText(row = {}) {
  return String(pick(row,['text','message.text','message','lastMessage.text','question','searchText','searchQuery','query','keyword'],'') || '')
}

function saveCsv(filename, headers, rows) {
  const lines = [headers.map(csvCell).join(';'), ...rows.map(row=>row.map(csvCell).join(';'))]
  const blob = new Blob([`\uFEFF${lines.join('\n')}`],{type:'text/csv;charset=utf-8'})
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

const emptyStream = { rows:[], total:0, next:null, payload:null, summary:null, coverage:null, state:null, status:'idle', updatedAt:null }

export default function WbExtendedWorkspace({
  mode, connection, syncing, onSync, notify, period, periodControls,
  query = '', onQueryChange = () => {},
}) {
  const [communicationTab,setCommunicationTab] = useState('reviews')
  const [streams,setStreams] = useState({})
  const [loading,setLoading] = useState({})
  const [statusFilter,setStatusFilter] = useState('all')
  const [ratingFilter,setRatingFilter] = useState('all')
  const [warehouseFilter,setWarehouseFilter] = useState('')
  const stream = mode === 'search' ? 'searchQueries' : mode === 'stock' ? 'stockHistory' : communicationTab
  const data = streams[stream] || emptyStream
  const stageState = (connection.syncStates || []).find(item=>item.stage === stream) || data.state

  const requestOptions = ({ append = false } = {}) => ({
    afterKey:append ? (streams[stream]?.next || '') : '',
    limit:150,
    from:period?.from,
    to:period?.to,
    query,
    status:statusFilter,
    rating:stream === 'reviews' ? ratingFilter : '',
    warehouse:stream === 'stockHistory' ? warehouseFilter : '',
  })

  const load = async ({ append = false } = {}) => {
    if (!connection.connectionId || loading[stream]) return
    setLoading(current=>({...current,[stream]:true}))
    try {
      const result = await wbApi.extended(stream,connection.connectionId,requestOptions({append}))
      setStreams(current=>({
        ...current,
        [stream]:{
          ...result,
          rows:append ? [...(current[stream]?.rows || []),...(result.rows || [])] : (result.rows || []),
        },
      }))
    } catch (error) {
      notify?.(error.message,8000)
    } finally {
      setLoading(current=>({...current,[stream]:false}))
    }
  }

  useEffect(()=>{
    setStatusFilter('all')
    setRatingFilter('all')
    setWarehouseFilter('')
  },[stream])

  useEffect(()=>{
    const timer=window.setTimeout(()=>load().catch(()=>{}),280)
    return ()=>window.clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[stream,connection.connectionId,stageState?.lastSuccessAt,stageState?.status,period?.from,period?.to,query,statusFilter,ratingFilter,warehouseFilter])

  const startSync = async () => {
    await onSync(connection.connectionId,[stream],{period})
    await load()
  }

  const rows = data.rows || []
  const selectedPeriodLabel = period?.from && period?.to ? `${formatDate(period.from)} — ${formatDate(period.to)}` : 'период не выбран'
  const coverage = data.coverage || {}
  const available = coverage.available || {}
  const coverageLimited = Boolean(period?.from && period?.to && available?.from && available?.to && (period.from < available.from || period.to > available.to))
  const periodMismatch = coverage.reason === 'search_report_requires_exact_period'

  const statusNotice = () => {
    if (!connection.connected) return <div className="notice warning"><AlertTriangle size={20}/><div><strong>Подключите Wildberries</strong><p>Раздел работает только с данными кабинета текущего пользователя.</p></div></div>
    if (stageState?.status === 'subscription_required') return <div className="notice warning"><AlertTriangle size={20}/><div><strong>Для поисковых запросов нужна подписка «Джем»</strong><p>{stageState.lastError || 'WB не выдал доступ к отчёту. ELISEI не подменяет отсутствие доступа нулевой статистикой.'}</p></div><button onClick={startSync}>Проверить снова</button></div>
    if (stageState?.status === 'missing_token') return <div className="notice warning"><AlertTriangle size={20}/><div><strong>Не хватает категории API-токена</strong><p>{stageState.lastError || 'Добавьте разрешение для этого потока в разделе подключений.'}</p></div></div>
    if (['pending','queued','running','rate_limited'].includes(stageState?.status)) return <div className="notice info"><RefreshCw className={stageState?.status==='running'?'spin':''} size={20}/><div><strong>Загрузка продолжается в очереди</strong><p>{stageState.lastError || `Уже сохранено ${formatNumber(stageState?.metadata?.persistedCount || stageState?.lastCount || 0)} строк.${stageState?.nextAllowedAt ? ` Следующая попытка: ${formatDateTime(stageState.nextAllowedAt)}.` : ''}`}</p></div></div>
    if (stageState?.status === 'error' || stageState?.status === 'forbidden') return <div className="notice warning"><AlertTriangle size={20}/><div><strong>WB не отдал данные</strong><p>{stageState.lastError || 'Повторите загрузку после проверки разрешений токена.'}</p></div><button onClick={startSync}>Повторить</button></div>
    if (periodMismatch) return <div className="notice warning"><AlertTriangle size={20}/><div><strong>Для выбранного периода нужен новый отчёт</strong><p>Сейчас сохранён отчёт за {formatDate(available.from)} — {formatDate(available.to)}. Поисковые показатели агрегированы WB за весь интервал, поэтому ELISEI не разрезает их приблизительно.</p></div><button onClick={startSync}>Загрузить {selectedPeriodLabel}</button></div>
    if (coverageLimited) return <div className="notice info"><AlertTriangle size={20}/><div><strong>Данные покрывают не весь выбранный период</strong><p>В базе есть строки с {formatDate(available.from)} по {formatDate(available.to)}. Дни вне покрытия не считаются подтверждённым нулём.</p></div><button onClick={startSync}>Обновить выбранный период</button></div>
    return null
  }

  const toolbar = label => <div className="extended-toolbar extended-toolbar-filters">
    <div className="extended-search"><Search size={16}/><input value={query} onChange={event=>onQueryChange(event.target.value)} placeholder={`Поиск: ${label}`}/></div>
    {stream === 'searchQueries' && <select value={statusFilter} onChange={event=>setStatusFilter(event.target.value)}><option value="all">Все строки</option><option value="group">Группы запросов</option><option value="query">Фразы по товарам</option></select>}
    {stream === 'stockHistory' && <><select value={statusFilter} onChange={event=>setStatusFilter(event.target.value)}><option value="all">Любой остаток</option><option value="positive">Есть остаток</option><option value="zero">Нулевой остаток</option></select><input className="extended-warehouse-filter" value={warehouseFilter} onChange={event=>setWarehouseFilter(event.target.value)} placeholder="Склад точно"/></>}
    {(stream === 'reviews' || stream === 'questions') && <select value={statusFilter} onChange={event=>setStatusFilter(event.target.value)}><option value="all">Все статусы</option><option value="unanswered">Без ответа</option><option value="answered">С ответом</option>{stream === 'reviews' && <option value="archived">Архив</option>}</select>}
    {stream === 'reviews' && <select value={ratingFilter} onChange={event=>setRatingFilter(event.target.value)}><option value="all">Любая оценка</option>{[5,4,3,2,1].map(value=><option key={value} value={value}>{value} ★</option>)}</select>}
    {stream === 'chats' && <select value={statusFilter} onChange={event=>setStatusFilter(event.target.value)}><option value="all">Диалоги и события</option><option value="chat">Только диалоги</option><option value="event">Только события</option></select>}
    <button className="secondary-btn" disabled={syncing || loading[stream]} onClick={startSync}><RefreshCw size={16} className={(syncing||loading[stream])?'spin':''}/> Обновить период</button>
  </div>

  const pager = () => <div className="extended-pager"><span>Показано {formatNumber(rows.length)} из {formatNumber(data.total || 0)} · {selectedPeriodLabel}</span>{data.next && <button className="secondary-btn" disabled={loading[stream]} onClick={()=>load({append:true})}>{loading[stream] ? <RefreshCw size={15} className="spin"/> : null} Показать ещё</button>}</div>

  if (mode === 'search') {
    const summary = data.summary || data.payload?.summary || {}
    const common = data.payload?.summary?.commonInfo || {}
    const exportRows = rows.map(row=>{
      const product = productInfo(row)
      return [pick(row,['searchText','searchQuery','query','keyword','text','name']),product.nmID,product.vendorCode,pick(row,['frequency','requestCount','searchCount','count']),pick(row,['avgPosition','averagePosition','position']),pick(row,['openCard','openCardCount','views']),pick(row,['addToCart','addToCartCount','cart']),pick(row,['orders','orderCount']),pick(row,['orderSum','revenue','sum'])]
    })
    return <section className="app-page glass-panel">
      <div className="page-title"><span>WB Аналитика</span><h1>Поисковые запросы</h1><p>Запросы покупателей, позиции карточек, переходы, корзины и заказы по единому периоду кабинета.</p></div>
      {periodControls}
      {statusNotice()}
      <div className="metrics-grid four">
        <MetricCard label="Строк отчёта" value={data.updatedAt?formatNumber(data.total):'Не загружено'} delta={data.updatedAt?selectedPeriodLabel:'ожидает синхронизацию'} icon={Search}/>
        <MetricCard label="Товаров в отчёте" value={formatNumber(pick(common,['totalProducts','productsCount'],data.payload?.productsScanned))} delta="просканировано по nmID" icon={PackageSearch}/>
        <MetricCard label="Средняя позиция" value={formatNumber(pick(data.payload?.summary?.positionInfo || {},['average','avg','position']))} delta="по доступному отчёту WB" icon={Eye}/>
        <MetricCard label="Видимость" value={formatPercent(pick(data.payload?.summary?.visibilityInfo || {},['visibility','percent','value']))} delta="если показатель отдан WB" icon={Star}/>
      </div>
      {toolbar('фраза, артикул, товар')}
      <div className="extended-actions"><button className="ghost-export" disabled={!rows.length} onClick={()=>saveCsv(`elisei-search-queries-${period?.from}-${period?.to}.csv`,['Запрос','nmID','Артикул продавца','Частотность','Позиция','Переходы','Корзины','Заказы','Выручка'],exportRows)}><Download size={16}/> CSV для Excel</button></div>
      <div className="data-table extended-table"><div className="data-row head search-query-row"><span>Запрос / товар</span><span>Артикулы</span><span>Частотность</span><span>Позиция</span><span>Переходы</span><span>Корзины</span><span>Заказы</span><span>Выручка</span></div>{rows.length ? rows.map((row,index)=>{ const product=productInfo(row); const phrase=pick(row,['searchText','searchQuery','query','keyword','text','name'],product.title); return <div className="data-row search-query-row" key={row.rowKey || `${phrase}-${index}`}><span><strong>{phrase || 'Группа запросов'}</strong><small>{row.rowType === 'query' ? 'Фраза по товару' : 'Сводный отчёт'}</small></span><span><strong>{product.nmID || '—'}</strong><small>{product.vendorCode || product.title || '—'}</small></span><span>{formatNumber(pick(row,['frequency','requestCount','searchCount','count']))}</span><span>{formatNumber(pick(row,['avgPosition','averagePosition','position']))}</span><span>{formatNumber(pick(row,['openCard','openCardCount','views']))}</span><span>{formatNumber(pick(row,['addToCart','addToCartCount','cart']))}</span><span>{formatNumber(pick(row,['orders','orderCount']))}</span><span>{formatMoney(pick(row,['orderSum','revenue','sum']))}</span></div>}) : <div className="product-empty">За выбранный период поисковый отчёт не загружен.</div>}</div>
      {pager()}
    </section>
  }

  if (mode === 'stock') {
    const summary = data.summary || data.payload?.summary || {}
    return <section className="app-page glass-panel">
      <div className="page-title"><span>Запасы · история</span><h1>История остатков</h1><p>Ежедневный CSV-архив WB по датам, товарам и складам. Максимум одного официального отчёта — 90 дней.</p></div>
      {periodControls}
      {statusNotice()}
      <div className="metrics-grid four">
        <MetricCard label="Последний остаток" value={formatNumber(summary.latestQuantity)} delta={summary.latestDate?`на ${formatDate(summary.latestDate)}`:'ожидает отчёт'} icon={Warehouse}/>
        <MetricCard label="Дней истории" value={formatNumber(summary.dates)} delta={selectedPeriodLabel} icon={RefreshCw}/>
        <MetricCard label="Товаров" value={formatNumber(summary.products)} delta="уникальных nmID" icon={PackageSearch}/>
        <MetricCard label="Складов" value={formatNumber(summary.warehouses)} delta="после фильтров" icon={Warehouse}/>
      </div>
      {Array.isArray(summary.daily) && summary.daily.length > 0 && <div className="history-strip">{summary.daily.slice(-14).map(item=><div key={item.date}><span>{item.date?.slice(5)}</span><strong>{formatNumber(item.quantity)}</strong><small>{formatNumber(item.rows)} строк</small></div>)}</div>}
      {toolbar('дата, nmID, артикул, склад')}
      <div className="extended-actions"><button className="ghost-export" disabled={!rows.length} onClick={()=>saveCsv(`elisei-stock-history-${period?.from}-${period?.to}.csv`,['Дата','nmID','Артикул продавца','Товар','Склад','Остаток','К клиенту','От клиента'],rows.map(row=>[row.date,row.nmID,row.vendorCode,row.title,row.warehouse,row.quantity,row.inWayToClient,row.inWayFromClient]))}><Download size={16}/> CSV для Excel</button></div>
      <div className="data-table extended-table"><div className="data-row head stock-history-row"><span>Дата</span><span>Товар</span><span>Артикулы</span><span>Склад</span><span>Остаток</span><span>В пути</span></div>{rows.length ? rows.map((row,index)=><div className="data-row stock-history-row" key={row.rowKey || `${row.date}-${row.nmID}-${row.warehouse}-${index}`}><span>{formatDate(row.date)}</span><span><strong>{row.title || 'Товар WB'}</strong><small>{row.sourceFile || 'CSV WB'}</small></span><span><strong>{row.nmID || '—'}</strong><small>{row.vendorCode || '—'}</small></span><span>{row.warehouse || '—'}</span><span><strong>{formatNumber(row.quantity)}</strong></span><span>{formatNumber(Number(row.inWayToClient||0)+Number(row.inWayFromClient||0))}</span></div>) : <div className="product-empty">За выбранный период строк истории остатков нет.</div>}</div>
      {pager()}
    </section>
  }

  const tabs = [{id:'reviews',label:'Отзывы',icon:Star},{id:'questions',label:'Вопросы',icon:HelpCircle},{id:'chats',label:'Чаты',icon:MessageCircle}]
  const summary = data.summary || data.payload?.summary || {}
  const reviewRows = rows.filter(row=>row.rowType === 'reviews' || communicationTab === 'reviews')
  const questionRows = rows.filter(row=>row.rowType === 'questions' || communicationTab === 'questions')
  const chatRows = rows.filter(row=>row.rowType === 'chat')
  const eventRows = rows.filter(row=>row.rowType === 'event')

  return <section className="app-page glass-panel">
    <div className="page-title"><span>Коммуникации WB</span><h1>Отзывы, вопросы и чаты</h1><p>Единый центр входящих обращений с периодом, поиском и фильтрами статусов. Чаты остаются в безопасном режиме чтения.</p></div>
    {periodControls}
    <div className="finance-tabs communication-tabs">{tabs.map(({id,label,icon:Icon})=><button key={id} className={communicationTab===id?'active':''} onClick={()=>setCommunicationTab(id)}><Icon size={15}/> {label}</button>)}</div>
    {statusNotice()}
    {communicationTab !== 'chats' ? <div className="metrics-grid four">
      <MetricCard label="Всего" value={data.updatedAt?formatNumber(data.total):'Не загружено'} delta={selectedPeriodLabel} icon={communicationTab==='reviews'?Star:HelpCircle}/>
      <MetricCard label="Без ответа" value={formatNumber(summary.unanswered)} delta="требуют внимания" icon={AlertTriangle}/>
      <MetricCard label="С ответом" value={formatNumber(summary.answered)} delta="обработано" icon={ShieldCheck}/>
      <MetricCard label={communicationTab==='reviews'?'Архив':'Полнота'} value={communicationTab==='reviews'?formatNumber(summary.archived):(data.payload?.truncated?'Есть пропуски':'Полная')} delta={communicationTab==='reviews'?'в выбранном периоде':'окна автоматически делятся'} icon={RefreshCw}/>
    </div> : <div className="metrics-grid four">
      <MetricCard label="Диалогов" value={formatNumber(summary.chatCount ?? chatRows.length)} delta={selectedPeriodLabel} icon={MessageCircle}/>
      <MetricCard label="Событий" value={formatNumber(summary.eventCount ?? eventRows.length)} delta="после фильтров" icon={RefreshCw}/>
      <MetricCard label="Режим" value="Только чтение" delta="без отправки сообщений" icon={ShieldCheck}/>
      <MetricCard label="Обновлено" value={data.updatedAt?formatDateTime(data.updatedAt):'Не загружено'} delta="из API WB" icon={RefreshCw}/>
    </div>}
    {toolbar(communicationTab==='chats'?'чат, сообщение, покупатель':'текст, товар, артикул')}

    {communicationTab === 'reviews' && <div className="communication-list">{reviewRows.length ? reviewRows.map((row,index)=>{ const product=productInfo(row); const rating=number(pick(row,['productValuation','valuation','rating'])); return <article className="communication-card" key={row.rowKey || row.id || index}><div className="communication-card-head"><div><strong>{row.userName || 'Покупатель'}</strong><span>{formatDateTime(row.createdDate || row.createdAt)}</span></div><b className="rating-pill">{rating ? `${rating} ★` : 'Без оценки'}</b></div><h3>{product.title}</h3><p>{row.text || 'Покупатель оставил оценку без текста.'}</p>{row.pros && <small><b>Плюсы:</b> {row.pros}</small>}{row.cons && <small><b>Минусы:</b> {row.cons}</small>}<footer><span>nmID {product.nmID || '—'} · {product.vendorCode || '—'}</span><b className={`status-badge ${row.isAnswered?'success':'warning'}`}>{row.archived?'Архив':row.isAnswered?'Есть ответ':'Нужен ответ'}</b></footer></article>}) : <div className="product-empty">За выбранный период отзывов нет.</div>}</div>}

    {communicationTab === 'questions' && <div className="communication-list">{questionRows.length ? questionRows.map((row,index)=>{ const product=productInfo(row); return <article className="communication-card" key={row.rowKey || row.id || index}><div className="communication-card-head"><div><strong>Вопрос покупателя</strong><span>{formatDateTime(row.createdDate || row.createdAt)}</span></div><b className={`status-badge ${row.isAnswered?'success':'warning'}`}>{row.isAnswered?'Отвечен':'Без ответа'}</b></div><h3>{product.title}</h3><p>{row.text || row.question || 'Текст вопроса не получен.'}</p>{row.answer?.text && <small><b>Ответ:</b> {row.answer.text}</small>}<footer><span>nmID {product.nmID || '—'} · {product.vendorCode || '—'}</span><span>{row.wasViewed === false ? 'Не просмотрен' : 'Просмотрен'}</span></footer></article>}) : <div className="product-empty">За выбранный период вопросов нет.</div>}</div>}

    {communicationTab === 'chats' && <><div className="notice info"><ShieldCheck size={20}/><div><strong>Безопасный режим чтения</strong><p>ELISEI загружает список диалогов и события, но не отправляет сообщения и не сохраняет служебную подпись ответа WB.</p></div></div><div className="data-table extended-table"><div className="data-row head chat-event-row"><span>Тип</span><span>Чат / покупатель</span><span>Сообщение</span><span>Дата</span><span>Статус</span></div>{rows.length ? rows.map((row,index)=>{ const message=rowText(row); const chatId=pick(row,['chatID','chatId','chat.id','clientID','clientId']); const sender=pick(row,['sender','senderName','userName','clientName','message.sender'],'Покупатель'); return <div className="data-row chat-event-row" key={row.rowKey || row.eventID || `${chatId}-${index}`}><span><b className={`status-badge ${row.rowType==='chat'?'info':'success'}`}>{row.rowType==='chat'?'Диалог':'Событие'}</b></span><span><strong>{sender}</strong><small>{chatId || 'ID не указан'}</small></span><span>{message || pick(row,['eventType','type'],'Системное событие')}</span><span>{formatDateTime(pick(row,['addTimestamp','createdAt','createdDate','timestamp','date']))}</span><span>{pick(row,['status','eventType','type'],row.rowType==='chat'?'Открыт':'Получено')}</span></div>}) : <div className="product-empty">За выбранный период событий чатов нет.</div>}</div></>}
    {pager()}
  </section>
}
