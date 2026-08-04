const DAY_MS = 86400000

const STAGE_CONFIG = Object.freeze({
  products:{ label:'Товары',weight:7,freshSeconds:36*3600,current:true,critical:true },
  orders:{ label:'Заказы',weight:11,freshSeconds:30*60,critical:true },
  sales:{ label:'Продажи',weight:11,freshSeconds:45*60,critical:true },
  stocks:{ label:'Остатки FBO',weight:8,freshSeconds:30*60,current:true,critical:true },
  sellerStocks:{ label:'Остатки FBS',weight:6,freshSeconds:30*60,current:true },
  advertising:{ label:'Реклама',weight:5,freshSeconds:3*3600 },
  finance:{ label:'Финансы WB',weight:18,freshSeconds:14*3600,critical:true },
  paidStorage:{ label:'Платное хранение',weight:3,freshSeconds:36*3600 },
  acceptance:{ label:'Платная приёмка',weight:3,freshSeconds:36*3600 },
  acquiring:{ label:'Эквайринг',weight:3,freshSeconds:14*3600,dependsOn:'finance' },
  financeReports:{ label:'Сводки реализации',weight:1,freshSeconds:36*3600,optional:true },
  acquiringReports:{ label:'Сводки эквайринга',weight:1,freshSeconds:36*3600,optional:true },
  fbsArchive:{ label:'Архив FBS',weight:2,freshSeconds:14*DAY_MS/1000,archive:true },
  measurementPenalties:{ label:'Штрафы за габариты',weight:1,freshSeconds:36*3600,optional:true },
  deductionsReport:{ label:'Подмены и вложения',weight:1,freshSeconds:36*3600,optional:true },
  warehouseMeasurements:{ label:'Замеры склада',weight:1,freshSeconds:36*3600,optional:true },
  antifraudRetention:{ label:'Самовыкупы',weight:1,freshSeconds:36*3600,optional:true },
  labelingRetention:{ label:'Маркировка',weight:1,freshSeconds:36*3600,optional:true },
  goodsReturns:{ label:'Возвраты и перемещения',weight:2,freshSeconds:36*3600 },
  tariffs:{ label:'Тарифы WB',weight:2,freshSeconds:7*DAY_MS/1000,current:true },
  funnel:{ label:'Воронка карточек',weight:2,freshSeconds:3*3600 },
  documents:{ label:'Документы WB',weight:6,freshSeconds:30*3600,critical:true },
  jamSubscription:{ label:'Подписка «Джем»',weight:0,optional:true },
  searchQueries:{ label:'Поисковые запросы',weight:2,freshSeconds:3*3600,optional:true },
  stockHistory:{ label:'История остатков',weight:4,freshSeconds:30*3600 },
  reviews:{ label:'Отзывы',weight:2,freshSeconds:3*3600 },
  questions:{ label:'Вопросы',weight:1,freshSeconds:3*3600 },
  chats:{ label:'Чаты',weight:1,freshSeconds:4*3600 },
})

const DATE_KEYS = Object.freeze({
  orders:['date','createdAt','created_at','lastChangeDate','last_change_date','orderDt','order_dt'],
  sales:['date','saleDt','sale_dt','lastChangeDate','last_change_date','rrDate','rr_dt'],
  advertising:['date','begin','end'],
  finance:['rrDate','rr_dt','saleDt','sale_dt','orderDt','order_dt','date','operationDate'],
  paidStorage:['date','originalDate'],
  acceptance:['date','shkCreateDate','giCreateDate'],
  acquiring:['operationDate','date','rrDate','rr_dt'],
  financeReports:['dateFrom','dateTo','createDate','createdAt'],
  acquiringReports:['dateFrom','dateTo','createDate','createdAt'],
  fbsArchive:['createdAt','created_at','updatedAt','updated_at'],
  measurementPenalties:['date','createdAt','operationDate'],
  deductionsReport:['date','createdAt','operationDate'],
  warehouseMeasurements:['date','createdAt','operationDate'],
  antifraudRetention:['date','createdAt','operationDate'],
  labelingRetention:['date','createdAt','operationDate'],
  goodsReturns:['date','createdAt','updatedAt'],
  funnel:['date','periodStart','periodEnd'],
  documents:['date','createDate','createdAt','periodStart','periodEnd'],
  searchQueries:['date','periodStart','periodEnd'],
  stockHistory:['date','snapshotDate','reportDate'],
  reviews:['createdDate','createdAt','updatedDate','updatedAt'],
  questions:['createdDate','createdAt','updatedDate','updatedAt'],
  chats:['addTimestamp','eventTime','createdAt','updatedAt'],
})

const BLOCKED_STATUSES = new Set(['service_token_required','service_secret_required','service_token_invalid','service_permission_required','token_invalid','missing_token'])
const WAITING_STATUSES = new Set(['pending','queued','rate_limited','retry_scheduled','running'])

function dateKey(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number' || /^\d{10,13}$/.test(String(value))) {
    const numeric = Number(value)
    const parsed = new Date(numeric < 1e12 ? numeric * 1000 : numeric)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0,10)
  }
  const match = String(value).match(/^\d{4}-\d{2}-\d{2}/)
  if (match) return match[0]
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0,10)
}

function daysInclusive(from,to) {
  if (!from || !to) return 0
  const start = new Date(`${from}T00:00:00Z`).getTime()
  const end = new Date(`${to}T00:00:00Z`).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return 0
  return Math.round((end-start)/DAY_MS)+1
}

function clamp(value,min,max){ return Math.max(min,Math.min(max,value)) }

function periodFromObject(value = {}) {
  if (!value || typeof value !== 'object') return null
  const from = dateKey(value.from || value.dateFrom || value.date_from || value.start || value.startDate || value.periodStart || value.beginDate)
  const to = dateKey(value.to || value.dateTo || value.date_to || value.end || value.endDate || value.periodEnd || value.finishDate)
  return from && to && from <= to ? {from,to} : null
}

function payloadRows(payload) {
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload?.rows)) return payload.rows
  if (Array.isArray(payload?.daily)) return payload.daily
  if (Array.isArray(payload?.campaigns)) return payload.campaigns
  return []
}

function deriveRowsPeriod(stream,payload) {
  const keys = DATE_KEYS[stream] || ['date','createdAt','updatedAt']
  let from = null
  let to = null
  const rows = payloadRows(payload)
  for (const row of rows) {
    for (const key of keys) {
      const value = dateKey(row?.[key])
      if (!value) continue
      if (!from || value < from) from = value
      if (!to || value > to) to = value
    }
  }
  return from && to ? {from,to} : null
}

export function extractStreamCoverage(stream,row = {}) {
  const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {}
  const metadata = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {}
  const candidates = [
    periodFromObject(payload.period),
    periodFromObject(metadata.period),
    periodFromObject(payload.coverage),
    periodFromObject(metadata.coverage),
    periodFromObject(payload.requestedPeriod),
    periodFromObject(metadata.requestedPeriod),
  ].filter(Boolean)
  const direct = candidates[0] || deriveRowsPeriod(stream,payload)
  return direct ? {...direct,source:candidates.length?'metadata':'rows'} : null
}

function coverageRatio(available,requested) {
  if (!available || !requested) return null
  const from = available.from > requested.from ? available.from : requested.from
  const to = available.to < requested.to ? available.to : requested.to
  const overlap = daysInclusive(from,to)
  const total = daysInclusive(requested.from,requested.to)
  return total > 0 ? clamp(overlap/total,0,1) : null
}

function ageSeconds(value,now) {
  const time = value ? new Date(value).getTime() : Number.NaN
  return Number.isFinite(time) ? Math.max(0,(now-time)/1000) : null
}

function humanStatus(status) {
  return ({ready:'Подтверждено',partial:'Частичное покрытие',waiting:'Ожидает WB',running:'Загружается',blocked:'Нет доступа',stale:'Устарело',missing:'Не загружено'})[status] || status
}

function streamAction(status,stage,state,config) {
  if (status === 'blocked') return state?.lastError || 'Проверьте категорию доступа токена.'
  if (status === 'waiting' || status === 'running') return state?.nextAllowedAt ? `Автоповтор после ${new Date(state.nextAllowedAt).toLocaleString('ru-RU')}` : 'ELISEI продолжит автоматически.'
  if (status === 'partial') return 'Дождаться продолжения загрузки; сохранённые строки не удаляются.'
  if (status === 'stale') return 'Обновить поток или проверить живой режим.'
  if (status === 'missing') return config?.optional ? 'Источник дополнительный; загрузить при наличии доступа.' : 'Запустить поток при разрешённом окне WB.'
  return 'Данные можно использовать.'
}

function evaluateStream({stage,state,row,requested,now}) {
  const config = STAGE_CONFIG[stage] || {label:stage,weight:1,freshSeconds:24*3600}
  const rowCount = Math.max(Number(row?.row_count || 0),Number(state?.lastCount || state?.last_count || 0),Number(row?.payload?.totalRows || 0),Array.isArray(row?.payload)?row.payload.length:0)
  const updatedAt = row?.updated_at || row?.updatedAt || state?.lastSuccessAt || state?.last_success_at || null
  const coverage = config.current || config.archive ? null : extractStreamCoverage(stage,row)
  const ratio = config.current || config.archive ? null : coverageRatio(coverage,requested)
  const complete = row?.payload?.complete !== false && row?.metadata?.complete !== false && row?.payload?.coverage?.partial !== true && row?.metadata?.coverage?.partial !== true
  const rawStatus = String(state?.status || (row ? 'success' : 'idle'))
  const age = ageSeconds(updatedAt,now)
  const stale = age != null && config.freshSeconds && age > config.freshSeconds
  let status = 'missing'
  if (BLOCKED_STATUSES.has(rawStatus)) status='blocked'
  else if (rawStatus === 'running') status='running'
  else if (WAITING_STATUSES.has(rawStatus)) status=rowCount>0?'partial':'waiting'
  else if (rowCount>0 || rawStatus === 'success') {
    if (!complete || (ratio != null && ratio < .999)) status='partial'
    else if (stale) status='stale'
    else status='ready'
  }
  const quality = ({ready:1,stale:.78,partial:.68,running:.55,waiting:.35,blocked:0,missing:config.optional?.45:0})[status] ?? 0
  return {
    stage,label:config.label,status,statusLabel:humanStatus(status),rawStatus,rowCount,source:row?.source || null,
    updatedAt,lastSuccessAt:state?.lastSuccessAt || state?.last_success_at || null,nextAllowedAt:state?.nextAllowedAt || state?.next_allowed_at || null,
    taskId:state?.taskId || state?.task_id || null,metadata:state?.metadata || {},coverage,coverageRatio:ratio,complete,
    freshness:{ageSeconds:age,expectedSeconds:config.freshSeconds || null,stale},critical:Boolean(config.critical),optional:Boolean(config.optional),weight:Number(config.weight||0),quality,
    action:streamAction(status,stage,state,config),dependency:config.dependsOn || null,
  }
}

function severityRank(value){ return ({critical:0,warning:1,info:2})[value] ?? 3 }

function issue(id,severity,title,text,action,stage=null){ return {id,severity,title,text,action,stage} }

function financeCheck(financeSummary = {},financeStream,requested) {
  const movements=Number(financeSummary.movements||0)
  const difference=Number(financeSummary.reconciliationDifference||0)
  const sellerPayable=Number(financeSummary.sellerPayable||0)
  const threshold=Math.max(100,Math.abs(sellerPayable)*0.01)
  const withinTolerance=Math.abs(difference)<=threshold
  const from=dateKey(financeSummary.dateFrom)
  const to=dateKey(financeSummary.dateTo)
  const ratio=coverageRatio(from&&to?{from,to}:financeStream?.coverage,requested)
  const complete=financeStream?.complete !== false && financeStream?.status === 'ready'
  return {
    movements,sellerPayable:Number(financeSummary.sellerPayable||0),grossRevenue:Number(financeSummary.grossRevenue||0),expenses:Number(financeSummary.expenses||0),
    compensations:Number(financeSummary.compensations||0),componentNet:Number(financeSummary.componentNet||0),difference,threshold,withinTolerance,
    period:from&&to?{from,to}:financeStream?.coverage||null,coverageRatio:ratio,complete,
    status:movements===0?'missing':complete && ratio!=null && ratio>=.999 && withinTolerance?'confirmed':'preliminary',
  }
}

export function buildDataQualityReport({states=[],streamRows=[],requestedPeriod=null,financeSummary={},productDiagnostics={},now=Date.now()}={}) {
  const requested = requestedPeriod?.from && requestedPeriod?.to ? {from:dateKey(requestedPeriod.from),to:dateKey(requestedPeriod.to)} : null
  const stateMap=new Map((states||[]).map(item=>[String(item.stage||''),item]))
  const rowMap=new Map((streamRows||[]).map(item=>[String(item.stream||''),item]))
  const stages=Object.keys(STAGE_CONFIG).map(stage=>evaluateStream({stage,state:stateMap.get(stage),row:rowMap.get(stage),requested,now}))
  const byStage=Object.fromEntries(stages.map(item=>[item.stage,item]))
  const finance=financeCheck(financeSummary,byStage.finance,requested)
  const issues=[]

  for (const item of stages) {
    if (item.status==='blocked' && !item.optional) issues.push(issue(`blocked:${item.stage}`,'critical',`${item.label}: нет доступа`,item.action,'Проверить токен и права WB.',item.stage))
    else if (item.status==='missing' && item.critical) issues.push(issue(`missing:${item.stage}`,'critical',`${item.label}: данных нет`,'Источник нужен для подтверждённых итогов.',item.action,item.stage))
    else if (item.status==='partial' && item.critical) issues.push(issue(`partial:${item.stage}`,'warning',`${item.label}: загружено частично`,item.coverage?`Покрытие ${item.coverage.from} — ${item.coverage.to}.`:`Сохранено строк: ${item.rowCount}.`,item.action,item.stage))
    else if (item.status==='stale' && item.critical) issues.push(issue(`stale:${item.stage}`,'warning',`${item.label}: данные устарели`,'Последнее успешное обновление старше ожидаемого интервала.',item.action,item.stage))
    else if (item.status==='waiting' && item.critical) issues.push(issue(`waiting:${item.stage}`,'warning',`${item.label}: ожидает WB`,item.nextAllowedAt?`Следующее окно: ${item.nextAllowedAt}.`:'Поток поставлен в очередь.',item.action,item.stage))
  }

  if (finance.movements>0 && !finance.withinTolerance) issues.push(issue('finance:reconciliation','warning','Финансовая сверка имеет расхождение',`Разница между компонентами и суммой к перечислению: ${Math.round(finance.difference)} ₽.`,'Проверить неподтверждённые удержания и дождаться полного отчёта.','finance'))
  if (finance.movements===0) issues.push(issue('finance:empty','critical','Финансовый реестр пока пуст','Прибыль и расходы нельзя считать подтверждёнными.','Дождаться разрешённого окна «Финансы WB».','finance'))

  const products=Number(productDiagnostics.products||0)
  const withBarcodes=Number(productDiagnostics.withBarcodes||0)
  const withMappedStock=Number(productDiagnostics.withMappedStock||0)
  const barcodeRatio=products>0?withBarcodes/products:null
  const stockMappingRatio=products>0?withMappedStock/products:null
  if (products>0 && barcodeRatio<.9) issues.push(issue('products:barcodes','warning','Не все карточки имеют штрихкоды',`Со штрихкодами ${withBarcodes} из ${products} карточек.`,'Обновить каталог и проверить сопоставление размеров.','products'))
  if (products>0 && byStage.stocks?.rowCount>0 && stockMappingRatio<.75) issues.push(issue('stocks:mapping','warning','Часть остатков не связана с товарами',`Остатки сопоставлены минимум с ${withMappedStock} из ${products} карточек.`,'Проверить barcode → nmID → vendorCode.','stocks'))

  if (byStage.acquiring?.status!=='ready' && byStage.finance?.rowCount>0) issues.push(issue('acquiring:derived','info','Эквайринг ещё не подтверждён отдельно','Основной финансовый отчёт уже может содержать суммы эквайринга.','Дождаться завершения производного расчёта.','acquiring'))
  const weighted=stages.filter(item=>item.weight>0 && !item.optional)
  const totalWeight=weighted.reduce((sum,item)=>sum+item.weight,0)
  const score=totalWeight?Math.round(weighted.reduce((sum,item)=>sum+item.weight*item.quality,0)/totalWeight*100):0
  const criticalCount=issues.filter(item=>item.severity==='critical').length
  const warningCount=issues.filter(item=>item.severity==='warning').length
  const readyCount=stages.filter(item=>item.status==='ready').length
  const partialCount=stages.filter(item=>['partial','waiting','running'].includes(item.status)).length

  const datedCritical=['orders','sales','finance'].map(stage=>byStage[stage]?.coverage).filter(Boolean)
  let confirmedPeriod=null
  if (datedCritical.length) {
    const from=datedCritical.map(item=>item.from).sort().at(-1)
    const to=datedCritical.map(item=>item.to).sort()[0]
    if (from&&to&&from<=to) confirmedPeriod={from,to}
  }

  const profitConfidence=finance.status==='confirmed'
    ? {status:'confirmed',label:'Прибыль подтверждена',text:'Финансовый реестр покрывает выбранный период и прошёл сверку.'}
    : finance.movements>0
      ? {status:'preliminary',label:'Прибыль предварительная',text:'Часть финансовых данных или подтверждающих источников ещё догружается.'}
      : {status:'unavailable',label:'Прибыль ожидает данные',text:'До загрузки финансового реестра итог не подменяется нулём.'}

  const overall=criticalCount>0?'critical':warningCount>0||score<90?'warning':'healthy'
  return {
    generatedAt:new Date(now).toISOString(),requestedPeriod:requested,score,overall,
    summary:{ready:readyCount,partial:partialCount,critical:criticalCount,warnings:warningCount,total:stages.length},
    confirmedPeriod,profitConfidence,finance,
    productDiagnostics:{products,withBarcodes,withMappedStock,barcodeRatio,stockMappingRatio},
    streams:stages,
    issues:issues.sort((a,b)=>severityRank(a.severity)-severityRank(b.severity)||a.title.localeCompare(b.title,'ru')),
  }
}

export const DATA_QUALITY_STAGES = Object.freeze(Object.keys(STAGE_CONFIG))
