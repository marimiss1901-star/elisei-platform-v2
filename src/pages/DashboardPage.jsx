import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, BarChart3, Bell, Boxes, Calculator, CalendarDays, CheckCircle2, ChevronDown,
  ChevronRight, ChevronUp, CircleDollarSign, CreditCard, Download, Eye, EyeOff, FileText, Home, LogOut,
  Info, Megaphone, MessageCircle, PackageSearch, Percent, PlugZap, RefreshCw, Save, Search, Send,
  Settings, ShieldCheck, SlidersHorizontal, Sparkles, Star, Tag, TrendingUp, UsersRound,
  Upload, WalletCards, Warehouse, X
} from 'lucide-react'
import ElMascot from '../components/ElMascot'
import MetricCard from '../components/MetricCard'
import TrendChart from '../components/TrendChart'
import WbExtendedWorkspace from '../components/WbExtendedWorkspace'
import { businessApi, elApi, wbApi } from '../lib/api'

const formatMoney = value => value == null ? 'Не загружено' : `${new Intl.NumberFormat('ru-RU').format(Math.round(Number(value || 0)))} ₽`
const formatNumber = value => value == null ? 'Не загружено' : new Intl.NumberFormat('ru-RU').format(Math.round(Number(value || 0)))
const formatPercent = value => value == null ? '—' : `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits:1 }).format(Number(value || 0))}%`
const csvCell = value => `"${String(value ?? '').replaceAll('"','""')}"`


const EL_CHAT_MESSAGES_KEY = 'elisei.el.embedded.messages.v2'
const EL_CHAT_CONVERSATION_KEY = 'elisei.el.embedded.conversation.v2'
const EL_CHAT_SETTINGS_KEY = 'elisei.el.embedded.settings.v2'
const EL_CHAT_MODE_KEY = 'elisei.el.mode.v1'
const EL_PERIOD_KEYS = ['elisei.globalPeriod.v3','elisei.globalPeriod','elisei.period.v4']

const defaultElPlan = {
  tier:'analyst', status:'active',
  features:{ analyst:true, gpt:false, pro:false, webSearch:false, longMemory:false, externalResearch:false },
}

const defaultElPersonality = {
  character:'insider', humor:'light', support:true, celebrations:true,
  address:'auto', preferredName:'', noHumorInCritical:true,
}

const elCharacterMeta = {
  professional:{ title:'Деловой', text:'Спокойно, профессионально и без разговорных вольностей.' },
  friendly:{ title:'Дружелюбный', text:'Тепло, понятно и иногда с лёгким юмором.' },
  insider:{ title:'Свой человек', text:'Живой язык, поддержка и уместные выражения вроде «лям двести».' },
}

const elHumorMeta = {
  off:'Без юмора', light:'Лёгкий', noticeable:'Заметный',
}

const elMoodMeta = {
  happy:'На связи', thinking:'Смотрю на данные', concerned:'Спокойно, проверяем',
  supportive:'Я рядом', proud:'Есть чем гордиться',
}

function normalizeElSettings(value = {}) {
  const legacyHumor = value.humor === true ? 'light' : value.humor === false ? 'off' : value.humor
  return {
    ...defaultElPersonality,
    ...value,
    character:['professional','friendly','insider'].includes(value.character) ? value.character : defaultElPersonality.character,
    humor:['off','light','noticeable'].includes(legacyHumor) ? legacyHumor : defaultElPersonality.humor,
    address:['auto','formal','informal'].includes(value.address) ? value.address : defaultElPersonality.address,
    support:value.support !== false,
    celebrations:value.celebrations !== false,
    preferredName:String(value.preferredName || value.userName || '').replace(/[^\p{L}\p{M} .'-]+/gu,'').replace(/\s+/g,' ').trim().slice(0,60),
    noHumorInCritical:true,
    allowWeb:Boolean(value.allowWeb),
  }
}

function initialElGreeting(greeting, displayName, settings) {
  const name = displayName ? `, ${displayName}` : ''
  if (settings.character === 'professional') return `${greeting}${name}. Готов проанализировать WB-кабинет и предложить следующий шаг.`
  if (settings.character === 'friendly') return `${greeting}${name}. Я рядом — давай спокойно разберём, что сейчас важнее всего.`
  return `${greeting}${name}. Я на месте. Данные кабинета проверю по фактам, а скучать постараюсь не дать.`
}

const elModeMeta = {
  analyst:{ title:'Эл Аналитик', subtitle:'WB-кабинет', description:'Продажи, реклама, остатки, финансы и другие данные кабинета. Без расходов OpenAI.' },
  gpt:{ title:'Эл GPT', subtitle:'Доп. функция', description:'Свободное общение, тексты, идеи и универсальные задачи.' },
  pro:{ title:'Эл Pro', subtitle:'Premium', description:'Интернет, внешние исследования и расширенная память.' },
}

function readStoredJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch { return fallback }
}

function createElConversationId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `el_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,10)}`
}

function readElPeriod() {
  if (window.__ELISEI_PERIOD__) return window.__ELISEI_PERIOD__
  for (const key of EL_PERIOD_KEYS) {
    const value = readStoredJson(key, null)
    if (value) return value
  }
  return null
}

function financeDateRange() {
  const period = readElPeriod() || {}
  const from = period.from || period.dateFrom || period.date_from || period.start || period.startDate
  const to = period.to || period.dateTo || period.date_to || period.end || period.endDate
  if (from && to) return { from:String(from).slice(0,10), to:String(to).slice(0,10) }
  const end = new Date()
  const start = new Date(end.getTime() - 29 * 86400000)
  return { from:start.toISOString().slice(0,10), to:end.toISOString().slice(0,10) }
}

const formatDate = value => {
  if (!value) return '—'
  const date = new Date(`${String(value).slice(0,10)}T00:00:00`)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('ru-RU')
}

const ANALYTICS_PERIOD_KEY = 'elisei.analytics.period.v1'
const ANALYTICS_COMPARE_KEY = 'elisei.analytics.compare.v1'

const isoLocalDate = date => {
  const value = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(value.getTime())) return ''
  const year = value.getFullYear()
  const month = String(value.getMonth()+1).padStart(2,'0')
  const day = String(value.getDate()).padStart(2,'0')
  return `${year}-${month}-${day}`
}

const addDays = (value, amount) => {
  const date = new Date(`${String(value).slice(0,10)}T12:00:00`)
  date.setDate(date.getDate()+amount)
  return isoLocalDate(date)
}

const earlierIsoDate = (left, right) => !left ? right : !right ? left : String(left) < String(right) ? left : right

const periodDaysBetween = period => {
  const from = new Date(`${period?.from}T00:00:00`)
  const to = new Date(`${period?.to}T00:00:00`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return 0
  return Math.round((to-from)/86400000)+1
}

const periodPresetValue = preset => {
  const today = new Date()
  const to = isoLocalDate(today)
  if (preset === '7') return { preset, from:addDays(to,-6), to }
  if (preset === '90') return { preset, from:addDays(to,-89), to }
  if (preset === 'month') return { preset, from:isoLocalDate(new Date(today.getFullYear(),today.getMonth(),1)), to }
  if (preset === 'prevMonth') {
    const start = new Date(today.getFullYear(),today.getMonth()-1,1)
    const end = new Date(today.getFullYear(),today.getMonth(),0)
    return { preset, from:isoLocalDate(start), to:isoLocalDate(end) }
  }
  if (preset === 'year') return { preset, from:isoLocalDate(new Date(today.getFullYear(),0,1)), to }
  return { preset:'30', from:addDays(to,-29), to }
}

const normalizeAnalyticsPeriod = value => {
  const fallback = periodPresetValue('30')
  const from = String(value?.from || '').slice(0,10)
  const to = String(value?.to || '').slice(0,10)
  const days = periodDaysBetween({from,to})
  return days > 0 && days <= 366 ? { preset:value?.preset || 'custom', from, to } : fallback
}

const previousPeriodFor = period => {
  const days = periodDaysBetween(period)
  const to = addDays(period.from,-1)
  return { from:addDays(to,-days+1), to, days }
}

const percentChange = (current, previous) => {
  const currentValue = Number(current)
  const previousValue = Number(previous)
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) return null
  if (previousValue === 0) return currentValue === 0 ? 0 : null
  return (currentValue-previousValue)/Math.abs(previousValue)*100
}

const comparisonLabel = (current, previous, enabled) => {
  if (!enabled) return null
  const change = percentChange(current,previous)
  if (change == null) return 'нет базы для сравнения'
  const prefix = change > 0 ? '+' : ''
  return `${prefix}${new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(change)}% к прошлому периоду`
}

const comparisonTone = (current, previous, enabled) => {
  if (!enabled) return ''
  const change = percentChange(current,previous)
  return change == null || change === 0 ? '' : change > 0 ? 'positive' : 'negative'
}

const aggregateAnalyticsRows = (rows = [], baseSummary = {}, periodDays = 30, filtered = false) => {
  if (!filtered) return baseSummary || {}
  const sum = key => rows.reduce((total,row) => total + Number(row?.[key] || 0),0)
  const salesAvailable = baseSummary?.sales != null
  const ordersAvailable = baseSummary?.orders != null
  const stockAvailable = baseSummary?.stockUnits != null
  const revenueAvailable = baseSummary?.revenue != null
  const profitAvailable = baseSummary?.operatingProfit != null
  const revenue = revenueAvailable ? sum('revenue') : null
  const sales = salesAvailable ? sum('salesCount') : null
  const returns = salesAvailable ? sum('returnsCount') : null
  const orders = ordersAvailable ? sum('ordersCount') : null
  const stockRows = stockAvailable ? rows.filter(row => row?.stock != null) : []
  const stockUnits = stockAvailable ? stockRows.reduce((total,row) => total + Number(row.stock || 0),0) : null
  const profitRows = profitAvailable ? rows.filter(row => row?.profit != null) : []
  const operatingProfit = profitAvailable ? profitRows.reduce((total,row) => total + Number(row.profit || 0),0) : null
  return {
    ...baseSummary,
    revenue:revenue == null ? null : Math.round(revenue),
    orders:orders == null ? null : Math.round(orders),
    sales:sales == null ? null : Math.round(sales),
    returns:returns == null ? null : Math.round(returns),
    returnRate:sales == null ? null : sales > 0 ? Math.round(returns/sales*1000)/10 : 0,
    stockUnits:stockUnits == null ? null : Math.round(stockUnits),
    activeProducts:rows.length,
    zeroStock:stockAvailable ? rows.filter(row => Number(row.stock || 0) <= 0).length : null,
    lowStock:stockAvailable ? rows.filter(row => row.stockStatus === 'Заканчивается').length : null,
    slowStock:stockAvailable ? rows.filter(row => ['Избыток','Без движения'].includes(row.stockStatus)).length : null,
    stockCoverDays:stockUnits != null && sales != null && sales > 0 ? Math.round(stockUnits/(sales/Math.max(1,periodDays))) : null,
    operatingProfit:operatingProfit == null ? null : Math.round(operatingProfit),
    margin:operatingProfit != null && revenue != null && revenue > 0 ? Math.round(operatingProfit/revenue*1000)/10 : null,
  }
}

const aggregateAnalyticsTrend = (core = {}, rows = [], filtered = false) => {
  const base = Array.isArray(core?.dailyTrend) ? core.dailyTrend : []
  if (!filtered) return base
  const map = new Map(base.map(item => [item.date,{ date:item.date,revenue:0,orders:0,sales:0,returns:0 }]))
  rows.forEach(row => {
    const keys = new Set([
      ...Object.keys(row?.dailyRevenue || {}), ...Object.keys(row?.dailyOrders || {}),
      ...Object.keys(row?.dailySales || {}), ...Object.keys(row?.dailyReturns || {}),
    ])
    keys.forEach(date => {
      const bucket = map.get(date) || { date,revenue:0,orders:0,sales:0,returns:0 }
      bucket.revenue += Number(row?.dailyRevenue?.[date] || 0)
      bucket.orders += Number(row?.dailyOrders?.[date] || 0)
      bucket.sales += Number(row?.dailySales?.[date] || 0)
      bucket.returns += Number(row?.dailyReturns?.[date] || 0)
      map.set(date,bucket)
    })
  })
  return [...map.values()].sort((a,b) => String(a.date).localeCompare(String(b.date))).map(row => ({ ...row,revenue:Math.round(row.revenue) }))
}

const elModuleNames = {
  overview:'Обзор', sales:'Продажи', advertising:'Реклама', stocks:'Остатки', finance:'Финансы',
  products:'Товары', returns:'Возвраты', reviews:'Отзывы', pricing:'Цены', seasonality:'Сезонность',
  procurement:'Закупки', sync:'Качество данных',
}

const defaultSettings = {
  commissionPercent:20, logisticsPerSale:0, storageMonthly:0, advertisingMonthly:0,
  fixedMonthly:0, taxPercent:0, defaultCostPercent:0, targetMarginPercent:20, productCosts:{}
}

const emptyConnection = {
  connected:false, connectionId:'', scopes:[], tokens:[], syncStates:[], lastSync:null,
  primaryToken:null, primaryTokenId:null, tokenMode:'none', coverageByStage:{},
  serviceToken:null, serviceTokenConnected:false, serviceFinanceReady:false,
  serviceSecret:{ configured:false,valid:false,expiresAt:null,error:null }
}

const normalizeConnection = (value = {}, current = {}) => ({
  ...emptyConnection,
  ...current,
  ...value,
  connected:Boolean(value.connected ?? current.connected),
  scopes:Array.isArray(value.scopes) ? value.scopes : (current.scopes || []),
  tokens:Array.isArray(value.tokens) ? value.tokens : (current.tokens || []),
  syncStates:Array.isArray(value.syncStates) ? value.syncStates : (current.syncStates || []),
  coverageByStage:value.coverageByStage || current.coverageByStage || {},
})

const syncDataRevision = (value = {}) => JSON.stringify(
  [...(Array.isArray(value.syncStates) ? value.syncStates : [])]
    .sort((a,b) => String(a.stage || '').localeCompare(String(b.stage || '')))
    .map(item => ({
      stage:item.stage || '',
      status:item.status || '',
      lastSuccessAt:item.lastSuccessAt || null,
      lastCount:Number(item.lastCount || 0),
      nextAllowedAt:item.nextAllowedAt || null,
      taskId:item.taskId || null,
      taskStatus:item.metadata?.taskStatus || null,
      rows:Number(item.metadata?.rows || 0),
      totalQuantity:Number(item.metadata?.totalQuantity || 0),
      receivedAt:item.metadata?.receivedAt || null,
    }))
)

const demoProducts = [
  { key:'demo-1', nmID:'1234567', vendorCode:'DEMO-01', title:'Товар для демонстрации', brand:'ELISEI Demo', revenue:286740, stock:124, salesCount:38, returnsCount:2, returnRate:5.3, stockCoverDays:98, stockStatus:'В наличии', abc:'A', xyz:'X', recommendation:'Контролировать динамику', profit:null, margin:null, unitCost:0, averagePrice:7546, breakevenPrice:null, targetPrice:null },
  { key:'demo-2', nmID:'7654321', vendorCode:'DEMO-02', title:'Ходовой товар', brand:'ELISEI Demo', revenue:198200, stock:8, salesCount:31, returnsCount:1, returnRate:3.2, stockCoverDays:8, stockStatus:'Заканчивается', abc:'A', xyz:'Y', recommendation:'Запланировать поставку', profit:null, margin:null, unitCost:0, averagePrice:6394, breakevenPrice:null, targetPrice:null },
]

function stockTone(status) {
  if (status === 'Не загружено' || status === 'Детализация ожидается') return 'info'
  if (status === 'Нет остатка') return 'danger'
  if (status === 'Заканчивается') return 'warning'
  if (status === 'Избыток' || status === 'Без движения') return 'info'
  return 'success'
}

function recommendationTone(type) {
  if (type === 'price') return 'amber'
  if (type === 'stock') return 'blue'
  if (type === 'quality') return 'pink'
  return 'violet'
}

export default function DashboardPage({ onNavigate, onLogout, user }) {
  const rawName = String(user?.name || '').trim()
  const displayName = rawName ? rawName.split(/\s+/)[0] : ''
  const profileInitial = displayName ? displayName.slice(0,1).toUpperCase() : 'Э'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер'

  const [active, setActive] = useState('Главная')
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState('')
  const [chat, setChat] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const [elConversationId, setElConversationId] = useState(() => localStorage.getItem(EL_CHAT_CONVERSATION_KEY) || createElConversationId())
  const [elSettings, setElSettings] = useState(() => normalizeElSettings(readStoredJson(EL_CHAT_SETTINGS_KEY, {})))
  const preferredElName = elSettings.preferredName || displayName
  const [elPlan, setElPlan] = useState(defaultElPlan)
  const [elEngineVersion, setElEngineVersion] = useState('')
  const [elProfileSaving, setElProfileSaving] = useState(false)
  const [showElPersonality, setShowElPersonality] = useState(false)
  const [elMood, setElMood] = useState('happy')
  const [elMode, setElMode] = useState(() => localStorage.getItem(EL_CHAT_MODE_KEY) || 'analyst')
  const [messages, setMessages] = useState(() => {
    const stored = readStoredJson(EL_CHAT_MESSAGES_KEY, [])
    const storedSettings = normalizeElSettings(readStoredJson(EL_CHAT_SETTINGS_KEY, {}))
    return Array.isArray(stored) && stored.length ? stored.slice(-50) : [{
      role:'el',
      text:initialElGreeting(greeting, storedSettings.preferredName || displayName, storedSettings),
      reaction:{ mood:'happy',label:'На связи' },
    }]
  })
  const [connection, setConnection] = useState(emptyConnection)
  const [tokenDraft, setTokenDraft] = useState('')
  const [tokenLabel, setTokenLabel] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [checking, setChecking] = useState(false)
  const [serviceTokenDraft, setServiceTokenDraft] = useState('')
  const [serviceTokenLabel, setServiceTokenLabel] = useState('')
  const [showServiceToken, setShowServiceToken] = useState(false)
  const [checkingServiceToken, setCheckingServiceToken] = useState(false)
  const [liveSync, setLiveSync] = useState({ enabled:false,mode:'polling',intervals:{},webhooksEnabled:false,webhookCount:0,oauth:{},webhookSetupReady:false })
  const [liveSyncBusy, setLiveSyncBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [dashboardData, setDashboardData] = useState(null)
  const [coreData, setCoreData] = useState(null)
  const [analyticsCore, setAnalyticsCore] = useState(null)
  const [analyticsCompareCore, setAnalyticsCompareCore] = useState(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [analyticsError, setAnalyticsError] = useState('')
  const [analyticsPeriod, setAnalyticsPeriod] = useState(() => normalizeAnalyticsPeriod(readStoredJson(ANALYTICS_PERIOD_KEY, null)))
  const [analyticsCompare, setAnalyticsCompare] = useState(() => localStorage.getItem(ANALYTICS_COMPARE_KEY) !== 'false')
  const [analyticsBrand, setAnalyticsBrand] = useState('Все')
  const [analyticsCategory, setAnalyticsCategory] = useState('Все')
  const [analyticsAbc, setAnalyticsAbc] = useState('Все')
  const [analyticsXyz, setAnalyticsXyz] = useState('Все')
  const [analyticsStock, setAnalyticsStock] = useState('Все')
  const [advertisingSnapshot, setAdvertisingSnapshot] = useState(null)
  const [advertisingCoverage, setAdvertisingCoverage] = useState(null)
  const [integrationDiagnostics, setIntegrationDiagnostics] = useState(null)
  const [dataQuality, setDataQuality] = useState(null)
  const [dataQualityLoading, setDataQualityLoading] = useState(false)
  const [qualityView, setQualityView] = useState('problems')
  const [financeLedger, setFinanceLedger] = useState(null)
  const [financeLedgerLoading, setFinanceLedgerLoading] = useState(false)
  const [documentsData, setDocumentsData] = useState(null)
  const [documentsLoading, setDocumentsLoading] = useState(false)
  const [documentsCategory, setDocumentsCategory] = useState('Все')
  const [documentDownloading, setDocumentDownloading] = useState('')
  const [financeTab, setFinanceTab] = useState('overview')
  const [financePage, setFinancePage] = useState(1)
  const [advertisingTab, setAdvertisingTab] = useState('overview')
  const [advertisingStatusFilter, setAdvertisingStatusFilter] = useState('all')
  const [advertisingTrendMetric, setAdvertisingTrendMetric] = useState('spend')
  const [liveProducts, setLiveProducts] = useState([])
  const [syncHistory, setSyncHistory] = useState([])
  const [settingsDraft, setSettingsDraft] = useState(defaultSettings)
  const [productFilter, setProductFilter] = useState('Все')
  const [productSort, setProductSort] = useState({ key:'revenue', direction:'desc' })
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [importResult, setImportResult] = useState(null)
  const connectionRef = useRef(emptyConnection)
  const syncRevisionRef = useRef('')
  const analyticsRequestRef = useRef(0)
  const lastBusinessSectionRef = useRef('Главная')

  const notify = (text, duration = 4200) => {
    setToast(text)
    window.clearTimeout(window.__eliseiToast)
    window.__eliseiToast = window.setTimeout(() => setToast(''), duration)
  }

  const financeRequestForTab = tab => {
    if (tab === 'fbs') return { mode:'FBS' }
    if (tab === 'fbo') return { mode:'FBO' }
    if (tab === 'penalties') return { group:'penalties,deductions' }
    if (tab === 'compensations') return { group:'compensations,adjustments' }
    if (tab === 'subscriptions') return { group:'subscriptions' }
    if (tab === 'promotionCharges') return { group:'advertising' }
    return {}
  }

  const loadFinanceLedger = async (connectionId = connection.connectionId, options = {}) => {
    if (!connectionId) return
    const range = { from:analyticsPeriod.from, to:analyticsPeriod.to }
    setFinanceLedgerLoading(true)
    try {
      const result = await wbApi.financeLedger(connectionId, {
        ...range,
        ...financeRequestForTab(options.tab || financeTab),
        query:options.query ?? query,
        page:options.page ?? financePage,
        limit:120,
      })
      setFinanceLedger(result)
    } catch (error) {
      notify(error.message, 8000)
    } finally {
      setFinanceLedgerLoading(false)
    }
  }

  const loadDocuments = async (connectionId = connection.connectionId) => {
    if (!connectionId) return
    setDocumentsLoading(true)
    try {
      const result = await wbApi.extended('documents',connectionId,{
        from:analyticsPeriod.from,to:analyticsPeriod.to,query,limit:500,
      })
      setDocumentsData(result)
    } catch (error) {
      notify(error.message,8000)
    } finally {
      setDocumentsLoading(false)
    }
  }

  const downloadWbDocument = async row => {
    if (!connection.connectionId || !row?.serviceName || !row?.extension) return
    const key=`${row.serviceName}.${row.extension}`
    setDocumentDownloading(key)
    try {
      const result=await wbApi.downloadDocument(connection.connectionId,row.serviceName,row.extension)
      const url=URL.createObjectURL(result.blob)
      const anchor=document.createElement('a')
      anchor.href=url
      anchor.download=result.filename || `${row.serviceName}.${row.extension}`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      notify(error.message,8000)
    } finally {
      setDocumentDownloading('')
    }
  }

  const exportFinanceLedger = () => {
    const rows = Array.isArray(financeLedger?.rows) ? financeLedger.rows : []
    if (!rows.length) return notify('В выбранном разделе пока нет финансовых операций.')
    const headers = ['Дата','Операция','Группа','Приход/расход','Сумма','Схема','Артикул WB','Артикул продавца','Заказ/srid','Склад','Источник','Примечание']
    const lines = [headers.map(csvCell).join(';'), ...rows.map(row => [
      row.operationDate,row.operationName,row.operationGroup,row.direction,row.amount,row.fulfillmentMode,row.nmId,row.vendorCode,row.srid || row.orderId,row.warehouse,row.sourceStream,row.note,
    ].map(csvCell).join(';'))]
    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type:'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `elisei-finance-${analyticsPeriod.from}-${analyticsPeriod.to}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const loadConnectionData = async connectionId => {
    const [dashboard, productResult, historyResult, coreResult, advertisingResult, diagnosticsResult] = await Promise.all([
      wbApi.dashboard(connectionId), wbApi.products(connectionId), wbApi.syncHistory(connectionId), wbApi.core(connectionId), wbApi.advertising(connectionId,{ from:analyticsPeriod.from,to:analyticsPeriod.to }), wbApi.diagnostics(connectionId)
    ])
    setDashboardData(dashboard.dashboard || null)
    setLiveProducts(productResult.products || [])
    setSyncHistory(historyResult.history || [])
    setCoreData(coreResult.core || null)
    setAdvertisingSnapshot(advertisingResult.advertising || coreResult.core?.advertising || null)
    setAdvertisingCoverage(advertisingResult.coverage || null)
    setIntegrationDiagnostics(diagnosticsResult || null)
    if (coreResult.core?.settings) setSettingsDraft(coreResult.core.settings)
  }

  const loadDataQuality = async (connectionId = connection.connectionId, period = analyticsPeriod) => {
    if (!connectionId) return
    setDataQualityLoading(true)
    try {
      const result=await wbApi.dataQuality(connectionId,{ from:period?.from,to:period?.to })
      setDataQuality(result?.quality || null)
    } catch (error) {
      notify(error.message,8000)
    } finally {
      setDataQualityLoading(false)
    }
  }

  const loadLiveSync = async (connectionId = connection.connectionId) => {
    if (!connectionId) return
    try {
      const result = await wbApi.live(connectionId)
      setLiveSync({ ...(result?.status || {}),webhooks:result?.webhooks || [] })
    } catch { /* live sync is optional and must not block the cabinet */ }
  }

  const updateLiveSync = async patch => {
    if (!connection.connectionId || liveSyncBusy) return
    setLiveSyncBusy(true)
    try {
      const result=await wbApi.updateLive(connection.connectionId,patch)
      setLiveSync(current=>({ ...current,...(result?.status || {}) }))
      notify(result?.status?.enabled ? 'Живое обновление включено. ELISEI будет обновлять оперативные данные автоматически.' : 'Живое обновление приостановлено.')
    } catch(error){ notify(error.message,9000) }
    finally{ setLiveSyncBusy(false) }
  }

  const setupLiveWebhooks = async () => {
    if (!connection.connectionId || liveSyncBusy) return
    setLiveSyncBusy(true)
    try {
      const result=await wbApi.setupWebhooks(connection.connectionId)
      setLiveSync({ ...(result?.status || {}),webhooks:result?.webhooks || [] })
      notify(result?.created?.length ? `Подключено вебхуков: ${result.created.length}. События WB будут приходить автоматически.` : 'Вебхуки уже подключены или для них пока нет подходящих прав.',8000)
    } catch(error){ notify(error.message,10000) }
    finally{ setLiveSyncBusy(false) }
  }

  const loadAdvertisingData = async (connectionId = connection.connectionId, period = analyticsPeriod) => {
    if (!connectionId || !period?.from || !period?.to) return
    const result = await wbApi.advertising(connectionId,{ from:period.from,to:period.to })
    setAdvertisingSnapshot(result.advertising || null)
    setAdvertisingCoverage(result.coverage || null)
  }

  const loadAnalyticsData = async (connectionId, period = analyticsPeriod, compare = analyticsCompare) => {
    if (!connectionId || !period?.from || !period?.to) return
    const requestId = ++analyticsRequestRef.current
    setAnalyticsLoading(true)
    setAnalyticsError('')
    setAnalyticsCore(null)
    setAnalyticsCompareCore(null)
    try {
      const previous = previousPeriodFor(period)
      const [currentResult, previousResult] = await Promise.all([
        wbApi.core(connectionId,{ from:period.from,to:period.to }),
        compare ? wbApi.core(connectionId,{ from:previous.from,to:previous.to }) : Promise.resolve(null),
      ])
      if (requestId !== analyticsRequestRef.current) return
      setAnalyticsCore(currentResult?.core || null)
      setAnalyticsCompareCore(previousResult?.core || null)
    } catch (error) {
      if (requestId !== analyticsRequestRef.current) return
      setAnalyticsError(error.message || 'Не удалось пересчитать аналитику за выбранный период.')
    } finally {
      if (requestId === analyticsRequestRef.current) setAnalyticsLoading(false)
    }
  }

  useEffect(() => {
    connectionRef.current = connection
  }, [connection])


  useEffect(() => {
    localStorage.setItem(EL_CHAT_MESSAGES_KEY, JSON.stringify(messages.slice(-50)))
  }, [messages])

  useEffect(() => {
    localStorage.setItem(EL_CHAT_CONVERSATION_KEY, elConversationId)
  }, [elConversationId])

  useEffect(() => {
    localStorage.setItem(EL_CHAT_SETTINGS_KEY, JSON.stringify(elSettings))
  }, [elSettings])

  useEffect(() => {
    localStorage.setItem(EL_CHAT_MODE_KEY, elMode)
  }, [elMode])

  useEffect(() => {
    if (!elApi?.status) return
    elApi.status().then(result => {
      const plan = result?.plan || defaultElPlan
      setElEngineVersion(String(result?.version || ''))
      setElPlan({ ...defaultElPlan, ...plan, features:{ ...defaultElPlan.features, ...(plan.features || {}) } })
      setElMode(current => {
        if (current === 'pro' && !plan?.features?.pro) return plan?.features?.gpt ? 'gpt' : 'analyst'
        if (current === 'gpt' && !plan?.features?.gpt) return 'analyst'
        return current
      })
    }).catch(() => setElPlan(defaultElPlan))
  }, [])

  useEffect(() => {
    const cabinetId = connection.connectionId || 'main'
    elApi.profile(cabinetId).then(profileResult => {
      if (profileResult?.profile) setElSettings(current => normalizeElSettings({ ...current, ...profileResult.profile }))
    }).catch(() => {})
  }, [connection.connectionId])

  useEffect(() => {
    if (active !== 'Спросить ЭЛа') lastBusinessSectionRef.current = active
  }, [active])

  useEffect(() => {
    if (!wbApi.configured) return
    Promise.all([wbApi.current(), businessApi.settings()]).then(async ([status, settingsResult]) => {
      if (settingsResult?.settings) setSettingsDraft(settingsResult.settings)
      if (!status.connected || !status.connectionId) return
      const normalized = normalizeConnection(status)
      connectionRef.current = normalized
      syncRevisionRef.current = syncDataRevision(normalized)
      setConnection(normalized)
      setSyncHistory(status.syncHistory || [])
      await Promise.all([loadConnectionData(status.connectionId),loadLiveSync(status.connectionId)])
    }).catch(error => notify(error.message, 8000))
  }, [])

  useEffect(() => {
    if (!connection.connected || !connection.connectionId) return undefined
    const connectionId = connection.connectionId
    const timer = window.setInterval(async () => {
      try {
        const status = await wbApi.status(connectionId)
        const current = connectionRef.current
        const normalized = normalizeConnection(status, current)
        const nextRevision = syncDataRevision(normalized)
        const shouldReload = nextRevision !== syncRevisionRef.current || Boolean(normalized.lastSync && normalized.lastSync !== current.lastSync)

        syncRevisionRef.current = nextRevision
        connectionRef.current = normalized
        setConnection(normalized)

        // Данные статуса и расчётное ядро приходят из разных endpoint'ов.
        // После фонового завершения отчёта обязательно перечитываем core,
        // иначе журнал уже показывает новый остаток, а раздел «Остатки» остаётся на старом снимке.
        if (shouldReload) await loadConnectionData(connectionId)
      } catch { /* фоновая проверка не должна мешать работе интерфейса */ }
    }, 15000)
    return () => window.clearInterval(timer)
  }, [connection.connected, connection.connectionId, analyticsPeriod.from, analyticsPeriod.to])

  useEffect(() => {
    if (active !== 'Остатки' || !connection.connected || !connection.connectionId) return
    loadConnectionData(connection.connectionId).catch(() => {})
  }, [active, connection.connected, connection.connectionId])


  useEffect(() => {
    if (active !== 'Подключения' || !connection.connected || !connection.connectionId) return
    loadLiveSync(connection.connectionId).catch(() => {})
  }, [active,connection.connected,connection.connectionId])

  useEffect(() => {
    if (active !== 'Синхронизации' || !connection.connected || !connection.connectionId) return undefined
    const timer=window.setTimeout(()=>loadDataQuality(connection.connectionId,analyticsPeriod).catch(()=>{}),220)
    return () => window.clearTimeout(timer)
  }, [active,connection.connected,connection.connectionId,analyticsPeriod.from,analyticsPeriod.to,
      (connection.syncStates || []).map(item=>`${item.stage}:${item.status}:${item.lastSuccessAt || item.nextAllowedAt || ''}:${item.lastCount || 0}`).join('|')])

  useEffect(() => {
    localStorage.setItem(ANALYTICS_PERIOD_KEY, JSON.stringify(analyticsPeriod))
    localStorage.setItem('elisei.globalPeriod.v3', JSON.stringify(analyticsPeriod))
    window.__ELISEI_PERIOD__ = analyticsPeriod
    window.dispatchEvent(new CustomEvent('elisei:period-change',{ detail:analyticsPeriod }))
  }, [analyticsPeriod])

  useEffect(() => {
    localStorage.setItem(ANALYTICS_COMPARE_KEY, analyticsCompare ? 'true' : 'false')
  }, [analyticsCompare])

  useEffect(() => {
    if (!['Аналитика','Остатки','Финансы'].includes(active) || !connection.connected || !connection.connectionId) return undefined
    const timer = window.setTimeout(() => {
      loadAnalyticsData(connection.connectionId,analyticsPeriod,active === 'Аналитика' ? analyticsCompare : false)
    }, 320)
    return () => window.clearTimeout(timer)
  }, [active, connection.connected, connection.connectionId, connection.lastSync, analyticsPeriod.from, analyticsPeriod.to, analyticsCompare])

  useEffect(() => {
    if (active !== 'Финансы' || !connection.connected || !connection.connectionId) return undefined
    const timer = window.setTimeout(() => {
      loadFinanceLedger(connection.connectionId).catch(() => {})
    }, 280)
    return () => window.clearTimeout(timer)
  }, [active, connection.connected, connection.connectionId, financeTab, query, financePage, analyticsPeriod.from, analyticsPeriod.to,
      (connection.syncStates || []).filter(item => ['finance','acquiring','paidStorage','acceptance','documents','jamSubscription'].includes(item.stage)).map(item => `${item.stage}:${item.lastSuccessAt || item.nextAllowedAt || ''}`).join('|')])

  useEffect(() => {
    if (active !== 'Документы WB' || !connection.connected || !connection.connectionId) return undefined
    const timer=window.setTimeout(()=>loadDocuments(connection.connectionId).catch(()=>{}),280)
    return () => window.clearTimeout(timer)
  }, [active,connection.connected,connection.connectionId,query,analyticsPeriod.from,analyticsPeriod.to,
      (connection.syncStates || []).find(item => item.stage === 'documents')?.lastSuccessAt])

  useEffect(() => {
    if (active !== 'Реклама' || !connection.connected || !connection.connectionId) return undefined
    const timer = window.setTimeout(() => {
      loadAdvertisingData(connection.connectionId,analyticsPeriod).catch(error => notify(error.message,8000))
    }, 280)
    return () => window.clearTimeout(timer)
  }, [active, connection.connected, connection.connectionId, analyticsPeriod.from, analyticsPeriod.to,
      (connection.syncStates || []).find(item => item.stage === 'advertising')?.lastSuccessAt])

  useEffect(() => {
    setFinancePage(1)
  }, [financeTab,query,analyticsPeriod.from,analyticsPeriod.to])

  const nav = [
    ['Главная', Home], ['Аналитика', BarChart3], ['Товары', PackageSearch], ['Остатки', Boxes], ['История остатков', Warehouse],
    ['Финансы', WalletCards], ['Документы WB', FileText], ['Цены и акции', Tag], ['Реклама', Megaphone], ['Поисковые запросы', Search], ['Коммуникации', Star],
    ['Сезонность', CalendarDays], ['Отчёты', FileText], ['Импорт данных', Upload], ['AI CRM', UsersRound], ['Спросить ЭЛа', MessageCircle],
    ['Подключения', PlugZap], ['Синхронизации', RefreshCw], ['Настройки', Settings]
  ]

  const summary = coreData?.summary || dashboardData || {
    revenue:connection.connected ? null : 0, orders:connection.connected ? null : 0, sales:connection.connected ? null : 0,
    returns:connection.connected ? null : 0, returnRate:connection.connected ? null : 0, stockUnits:connection.connected ? null : 0,
    activeProducts:liveProducts.length, zeroStock:connection.connected ? null : 0, lowStock:connection.connected ? null : 0,
    slowStock:connection.connected ? null : 0, stockCoverDays:null, operatingProfit:null, margin:null,
    cogs:null, commission:0, logistics:0, advertising:0, storage:0, acceptance:0, acquiring:0, penalties:0, deductions:0, additionalPayment:0, fixed:0, tax:0
  }

  const coreProducts = useMemo(() => {
    if (coreData?.products?.length) return coreData.products
    if (liveProducts.length) return liveProducts.map((p,index) => ({
      ...p, key:String(p.nmID || p.vendorCode || index), salesCount:null, returnsCount:null, returnRate:null, stock:null,
      stockAvailable:false, stockStatus:'Не загружено', recommendation:'Дождаться загрузки данных WB',
      abc:'C', xyz:'Z', profit:null, margin:null, averagePrice:null, unitCost:0
    }))
    return connection.connected ? [] : demoProducts
  }, [coreData, liveProducts, connection.connected])

  const productRows = useMemo(() => coreProducts.map((p,index) => ({
    ...p,
    id:String(p.key || p.nmID || p.vendorCode || index),
    article:String(p.vendorCode || p.nmID || '—'),
    vendorCode:String(p.vendorCode || '—'),
    barcode:String(p.barcode || (Array.isArray(p.barcodes) ? p.barcodes[0] : '') || '—'),
    title:p.title || 'Товар', brand:p.brand || 'Без бренда', photo:p.photo || '',
    revenue:p.revenue == null ? null : Number(p.revenue || 0),
    stock:p.stock == null ? null : Number(p.stock || 0),
    expenses:p.expenses == null ? null : Number(p.expenses || 0),
    status:p.stockStatus || (p.stock == null ? 'Не загружено' : Number(p.stock || 0) <= 0 ? 'Нет остатка' : Number(p.stock || 0) < 10 ? 'Заканчивается' : 'В наличии')
  })), [coreProducts])

  const filteredProducts = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = productRows.filter(p => {
      const matchesQuery = !needle || [p.article,p.vendorCode,p.barcode,p.title,p.brand,p.nmID,p.key].join(' ').toLowerCase().includes(needle)
      const matchesFilter = productFilter === 'Все' ||
        (productFilter === 'В наличии' && p.status === 'В наличии') ||
        (productFilter === 'Заканчиваются' && p.status === 'Заканчивается') ||
        (productFilter === 'Нет остатка' && p.status === 'Нет остатка') ||
        (productFilter === 'Избыток' && ['Избыток','Без движения'].includes(p.status)) ||
        (productFilter === 'С продажами' && p.salesCount != null && Number(p.salesCount) > 0) ||
        (productFilter === 'Без продаж' && p.salesCount != null && Number(p.salesCount) === 0)
      return matchesQuery && matchesFilter
    })
    return [...rows].sort((a,b) => {
      const av = a[productSort.key], bv = b[productSort.key]
      const result = typeof av === 'number' ? av-bv : String(av ?? '').localeCompare(String(bv ?? ''),'ru')
      return productSort.direction === 'asc' ? result : -result
    })
  }, [productRows, query, productFilter, productSort])

  const analyticsBaseProducts = useMemo(() => {
    const source = analyticsCore?.products || (!connection.connected ? coreData?.products : []) || []
    return source.map((p,index) => ({
      ...p,
      id:String(p.key || p.nmID || p.vendorCode || index),
      article:String(p.vendorCode || p.nmID || '—'),
      category:String(p.category || p.subjectName || p.subject || 'Без категории'),
      brand:String(p.brand || 'Без бренда'),
      status:p.stockStatus || (p.stock == null ? 'Не загружено' : Number(p.stock || 0) <= 0 ? 'Нет остатка' : Number(p.stock || 0) < 10 ? 'Заканчивается' : 'В наличии'),
    }))
  }, [analyticsCore,coreData,connection.connected])

  const analyticsFilterOptions = useMemo(() => ({
    brands:[...new Set(analyticsBaseProducts.map(row => row.brand).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru')),
    categories:[...new Set(analyticsBaseProducts.map(row => row.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru')),
  }), [analyticsBaseProducts])

  const filterAnalyticsRows = rows => {
    const needle = query.trim().toLowerCase()
    return rows.filter(row => {
      const matchesQuery = !needle || [row.article,row.vendorCode,row.barcode,row.title,row.brand,row.category,row.nmID,row.key].join(' ').toLowerCase().includes(needle)
      const matchesBrand = analyticsBrand === 'Все' || row.brand === analyticsBrand
      const matchesCategory = analyticsCategory === 'Все' || row.category === analyticsCategory
      const matchesAbc = analyticsAbc === 'Все' || row.abc === analyticsAbc
      const matchesXyz = analyticsXyz === 'Все' || row.xyz === analyticsXyz
      const matchesStock = analyticsStock === 'Все' ||
        (analyticsStock === 'В наличии' && row.status === 'В наличии') ||
        (analyticsStock === 'Заканчиваются' && row.status === 'Заканчивается') ||
        (analyticsStock === 'Нет остатка' && row.status === 'Нет остатка') ||
        (analyticsStock === 'Без движения' && ['Избыток','Без движения'].includes(row.status))
      return matchesQuery && matchesBrand && matchesCategory && matchesAbc && matchesXyz && matchesStock
    })
  }

  const analyticsFilteredProducts = useMemo(() => filterAnalyticsRows(analyticsBaseProducts), [analyticsBaseProducts,query,analyticsBrand,analyticsCategory,analyticsAbc,analyticsXyz,analyticsStock])
  const analyticsFiltersActive = Boolean(query.trim() || analyticsBrand !== 'Все' || analyticsCategory !== 'Все' || analyticsAbc !== 'Все' || analyticsXyz !== 'Все' || analyticsStock !== 'Все')
  const analyticsSummary = useMemo(() => aggregateAnalyticsRows(analyticsFilteredProducts,analyticsCore?.summary || (!connection.connected ? summary : {}),periodDaysBetween(analyticsPeriod),analyticsFiltersActive), [analyticsFilteredProducts,analyticsCore,summary,analyticsPeriod,analyticsFiltersActive,connection.connected])
  const analyticsTrend = useMemo(() => aggregateAnalyticsTrend(analyticsCore || (!connection.connected ? coreData : {}) || {},analyticsFilteredProducts,analyticsFiltersActive), [analyticsCore,coreData,analyticsFilteredProducts,analyticsFiltersActive,connection.connected])

  const analyticsCompareProducts = useMemo(() => {
    const source = analyticsCompareCore?.products || []
    const rows = source.map((p,index) => ({
      ...p,
      id:String(p.key || p.nmID || p.vendorCode || index), article:String(p.vendorCode || p.nmID || '—'),
      category:String(p.category || p.subjectName || p.subject || 'Без категории'), brand:String(p.brand || 'Без бренда'),
      status:p.stockStatus || (p.stock == null ? 'Не загружено' : Number(p.stock || 0) <= 0 ? 'Нет остатка' : Number(p.stock || 0) < 10 ? 'Заканчивается' : 'В наличии'),
    }))
    return filterAnalyticsRows(rows)
  }, [analyticsCompareCore,query,analyticsBrand,analyticsCategory,analyticsAbc,analyticsXyz,analyticsStock])
  const analyticsCompareSummary = useMemo(() => aggregateAnalyticsRows(analyticsCompareProducts,analyticsCompareCore?.summary || {},periodDaysBetween(analyticsPeriod),analyticsFiltersActive), [analyticsCompareProducts,analyticsCompareCore,analyticsPeriod,analyticsFiltersActive])
  const analyticsCompareTrend = useMemo(() => aggregateAnalyticsTrend(analyticsCompareCore || {},analyticsCompareProducts,analyticsFiltersActive), [analyticsCompareCore,analyticsCompareProducts,analyticsFiltersActive])

  const resetAnalyticsFilters = () => {
    setQuery('')
    setAnalyticsBrand('Все')
    setAnalyticsCategory('Все')
    setAnalyticsAbc('Все')
    setAnalyticsXyz('Все')
    setAnalyticsStock('Все')
  }

  const setAnalyticsPreset = preset => setAnalyticsPeriod(periodPresetValue(preset))

  const renderSharedPeriodControls = ({ note = '', maxDays = null } = {}) => {
    const selectedDays = periodDaysBetween(analyticsPeriod)
    const limited = maxDays && selectedDays > maxDays
    return <div className="workspace-period-controls">
      <div className="analytics-control-panel workspace-period-panel">
        <div className="analytics-period-head">
          <div><CalendarDays size={18}/><span>Единый период</span><strong>{formatDate(analyticsPeriod.from)} — {formatDate(analyticsPeriod.to)}</strong><small>{selectedDays} дн.</small></div>
          <small className="workspace-period-global">Применяется ко всему кабинету</small>
        </div>
        <div className="analytics-presets">
          {[['7','7 дней'],['30','30 дней'],['90','90 дней'],['month','Этот месяц'],['prevMonth','Прошлый месяц'],['year','Этот год']].map(([key,label]) => <button key={key} className={analyticsPeriod.preset===key?'active':''} onClick={() => setAnalyticsPreset(key)}>{label}</button>)}
        </div>
        <div className="analytics-date-range">
          <label><span>С</span><input type="date" value={analyticsPeriod.from} min={addDays(analyticsPeriod.to,-365)} max={analyticsPeriod.to} onChange={event => setAnalyticsPeriod(current => ({ ...current,preset:'custom',from:event.target.value }))}/></label>
          <span className="analytics-date-arrow">→</span>
          <label><span>По</span><input type="date" value={analyticsPeriod.to} min={analyticsPeriod.from} max={earlierIsoDate(isoLocalDate(new Date()),addDays(analyticsPeriod.from,365))} onChange={event => setAnalyticsPeriod(current => ({ ...current,preset:'custom',to:event.target.value }))}/></label>
        </div>
      </div>
      {(note || limited) && <div className={`workspace-period-note ${limited ? 'warning' : ''}`}><Info size={17}/><span>{limited ? `WB ограничивает один запрос этого раздела периодом ${maxDays} дн. ELISEI покажет фактическое покрытие и не подставит нули за недоступные даты.` : note}</span></div>}
    </div>
  }

  const changeProductSort = key => setProductSort(current => current.key === key
    ? { key, direction:current.direction === 'asc' ? 'desc' : 'asc' }
    : { key, direction:'desc' })
  const SortIcon = ({ column }) => productSort.key !== column ? null : productSort.direction === 'asc' ? <ChevronUp size={14}/> : <ChevronDown size={14}/>

  const recommendations = coreData?.recommendations?.length ? coreData.recommendations : [
    { id:'demo-stock', type:'stock', title:'Синхронизировать остатки', text:'После синхронизации Эл рассчитает дни запаса и точки пополнения.', effect:'Контроль дефицита' },
    { id:'demo-cost', type:'price', title:'Добавить себестоимость', text:'Введите себестоимость, комиссию и расходы для расчёта чистой прибыли.', effect:'P&L по каждому товару' },
    { id:'demo-quality', type:'quality', title:'Проверить возвраты', text:'Эл выделит товары с повышенной долей возвратов.', effect:'Улучшение качества' },
  ]

  const syncConnection = async (connectionId = connection.connectionId, stages = null, options = {}) => {
    if (!connectionId || syncing) return
    setSyncing(true)
    try {
      const result = await wbApi.sync(connectionId, stages, options)
      const normalized = normalizeConnection({ connected:true, lastSync:result.lastSync, syncStates:result.syncStates || connectionRef.current.syncStates }, connectionRef.current)
      connectionRef.current = normalized
      syncRevisionRef.current = syncDataRevision(normalized)
      setConnection(normalized)
      setDashboardData(result.dashboard || null)
      setCoreData(result.core || null)
      if (!stages || !stages.includes('advertising')) setAdvertisingSnapshot(result.core?.advertising || null)
      setSyncHistory(result.syncHistory || [])
      const productResult = await wbApi.products(connectionId)
      setLiveProducts(productResult.products || [])
      if (stages?.includes('advertising')) await loadAdvertisingData(connectionId,options.period || analyticsPeriod)
      if (stages?.some(stage => ['searchQueries','stockHistory','reviews','questions','chats'].includes(stage))) { /* workspace перечитает поток по обновлённому статусу */ }
      notify(result.warnings?.length
        ? `Синхронизация завершена частично: ${result.warnings[0]}`
        : `Готово: ${result.counts.products} товаров, ${result.counts.orders} заказов, ${result.counts.sales} продаж`,
      result.warnings?.length ? 9000 : 5200)
    } catch (error) { notify(error.message, 9000) }
    finally { setSyncing(false) }
  }

  const repairStockSnapshot = async () => {
    if (!connection.connectionId || syncing) return
    setSyncing(true)
    try {
      const result = await wbApi.repairStocks(connection.connectionId, coreData?.stockMeta?.taskId || '')
      if (Array.isArray(result.syncStates)) {
        const normalized = normalizeConnection({ connected:true, lastSync:result.lastSync, syncStates:result.syncStates }, connectionRef.current)
        connectionRef.current = normalized
        syncRevisionRef.current = syncDataRevision(normalized)
        setConnection(normalized)
      }
      if (result.core) setCoreData(result.core)
      if (result.dashboard) setDashboardData(result.dashboard)
      await loadConnectionData(connection.connectionId)
      notify(result.message || (result.queued ? 'Новый отчёт остатков поставлен в очередь.' : 'Детализация остатков восстановлена.'), result.queued ? 9000 : 5200)
    } catch (error) {
      notify(error.message, 9000)
    } finally {
      setSyncing(false)
    }
  }

  const saveConnection = async event => {
    event.preventDefault()
    if (!wbApi.configured) return notify('Добавьте VITE_API_BASE_URL в Render')
    if (tokenDraft.trim().length < 40) return notify('API-ключ выглядит слишком коротким')
    setChecking(true)
    try {
      const result = await wbApi.connect(tokenDraft.trim(), tokenLabel.trim())
      setConnection(normalizeConnection(result))
      setTokenDraft(''); setTokenLabel('')
      notify(result.tokenMode === 'universal' ? 'Основной токен подключён и назначен всем доступным потокам.' : 'Токен подключён. ELISEI использует его только для доступных категорий.')
    } catch (error) { notify(error.message, 9000) }
    finally { setChecking(false) }
  }

  const saveServiceConnection = async event => {
    event.preventDefault()
    if (!wbApi.configured) return notify('Добавьте VITE_API_BASE_URL в Render')
    if (serviceTokenDraft.trim().length < 40) return notify('Сервисный токен выглядит слишком коротким')
    setCheckingServiceToken(true)
    try {
      const result = await wbApi.connectService(serviceTokenDraft.trim(),serviceTokenLabel.trim())
      setConnection(current => normalizeConnection(result,current))
      setServiceTokenDraft(''); setServiceTokenLabel('')
      notify(result.serviceFinanceReady ? 'Сервисный токен подключён. Финансовые сводки WB готовы к загрузке.' : 'Сервисный токен сохранён. Проверьте WB_CLIENT_SECRET в backend Render.')
    } catch (error) { notify(error.message,10000) }
    finally { setCheckingServiceToken(false) }
  }

  const removeToken = async tokenId => {
    if (!window.confirm('Удалить этот API-токен из ELISEI? Уже загруженные данные сохранятся.')) return
    try {
      const result = await wbApi.removeToken(tokenId)
      setConnection(current => normalizeConnection(result, current))
      notify('API-токен удалён')
    } catch (error) { notify(error.message, 8000) }
  }

  const setPrimaryToken = async tokenId => {
    try {
      const result = await wbApi.setPrimaryToken(tokenId)
      setConnection(current => normalizeConnection(result, current))
      notify('Основной токен выбран. Синхронизации будут использовать его в первую очередь.')
    } catch (error) { notify(error.message, 8000) }
  }

  const disconnect = async () => {
    if (!window.confirm('Отключить Wildberries? Загруженные данные этого подключения будут удалены.')) return
    try {
      await wbApi.disconnect(connection.connectionId)
      setConnection(emptyConnection)
      setDashboardData(null); setCoreData(null); setAdvertisingSnapshot(null); setLiveProducts([]); setSyncHistory([])
      notify('Wildberries отключён')
    } catch (error) { notify(error.message, 8000) }
  }

  const updateSetting = (key,value) => setSettingsDraft(current => ({ ...current, [key]:Math.max(0, Number(value || 0)) }))
  const updateProductCost = (product,value) => {
    const key = String(product.key || product.nmID || product.vendorCode)
    setSettingsDraft(current => ({ ...current, productCosts:{ ...(current.productCosts || {}), [key]:Math.max(0, Number(value || 0)) } }))
  }
  const saveSettings = async () => {
    setSavingSettings(true)
    try {
      const result = await businessApi.saveSettings(settingsDraft)
      setSettingsDraft(result.settings || settingsDraft)
      if (result.core) setCoreData(result.core)
      notify('Финансовые настройки сохранены. Прибыль пересчитана.')
    } catch (error) { notify(error.message, 8000) }
    finally { setSavingSettings(false) }
  }

  const updateElSetting = (key, value) => setElSettings(current => normalizeElSettings({ ...current, [key]:value }))

  const saveElProfile = async () => {
    setElProfileSaving(true)
    try {
      const result = await elApi.saveProfile({
        character:elSettings.character,
        humor:elSettings.humor,
        support:elSettings.support,
        celebrations:elSettings.celebrations,
        address:elSettings.address,
        noHumorInCritical:true,
        preferredName:elSettings.preferredName,
      }, connection.connectionId || 'main', user?.company || 'Основной кабинет WB')
      if (result?.profile) setElSettings(current => normalizeElSettings({ ...current, ...result.profile }))
      notify('Характер Эла сохранён для этого кабинета.')
    } catch (error) { notify(error.message, 8000) }
    finally { setElProfileSaving(false) }
  }

  const downloadCsv = (name, headers, rows) => {
    const content = '\uFEFF' + [headers, ...rows].map(row => row.map(csvCell).join(';')).join('\n')
    const blob = new Blob([content], { type:'text/csv;charset=utf-8' })
    const href = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = href; link.download = `${name}_${new Date().toISOString().slice(0,10)}.csv`; link.click()
    URL.revokeObjectURL(href)
  }

  const exportAnalytics = () => {
    if (!analyticsFilteredProducts.length) return notify('По выбранному периоду и фильтрам нет товаров для выгрузки.')
    downloadCsv(
      `elisei_analytics_${analyticsPeriod.from}_${analyticsPeriod.to}`,
      ['Период с','Период по','Артикул WB','Артикул продавца','Товар','Бренд','Категория','ABC','XYZ','Выручка','Заказы','Продажи','Возвраты','Доля возвратов','Остаток сейчас','Дней запаса','Операционная прибыль','Маржа'],
      analyticsFilteredProducts.map(row => [analyticsPeriod.from,analyticsPeriod.to,row.nmID,row.vendorCode,row.title,row.brand,row.category,row.abc,row.xyz,row.revenue,row.ordersCount,row.salesCount,row.returnsCount,row.returnRate,row.stock,row.stockCoverDays,row.profit,row.margin]),
    )
  }

  const importCostsCsv = event => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text = String(reader.result || '').replace(/^\uFEFF/, '')
        const lines = text.split(/\r?\n/).filter(line => line.trim())
        if (lines.length < 2) throw new Error('Файл пустой или не содержит строк данных')
        const delimiter = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ','
        const parse = line => line.split(delimiter).map(value => value.trim().replace(/^"|"$/g, '').replace(/""/g, '"'))
        const headers = parse(lines[0]).map(value => value.toLowerCase())
        const articleIndex = headers.findIndex(value => /артикул|vendor|nm.?id|sku/.test(value))
        const costIndex = headers.findIndex(value => /себестоим|cost/.test(value))
        if (articleIndex < 0 || costIndex < 0) throw new Error('Нужны колонки «Артикул» и «Себестоимость»')
        const productIndex = new Map()
        for (const product of productRows) {
          for (const key of [product.article, product.nmID, product.key, product.vendorCode]) if (key) productIndex.set(String(key).trim().toLowerCase(), product)
        }
        const nextCosts = { ...(settingsDraft.productCosts || {}) }
        let imported = 0, skipped = 0
        for (const line of lines.slice(1)) {
          const row = parse(line)
          const article = String(row[articleIndex] || '').trim().toLowerCase()
          const cost = Number(String(row[costIndex] || '').replace(/\s/g, '').replace(',', '.'))
          const product = productIndex.get(article)
          if (!product || !Number.isFinite(cost) || cost < 0) { skipped += 1; continue }
          nextCosts[String(product.key || product.nmID || product.vendorCode)] = cost
          imported += 1
        }
        setSettingsDraft(current => ({ ...current, productCosts:nextCosts }))
        setImportResult({ type:'success', text:`Подготовлено к сохранению: ${imported} товаров. Пропущено: ${skipped}.` })
      } catch (error) { setImportResult({ type:'error', text:error.message }) }
    }
    reader.readAsText(file, 'utf-8')
  }

  const reportDefinitions = [
    { title:'Товары и экономика', text:'Артикулы, ШК, продажи, остатки, себестоимость, затраты и прибыль.', action:() => downloadCsv('elisei_products', ['Артикул WB','Артикул продавца','ШК','Товар','Бренд','Выручка','Продажи','Возвраты','Остаток','Себестоимость за единицу','Все затраты','Прибыль','Маржа','Реклама','Рекомендация'], productRows.map(p => [p.nmID,p.vendorCode,p.barcode,p.title,p.brand,p.revenue,p.salesCount,p.returnsCount,p.stock,p.unitCost,p.expenses,p.profit,p.margin,p.advertising,p.recommendation])) },
    { title:'P&L за 30 дней', text:'Выручка, COGS, комиссия, логистика, реклама, хранение и прибыль.', action:() => downloadCsv('elisei_pnl', ['Показатель','Значение'], [['Выручка',summary.revenue],['Себестоимость',summary.cogs],['Комиссия WB',summary.commission],['Логистика',summary.logistics],['Хранение',summary.storage],['Платная приёмка',summary.acceptance],['Эквайринг',summary.acquiring],['Штрафы',summary.penalties],['Удержания',summary.deductions],['Корректировки/доплаты',summary.additionalPayment],['Реклама',summary.advertising],['Постоянные расходы',summary.fixed],['Налог',summary.tax],['Операционная прибыль',summary.operatingProfit],['Маржа',summary.margin]]) },
    { title:'Остатки и пополнение', text:'Статусы запасов, покрытие и товары без движения.', action:() => downloadCsv('elisei_stocks', ['Артикул','Товар','Остаток','Дней запаса','Статус','Продажи 30 дней','Рекомендация'], productRows.map(p => [p.article,p.title,p.stock,p.stockCoverDays,p.status,p.salesCount,p.recommendation])) },
    { title:'Рекомендации ЭЛа', text:'Готовый список действий по цене, запасам и качеству.', action:() => downloadCsv('elisei_recommendations', ['Приоритет','Тип','Действие','Причина','Эффект'], recommendations.map((r,index) => [index+1,r.type,r.title,r.text,r.effect])) },
  ]


  const startNewElConversation = async () => {
    const previous = elConversationId
    const next = createElConversationId()
    setElConversationId(next)
    setMessages([{ role:'el', text:elSettings.character === 'professional' ? 'Новый диалог начат. Какой вопрос по кабинету проверим?' : `Новый диалог начат. Я на связи${preferredElName ? `, ${preferredElName}` : ''} — о чём думаем?`, reaction:{ mood:'happy',label:'На связи' } }])
    setElMood('happy')
    setChat('')
    if (previous) elApi.clearConversation(previous).catch(() => {})
  }

  const sendChat = async (event, forcedText = '') => {
    event?.preventDefault?.()
    const question = String(forcedText || chat).trim()
    if (!question || chatBusy) return

    const userMessage = { role:'user', text:question, createdAt:new Date().toISOString() }
    const previousMessages = messages
    setMessages(current => [...current, userMessage])
    setChat('')
    setChatBusy(true)
    setElMood('thinking')

    try {
      const period = readElPeriod()
      const clientNow = new Date()
      const clientLocalDate = `${clientNow.getFullYear()}-${String(clientNow.getMonth()+1).padStart(2,'0')}-${String(clientNow.getDate()).padStart(2,'0')}`
      const clientTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
      const result = await elApi.chat({
        message:question,
        conversationId:elConversationId,
        history:previousMessages.slice(-18).map(item => ({
          role:item.role === 'el' ? 'assistant' : 'user',
          content:item.text,
          ...(item.resolvedPeriod ? { resolvedPeriod:item.resolvedPeriod } : {}),
          ...(item.analysisContext ? { analysisContext:item.analysisContext } : {}),
          ...(item.modulesUsed ? { modulesUsed:item.modulesUsed } : {}),
        })),
        mode:elMode,
        allowWeb:elMode === 'pro' && elSettings.allowWeb,
        tone:elSettings.humor === 'off' ? 'professional' : 'adaptive_playful',
        personality:{
          character:elSettings.character, humor:elSettings.humor, support:elSettings.support,
          celebrations:elSettings.celebrations, address:elSettings.address,
          ...(elSettings.preferredName ? { preferredName:elSettings.preferredName } : {}),
          noHumorInCritical:true,
        },
        userName:preferredElName,
        clientContext:{
          localDate:clientLocalDate,
          timeZone:clientTimeZone,
          utcOffsetMinutes:-clientNow.getTimezoneOffset(),
        },
        cabinetId:connection.connectionId || 'main',
        cabinetName:user?.company || 'Основной кабинет WB',
        period,
        page:{
          section:lastBusinessSectionRef.current,
          chatSection:active,
          path:window.location.pathname,
          title:document.title,
        },
        selectedProduct:selectedProduct ? {
          nmID:selectedProduct.nmID,
          vendorCode:selectedProduct.vendorCode,
          title:selectedProduct.title,
        } : null,
        screenContext:{
          section:lastBusinessSectionRef.current,
          localHour:clientNow.getHours(),
          localDate:clientLocalDate,
          timeZone:clientTimeZone,
          period,
          summary,
          dailyTrend:(Array.isArray(analyticsCore?.dailyTrend) && analyticsCore.dailyTrend.length
            ? analyticsCore.dailyTrend
            : (Array.isArray(coreData?.dailyTrend) ? coreData.dailyTrend : [])).slice(-366),
          periodCoverage:analyticsCore?.periodCoverage || coreData?.periodCoverage || null,
          fulfillment:analyticsCore?.fulfillment || coreData?.fulfillment || null,
          advertising:advertisingSnapshot?.totals || advertisingSnapshot || null,
          lastSync:connection.lastSync || null,
        },
      })

      if (result.conversationId && result.conversationId !== elConversationId) setElConversationId(result.conversationId)
      setMessages(current => [...current, {
        role:'el',
        text:result.answer || 'Я проверил данные, но ответ не сформировался. Давай повторим вопрос.',
        sources:Array.isArray(result.sources) ? result.sources : [],
        modules:Array.isArray(result.modulesUsed) ? result.modulesUsed : [],
        modulesUsed:Array.isArray(result.modulesUsed) ? result.modulesUsed : [],
        resolvedPeriod:result.resolvedPeriod || null,
        analysisContext:result.analysisContext || null,
        usedWeb:Boolean(result.usedWeb),
        model:result.model || null,
        mode:result.mode || elMode,
        apiUsed:Boolean(result.apiUsed),
        reaction:result.reaction || null,
        grounding:result.grounding || null,
        answerKind:result.answerKind || 'analysis',
        createdAt:new Date().toISOString(),
      }])
      setElMood(result.reaction?.mood || 'happy')
    } catch (error) {
      setMessages(current => [...current, {
        role:'el',
        text:error.message || 'Не удалось получить ответ Эла. Базовый аналитик работает без OpenAI; GPT и Pro требуют подключённой допфункции и активного API-баланса.',
        error:true,
        reaction:{ mood:'concerned',label:'Нужно проверить' },
        createdAt:new Date().toISOString(),
      }])
      setElMood('concerned')
    } finally {
      setChatBusy(false)
    }
  }

  const requireConnection = children => connection.connected ? children : <div className="empty-state compact-empty"><PlugZap size={34}/><h3>Подключите Wildberries</h3><p>Раздел использует реальные данные кабинета, а не демонстрационные цифры.</p><button className="primary-btn" onClick={() => setActive('Подключения')}>Открыть подключения</button></div>

  const homeElState = useMemo(() => {
    const say = (professional, friendly, insider) => elSettings.character === 'professional'
      ? professional
      : elSettings.character === 'friendly' ? friendly : insider
    if (!connection.connected) return {
      mood:'thinking',
      title:'Готов познакомиться',
      line:say(
        'Подключите кабинет Wildberries — после этого я смогу анализировать фактические показатели.',
        'Подключим Wildberries, и я спокойно разложу кабинет по цифрам и задачам.',
        'Подключим WB — и я перестану гадать по пустому экрану. Договорились?',
      ),
    }
    const profit = Number(summary.operatingProfit)
    if (summary.operatingProfit != null && Number.isFinite(profit) && profit < 0) return {
      mood:'concerned',
      title:'Спокойно, разбираемся',
      line:say(
        'Операционная прибыль отрицательная. Сначала проверим расходы и товары, формирующие убыток.',
        'Прибыль сейчас в минусе. Без лишней тревоги: сначала найдём, где именно теряются деньги.',
        'Прибыль в минусе. Тут без шуток — сначала найдём, кто тихо ест деньги.',
      ),
    }
    const warnings = Array.isArray(coreData?.syncWarnings) ? coreData.syncWarnings : []
    if (warnings.length) return {
      mood:'thinking',
      title:'Данные под контролем',
      line:say(
        'Часть источников ожидает ответа Wildberries. Сохранённые данные доступны, повторы выполняются автоматически.',
        'Некоторые данные WB ещё в пути. Прогресс сохранён, поэтому начинаем не с нуля.',
        'WB кое-что придержал, но прогресс не пропал. Эл помнит, где остановился.',
      ),
    }
    const zeroStock = Number(summary.zeroStock || 0)
    const lowStock = Number(summary.lowStock || 0)
    if (zeroStock > 0 || lowStock > 0) return {
      mood:'thinking',
      title:'Есть задача на сегодня',
      line:say(
        `Обнаружено ${formatNumber(zeroStock)} товаров без остатка и ${formatNumber(lowStock)} с низким запасом.`,
        `Есть ${formatNumber(zeroStock)} товаров без остатка и ещё ${formatNumber(lowStock)} заканчиваются — лучше проверить поставку.`,
        `${formatNumber(zeroStock)} товаров уже без остатка, ещё ${formatNumber(lowStock)} на подходе. Склад намекает довольно прозрачно.`,
      ),
    }
    if (summary.operatingProfit != null && profit > 0) return {
      mood:'proud',
      title:'Есть чем гордиться',
      line:say(
        'Операционная прибыль положительная. Теперь можно определить товары, которые способны дать дополнительный рост.',
        'Прибыль положительная — хорошая база. Теперь посмотрим, что можно усилить.',
        'Прибыль в плюсе. Вот это уже разговор — теперь ищем, где лежит следующий рост.',
      ),
    }
    return {
      mood:'happy',
      title:'Я на связи',
      line:say(
        recommendations[0]?.title || 'Данные проверены. Готов перейти к приоритетной задаче.',
        recommendations[0]?.title || 'Я всё проверил и подготовил следующий шаг.',
        recommendations[0]?.title || 'Я всё проверил. Можно работать — и даже без драматичной музыки.',
      ),
    }
  }, [connection.connected, coreData?.syncWarnings, summary.operatingProfit, summary.zeroStock, summary.lowStock, recommendations, elSettings.character])

  const renderHome = () => <>
    <section className="brand-hero glass-panel">
      <div className="brand-hero-copy">
        <span className="brand-kicker"><Sparkles size={14}/> {connection.connected ? 'ЭЛ уже всё проверил' : 'ЭЛ готов к работе'}</span>
        <h1>{greeting},<br/><em>{displayName || 'рады вас видеть'}</em></h1>
        <p>{connection.connected
          ? `Я проверил ${formatNumber(summary.activeProducts || productRows.length)} товаров. ${coreData?.availability?.sales ? 'Продажи загружены.' : 'Продажи ожидают синхронизации.'} ${coreData?.availability?.stocks ? 'Остатки загружены.' : 'Отчёт остатков формируется отдельно.'}`
          : 'Подключите Wildberries — я соберу продажи, остатки и подготовлю план действий.'}</p>
        <div className="brand-hero-actions">
          <button className="primary-btn brand-primary" onClick={() => setActive('Спросить ЭЛа')}><MessageCircle size={18}/> Обсудить с ЭЛом</button>
          <button className="brand-secondary" onClick={() => setActive(connection.connected ? 'Аналитика' : 'Подключения')}>{connection.connected ? 'Открыть аналитику' : 'Подключить WB'} <ChevronRight size={17}/></button>
        </div>
        <div className="brand-sync"><span className="status-dot"/>{connection.connected ? `Данные обновлены ${connection.lastSync ? new Date(connection.lastSync).toLocaleString('ru-RU') : '—'}` : 'Кабинет пока не подключён'}</div>
      </div>
      <div className="brand-mascot-stage"><span className="brand-orbit one"/><span className="brand-orbit two"/><ElMascot mood={homeElState.mood}/><div className="el-speech"><strong>ЭЛ · {elCharacterMeta[elSettings.character]?.title}</strong><span>{homeElState.line}</span></div></div>
    </section>
    <section className="brand-metrics">
      <button className="brand-metric" onClick={() => setActive('Аналитика')}><span className="brand-3d-icon"><TrendingUp/></span><span><small>Выручка · 30 дней</small><strong>{formatMoney(summary.revenue)}</strong><em>{formatNumber(summary.sales)} продаж</em></span><ChevronRight/></button>
      <button className="brand-metric pink" onClick={() => setActive('Финансы')}><span className="brand-3d-icon"><CircleDollarSign/></span><span><small>Операционная прибыль</small><strong>{formatMoney(summary.operatingProfit)}</strong><em>{summary.operatingProfit == null ? 'Добавьте себестоимость' : `Маржа ${formatPercent(summary.margin)}`}</em></span><ChevronRight/></button>
      <button className="brand-metric blue" onClick={() => setActive('Товары')}><span className="brand-3d-icon"><PackageSearch/></span><span><small>Товары</small><strong>{formatNumber(summary.activeProducts || productRows.length)}</strong><em>{formatNumber(summary.zeroStock)} без остатка</em></span><ChevronRight/></button>
      <button className="brand-metric cyan" onClick={() => setActive('Остатки')}><span className="brand-3d-icon"><Boxes/></span><span><small>Остатки</small><strong>{formatNumber(summary.stockUnits)}</strong><em>{formatNumber(summary.lowStock)} заканчиваются</em></span><ChevronRight/></button>
    </section>
    <section className="brand-grid">
      <div className="el-recommendations glass-panel"><div className="brand-section-head"><div><span>ЭЛ рекомендует</span><h2>Что сделать сегодня</h2></div><button onClick={() => setActive('Спросить ЭЛа')}>Спросить ЭЛа <ChevronRight size={16}/></button></div><div className="recommendation-cards">{recommendations.slice(0,3).map((item,index) => <button className={`recommendation-tile ${recommendationTone(item.type)}`} key={item.id || index} onClick={() => setActive(item.type === 'stock' ? 'Остатки' : item.type === 'price' ? 'Цены и акции' : item.type === 'quality' ? 'Отзывы' : 'Аналитика')}><span className="rec-number">0{index+1}</span><div><small>{item.type || 'Рекомендация'}</small><h3>{item.title}</h3><p>{item.text}</p><strong>{item.effect}</strong></div><ChevronRight className="rec-arrow" size={18}/></button>)}</div></div>
      <aside className="el-profile-card glass-panel"><div className="el-profile-top"><span className="mini-el"><ElMascot compact mood={homeElState.mood}/></span><div><span>ЭЛ · AI-помощник</span><h2>{homeElState.title}</h2></div><b className="live-pill">LIVE</b></div><p>Я связываю продажи, запасы, возвраты и экономику, чтобы подсказать конкретное действие.</p><div className="el-profile-stats"><div><span>Проверено товаров</span><strong>{formatNumber(summary.activeProducts || productRows.length)}</strong></div><div><span>Задач найдено</span><strong>{recommendations.length}</strong></div><div><span>Дней запаса</span><strong>{summary.stockCoverDays ?? '—'}</strong></div></div><button className="primary-btn brand-primary" onClick={() => setActive('Спросить ЭЛа')}>Задать вопрос</button></aside>
    </section>
  </>

  const renderAnalytics = () => {
    const analyticsAvailability = analyticsCore?.availability || (!connection.connected ? coreData?.availability : {}) || {}
    const previousPeriod = previousPeriodFor(analyticsPeriod)
    const selectedDays = periodDaysBetween(analyticsPeriod)
    const selectedPeriodLabel = `${formatDate(analyticsPeriod.from)} — ${formatDate(analyticsPeriod.to)}`
    const comparisonPeriodLabel = `${formatDate(previousPeriod.from)} — ${formatDate(previousPeriod.to)}`
    const filteredCount = analyticsFilteredProducts.length
    const currentCoreReady = Boolean(analyticsCore || (!connection.connected && coreData))
    const periodCoverage = analyticsCore?.periodCoverage || null
    const salesCoverage = periodCoverage?.sales || null
    const advertisingCoverage = periodCoverage?.advertising || null
    const salesCoverageLimited = Boolean(salesCoverage?.totalRows && salesCoverage?.from && salesCoverage?.to && (analyticsPeriod.from < salesCoverage.from || analyticsPeriod.to > salesCoverage.to))
    const advertisingCoverageLimited = Boolean(advertisingCoverage?.from && advertisingCoverage?.to && (analyticsPeriod.from < advertisingCoverage.from || analyticsPeriod.to > advertisingCoverage.to))
    const metricDelta = (current,previous,fallback) => analyticsCompare
      ? (analyticsCompareCore ? comparisonLabel(current,previous,true) : 'сравнение загружается')
      : fallback

    return <section className="app-page glass-panel">
      <div className="page-title analytics-title-row">
        <div><span>Аналитика</span><h1>Центр показателей</h1><p>Показатели пересчитываются по реальному выбранному периоду и активным фильтрам.</p></div>
        <div className="analytics-title-actions"><button className="secondary-btn" onClick={exportAnalytics}><Download size={16}/> Выгрузить</button><button className="secondary-btn" disabled={analyticsLoading || !connection.connectionId} onClick={() => loadAnalyticsData(connection.connectionId,analyticsPeriod,analyticsCompare)}><RefreshCw className={analyticsLoading?'spin':''} size={16}/> Пересчитать</button></div>
      </div>

      {requireConnection(<>
        <div className="analytics-control-panel">
          <div className="analytics-period-head">
            <div><CalendarDays size={18}/><span>Период</span><strong>{selectedPeriodLabel}</strong><small>{selectedDays} дн.</small></div>
            <label className="analytics-compare-toggle"><input type="checkbox" checked={analyticsCompare} onChange={event => setAnalyticsCompare(event.target.checked)}/><span>Сравнить</span><small>{analyticsCompare ? comparisonPeriodLabel : 'выключено'}</small></label>
          </div>
          <div className="analytics-presets">
            {[['7','7 дней'],['30','30 дней'],['90','90 дней'],['month','Этот месяц'],['prevMonth','Прошлый месяц'],['year','Этот год']].map(([key,label]) => <button key={key} className={analyticsPeriod.preset===key?'active':''} onClick={() => setAnalyticsPreset(key)}>{label}</button>)}
          </div>
          <div className="analytics-date-range">
            <label><span>С</span><input type="date" value={analyticsPeriod.from} min={addDays(analyticsPeriod.to,-365)} max={analyticsPeriod.to} onChange={event => setAnalyticsPeriod(current => ({ ...current,preset:'custom',from:event.target.value }))}/></label>
            <span className="analytics-date-arrow">→</span>
            <label><span>По</span><input type="date" value={analyticsPeriod.to} min={analyticsPeriod.from} max={earlierIsoDate(isoLocalDate(new Date()),addDays(analyticsPeriod.from,365))} onChange={event => setAnalyticsPeriod(current => ({ ...current,preset:'custom',to:event.target.value }))}/></label>
          </div>
        </div>

        <div className="analytics-filter-panel">
          <label className="analytics-filter-search"><Search size={16}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Товар, артикул, nmID, бренд или категория"/></label>
          <select value={analyticsCategory} onChange={event => setAnalyticsCategory(event.target.value)}><option value="Все">Категория: все</option>{analyticsFilterOptions.categories.map(value => <option key={value}>{value}</option>)}</select>
          <select value={analyticsBrand} onChange={event => setAnalyticsBrand(event.target.value)}><option value="Все">Бренд: все</option>{analyticsFilterOptions.brands.map(value => <option key={value}>{value}</option>)}</select>
          <select value={analyticsAbc} onChange={event => setAnalyticsAbc(event.target.value)}><option value="Все">ABC: все</option><option value="A">ABC A</option><option value="B">ABC B</option><option value="C">ABC C</option></select>
          <select value={analyticsXyz} onChange={event => setAnalyticsXyz(event.target.value)}><option value="Все">XYZ: все</option><option value="X">XYZ X</option><option value="Y">XYZ Y</option><option value="Z">XYZ Z</option></select>
          <select value={analyticsStock} onChange={event => setAnalyticsStock(event.target.value)}><option value="Все">Остаток: все</option><option value="В наличии">В наличии</option><option value="Заканчиваются">Заканчиваются</option><option value="Нет остатка">Нет остатка</option><option value="Без движения">Избыток / без движения</option></select>
          <div className="analytics-filter-result"><span>{formatNumber(filteredCount)} товаров</span>{analyticsFiltersActive && <button onClick={resetAnalyticsFilters}><X size={14}/> Сбросить</button>}</div>
        </div>

        {analyticsLoading && <div className="notice info"><RefreshCw className="spin" size={20}/><div><strong>Пересчитываю выбранный период</strong><p>Выручка, продажи, возвраты, прибыль, ABC/XYZ и график загружаются заново из сохранённых данных WB.</p></div></div>}
        {analyticsError && <div className="notice warning"><AlertTriangle size={20}/><div><strong>Период не пересчитан</strong><p>{analyticsError}</p></div><button onClick={() => loadAnalyticsData(connection.connectionId,analyticsPeriod,analyticsCompare)}>Повторить</button></div>}
        {currentCoreReady && (!analyticsAvailability.orders || !analyticsAvailability.sales || !analyticsAvailability.stocks) && <div className="notice warning"><AlertTriangle size={20}/><div><strong>Не все потоки WB загружены</strong><p>{!analyticsAvailability.orders ? 'Заказы — ожидают разрешённого окна. ' : ''}{!analyticsAvailability.sales ? 'Продажи — ожидают разрешённого окна. ' : ''}{!analyticsAvailability.stocks ? 'Остатки — отчёт формируется отдельно. ' : ''}Неполученные значения не подменяются ложными нулями.</p></div><button onClick={() => setActive('Синхронизации')}>Открыть статусы</button></div>}
        {salesCoverageLimited && <div className="notice info"><AlertTriangle size={20}/><div><strong>Выбранный период шире сохранённой истории продаж</strong><p>В базе сейчас есть продажи с {formatDate(salesCoverage.from)} по {formatDate(salesCoverage.to)}. Показатели рассчитаны только по фактически сохранённым строкам; дни вне покрытия не считаются подтверждённым нулём.</p></div><button onClick={() => setActive('Синхронизации')}>Проверить загрузку</button></div>}
        {advertisingCoverageLimited && <div className="notice warning"><Megaphone size={20}/><div><strong>Реклама покрывает не весь выбранный период</strong><p>Снимок рекламы WB доступен с {formatDate(advertisingCoverage.from)} по {formatDate(advertisingCoverage.to)}. Прибыль за более широкий период считается предварительной до загрузки рекламной истории.</p></div><button onClick={() => setActive('Реклама')}>Открыть рекламу</button></div>}

        <div className="analytics-period-caption"><span>Текущий период: <strong>{selectedPeriodLabel}</strong></span>{analyticsCompare && <span>Сравнение: <strong>{comparisonPeriodLabel}</strong></span>}{analyticsFiltersActive && <span>Фильтры применены к карточкам и итогам</span>}</div>

        <div className="metrics-grid four">
          <MetricCard label="Выручка" value={formatMoney(analyticsSummary.revenue)} delta={metricDelta(analyticsSummary.revenue,analyticsCompareSummary.revenue,`${formatNumber(analyticsSummary.sales)} продаж`)} deltaTone={comparisonTone(analyticsSummary.revenue,analyticsCompareSummary.revenue,analyticsCompare && Boolean(analyticsCompareCore))} icon={TrendingUp}/>
          <MetricCard label="Заказы" value={formatNumber(analyticsSummary.orders)} delta={metricDelta(analyticsSummary.orders,analyticsCompareSummary.orders,`${formatNumber(analyticsSummary.returns)} возвратов`)} deltaTone={comparisonTone(analyticsSummary.orders,analyticsCompareSummary.orders,analyticsCompare && Boolean(analyticsCompareCore))} icon={PackageSearch}/>
          <MetricCard label="Остатки сейчас" value={formatNumber(analyticsSummary.stockUnits)} delta={`${analyticsSummary.stockCoverDays ?? '—'} дней покрытия по темпу периода`} icon={Boxes}/>
          <MetricCard label="Опер. прибыль" value={formatMoney(analyticsSummary.operatingProfit)} delta={analyticsSummary.operatingProfit == null ? 'Нужна себестоимость' : metricDelta(analyticsSummary.operatingProfit,analyticsCompareSummary.operatingProfit,`Маржа ${formatPercent(analyticsSummary.margin)}`)} deltaTone={comparisonTone(analyticsSummary.operatingProfit,analyticsCompareSummary.operatingProfit,analyticsCompare && Boolean(analyticsCompareCore))} icon={CircleDollarSign}/>
        </div>

        <div className="analytics-layout">
          <div className="chart-card inner-chart">
            <div className="card-head"><div><span>{selectedDays} дней · {selectedPeriodLabel}</span><h3>Динамика выручки</h3></div>{analyticsCompare && <div className="analytics-chart-legend"><i/><span>выбранный</span><i className="compare"/><span>предыдущий</span></div>}</div>
            <TrendChart data={analyticsTrend} comparisonData={analyticsCompare ? analyticsCompareTrend : []}/>
          </div>
          <div className="analytics-side"><h3>Ассортимент</h3><div className="insight-list">
            <div><span>ABC A</span><strong>{analyticsFilteredProducts.filter(p => p.abc === 'A').length}</strong><small>основная выручка</small></div>
            <div><span>XYZ X</span><strong>{analyticsFilteredProducts.filter(p => p.xyz === 'X').length}</strong><small>стабильный спрос</small></div>
            <div><span>Без движения</span><strong>{analyticsSummary.slowStock ?? '—'}</strong><small>нужно решение</small></div>
            <div><span>Возвраты</span><strong>{formatPercent(analyticsSummary.returnRate)}</strong><small>{formatNumber(analyticsSummary.returns)} шт.</small></div>
          </div></div>
        </div>

        <div className="section-title-row"><div><span>ABC/XYZ</span><h2>Приоритет товаров</h2></div><small>{formatNumber(filteredCount)} из {formatNumber(analyticsBaseProducts.length)}</small></div>
        <div className="data-table compact-table"><div className="data-row head analytics-row"><span>Товар</span><span>ABC</span><span>XYZ</span><span>Выручка</span><span>Продажи</span><span>Возвраты</span><span>Дней запаса</span></div>
          {analyticsFilteredProducts.length ? analyticsFilteredProducts.slice(0,100).map(p => <div className="data-row analytics-row" key={p.id}><span><strong>{p.title}</strong><small>{p.article} · {p.brand}{p.category ? ` · ${p.category}` : ''}</small></span><span><b className={`class-pill class-${String(p.abc || 'C').toLowerCase()}`}>{p.abc}</b></span><span><b className="class-pill">{p.xyz}</b></span><span>{formatMoney(p.revenue)}</span><span>{formatNumber(p.salesCount)}</span><span>{formatPercent(p.returnRate)}</span><span>{p.stockCoverDays ?? '—'}</span></div>) : <div className="product-empty">По выбранным фильтрам товаров нет.</div>}
        </div>
      </>)}
    </section>
  }

  const renderProducts = () => (
    <section className="app-page glass-panel products-page">
      <div className="page-title product-title">
        <div>
          <span>Каталог</span>
          <h1>Товары</h1>
          <p>Единая карточка товара: фото, артикулы, штрихкоды, остаток, продажи, возвраты и экономика.</p>
        </div>
        <div className="catalog-counter"><strong>{filteredProducts.length}</strong><span>товаров показано</span></div>
      </div>

      <div className="product-toolbar">
        <div className="filter-label"><SlidersHorizontal size={16}/> Фильтры</div>
        {['Все','В наличии','Заканчиваются','Нет остатка','Избыток','С продажами','Без продаж'].map(filter => (
          <button key={filter} className={productFilter===filter?'filter-chip active':'filter-chip'} onClick={() => setProductFilter(filter)}>{filter}</button>
        ))}
      </div>

      <div className="data-table product-table product-master-table">
        <div className="data-row head product-row product-master-row">
          <span>Фото / товар</span>
          <button onClick={() => changeProductSort('nmID')}>Артикул WB <SortIcon column="nmID"/></button>
          <button onClick={() => changeProductSort('vendorCode')}>Артикул продавца <SortIcon column="vendorCode"/></button>
          <span>ШК</span>
          <span>Схема</span>
          <button onClick={() => changeProductSort('stock')}>Остаток <SortIcon column="stock"/></button>
          <button onClick={() => changeProductSort('salesCount')}>Продажи <SortIcon column="salesCount"/></button>
          <span>Возвраты</span>
          <button onClick={() => changeProductSort('profit')}>Прибыль <SortIcon column="profit"/></button>
          <span>Себестоимость</span>
          <span>Затраты</span>
        </div>
        {filteredProducts.length === 0 ? (
          <div className="product-empty">По выбранным условиям товары не найдены.</div>
        ) : filteredProducts.map(p => (
          <button className="data-row product-row product-master-row product-item" key={p.id} onClick={() => setSelectedProduct(p)}>
            <span className="product-master-main">
              <span className="product-thumb">{p.photo ? <img src={p.photo} alt="" loading="lazy"/> : <PackageSearch size={22}/>}</span>
              <span className="product-name"><strong>{p.title}</strong><small>{p.brand} · {p.status}</small></span>
            </span>
            <span className="mono-cell"><strong>{p.nmID || '—'}</strong></span>
            <span className="mono-cell"><strong>{p.vendorCode || '—'}</strong></span>
            <span className="mono-cell"><strong>{p.barcode || '—'}</strong><small>{Array.isArray(p.barcodes) && p.barcodes.length > 1 ? `ещё ${p.barcodes.length-1}` : ''}</small></span>
            <span><b className={`fulfillment-pill ${String(p.fulfillmentMode || '').toLowerCase().replace(/[^a-z]+/g,'-')}`}>{p.fulfillmentMode || '—'}</b><small className="scheme-stock">FBS {formatNumber(p.fbsStock)} · FBO {formatNumber(p.fboStock)}</small></span>
            <span className={`stock-value ${p.stock==null?'unknown':p.stock===0?'zero':p.stock<10?'low':'good'}`}>{formatNumber(p.stock)}</span>
            <span>{formatNumber(p.salesCount)}</span>
            <span>{formatNumber(p.returnsCount)}</span>
            <span className={p.profit != null && p.profit < 0 ? 'negative' : 'positive'}>{formatMoney(p.profit)}</span>
            <span>{Number(p.unitCost || 0) > 0 ? formatMoney(p.unitCost) : 'Не задана'}</span>
            <span>{formatMoney(p.expenses)}</span>
          </button>
        ))}
      </div>

      {selectedProduct && (
        <div className="product-drawer-backdrop" onClick={() => setSelectedProduct(null)}>
          <aside className="product-drawer wide" onClick={event => event.stopPropagation()}>
            <button className="drawer-close" onClick={() => setSelectedProduct(null)}><X size={20}/></button>
            <div className="drawer-photo">{selectedProduct.photo ? <img src={selectedProduct.photo} alt={selectedProduct.title}/> : <PackageSearch size={44}/>}</div>
            <span className="drawer-eyebrow">{selectedProduct.brand} · {selectedProduct.abc}{selectedProduct.xyz}</span>
            <h2>{selectedProduct.title}</h2>
            <div className="product-identifiers">
              <span>Артикул WB<strong>{selectedProduct.nmID || '—'}</strong></span>
              <span>Артикул продавца<strong>{selectedProduct.vendorCode || '—'}</strong></span>
              <span>Штрихкоды<strong>{Array.isArray(selectedProduct.barcodes) && selectedProduct.barcodes.length ? selectedProduct.barcodes.join(', ') : selectedProduct.barcode || '—'}</strong></span>
              <span>Схема работы<strong>{selectedProduct.fulfillmentMode || 'Не определено'}</strong></span>
            </div>
            <div className="drawer-metrics grid">
              <div><span>Остаток общий</span><strong>{selectedProduct.stock == null ? 'Не загружено' : `${formatNumber(selectedProduct.stock)} шт.`}</strong><small>FBS {formatNumber(selectedProduct.fbsStock)} · FBO {formatNumber(selectedProduct.fboStock)}</small></div>
              <div><span>Продажи</span><strong>{formatNumber(selectedProduct.salesCount)}</strong></div>
              <div><span>Возвраты</span><strong>{formatNumber(selectedProduct.returnsCount)}</strong></div>
              <div><span>Выручка</span><strong>{formatMoney(selectedProduct.revenue)}</strong></div>
              <div><span>Прибыль</span><strong>{formatMoney(selectedProduct.profit)}</strong></div>
              <div><span>Маржа</span><strong>{formatPercent(selectedProduct.margin)}</strong></div>
            </div>
            <div className="expense-breakdown">
              <h3>Экономика товара</h3>
              <div><span>Себестоимость</span><strong>{formatMoney(selectedProduct.cogs)}</strong></div>
              <div><span>Комиссия WB</span><strong>{formatMoney(selectedProduct.commission)}</strong></div>
              <div><span>Логистика</span><strong>{formatMoney(selectedProduct.logistics)}</strong></div>
              <div><span>Хранение</span><strong>{formatMoney(selectedProduct.storage)}</strong></div>
              <div><span>Платная приёмка</span><strong>{formatMoney(selectedProduct.acceptance)}</strong></div>
              <div><span>Эквайринг</span><strong>{formatMoney(selectedProduct.acquiring)}</strong></div>
              <div><span>Штрафы и удержания</span><strong>{formatMoney((selectedProduct.penalties || 0) + (selectedProduct.deductions || 0))}</strong></div>
              <div><span>Реклама</span><strong>{formatMoney(selectedProduct.advertising)}</strong></div>
              <div><span>Налог и постоянные расходы</span><strong>{formatMoney((selectedProduct.tax || 0) + (selectedProduct.fixedExpenses || selectedProduct.sharedExpenses || 0))}</strong></div>
              {(selectedProduct.additionalPayment || 0) !== 0 && <div><span>Корректировки / доплаты</span><strong className="positive">− {formatMoney(selectedProduct.additionalPayment)}</strong></div>}
              <div className="expense-total"><span>Все затраты</span><strong>{formatMoney(selectedProduct.expenses)}</strong></div>
            </div>
            {selectedProduct.modeBreakdown && <div className="mode-economics"><h3>FBS / FBO</h3>{['FBS','FBO'].map(mode => { const row=selectedProduct.modeBreakdown?.[mode]; return row?.active ? <div className="mode-economics-row" key={mode}><b>{mode}</b><span>Выручка {formatMoney(row.revenue)}</span><span>Расходы {formatMoney(row.expenses)}</span><strong className={row.profit != null && row.profit < 0 ? 'negative':'positive'}>{formatMoney(row.profit)}</strong></div> : null })}</div>}
            <div className={`drawer-insight ${stockTone(selectedProduct.status)}`}><Sparkles size={19}/><div><strong>Рекомендация ЭЛа</strong><p>{selectedProduct.recommendation}</p></div></div>
          </aside>
        </div>
      )}
    </section>
  )

  const renderStocks = () => {
    const periodStockSummary = analyticsCore?.summary || summary
    const periodStockRows = analyticsBaseProducts.length ? analyticsBaseProducts : productRows
    const stockNeedle = query.trim().toLowerCase()
    const visibleStockRows = periodStockRows.filter(row => {
      const matchesQuery = !stockNeedle || [row.article,row.vendorCode,row.barcode,row.title,row.brand,row.nmID,row.key].join(' ').toLowerCase().includes(stockNeedle)
      const matchesStatus = productFilter === 'Все' ||
        (productFilter === 'В наличии' && row.status === 'В наличии') ||
        (productFilter === 'Заканчиваются' && row.status === 'Заканчивается') ||
        (productFilter === 'Нет остатка' && row.status === 'Нет остатка') ||
        (productFilter === 'Избыток' && ['Избыток','Без движения'].includes(row.status)) ||
        (productFilter === 'С продажами' && row.salesCount != null && Number(row.salesCount) > 0) ||
        (productFilter === 'Без продаж' && row.salesCount != null && Number(row.salesCount) === 0)
      return matchesQuery && matchesStatus
    })
    const stockState = connection.syncStates?.find(item => item.stage === 'stocks')
    const stockAvailable = Boolean(coreData?.availability?.stocks)
    const stockDetailsAvailable = Boolean(coreData?.availability?.stockDetails)
    const stockMeta = coreData?.stockMeta || null
    const unmatchedRows = Array.isArray(coreData?.unmatchedStockDetails) ? coreData.unmatchedStockDetails : []
    const nextAttempt = stockState?.nextAllowedAt ? new Date(stockState.nextAllowedAt).toLocaleString('ru-RU') : null
    const zeroSnapshot = stockAvailable && Number(stockMeta?.totalQuantity || 0) === 0
    const mappingNeedsRefresh = stockAvailable && Number(stockMeta?.totalQuantity || 0) > 0 && !stockDetailsAvailable && Boolean(stockMeta?.needsCatalogRefresh || stockMeta?.legacySnapshot)
    const missingDetails = stockAvailable && Number(stockMeta?.totalQuantity || 0) > 0 && !stockDetailsAvailable && !mappingNeedsRefresh
    const partialMapping = stockDetailsAvailable && Number(stockMeta?.unmatchedRows || 0) > 0
    const quantityMismatch = stockDetailsAvailable && Number(stockMeta?.calculatedQuantity || 0) !== Number(stockMeta?.totalQuantity || 0)
    const legacyIgnored = !stockAvailable && stockState?.lastCount > 0 && Number(stockState?.metadata?.schemaVersion || 0) < 5
    const reportHasNoIdentities = Number(stockMeta?.reportIdentityCounts?.nmIds || 0) === 0 && Number(stockMeta?.reportIdentityCounts?.barcodes || 0) === 0 && Number(stockMeta?.reportIdentityCounts?.vendorCodes || 0) === 0
    const repairStockMapping = () => reportHasNoIdentities ? repairStockSnapshot() : syncConnection(connection.connectionId, ['products'])

    return <section className="app-page glass-panel"><div className="page-title"><span>Управление запасами</span><h1>Остатки</h1><p>Дни запаса, дефицит, излишки, замороженные деньги и план пополнения.</p></div>{requireConnection(<>
      {renderSharedPeriodControls({ note:'Остаток берётся из последнего официального снимка WB, а продажи, скорость и дни запаса пересчитываются по единому выбранному периоду.' })}
      <div className="workspace-filter-bar"><label><Search size={16}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Товар, артикул, nmID, бренд или штрихкод"/></label><select value={productFilter} onChange={event => setProductFilter(event.target.value)}><option>Все</option><option>В наличии</option><option>Заканчиваются</option><option>Нет остатка</option><option>Избыток</option><option>С продажами</option><option>Без продаж</option></select><span>{formatNumber(visibleStockRows.length)} товаров</span></div>
      {!stockAvailable && <div className="notice warning"><RefreshCw size={20}/><div><strong>{legacyIgnored ? 'Старые некорректные остатки скрыты' : stockState?.status === 'pending' ? 'Отчёт остатков формируется в WB' : 'Остатки ещё не загружены'}</strong><p>{legacyIgnored ? 'Предыдущие значения не имели подтверждённого источника WB и больше не участвуют в расчётах. Дождитесь нового отчёта.' : stockState?.lastError || (nextAttempt ? `Следующая автоматическая проверка: ${nextAttempt}.` : 'Запустите отдельный этап остатков. ELISEI создаст отчёт и заберёт его в фоне.')}</p></div><button disabled={syncing || stockState?.status === 'pending'} onClick={() => syncConnection(connection.connectionId, ['stocks'])}>{stockState?.status === 'pending' ? 'Формируется' : 'Загрузить остатки'}</button></div>}
      {mappingNeedsRefresh && <div className="notice warning"><AlertTriangle size={20}/><div><strong>Остатки получены, но каталог не совпал с отчётом</strong><p>{reportHasNoIdentities ? 'Сохранённый снимок старой версии содержит количества по складам, но потерял nmID, штрихкоды и артикулы. ELISEI повторно скачает готовый отчёт по сохранённому taskId; если срок его хранения истёк, новый снимок будет поставлен в очередь.' : 'Официальный отчёт остатков сопоставляется по nmID, штрихкоду размера и артикулу продавца; chrtID для этого отчёта не требуется. ELISEI обновит каталог и повторно выполнит сопоставление уже сохранённого снимка без нового запроса остатков.'}</p><small>Отчёт: nmID {formatNumber(stockMeta?.reportIdentityCounts?.nmIds || 0)}, штрихкодов {formatNumber(stockMeta?.reportIdentityCounts?.barcodes || 0)}, артикулов {formatNumber(stockMeta?.reportIdentityCounts?.vendorCodes || 0)} · каталог: nmID {formatNumber(stockMeta?.catalogIdentityCounts?.nmIds || 0)}, штрихкодов {formatNumber(stockMeta?.catalogIdentityCounts?.barcodes || 0)}, артикулов {formatNumber(stockMeta?.catalogIdentityCounts?.vendorCodes || 0)}</small></div><button disabled={syncing} onClick={repairStockMapping}>{reportHasNoIdentities ? 'Восстановить отчёт' : 'Обновить каталог'}</button></div>}
      {missingDetails && <div className="notice warning"><AlertTriangle size={20}/><div><strong>Сумма остатков сохранена, но детализация потеряна</strong><p>WB вернул {formatNumber(stockMeta?.totalQuantity || 0)} шт., однако в базе нет строк по артикулам и складам. Общая сумма показана честно, а товары не помечаются нулевыми.</p></div><button disabled={syncing || stockState?.status === 'pending'} onClick={repairStockSnapshot}>Восстановить детализацию</button></div>}
      {partialMapping && <div className="notice warning"><AlertTriangle size={20}/><div><strong>Часть строк не сопоставлена с каталогом</strong><p>Привязано {formatNumber(stockMeta?.mappedRows || 0)} строк на {formatNumber(stockMeta?.mappedQuantity || 0)} шт.; не найдено {formatNumber(stockMeta?.unmatchedRows || 0)} строк на {formatNumber(stockMeta?.unmatchedQuantity || 0)} шт. Покрытие — {formatPercent(stockMeta?.mappingCoveragePercent)}.</p></div><button disabled={syncing || stockState?.status === 'pending'} onClick={repairStockMapping}>Повторить сопоставление</button></div>}
      {quantityMismatch && <div className="notice warning"><AlertTriangle size={20}/><div><strong>Найдена разница в сохранённом снимке</strong><p>В отчёте WB {formatNumber(stockMeta?.totalQuantity || 0)} шт., в строках детализации — {formatNumber(stockMeta?.calculatedQuantity || 0)} шт. ELISEI использует сумму отчёта и предлагает обновить детализацию.</p></div></div>}
      {zeroSnapshot && <div className="notice info"><CheckCircle2 size={20}/><div><strong>Отчёт WB загружен: остаток равен нулю</strong><p>Wildberries вернул {formatNumber(stockMeta?.rows || 0)} строк по товарам и размерам, но суммарное доступное количество — 0 шт. Это не ошибка загрузки.</p></div></div>}
      {stockAvailable && stockDetailsAvailable && !zeroSnapshot && <div className="notice success"><CheckCircle2 size={20}/><div><strong>Официальный снимок остатков WB</strong><p>{formatNumber(stockMeta?.persistedRows ?? stockMeta?.rows ?? 0)} строк · {formatNumber(stockMeta?.totalQuantity || 0)} шт. · сопоставлено {formatNumber(stockMeta?.mappedRows || 0)} строк ({formatPercent(stockMeta?.mappingCoveragePercent)}) · получено {stockMeta?.receivedAt ? new Date(stockMeta.receivedAt).toLocaleString('ru-RU') : '—'}.</p></div></div>}
      <div className="metrics-grid four"><MetricCard label="Всего единиц" value={formatNumber(periodStockSummary.stockUnits)} delta={stockAvailable ? (stockDetailsAvailable ? `${formatNumber(stockMeta?.mappedProducts || 0)} товаров сопоставлено` : 'нужно сопоставить с каталогом') : 'данные ожидаются'} icon={Boxes}/><MetricCard label="Нет остатка" value={formatNumber(periodStockSummary.zeroStock)} delta="потенциально упущенные продажи" icon={AlertTriangle}/><MetricCard label="Заканчиваются" value={formatNumber(periodStockSummary.lowStock)} delta="запас менее 14 дней" icon={Warehouse}/><MetricCard label="Избыток" value={formatNumber(periodStockSummary.slowStock)} delta="запас выше нормы" icon={PackageSearch}/></div>
      {stockAvailable && coreData?.warehouses?.length > 0 && <div className="warehouse-grid">{coreData.warehouses.slice(0,8).map(row => <div className="warehouse-card" key={row.name}><Warehouse size={18}/><span>{row.name}</span><strong>{formatNumber(row.quantity)} шт.</strong></div>)}</div>}
      <div className="data-table stock-table"><div className="data-row head stock-row"><span>Товар</span><span>Продажи</span><span>Остаток</span><span>Дней запаса</span><span>Заморожено</span><span>Статус</span><span>Что делать</span></div>{periodStockRows.length === 0 ? <div className="product-empty">Сначала загрузите каталог товаров.</div> : visibleStockRows.length === 0 ? <div className="product-empty">По выбранному периоду и фильтрам товаров нет.</div> : [...visibleStockRows].sort((a,b) => (a.stockCoverDays ?? 99999) - (b.stockCoverDays ?? 99999)).map(p => <div className="data-row stock-row" key={p.id}><span><strong>{p.title}</strong><small>{p.article}</small></span><span>{formatNumber(p.salesCount)}</span><span>{formatNumber(p.stock)}</span><span>{p.stockCoverDays ?? '—'}</span><span>{p.stock == null ? '—' : formatMoney(p.frozenMoney || 0)}</span><span><b className={`status-badge ${stockTone(p.status)}`}>{p.status}</b></span><span>{p.recommendation}</span></div>)}</div>
      {stockAvailable && coreData?.stockDetails?.length > 0 && <><div className="section-title-row"><div><span>Детализация</span><h2>По артикулам, размерам и складам</h2></div><small>{formatNumber(coreData.stockDetails.length)} строк</small></div><div className="data-table stock-detail-table"><div className="data-row head stock-detail-row"><span>Товар</span><span>Размер</span><span>nmID / штрихкод</span><span>Склад</span><span>Остаток</span></div>{coreData.stockDetails.filter(row => !stockNeedle || [row.title,row.vendorCode,row.nmID,row.barcode,row.warehouseName].join(' ').toLowerCase().includes(stockNeedle)).slice(0,500).map(row => <div className="data-row stock-detail-row" key={row.key}><span><strong>{row.title}</strong><small>{row.vendorCode || `nmID ${row.nmID || '—'}`}</small></span><span>{row.techSize || '—'}</span><span>{row.nmID || row.barcode || '—'}{row.nmID && row.barcode ? <small>{row.barcode}</small> : null}</span><span>{row.warehouseName}</span><span>{formatNumber(row.quantity)}</span></div>)}</div></>}
      {unmatchedRows.length > 0 && <><div className="section-title-row"><div><span>Диагностика</span><h2>Не сопоставленные строки WB</h2></div><small>{formatNumber(unmatchedRows.length)} строк</small></div><div className="data-table stock-detail-table"><div className="data-row head stock-detail-row"><span>Идентификатор</span><span>Размер</span><span>nmID / штрихкод</span><span>Склад</span><span>Остаток</span></div>{unmatchedRows.filter(row => !stockNeedle || [row.vendorCode,row.nmID,row.barcode,row.warehouseName].join(' ').toLowerCase().includes(stockNeedle)).slice(0,200).map(row => <div className="data-row stock-detail-row" key={row.key}><span><strong>{row.vendorCode || `nmID ${row.nmID || 'не передан'}`}</strong><small>Строка пока не привязана к карточке</small></span><span>{row.techSize || '—'}</span><span>{row.nmID || row.barcode || row.vendorCode || '—'}</span><span>{row.warehouseName}</span><span>{formatNumber(row.quantity)}</span></div>)}</div></>}
    </>)}</section>
  }

  const renderFinance = () => {
    const periodFinanceSummary = analyticsCore?.summary || summary
    const periodFinanceRows = analyticsBaseProducts.length ? analyticsBaseProducts : productRows
    const financeProductNeedle = query.trim().toLowerCase()
    const visibleFinanceProducts = periodFinanceRows.filter(row => !financeProductNeedle || [row.article,row.vendorCode,row.barcode,row.title,row.brand,row.nmID,row.key].join(' ').toLowerCase().includes(financeProductNeedle))
    const ledger = financeLedger || { rows:[],summary:{},products:[],groups:[],sources:[],timeline:[],reports:{sales:{rows:[]},acquiring:{rows:[]}},riskDetails:{},coverage:{} }
    const ledgerRows = Array.isArray(ledger.rows) ? ledger.rows : []
    const ledgerSummary = ledger.summary || {}
    const financeReady = Boolean(ledger.coverage?.financeReady || coreData?.availability?.finance)
    const financePartial = Boolean(ledger.coverage?.financePartial)
    const financeComplete = financeReady && !financePartial
    const tabs = [
      ['overview','Обзор'],['all','Все операции'],['products','По товарам'],['fbs','FBS'],['fbo','FBO'],
      ['penalties','Удержания и штрафы'],['compensations','Компенсации'],['subscriptions','Подписки и Джем'],['promotionCharges','Списания рекламы'],['reports','Отчёты WB'],['dynamics','Динамика'],['risks','Причины удержаний'],['reconciliation','Сверка с WB'],
    ]
    const groupNames = {
      sales:'Продажи',settlement:'К перечислению',commission:'Комиссия WB',logistics:'Логистика',storage:'Хранение',
      acceptance:'Приёмка',acquiring:'Эквайринг',penalties:'Штрафы',deductions:'Удержания',compensations:'Компенсации',adjustments:'Корректировки',subscriptions:'Подписки и тарифные опции',advertising:'Продвижение WB',
    }
    const sourceNames = { finance:'Финансовая детализация',acquiring:'Отчёт эквайринга',paidStorage:'Отчёт хранения',acceptance:'Отчёт приёмки',measurementPenalties:'Габариты и коэффициенты',deductionsReport:'Подмены и вложения',antifraudRetention:'Самовыкупы',labelingRetention:'Маркировка',documents:'Документы WB' }
    const productMap = new Map()
    periodFinanceRows.forEach(item => {
      if (item.nmID) productMap.set(`nm:${item.nmID}`,item)
      if (item.vendorCode) productMap.set(`vendor:${item.vendorCode}`,item)
    })
    const titleForLedger = row => productMap.get(`nm:${row.nmId}`)?.title || productMap.get(`vendor:${row.vendorCode}`)?.title || 'Финансовая операция'
    const statusText = financeComplete
      ? `Финансовая детализация WB завершена. ${formatNumber(ledgerSummary.movements || 0)} движений за ${formatDate(analyticsPeriod.from)} — ${formatDate(analyticsPeriod.to)}.`
      : financeReady
        ? `Финансовая детализация загружается частями. Уже подтверждено ${formatNumber(ledgerSummary.movements || 0)} движений; отсутствующие суммы до завершения не считаются нулём.`
        : 'Финансовый отчёт WB ещё не начат или не сохранил первую страницу. Нули не считаются подтверждёнными.'
    const financeValue = value => financeReady || Number(value || 0) !== 0 ? formatMoney(value) : 'Ожидает WB'
    const reportNumber = (row, aliases = []) => {
      for (const key of aliases) {
        const value = Number(String(row?.[key] ?? '').replace(',','.'))
        if (Number.isFinite(value)) return value
      }
      return 0
    }
    const salesReports = Array.isArray(ledger.reports?.sales?.rows) ? ledger.reports.sales.rows : []
    const acquiringReports = Array.isArray(ledger.reports?.acquiring?.rows) ? ledger.reports.acquiring.rows : []
    const timeline = Array.isArray(ledger.timeline) ? ledger.timeline : []
    const riskDetails = ledger.riskDetails || {}
    const riskRows = key => Array.isArray(riskDetails?.[key]?.rows) ? riskDetails[key].rows : []
    const timelineMax = Math.max(1,...timeline.map(row => Math.max(Math.abs(Number(row.sellerPayable || 0)),Math.abs(Number(row.expenses || 0)),Math.abs(Number(row.retentions || 0)))))
    const reportStatus = state => state?.lastSuccessAt ? `обновлено ${new Date(state.lastSuccessAt).toLocaleString('ru-RU')}` : state?.lastError || 'ожидает загрузки'

    const renderLedgerTable = () => <>
      <div className="finance-ledger-tools">
        <label className="finance-ledger-search"><Search size={16}/><input value={query} onChange={event => { setQuery(event.target.value); setFinancePage(1) }} placeholder="Операция, артикул, nmID, srid, заказ"/></label>
        <button className="secondary-btn" onClick={exportFinanceLedger}><Download size={16}/> Выгрузить показанные</button>
      </div>
      {financeLedgerLoading ? <div className="finance-ledger-empty"><RefreshCw className="spin" size={22}/> Загружаю движения денег…</div>
        : ledgerRows.length ? <div className="data-table finance-ledger-table">
          <div className="data-row head finance-ledger-row"><span>Дата</span><span>Операция</span><span>Приход / расход</span><span>Сумма</span><span>FBS/FBO</span><span>Товар</span><span>Заказ</span><span>Источник</span></div>
          {ledgerRows.map(row => <div className="data-row finance-ledger-row" key={row.movementKey}>
            <span>{formatDate(row.operationDate)}</span>
            <span><strong>{row.operationName}</strong><small>{groupNames[row.operationGroup] || row.operationGroup}{row.detailOnly ? ' · детализация без повторного счёта' : ''}</small></span>
            <span><b className={`money-direction ${row.direction}`}>{row.direction === 'income' ? 'Приход' : row.direction === 'expense' ? 'Расход' : 'Информация'}</b></span>
            <span className={row.amount < 0 ? 'negative' : row.amount > 0 ? 'positive' : ''}>{row.amount > 0 ? '+' : ''}{formatMoney(row.amount)}</span>
            <span><b className="mode-pill">{row.fulfillmentMode || '—'}</b></span>
            <span><strong>{titleForLedger(row)}</strong><small>{row.vendorCode || '—'} · nmID {row.nmId || '—'}</small></span>
            <span><strong>{row.orderId || '—'}</strong><small>{row.srid || row.warehouse || '—'}</small></span>
            <span><strong>{sourceNames[row.sourceStream] || row.sourceStream}</strong><small>{row.note || row.sourceField || 'WB API'}</small></span>
          </div>)}
        </div> : <div className="finance-ledger-empty"><WalletCards size={24}/><strong>{financeReady ? 'В выбранном фильтре операций нет' : 'Ожидает финансовые данные WB'}</strong><span>{statusText}</span></div>}
      {ledger.pagination?.pages > 1 && <div className="finance-pagination"><button disabled={financePage <= 1} onClick={() => setFinancePage(page => Math.max(1,page-1))}>Назад</button><span>Страница {ledger.pagination.page} из {ledger.pagination.pages}</span><button disabled={financePage >= ledger.pagination.pages} onClick={() => setFinancePage(page => page+1)}>Далее</button></div>}
    </>

    return <section className="app-page glass-panel">
      <div className="page-title"><span>Финансы / P&amp;L</span><h1>Все движения денег WB</h1><p>Продажи, перечисления, FBS/FBO-логистика, хранение, приёмка, эквайринг, штрафы, удержания, компенсации и корректировки — с привязкой к товару и источнику.</p></div>
      {renderSharedPeriodControls({ note:'Финансовый реестр, отчёты, динамика и P&L ограничиваются единым выбранным периодом. Поиск применяется на сервере ко всем операциям.' })}
      <div className={`notice ${financeComplete ? 'success' : 'warning'}`}><ShieldCheck size={20}/><div><strong>{financeComplete ? 'Финансовые данные подтверждены WB' : financeReady ? 'Финансовые данные загружены частично' : 'Ожидает «Финансы WB»'}</strong><p>{statusText}</p></div><button onClick={() => setActive('Синхронизации')}>Открыть статусы</button></div>
      <div className="finance-tabs">{tabs.map(([key,label]) => <button className={financeTab === key ? 'active' : ''} key={key} onClick={() => { setFinanceTab(key); setFinancePage(1) }}>{label}</button>)}</div>

      <div className="metrics-grid four finance-movement-metrics">
        <MetricCard label="К перечислению" value={financeValue(ledgerSummary.sellerPayable)} delta="поле forPay из отчёта WB" icon={WalletCards}/>
        <MetricCard label="Расходы WB" value={financeValue(ledgerSummary.expenses)} delta={`логистика ${financeValue(ledgerSummary.logistics)}`} icon={CircleDollarSign}/>
        <MetricCard label="Удержания и штрафы" value={financeValue(Number(ledgerSummary.penalties || 0)+Number(ledgerSummary.deductions || 0))} delta={`${formatNumber(ledgerSummary.movements || 0)} движений`} icon={AlertTriangle}/>
        <MetricCard label="Компенсации" value={financeValue(ledgerSummary.compensations)} delta={`FBS-логистика ${financeValue(ledgerSummary.fbsLogistics)}`} icon={TrendingUp}/>
      </div>
      <div className={`finance-jam-strip ${ledger.jam?.confirmed ? 'confirmed' : ''}`}><CreditCard size={20}/><div><strong>{ledger.jam?.confirmed ? `Списание «Джем» подтверждено: ${formatMoney(ledger.jam?.financial?.amount || 0)}` : 'Списание «Джем» пока не подтверждено'}</strong><p>{ledger.jam?.note || 'ELISEI ищет подтверждение одновременно в финансовых операциях и документах WB. Один статус подписки не считается денежным списанием.'}</p></div><span>{ledger.jam?.subscription?.active ? 'Подписка активна' : ledger.coverage?.jamSubscription?.lastSuccessAt ? 'Статус проверен' : 'Статус ожидается'}</span></div>

      {financeTab === 'overview' && <>
        <div className="finance-layout">
          <div className="settings-card"><h3><Calculator size={19}/> Резервные параметры и себестоимость</h3><p className="settings-hint">WB-расходы подставляются автоматически. Здесь остаются себестоимость, налог, постоянные расходы и fallback на случай недоступности отчёта.</p><div className="settings-grid"><label>Комиссия WB, %<input type="number" min="0" max="100" value={settingsDraft.commissionPercent ?? 0} onChange={e => updateSetting('commissionPercent',e.target.value)}/></label><label>Логистика за продажу, ₽<input type="number" min="0" value={settingsDraft.logisticsPerSale ?? 0} onChange={e => updateSetting('logisticsPerSale',e.target.value)}/></label><label>Реклама, ₽/мес.<input type="number" min="0" value={settingsDraft.advertisingMonthly ?? 0} onChange={e => updateSetting('advertisingMonthly',e.target.value)}/></label><label>Хранение, ₽/мес.<input type="number" min="0" value={settingsDraft.storageMonthly ?? 0} onChange={e => updateSetting('storageMonthly',e.target.value)}/></label><label>Постоянные расходы, ₽/мес.<input type="number" min="0" value={settingsDraft.fixedMonthly ?? 0} onChange={e => updateSetting('fixedMonthly',e.target.value)}/></label><label>Налог с выручки, %<input type="number" min="0" max="100" value={settingsDraft.taxPercent ?? 0} onChange={e => updateSetting('taxPercent',e.target.value)}/></label><label>Себестоимость по умолчанию, % цены<input type="number" min="0" max="100" value={settingsDraft.defaultCostPercent ?? 0} onChange={e => updateSetting('defaultCostPercent',e.target.value)}/></label><label>Целевая маржа, %<input type="number" min="0" max="90" value={settingsDraft.targetMarginPercent ?? 20} onChange={e => updateSetting('targetMarginPercent',e.target.value)}/></label></div><button className="primary-btn" disabled={savingSettings} onClick={saveSettings}>{savingSettings ? <RefreshCw className="spin" size={17}/> : <Save size={17}/>} Сохранить и пересчитать</button></div>
          <div className="pnl-card"><h3>P&amp;L за выбранный период</h3>{[['Выручка',periodFinanceSummary.revenue],['Себестоимость',periodFinanceSummary.cogs],['Комиссия WB',periodFinanceSummary.commission],['Логистика',periodFinanceSummary.logistics],['Хранение',periodFinanceSummary.storage],['Платная приёмка',periodFinanceSummary.acceptance],['Эквайринг',periodFinanceSummary.acquiring],['Штрафы',periodFinanceSummary.penalties],['Удержания',periodFinanceSummary.deductions],['Корректировки / доплаты',periodFinanceSummary.additionalPayment],['Реклама',periodFinanceSummary.advertising],['Постоянные расходы',periodFinanceSummary.fixed],['Налог',periodFinanceSummary.tax]].map(([label,value]) => <div className="pnl-line" key={label}><span>{label}</span><strong>{formatMoney(value)}</strong></div>)}<div className={`pnl-line total ${periodFinanceSummary.operatingProfit != null && periodFinanceSummary.operatingProfit < 0 ? 'negative' : ''}`}><span>Операционная прибыль</span><strong>{formatMoney(periodFinanceSummary.operatingProfit)}</strong></div><div className="pnl-margin"><span>Операционная маржа</span><strong>{formatPercent(periodFinanceSummary.margin)}</strong></div><div className="finance-source-note"><ShieldCheck size={16}/><span>«К перечислению» не уменьшается повторно на компоненты отчёта. Отдельные отчёты хранения, приёмки и эквайринга используются для детализации без двойного счёта.</span></div></div>
        </div>
        <div className="finance-breakdown-grid">{(ledger.groups || []).map(item => <div key={item.group}><span>{groupNames[item.group] || item.group}</span><strong>{formatMoney(item.expense || item.income)}</strong><small>{formatNumber(item.movements)} операций</small></div>)}</div>
        <div className="section-title-row"><div><span>Себестоимость</span><h2>По товарам</h2></div><button className="secondary-btn" onClick={saveSettings}><Save size={16}/> Сохранить</button></div><div className="data-table cost-table"><div className="data-row head cost-row"><span>Товар</span><span>Средняя цена</span><span>Себестоимость за единицу</span><span>Цена в ноль</span><span>Прибыль</span><span>Маржа</span></div>{visibleFinanceProducts.slice(0,100).map(p => { const costKey=String(p.key || p.nmID || p.vendorCode); const cost=settingsDraft.productCosts?.[costKey] ?? p.unitCost ?? 0; return <div className="data-row cost-row" key={p.id}><span><strong>{p.title}</strong><small>{p.article}</small></span><span>{formatMoney(p.averagePrice)}</span><span><input className="inline-cost" type="number" min="0" value={cost} onChange={e => updateProductCost(p,e.target.value)} /></span><span>{formatMoney(p.breakevenPrice)}</span><span className={p.profit != null && p.profit < 0 ? 'negative' : 'positive'}>{formatMoney(p.profit)}</span><span>{formatPercent(p.margin)}</span></div>})}</div>
      </>}

      {financeTab === 'products' && <div className="data-table finance-products-table"><div className="data-row head finance-products-row"><span>Товар</span><span>Схема</span><span>К перечислению</span><span>Расходы WB</span><span>Логистика</span><span>Штрафы</span><span>Удержания</span><span>Компенсации</span></div>{(ledger.products || []).map(row => <div className="data-row finance-products-row" key={`${row.nmId}-${row.vendorCode}-${row.fulfillmentMode}`}><span><strong>{titleForLedger(row)}</strong><small>{row.vendorCode || '—'} · nmID {row.nmId || '—'}</small></span><span><b className="mode-pill">{row.fulfillmentMode || '—'}</b></span><span>{formatMoney(row.sellerPayable)}</span><span>{formatMoney(row.expenses)}</span><span>{formatMoney(row.logistics)}</span><span>{formatMoney(row.penalties)}</span><span>{formatMoney(row.deductions)}</span><span>{formatMoney(row.compensations)}</span></div>)}</div>}

      {financeTab === 'reports' && <div className="finance-report-layout">
        <div className="finance-report-card"><div className="finance-report-head"><div><span>Официальные сводки</span><h3>Отчёты реализации</h3></div><b>{formatNumber(ledger.reports?.sales?.totalRows || salesReports.length)}</b></div>{salesReports.length ? <div className="data-table finance-report-table"><div className="data-row head finance-report-row"><span>Период / ID</span><span>Розница</span><span>К перечислению</span><span>Логистика</span><span>Хранение</span><span>Приёмка</span><span>Штрафы и удержания</span><span>Банк</span></div>{salesReports.map((row,index) => <div className="data-row finance-report-row" key={row.reportId || index}><span><strong>{formatDate(row.dateFrom)} — {formatDate(row.dateTo)}</strong><small>№ {row.reportId || '—'} · создан {formatDate(row.createDate)}</small></span><span>{formatMoney(reportNumber(row,['retailAmountSum']))}</span><span>{formatMoney(reportNumber(row,['forPaySum']))}</span><span>{formatMoney(reportNumber(row,['deliveryServiceSum']))}</span><span>{formatMoney(reportNumber(row,['paidStorageSum']))}</span><span>{formatMoney(reportNumber(row,['paidAcceptanceSum']))}</span><span>{formatMoney(reportNumber(row,['penaltySum'])+reportNumber(row,['deductionSum']))}<small>штраф {formatMoney(reportNumber(row,['penaltySum']))} · удержание {formatMoney(reportNumber(row,['deductionSum']))}</small></span><span>{formatMoney(reportNumber(row,['bankPaymentSum']))}</span></div>)}</div> : <div className="finance-ledger-empty"><FileText size={24}/><strong>Сводки реализации ещё не загружены</strong><span>{reportStatus(ledger.coverage?.financeReports)}</span></div>}</div>
        <div className="finance-report-card"><div className="finance-report-head"><div><span>Контроль платежей</span><h3>Отчёты эквайринга</h3></div><b>{formatNumber(ledger.reports?.acquiring?.totalRows || acquiringReports.length)}</b></div>{acquiringReports.length ? <div className="data-table acquiring-report-table"><div className="data-row head acquiring-report-row"><span>Период / ID</span><span>Комиссия эквайринга</span><span>НДС</span><span>Всего</span></div>{acquiringReports.map((row,index) => { const fee=reportNumber(row,['acquiringFeeSum']); const vat=reportNumber(row,['acquiringFeeVatSum']); return <div className="data-row acquiring-report-row" key={row.reportId || index}><span><strong>{formatDate(row.dateFrom)} — {formatDate(row.dateTo)}</strong><small>№ {row.reportId || '—'} · {row.currency || 'RUB'}</small></span><span>{formatMoney(fee)}</span><span>{formatMoney(vat)}</span><span>{formatMoney(fee+vat)}</span></div>})}</div> : <div className="finance-ledger-empty"><CreditCard size={24}/><strong>Сводки эквайринга ещё не загружены</strong><span>{reportStatus(ledger.coverage?.acquiringReports)}</span></div>}</div>
      </div>}

      {financeTab === 'dynamics' && <div className="finance-dynamics-card"><div className="section-title-row"><div><span>День за днём</span><h2>Движение денег</h2></div><small>{formatNumber(timeline.length)} дней</small></div>{timeline.length ? <div className="finance-timeline">{timeline.map(row => <div className="finance-timeline-row" key={String(row.date)}><span>{formatDate(row.date)}</span><div className="finance-timeline-bars"><i className="payable" style={{width:`${Math.max(2,Math.abs(Number(row.sellerPayable || 0))/timelineMax*100)}%`}} title={`К перечислению: ${formatMoney(row.sellerPayable)}`}></i><i className="expense" style={{width:`${Math.max(2,Math.abs(Number(row.expenses || 0))/timelineMax*100)}%`}} title={`Расходы: ${formatMoney(row.expenses)}`}></i><i className="retention" style={{width:`${Math.max(2,Math.abs(Number(row.retentions || 0))/timelineMax*100)}%`}} title={`Удержания: ${formatMoney(row.retentions)}`}></i></div><strong>{formatMoney(row.sellerPayable)}</strong><small>расходы {formatMoney(row.expenses)} · удержания {formatMoney(row.retentions)}</small></div>)}</div> : <div className="finance-ledger-empty"><TrendingUp size={24}/><strong>Динамика появится после финансовой детализации</strong><span>ELISEI строит её по датам операций WB, а не по дате загрузки файла.</span></div>}<div className="finance-timeline-legend"><span><i className="payable"></i>К перечислению</span><span><i className="expense"></i>Расходы</span><span><i className="retention"></i>Штрафы и удержания</span></div></div>}

      {financeTab === 'risks' && <div className="finance-risks-layout"><div className="finance-risk-summary">{[
        ['measurementPenalties','Габариты и коэффициенты',riskDetails.measurementPenalties?.totalRows,ledger.coverage?.measurementPenalties],
        ['warehouseMeasurements','Замеры склада',riskDetails.warehouseMeasurements?.totalRows,ledger.coverage?.warehouseMeasurements],
        ['deductions','Подмены и вложения',riskDetails.deductions?.totalRows,ledger.coverage?.deductionsReport],
        ['antifraud','Самовыкупы',riskDetails.antifraud?.totalRows,ledger.coverage?.antifraudRetention],
        ['labeling','Маркировка',riskDetails.labeling?.totalRows,ledger.coverage?.labelingRetention],
      ].map(([key,label,count,state]) => <div key={key}><span>{label}</span><strong>{state?.lastSuccessAt ? formatNumber(count || 0) : 'Ожидает WB'}</strong><small>{reportStatus(state)}</small></div>)}</div>
        <div className="finance-risk-sections">
          {riskRows('measurementPenalties').length > 0 && <div className="finance-risk-card"><h3>Штрафы за габариты</h3>{riskRows('measurementPenalties').slice(0,30).map((row,index) => <div key={row.dimId || index}><span><strong>nmID {row.nmId || row.nmID || '—'}</strong><small>{row.subjectName || 'Товар'} · {formatDate(row.dtBonus || row.date)}</small></span><b>{formatMoney(reportNumber(row,['penaltyAmount','amount']))}</b></div>)}</div>}
          {riskRows('warehouseMeasurements').length > 0 && <div className="finance-risk-card"><h3>Фактические замеры склада</h3>{riskRows('warehouseMeasurements').slice(0,30).map((row,index) => <div key={row.dimId || index}><span><strong>nmID {row.nmId || row.nmID || '—'}</strong><small>{row.subjectName || 'Товар'} · {row.length || '—'}×{row.width || '—'}×{row.height || '—'} см · {formatDate(row.dt)}</small></span><b>{row.volume != null ? `${row.volume} л` : '—'}</b></div>)}</div>}
          {riskRows('antifraud').length > 0 && <div className="finance-risk-card"><h3>Удержания за самовыкупы</h3>{riskRows('antifraud').slice(0,30).map((row,index) => <div key={`${row.nmID || row.nmId}-${index}`}><span><strong>nmID {row.nmID || row.nmId || '—'}</strong><small>{formatDate(row.dateFrom)} — {formatDate(row.dateTo)}</small></span><b>{formatMoney(reportNumber(row,['sum','amount']))}</b></div>)}</div>}
          {riskRows('labeling').length > 0 && <div className="finance-risk-card"><h3>Нарушения маркировки</h3>{riskRows('labeling').slice(0,30).map((row,index) => <div key={`${row.shkID || row.sku}-${index}`}><span><strong>nmID {row.nmID || row.nmId || '—'}</strong><small>ШК {row.sku || row.shkID || '—'} · {formatDate(row.date)}</small></span><b>{formatMoney(reportNumber(row,['amount']))}</b></div>)}</div>}
          {!['measurementPenalties','warehouseMeasurements','deductions','antifraud','labeling'].some(key => riskRows(key).length) && <div className="finance-ledger-empty"><ShieldCheck size={24}/><strong>Детализация причин пока не загружена</strong><span>Отсутствие строк не считается подтверждённым нулём, пока соответствующий поток WB не завершён.</span></div>}
        </div>
      </div>}

      {financeTab === 'reconciliation' && <div className="reconciliation-layout"><div className="pnl-card"><h3>Сверка с отчётом WB</h3><div className="pnl-line"><span>Розничная сумма операций</span><strong>{financeValue(ledgerSummary.grossRevenue)}</strong></div><div className="pnl-line"><span>Расходные компоненты</span><strong>{financeValue(ledgerSummary.expenses)}</strong></div><div className="pnl-line"><span>Компенсации и доплаты</span><strong>{financeValue(ledgerSummary.compensations)}</strong></div><div className="pnl-line"><span>Расчёт по компонентам</span><strong>{financeValue(ledgerSummary.componentNet)}</strong></div><div className="pnl-line total"><span>WB: к перечислению продавцу</span><strong>{financeValue(ledgerSummary.sellerPayable)}</strong></div><div className={`pnl-margin ${Math.abs(Number(ledgerSummary.reconciliationDifference || 0)) > 1 ? 'warning' : ''}`}><span>Контрольная разница</span><strong>{financeValue(ledgerSummary.reconciliationDifference)}</strong></div><p className="settings-hint">Разница может включать специальные операции WB, скидочные механики и поля, которые не являются отдельным денежным удержанием. Все исходные операции остаются в реестре.</p></div><div className="settings-card"><h3>Покрытие источников</h3><div className="finance-sources-list">{(ledger.sources || []).map(item => <div key={item.stream}><span>{sourceNames[item.stream] || item.stream}</span><strong>{formatNumber(item.movements)} движений</strong><small>{item.updatedAt ? new Date(item.updatedAt).toLocaleString('ru-RU') : 'не загружено'}</small></div>)}</div></div></div>}

      {!['overview','products','reports','dynamics','risks','reconciliation'].includes(financeTab) && renderLedgerTable()}
    </section>
  }

  const renderDocuments = () => {
    const payload=documentsData?.payload || {}
    const rows=Array.isArray(documentsData?.rows) ? documentsData.rows : (Array.isArray(payload.rows) ? payload.rows : [])
    const state=documentsData?.state || connection.syncStates?.find(item=>item.stage === 'documents') || null
    const summary=payload.summary || {total:documentsData?.total || rows.length,downloadable:rows.filter(row=>row.downloadable).length,categories:0,jamDocuments:0}
    const categories=['Все',...new Set(rows.map(row=>row.category || row.categoryId || 'Без категории'))]
    const visible=rows.filter(row=>documentsCategory === 'Все' || (row.category || row.categoryId || 'Без категории') === documentsCategory)
    const complete=payload.complete !== false
    const nextAttempt=state?.nextAllowedAt || payload.nextAllowedAt
    return <section className="app-page glass-panel">
      <div className="page-title"><span>Документы Wildberries</span><h1>Акты, отчёты и подтверждения списаний</h1><p>Категории документов, номера, периоды и безопасное скачивание. Документы «Джем» связываются с финансовым реестром только как подтверждающий источник.</p></div>
      {renderSharedPeriodControls({note:'Список документов ограничивается единым периодом кабинета. Для Базового токена WB может разрешать продолжение списка только после суточной паузы.'})}
      <div className={`notice ${state?.lastSuccessAt || Number(summary.total || 0) > 0 ? 'success' : 'warning'}`}><FileText size={20}/><div><strong>{Number(summary.total || 0) > 0 ? `Найдено документов: ${formatNumber(summary.total)}` : 'Документы пока не подтверждены'}</strong><p>{complete ? 'Проверенный список сохранён в ELISEI.' : `Список загружен частично${nextAttempt ? `; продолжение после ${new Date(nextAttempt).toLocaleString('ru-RU')}` : ''}. Уже сохранённые документы доступны.`}</p></div><button onClick={()=>syncConnection(connection.connectionId,['documents'],{period:analyticsPeriod})} disabled={syncing || (nextAttempt && new Date(nextAttempt).getTime()>Date.now())}>{syncing?'Загрузка':'Обновить документы'}</button></div>
      <div className="metrics-grid four finance-movement-metrics">
        <MetricCard label="Всего документов" value={formatNumber(summary.total || 0)} delta={complete?'покрытие завершено':'загрузка продолжается'} icon={FileText}/>
        <MetricCard label="Можно скачать" value={formatNumber(summary.downloadable || 0)} delta="через защищённый backend" icon={Download}/>
        <MetricCard label="Категории" value={formatNumber(summary.categories || categories.length-1)} delta={payload.categories?.length ? 'справочник WB загружен' : 'по найденным документам'} icon={Tag}/>
        <MetricCard label="Связано с Джем" value={state?.lastSuccessAt ? formatNumber(summary.jamDocuments || 0) : 'Ожидает WB'} delta="не считается списанием без финансового факта" icon={CreditCard}/>
      </div>
      <div className="documents-toolbar"><label><Search size={16}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Название, номер, категория или период"/></label><select value={documentsCategory} onChange={event=>setDocumentsCategory(event.target.value)}>{categories.map(category=><option key={category}>{category}</option>)}</select><span>{formatNumber(visible.length)} показано</span></div>
      {documentsLoading ? <div className="finance-ledger-empty"><RefreshCw className="spin" size={22}/> Загружаю документы…</div> : visible.length ? <div className="data-table documents-table"><div className="data-row head documents-row"><span>Дата</span><span>Категория / документ</span><span>Номер и период</span><span>Формат</span><span>Действие</span></div>{visible.map((row,index)=>{ const key=`${row.serviceName || index}.${row.extension || ''}`; return <div className="data-row documents-row" key={key}><span>{formatDate(row.createdAt || row.date)}</span><span><strong>{row.category || 'Документ WB'}</strong><small>{row.title || row.name || row.serviceName || '—'}{row.isJam ? ' · Джем' : ''}</small></span><span><strong>{row.documentNumber || 'Без номера'}</strong><small>{row.periodFrom || row.periodTo ? `${formatDate(row.periodFrom)} — ${formatDate(row.periodTo)}` : 'Период не указан'}</small></span><span><b className="mode-pill">{String(row.extension || '—').toUpperCase()}</b></span><span>{row.downloadable ? <button className="secondary-btn document-download" disabled={documentDownloading === key} onClick={()=>downloadWbDocument(row)}>{documentDownloading === key ? <RefreshCw className="spin" size={15}/> : <Download size={15}/>} Скачать</button> : <small>WB не дал файл</small>}</span></div>})}</div> : <div className="finance-ledger-empty"><FileText size={24}/><strong>{state?.lastSuccessAt ? 'В выбранном периоде документов нет' : 'Ожидает документы WB'}</strong><span>{state?.lastError || 'Запустите поток «Документы WB». Отсутствие строк до завершения загрузки не считается подтверждённым нулём.'}</span></div>}
    </section>
  }

  const renderPricing = () => <section className="app-page glass-panel"><div className="page-title"><span>Ценообразование</span><h1>Цены и акции</h1><p>Цена в ноль, целевая цена, цена пика и безопасные сценарии скидок.</p></div>{summary.cogs == null && <div className="notice warning"><AlertTriangle size={20}/><div><strong>Добавьте себестоимость</strong><p>Без неё невозможно честно определить убыточные скидки.</p></div><button onClick={() => setActive('Финансы')}>Открыть финансы</button></div>}<div className="data-table pricing-table"><div className="data-row head pricing-row"><span>Товар</span><span>Текущая/средняя</span><span>Цена в 0</span><span>Целевая</span><span>Пик</span><span>−20%</span><span>−40%</span><span>Решение</span></div>{productRows.map(p => { const base=p.averagePrice || p.targetPrice || 0; const discount20=base*.8; const discount40=base*.6; return <div className="data-row pricing-row" key={p.id}><span><strong>{p.title}</strong><small>{p.article}</small></span><span>{formatMoney(base)}</span><span>{formatMoney(p.breakevenPrice)}</span><span>{formatMoney(p.targetPrice)}</span><span>{formatMoney(p.peakPrice)}</span><span className={p.breakevenPrice && discount20 < p.breakevenPrice ? 'negative' : 'positive'}>{formatMoney(discount20)}</span><span className={p.breakevenPrice && discount40 < p.breakevenPrice ? 'negative' : 'positive'}>{formatMoney(discount40)}</span><span>{p.profit != null && p.profit < 0 ? 'Повысить цену / снизить расходы' : p.status === 'Избыток' ? 'Допустима контролируемая акция' : 'Сохранять цену'}</span></div>})}</div></section>

  const renderAdvertising = () => {
    const advertising = advertisingSnapshot || coreData?.advertising || { campaigns:[], productRows:[], daily:[], totals:{}, source:'manual' }
    const campaigns = Array.isArray(advertising.campaigns) ? advertising.campaigns : []
    const adProductRows = Array.isArray(advertising.productRows) ? advertising.productRows : []
    const daily = Array.isArray(advertising.daily) ? advertising.daily : []
    const totals = advertising.totals || {}
    const advertisingState = (connection.syncStates || []).find(item => item.stage === 'advertising')
    const apiAvailable = Boolean(coreData?.availability?.advertising || campaigns.length > 0 || Number(advertisingState?.lastCount || 0) > 0)
    const statsAvailable = Boolean(advertising.statsAvailable)
    const hasPromotionToken = connection.scopes?.includes('promotion')
    const statusName = status => ({ 4:'Готова', 7:'Завершена', 8:'Отменена', 9:'Активна', 11:'На паузе', '-1':'Удалена' }[String(status)] || 'Неизвестно')
    const statusTone = status => Number(status) === 9 ? 'success' : Number(status) === 11 ? 'warning' : Number(status) === 8 || Number(status) === -1 ? 'danger' : 'info'
    const needle = query.trim().toLowerCase()
    const matchStatus = row => advertisingStatusFilter === 'all' || String(row.status) === advertisingStatusFilter
    const filteredProducts = adProductRows.filter(row => matchStatus(row) && (!needle || [row.campaignName,row.advertId,row.nmID,row.vendorCode,row.title,row.barcode].some(value => String(value || '').toLowerCase().includes(needle))))
    const filteredCampaigns = campaigns.filter(row => matchStatus(row) && (!needle || [row.name,row.advertId,...(row.nmIds || [])].some(value => String(value || '').toLowerCase().includes(needle))))
    const spend = statsAvailable ? Number(totals.spend || 0) : null
    const exportRows = () => {
      let headers = []
      let rows = []
      let filename = `elisei-advertising-${analyticsPeriod.from}-${analyticsPeriod.to}.csv`
      if (advertisingTab === 'campaigns') {
        headers = ['ID кампании','Название','Статус','Артикулы WB','Расход','Показы','Клики','Заказы','Выручка','CTR','CPC','CRR','ROMI','Конверсия в заказ']
        rows = filteredCampaigns.map(row => [row.advertId,row.name,statusName(row.status),(row.nmIds || []).join(', '),row.spend,row.views,row.clicks,row.orders,row.revenue,row.ctr,row.cpc,row.crr,row.romi,row.orderConversion])
        filename = `elisei-advertising-campaigns-${analyticsPeriod.from}-${analyticsPeriod.to}.csv`
      } else if (advertisingTab === 'dynamics') {
        headers = ['Дата','Расход','Показы','Клики','Заказы','Выручка','CTR','CPC','CRR','ROMI']
        rows = daily.map(row => [row.date,row.spend,row.views,row.clicks,row.orders,row.revenue,row.ctr,row.cpc,row.crr,row.romi])
        filename = `elisei-advertising-daily-${analyticsPeriod.from}-${analyticsPeriod.to}.csv`
      } else {
        headers = ['Кампания','ID кампании','Статус','nmID','Артикул продавца','Товар','Штрихкод','Расход','Показы','Клики','Заказы','Выручка','CTR','CPC','CRR','ROMI','Конверсия в заказ','Привязан к каталогу']
        rows = filteredProducts.map(row => [row.campaignName,row.advertId,statusName(row.status),row.nmID,row.vendorCode,row.title,row.barcode,row.spend,row.views,row.clicks,row.orders,row.revenue,row.ctr,row.cpc,row.crr,row.romi,row.orderConversion,row.mapped?'Да':'Нет'])
        filename = `elisei-advertising-products-${analyticsPeriod.from}-${analyticsPeriod.to}.csv`
      }
      if (!rows.length) return notify('В выбранном разделе рекламы пока нет строк для выгрузки.')
      const lines = [headers.map(csvCell).join(';'),...rows.map(row=>row.map(csvCell).join(';'))]
      const blob = new Blob([`\uFEFF${lines.join('\n')}`],{type:'text/csv;charset=utf-8'})
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      anchor.click()
      URL.revokeObjectURL(url)
    }
    const tabs = [['overview','Обзор'],['products','По товарам'],['campaigns','Кампании'],['dynamics','Динамика']]
    const trendLabels = { spend:'Расход', revenue:'Выручка', clicks:'Клики', orders:'Заказы', romi:'ROMI' }

    return <section className="app-page glass-panel advertising-workspace">
      <div className="page-title"><span>WB Продвижение</span><h1>Полная реклама</h1><p>Кампании, товары и дневная динамика в едином блоке. Расходы связываются с nmID и входят в прибыль конкретного товара.</p></div>
      {renderSharedPeriodControls({ maxDays:31,note:'Рекламные показатели, кампании и дневная динамика фильтруются по единому периоду.' })}
      {advertisingCoverage && !advertisingCoverage.exact && <div className="notice warning"><AlertTriangle size={20}/><div><strong>Покрытие рекламы неполное</strong><p>В базе есть статистика за {formatDate(advertisingCoverage.available?.from)} — {formatDate(advertisingCoverage.available?.to)}. За остальные даты ELISEI не подставляет нули.</p></div><button disabled={syncing} onClick={() => syncConnection(connection.connectionId,['advertising'],{ period:analyticsPeriod })}>Загрузить выбранный период</button></div>}
      <div className="metrics-grid four">
        <MetricCard label="Расходы" value={statsAvailable?formatMoney(spend):'Не загружено'} delta={statsAvailable?'фактически по API WB':'статистика ожидается'} icon={Megaphone}/>
        <MetricCard label="Выручка из рекламы" value={statsAvailable?formatMoney(totals.revenue):'Не загружено'} delta={statsAvailable?`${formatNumber(totals.orders)} заказов`:'не показываем ложный ноль'} icon={TrendingUp}/>
        <MetricCard label="CRR" value={statsAvailable?formatPercent(totals.crr):'—'} delta={statsAvailable?`CPC ${formatMoney(totals.cpc)}`:'ожидает fullstats'} icon={Percent}/>
        <MetricCard label="ROMI" value={statsAvailable?formatPercent(totals.romi):'—'} delta={statsAvailable?`Конверсия ${formatPercent(totals.orderConversion)}`:'ожидает статистику'} icon={CircleDollarSign}/>
      </div>

      {!hasPromotionToken && <div className="notice warning"><AlertTriangle size={20}/><div><strong>Не подключена категория «Продвижение»</strong><p>Добавьте API-токен WB с этой категорией. Новый магазин создавать не нужно.</p></div><button onClick={() => setActive('Подключения')}>Добавить токен</button></div>}
      {hasPromotionToken && !apiAvailable && <div className="notice"><RefreshCw size={20}/><div><strong>Рекламный токен подключён</strong><p>Запустите отдельный этап «Реклама».</p></div><button onClick={() => syncConnection(connection.connectionId, ['advertising'], { period:analyticsPeriod })}>Синхронизировать</button></div>}
      {apiAvailable && campaigns.length > 0 && !statsAvailable && <div className="notice warning"><AlertTriangle size={20}/><div><strong>Кампании загружены, статистика ещё ожидается</strong><p>ELISEI видит {formatNumber(advertising.totalCampaigns || campaigns.length)} кампаний. Неполученные расходы не заменяются нулями и не входят в P&amp;L.</p></div><button onClick={() => syncConnection(connection.connectionId, ['advertising'], { period:analyticsPeriod })}>Обновить статистику</button></div>}

      <div className="finance-tabs ad-workspace-tabs">{tabs.map(([key,label])=><button key={key} className={advertisingTab===key?'active':''} onClick={()=>setAdvertisingTab(key)}>{label}</button>)}</div>
      <div className="ad-filter-bar">
        <div className="ad-search"><Search size={16}/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Кампания, nmID, артикул или товар"/></div>
        <select className="ad-status-filter" value={advertisingStatusFilter} onChange={event=>setAdvertisingStatusFilter(event.target.value)}><option value="all">Все статусы</option><option value="9">Активные</option><option value="11">На паузе</option><option value="7">Завершённые</option><option value="4">Готовые</option><option value="8">Отменённые</option></select>
        <button className="secondary-btn" disabled={syncing || !hasPromotionToken} onClick={()=>syncConnection(connection.connectionId,['advertising'],{ period:analyticsPeriod })}><RefreshCw size={16} className={syncing?'spin':''}/> Обновить</button>
        <button className="secondary-btn" onClick={exportRows}><Download size={16}/> CSV</button>
      </div>

      {advertisingTab === 'overview' && <div className="ad-overview-grid">
        <div className="chart-card ad-chart-card"><div className="card-head"><div><span>{formatDate(analyticsPeriod.from)} — {formatDate(analyticsPeriod.to)}</span><h3>Расход и результат</h3></div><div className="ad-trend-switch">{Object.entries(trendLabels).map(([key,label])=><button key={key} className={advertisingTrendMetric===key?'active':''} onClick={()=>setAdvertisingTrendMetric(key)}>{label}</button>)}</div></div><TrendChart data={daily} valueKey={advertisingTrendMetric} emptyText="Дневная статистика рекламы ещё не загружена"/></div>
        <div className="ad-breakdown-card"><h3>Воронка рекламы</h3><div className="ad-funnel-list"><div><span>Показы</span><strong>{statsAvailable?formatNumber(totals.views):'—'}</strong></div><div><span>Клики</span><strong>{statsAvailable?formatNumber(totals.clicks):'—'}</strong><small>CTR {formatPercent(totals.ctr)}</small></div><div><span>Заказы</span><strong>{statsAvailable?formatNumber(totals.orders):'—'}</strong><small>{formatPercent(totals.orderConversion)} от кликов</small></div><div><span>Выручка</span><strong>{statsAvailable?formatMoney(totals.revenue):'—'}</strong><small>CRR {formatPercent(totals.crr)}</small></div></div></div>
        <div className="ad-breakdown-card"><h3>Покрытие данных</h3><div className="ad-funnel-list"><div><span>Всего кампаний</span><strong>{formatNumber(advertising.totalCampaigns || campaigns.length)}</strong></div><div><span>Со статистикой</span><strong>{formatNumber(advertising.statsLoadedCampaigns || 0)}</strong></div><div><span>Ожидают данные</span><strong>{formatNumber(advertising.statsPendingCampaigns || 0)}</strong></div><div><span>Привязано к товарам</span><strong>{formatNumber(advertising.mappedProductRows || adProductRows.filter(row=>row.mapped).length)}</strong></div></div></div>
      </div>}

      {advertisingTab === 'products' && <div className="data-table ad-product-table"><div className="data-row head ad-full-product-row"><span>Кампания / товар</span><span>Артикулы</span><span>Расход</span><span>Показы</span><span>Клики</span><span>Заказы</span><span>Выручка</span><span>CTR</span><span>CPC</span><span>CRR</span><span>ROMI</span></div>{filteredProducts.length ? [...filteredProducts].sort((a,b)=>Number(b.spend||0)-Number(a.spend||0)).map(item=><div className="data-row ad-full-product-row" key={item.key}><span><strong>{item.title}</strong><small>{item.campaignName} · ID {item.advertId} · {statusName(item.status)}</small></span><span><strong>nmID {item.nmID || '—'}</strong><small>{item.vendorCode || 'артикул не найден'}{item.barcode?` · ШК ${item.barcode}`:''}</small></span><span>{formatMoney(item.spend)}</span><span>{formatNumber(item.views)}</span><span>{formatNumber(item.clicks)}</span><span>{formatNumber(item.orders)}</span><span>{formatMoney(item.revenue)}</span><span>{formatPercent(item.ctr)}</span><span>{formatMoney(item.cpc)}</span><span>{formatPercent(item.crr)}</span><span className={Number(item.romi||0)<0?'negative':'positive'}>{formatPercent(item.romi)}</span></div>) : <div className="product-empty">По выбранным фильтрам рекламных товаров нет.</div>}</div>}

      {advertisingTab === 'campaigns' && <div className="data-table ad-table"><div className="data-row head ad-full-campaign-row"><span>Кампания</span><span>Статус</span><span>Артикулы</span><span>Расход</span><span>Клики</span><span>Заказы</span><span>Выручка</span><span>CRR</span><span>ROMI</span></div>{filteredCampaigns.length ? [...filteredCampaigns].sort((a,b)=>Number(b.spend||0)-Number(a.spend||0)).map(item=><div className="data-row ad-full-campaign-row" key={item.advertId}><span><strong>{item.name}</strong><small>ID {item.advertId} · {item.statsStatus==='loaded'?'статистика загружена':'ожидает статистику'}</small></span><span><b className={`status-badge ${statusTone(item.status)}`}>{statusName(item.status)}</b></span><span>{Array.isArray(item.nmIds)&&item.nmIds.length?item.nmIds.slice(0,5).join(', '):'—'}</span><span>{formatMoney(item.spend)}</span><span>{formatNumber(item.clicks)}</span><span>{formatNumber(item.orders)}</span><span>{formatMoney(item.revenue)}</span><span>{formatPercent(item.crr)}</span><span className={Number(item.romi||0)<0?'negative':'positive'}>{formatPercent(item.romi)}</span></div>) : <div className="product-empty">По выбранным фильтрам кампаний нет.</div>}</div>}

      {advertisingTab === 'dynamics' && <><div className="chart-card ad-chart-card ad-dynamics-chart"><div className="card-head"><div><span>По дням</span><h3>{trendLabels[advertisingTrendMetric]}</h3></div><div className="ad-trend-switch">{Object.entries(trendLabels).map(([key,label])=><button key={key} className={advertisingTrendMetric===key?'active':''} onClick={()=>setAdvertisingTrendMetric(key)}>{label}</button>)}</div></div><TrendChart data={daily} valueKey={advertisingTrendMetric} emptyText="Дневная статистика рекламы ещё не загружена"/></div><div className="data-table"><div className="data-row head ad-daily-row"><span>Дата</span><span>Расход</span><span>Показы</span><span>Клики</span><span>Заказы</span><span>Выручка</span><span>CTR</span><span>CPC</span><span>CRR</span><span>ROMI</span></div>{daily.length ? daily.map(row=><div className="data-row ad-daily-row" key={row.date}><span>{formatDate(row.date)}</span><span>{formatMoney(row.spend)}</span><span>{formatNumber(row.views)}</span><span>{formatNumber(row.clicks)}</span><span>{formatNumber(row.orders)}</span><span>{formatMoney(row.revenue)}</span><span>{formatPercent(row.ctr)}</span><span>{formatMoney(row.cpc)}</span><span>{formatPercent(row.crr)}</span><span className={Number(row.romi||0)<0?'negative':'positive'}>{formatPercent(row.romi)}</span></div>) : <div className="product-empty">Дневная статистика ещё не загружена.</div>}</div></>}

      {!apiAvailable && <div className="settings-card ad-input-card"><h3>Резервный ручной расход</h3><p>Используется в P&amp;L только пока WB API рекламы не загрузил фактические расходы.</p><div className="inline-setting"><input type="number" min="0" value={settingsDraft.advertisingMonthly ?? 0} onChange={event=>updateSetting('advertisingMonthly',event.target.value)}/><button className="primary-btn" onClick={saveSettings}><Save size={17}/> Сохранить</button></div></div>}
    </section>
  }

  const renderSearchQueries = () => <WbExtendedWorkspace mode="search" connection={connection} syncing={syncing} onSync={syncConnection} notify={notify} period={analyticsPeriod} periodControls={renderSharedPeriodControls({ note:'Поисковый отчёт WB загружается строго для выбранного периода. Для некоторых детализаций WB ограничивает один запрос семью днями — покрытие показывается отдельно.' })} query={query} onQueryChange={setQuery}/>
  const renderStockHistory = () => <WbExtendedWorkspace mode="stock" connection={connection} syncing={syncing} onSync={syncConnection} notify={notify} period={analyticsPeriod} periodControls={renderSharedPeriodControls({ maxDays:90,note:'История остатков ограничивается единым периодом и фильтруется по товару и складу.' })} query={query} onQueryChange={setQuery}/>
  const renderCommunications = () => <WbExtendedWorkspace mode="communications" connection={connection} syncing={syncing} onSync={syncConnection} notify={notify} period={analyticsPeriod} periodControls={renderSharedPeriodControls({ note:'Отзывы, вопросы и события чатов фильтруются по выбранным датам и общему поиску. Чаты остаются только для чтения.' })} query={query} onQueryChange={setQuery}/>

  const renderReviews = () => {
    const qualityRows = [...productRows].filter(p => Number(p.returnsCount || 0) > 0 || Number(p.returnRate || 0) > 0).sort((a,b) => Number(b.returnRate || 0)-Number(a.returnRate || 0))
    return <section className="app-page glass-panel"><div className="page-title"><span>Качество</span><h1>Отзывы и возвраты</h1><p>На этом этапе качество оценивается по возвратам. Тексты отзывов и рейтинг подключаются отдельным разрешённым методом WB.</p></div><div className="metrics-grid"><MetricCard label="Возвраты" value={formatNumber(summary.returns)} delta="за 30 дней" icon={RefreshCw}/><MetricCard label="Доля возвратов" value={formatPercent(summary.returnRate)} delta="от количества продаж" icon={Percent}/><MetricCard label="Товаров в зоне риска" value={formatNumber(qualityRows.filter(p => p.returnRate >= 20).length)} delta="возвраты от 20%" icon={AlertTriangle}/></div><div className="data-table quality-table"><div className="data-row head quality-row"><span>Товар</span><span>Продажи</span><span>Возвраты</span><span>Доля</span><span>Риск</span><span>Рекомендация</span></div>{qualityRows.length ? qualityRows.map(p => <div className="data-row quality-row" key={p.id}><span><strong>{p.title}</strong><small>{p.article}</small></span><span>{formatNumber(p.salesCount)}</span><span>{formatNumber(p.returnsCount)}</span><span>{formatPercent(p.returnRate)}</span><span><b className={`status-badge ${p.returnRate >= 20 ? 'danger' : p.returnRate >= 10 ? 'warning' : 'success'}`}>{p.returnRate >= 20 ? 'Высокий' : p.returnRate >= 10 ? 'Внимание' : 'Норма'}</b></span><span>{p.returnRate >= 20 ? 'Проверить фото, описание, размер/комплектацию и причины возврата' : 'Контролировать динамику'}</span></div>) : <div className="product-empty">Возвраты в загруженных данных не обнаружены.</div>}</div></section>
  }

  const renderSeasonality = () => {
    const month = new Date().getMonth()+1
    const stages = {
      1:['После праздников','Распродажа остатков и осторожное пополнение базовых товаров'],2:['Подготовка к весне','Проверить весенний ассортимент и рекламные ставки'],3:['Рост весеннего спроса','Держать цену на ходовых товарах, пополнять дефицит'],4:['Переход к лету','Ускорять летние категории, контролировать закрытый ассортимент'],5:['Летний спрос','Поддерживать ходовые товары, очищать слабые позиции'],6:['Пик летнего периода','Не уценять дефицит, готовить осень'],7:['Сезонная распродажа','Распродавать медленные летние остатки, заводить осень'],8:['Подготовка к осени','Пополнять демисезон и тестировать цены'],9:['Пик осеннего спроса','Защищать маржу ходовых товаров, пополнять размеры'],10:['Переход к зиме','Ускорять зимние категории, сокращать осенний неликвид'],11:['Высокий сезон','Контролировать дефицит и рекламную эффективность'],12:['Праздничный спрос','Сохранять наличие, не допускать убыточных скидок']
    }
    const [stage,action]=stages[month]
    return <section className="app-page glass-panel"><div className="page-title"><span>Коммерческий календарь</span><h1>Сезонность</h1><p>Месячный ориентир объединён с реальными продажами и запасами.</p></div><div className="season-hero"><CalendarDays size={40}/><div><span>{new Date().toLocaleDateString('ru-RU',{month:'long',year:'numeric'})}</span><h2>{stage}</h2><p>{action}</p></div></div><div className="season-grid">{productRows.slice(0,12).map(p => <div className="season-card" key={p.id}><span className={`status-badge ${stockTone(p.status)}`}>{p.status}</span><h3>{p.title}</h3><p>{p.recommendation}</p><div><span>Продажи: {formatNumber(p.salesCount)}</span><span>Дней запаса: {p.stockCoverDays ?? '—'}</span></div></div>)}</div></section>
  }

  const renderReports = () => <section className="app-page glass-panel"><div className="page-title"><span>Выгрузка данных</span><h1>Отчёты</h1><p>Выгружайте уже отфильтрованные и рассчитанные данные в CSV для Excel.</p></div><div className="report-grid">{reportDefinitions.map(report => <button className="report-card" key={report.title} onClick={report.action}><span><FileText size={25}/></span><div><h3>{report.title}</h3><p>{report.text}</p></div><Download size={20}/></button>)}</div><div className="notice"><ShieldCheck size={20}/><div><strong>Данные каждого клиента изолированы</strong><p>Выгрузка формируется только из кабинета текущего пользователя.</p></div></div></section>

  const renderImport = () => <section className="app-page glass-panel"><div className="page-title"><span>Ручные данные</span><h1>Импорт себестоимости</h1><p>API WB не знает закупочную себестоимость. Загрузите CSV из Excel, чтобы получить честный P&L и цены в ноль.</p></div><div className="import-grid"><div className="settings-card import-card"><Upload size={34}/><h3>Загрузить CSV</h3><p>Колонки: «Артикул» и «Себестоимость». Поддерживаются артикул продавца, nmID и внутренний ключ товара.</p><label className="file-button"><Upload size={17}/> Выбрать CSV<input type="file" accept=".csv,text/csv" onChange={importCostsCsv}/></label></div><div className="settings-card import-card"><FileText size={34}/><h3>Шаблон для Excel</h3><p>Скачайте шаблон, заполните себестоимость и сохраните его в формате CSV UTF-8.</p><button className="secondary-btn" onClick={() => downloadCsv('elisei_cost_template',['Артикул','Себестоимость'],productRows.map(p => [p.article, settingsDraft.productCosts?.[String(p.key || p.nmID || p.vendorCode)] ?? p.unitCost ?? '']))}><Download size={17}/> Скачать шаблон</button></div></div>{importResult && <div className={`notice ${importResult.type === 'error' ? 'warning' : ''}`}><CheckCircle2 size={20}/><div><strong>{importResult.type === 'error' ? 'Импорт не выполнен' : 'Файл прочитан'}</strong><p>{importResult.text}</p></div></div>}<div className="import-actions"><button className="primary-btn" disabled={savingSettings} onClick={saveSettings}><Save size={17}/> Сохранить импорт и пересчитать</button></div><div className="security-note"><ShieldCheck size={22}/><div><strong>Файл обрабатывается в браузере</strong><p>В базу отправляются только сопоставленные значения себестоимости текущего пользователя.</p></div></div></section>

  const renderCrm = () => <section className="app-page glass-panel"><div className="page-title"><span>AI CRM</span><h1>Центр коммуникаций</h1><p>Рабочая основа модуля: приоритеты, правила ответов и задачи. Отправка сообщений включается только через разрешённые методы маркетплейса.</p></div><div className="crm-grid"><div className="crm-card"><UsersRound size={26}/><h3>Очередь внимания</h3><strong>{formatNumber(summary.returns)}</strong><p>Возвраты за 30 дней — потенциальные точки для проверки качества и коммуникаций.</p></div><div className="crm-card"><Star size={26}/><h3>Контроль качества</h3><strong>{productRows.filter(p => p.returnRate >= 20).length}</strong><p>Товаров с высокой долей возвратов.</p></div><div className="crm-card"><Sparkles size={26}/><h3>Правила ЭЛа</h3><strong>Готово</strong><p>Эл не отправляет сообщения без разрешённого API и подтверждённых правил.</p></div></div><div className="notice"><AlertTriangle size={20}/><div><strong>Безопасный режим</strong><p>Массовые сообщения и промокоды не запускаются самовольно. Здесь будут история, статусы и аналитика эффективности.</p></div></div></section>

  const renderConnections = () => {
    const requirements = [
      { scope:'content', stage:'products', title:'Товары', text:'Карточки, фото и артикулы' },
      { scope:'statistics', stage:'orders', title:'Заказы', text:'Заказы за последние 30 дней' },
      { scope:'statistics', stage:'sales', title:'Продажи', text:'Продажи и возвраты за 30 дней' },
      { scope:'analytics', stage:'stocks', title:'Остатки FBO', text:'Остатки на складах Wildberries' },
      { scope:'marketplace', stage:'sellerStocks', title:'Остатки FBS', text:'Остатки на складах продавца' },
      { scope:'promotion', stage:'advertising', title:'Реклама', text:'Кампании и эффективность' },
      { scope:'feedbacks', title:'Отзывы', text:'Вопросы, отзывы и рейтинг' },
      { scope:'finance', stage:'finance', title:'Финансы', text:'Базовый токен: детализация реализации, комиссия, логистика, удержания и выплаты' },
      { scope:'documents', stage:'documents', title:'Документы WB', text:'Акты, отчёты, УПД и подтверждающие документы кабинета' },
      { scope:'finance', stage:'financeReports', title:'Сводки реализации', text:'Официальные сводки для сверки выплат · Персональный/Сервисный доступ' },
      { scope:'analytics', stage:'paidStorage', title:'Хранение', text:'Платное хранение по товарам' },
      { scope:'analytics', stage:'acceptance', title:'Приёмка', text:'Платные операции при приёмке' },
      { scope:'finance', stage:'acquiring', title:'Эквайринг', text:'Издержки на приём платежей' },
      { scope:'finance', stage:'acquiringReports', title:'Сводки эквайринга', text:'Контроль комиссии и НДС · Персональный/Сервисный доступ' },
      { scope:'finance', stage:'jamSubscription', title:'Статус Джем', text:'Проверяется Сервисным токеном; денежное списание подтверждается финансами или документом' },
      { scope:'marketplace', stage:'fbsArchive', title:'Архив FBS', text:'Сборочные задания старше трёх месяцев' },
      { scope:'analytics', stage:'measurementPenalties', title:'Штрафы за габариты', text:'Удержания и замеры упаковки' },
      { scope:'analytics', stage:'deductionsReport', title:'Подмены и вложения', text:'Детализация специальных удержаний' },
      { scope:'analytics', stage:'warehouseMeasurements', title:'Замеры склада', text:'Фото и фактические размеры упаковки' },
      { scope:'analytics', stage:'antifraudRetention', title:'Самовыкупы', text:'Официальная расшифровка удержаний' },
      { scope:'analytics', stage:'labelingRetention', title:'Маркировка', text:'Штрафы и фото отсутствующей маркировки' },
      { scope:'analytics', stage:'goodsReturns', title:'Возвраты и перемещения', text:'Возвраты товаров продавцу и движение' },
      { scope:'content', stage:'tariffs', title:'Тарифы WB', text:'Комиссии, логистика, хранение и возврат' },
      { scope:'analytics', stage:'funnel', title:'Воронка карточек', text:'Просмотры, корзина, заказы и выкупы' },
      { scope:'analytics', stage:'searchQueries', title:'Поисковые запросы', text:'Фразы покупателей и позиции карточек · нужна подписка «Джем»' },
      { scope:'analytics', stage:'stockHistory', title:'История остатков', text:'Ежедневный CSV-архив остатков за 90 дней' },
      { scope:'feedbacks', stage:'reviews', title:'Отзывы', text:'Активные, отвеченные и архивные отзывы' },
      { scope:'feedbacks', stage:'questions', title:'Вопросы', text:'Вопросы покупателей и статусы ответов' },
      { scope:'chat', stage:'chats', title:'Чаты', text:'Диалоги и события в режиме чтения' },
      { scope:'documents', stage:'documents', title:'Документы', text:'Список актов, УПД, УКД и уведомлений' },
    ]
    const syncStatus = stage => connection.syncStates?.find(item => item.stage === stage)
    const stageLabel = state => {
      if (!state) return 'Не запускалось'
      if (state.status === 'success') return `Загружено: ${formatNumber(state.lastCount)}`
      if (state.status === 'pending') return 'Формируется в фоне'
      if (state.status === 'queued') return 'Поставлено в фоновую очередь'
      if (state.status === 'retry_scheduled') return state.nextAllowedAt ? `Автоповтор после ${new Date(state.nextAllowedAt).toLocaleString('ru-RU')}` : 'Автоповтор запланирован'
      if (state.status === 'rate_limited') return state.nextAllowedAt ? `Пауза до ${new Date(state.nextAllowedAt).toLocaleString('ru-RU')}` : 'Лимит WB'
      if (['service_token_required','service_secret_required','service_token_invalid','service_permission_required'].includes(state.status)) return 'Нужен сервисный доступ'
      if (state.status === 'missing_token') return 'Нет подходящего токена'
      if (state.status === 'running') return 'Загрузка'
      return state.lastError || 'Не загружено'
    }
    const primary = connection.primaryToken || connection.tokens?.find(item => item.isPrimary)
    const modeCopy = connection.tokenMode === 'universal'
      ? { tone:'universal', title:'Основной токен покрывает обычные потоки кабинета', text:'Товары, заказы, продажи, остатки, реклама и основная финансовая детализация работают через Базовый токен. Сводки реализации и эквайринга подключаются отдельно сервисным токеном.' }
      : connection.tokenMode === 'combined'
        ? { tone:'combined', title:'Обычные потоки собраны из нескольких токенов', text:'ELISEI использует основной Базовый токен в первую очередь, а дополнительные обычные ключи — только для недостающих категорий.' }
        : connection.tokens?.some(item => !item.isServiceToken)
          ? { tone:'partial', title:'Основной токен подключён не ко всем обычным потокам', text:'Добавьте обычный токен только для категорий, отмеченных ниже как недоступные. Сервисный токен не заменяет основной.' }
          : { tone:'empty', title:'Подключите основной Базовый API-ключ WB', text:'Сначала подключается токен кабинета. Сервисный токен для двух официальных финансовых сводок добавляется отдельным полем.' }
    const serviceSecretText = connection.serviceSecret?.valid
      ? `Секрет сервиса настроен${connection.serviceSecret?.expiresAt ? ` до ${new Date(connection.serviceSecret.expiresAt).toLocaleDateString('ru-RU')}` : ''}`
      : connection.serviceSecret?.configured
        ? connection.serviceSecret?.error || 'WB_CLIENT_SECRET требует обновления'
        : 'WB_CLIENT_SECRET ещё не настроен в backend Render'

    return <section className="app-page glass-panel connections-page">
      <div className="page-title"><span>Интеграции</span><h1>Подключение Wildberries</h1><p>Обычный токен и сервисный токен разделены. Сервисный ключ никогда не становится основным и используется только для официальных сводок реализации и эквайринга.</p></div>
      <div className={`token-mode-banner ${modeCopy.tone}`}><div className="token-mode-icon">{connection.tokenMode === 'universal' ? <CheckCircle2 size={24}/> : <ShieldCheck size={24}/>}</div><div><strong>{modeCopy.title}</strong><p>{modeCopy.text}</p>{primary && <small>Основной: {primary.label} · {primary.stageCoverageCount || 0} обычных потоков</small>}</div></div>

      <div className={`service-access-banner ${connection.serviceFinanceReady ? 'ready' : connection.serviceTokenConnected ? 'warning' : 'missing'}`}>
        <div><ShieldCheck size={24}/></div>
        <div><strong>{connection.serviceFinanceReady ? 'Сервисный финансовый доступ готов' : connection.serviceTokenConnected ? 'Сервисный токен сохранён, но доступ не готов' : 'Сервисный токен ещё не подключён'}</strong><p>{connection.serviceFinanceReady ? 'Сводки реализации и эквайринга будут запрашиваться только этим токеном.' : serviceSecretText}</p></div>
      </div>

      {connection.connected && <div className={`live-sync-card ${liveSync.enabled?'enabled':'disabled'}`}>
        <div className="live-sync-head"><div className="live-sync-icon"><RefreshCw className={liveSync.enabled?'live-spin':''} size={24}/></div><div><span>Живое обновление</span><h3>{liveSync.enabled ? (liveSync.webhooksEnabled ? 'Гибридный режим включён' : 'Частая синхронизация включена') : 'Автоматическое обновление выключено'}</h3><p>{liveSync.webhooksEnabled ? 'События карточек, отзывов и готовых отчётов приходят через вебхуки; заказы и продажи обновляются инкрементально, остатки — свежим снимком.' : 'Заказы обновляются примерно раз в 2 минуты, продажи — инкрементально раз в 5 минут, остатки — свежим снимком по расписанию. Жёсткие лимиты финансов и документов сохраняются.'}</p></div><button className={liveSync.enabled?'secondary-btn':'primary-btn'} disabled={liveSyncBusy} onClick={()=>updateLiveSync({enabled:!liveSync.enabled})}>{liveSyncBusy?<RefreshCw className="spin" size={17}/>:<PlugZap size={17}/>} {liveSync.enabled?'Приостановить':'Включить'}</button></div>
        <div className="live-sync-grid"><div><small>Заказы</small><strong>≈ 2 мин.</strong><span>инкрементально</span></div><div><small>Продажи и остатки</small><strong>≈ 5 мин.</strong><span>продажи — инкрементально, остатки — снимком</span></div><div><small>Вебхуки WB</small><strong>{liveSync.webhookCount || 0}</strong><span>{liveSync.webhooksEnabled?'активны':'ожидают регистрацию сервиса'}</span></div><div><small>Последнее событие</small><strong>{liveSync.lastEventAt?new Date(liveSync.lastEventAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):'—'}</strong><span>{liveSync.lastEventAt?new Date(liveSync.lastEventAt).toLocaleDateString('ru-RU'):'событий пока нет'}</span></div></div>
        <div className="live-sync-actions"><div><strong>OAuth и вебхуки</strong><p>{liveSync.oauth?.message || 'OAuth станет доступен после регистрации ELISEI в Каталоге решений WB. До этого живой режим работает через текущий токен.'}</p></div>{liveSync.webhookSetupReady?<button className="secondary-btn" disabled={liveSyncBusy} onClick={setupLiveWebhooks}><PlugZap size={17}/> Подключить вебхуки</button>:liveSync.oauth?.connectUrl?<button className="secondary-btn" onClick={()=>window.open(liveSync.oauth.connectUrl,'_blank','noopener,noreferrer')}><PlugZap size={17}/> Подключить через WB</button>:liveSync.oauth?.catalogUrl?<button className="secondary-btn" onClick={()=>window.open(liveSync.oauth.catalogUrl,'_blank','noopener,noreferrer')}><FileText size={17}/> Регистрация сервиса</button>:<span className="live-sync-wait">{liveSync.oauth?.catalogRegistered?'OAuth ожидает финальную активацию':'Нужна регистрация в Каталоге WB'}</span>}</div>
      </div>}

      <div className="wb-coverage-grid">{requirements.map(item => {
        const state = item.stage ? syncStatus(item.stage) : null
        const source = item.stage ? connection.coverageByStage?.[item.stage] : connection.tokens?.find(token => !token.isServiceToken && token.scopes?.includes(item.scope))
        const covered = item.stage ? Boolean(source) : Boolean(source)
        return <div className={`wb-coverage-card ${covered?'covered':'missing'}`} key={`${item.scope}:${item.stage || item.title}`}><span className="coverage-icon">{covered?<CheckCircle2 size={20}/>:<AlertTriangle size={20}/>}</span><div><strong>{item.title}</strong><p>{item.text}</p><small>{covered ? `${source?.isServiceToken ? 'Сервисный токен' : source?.isPrimary ? 'Основной токен' : source?.label || 'Токен подключён'}${item.stage ? ` · ${stageLabel(state)}` : ''}` : item.stage && ['financeReports','acquiringReports'].includes(item.stage) ? 'Нужен отдельный Сервисный токен' : 'Нужна категория доступа'}</small></div></div>
      })}</div>

      {connection.tokens?.length > 0 && <div className="token-manager"><div className="section-title-row"><div><span>Безопасное хранилище</span><h2>API-токены кабинета</h2></div><button className="secondary-btn" disabled={syncing} onClick={() => syncConnection()}><RefreshCw className={syncing?'spin':''} size={17}/>{syncing?'Синхронизация':'Синхронизировать доступные разделы'}</button></div><div className="token-card-grid">{connection.tokens.map(item => <div className={`saved-token-card ${item.isPrimary?'primary-token-card':''} ${item.isServiceToken?'service-token-card':''}`} key={item.id}><div className="saved-token-head"><div className="token-shield"><ShieldCheck size={20}/></div><div><div className="token-title-line"><strong>{item.label}</strong>{item.isPrimary && <b className="primary-token-badge">Основной</b>}{item.isServiceToken && <b className="service-token-badge">Сервисный</b>}</div><span>{item.tokenType} · {item.readOnly?'только чтение':'чтение и запись'}</span></div><button className="token-remove" onClick={() => removeToken(item.id)} title="Удалить токен"><X size={17}/></button></div><div className="token-flow-coverage"><strong>{item.stageCoverageCount || 0}/{connection.stageTotal || item.stageTotal || 28} потоков</strong><span>{item.isServiceToken ? 'Расширенные сводки и статус Джем' : item.coversAllCoreFlows ? 'Покрывает обычное рабочее ядро' : 'Используется только по своим категориям'}</span></div><div className="token-scopes">{item.scopeLabels?.map(scope => <b key={scope}>{scope}</b>)}</div><div className="token-card-foot"><small>До: {item.expiresAt?new Date(item.expiresAt).toLocaleDateString('ru-RU'):'не указано'} · код {item.fingerprint}</small>{!item.isPrimary && !item.isServiceToken && <button className="token-primary-btn" onClick={() => setPrimaryToken(item.id)}>Сделать основным</button>}</div></div>)}</div></div>}

      <div className="connection-card add-token-card"><div className="connection-logo">WB</div><div className="connection-copy"><div className="connection-title"><h3>{connection.connected ? 'Добавить обычный резервный токен' : 'Подключить основной токен'}</h3><span className={connection.connected?'connection-status connected':'connection-status'}>{connection.connected ? 'Основной подключён' : 'Не подключён'}</span></div><p>Здесь принимаются Базовые токены кабинета. Сервисный токен в это поле не добавляется и не сможет случайно стать основным.</p><form className="token-form multi-token-form" onSubmit={saveConnection}><label>Название токена — необязательно<input type="text" value={tokenLabel} onChange={e => setTokenLabel(e.target.value)} placeholder={connection.connected ? 'Например: Резервный или Отзывы' : 'Например: Основной токен WB'} maxLength="80"/></label><label>Базовый API-ключ Wildberries</label><div className="token-input"><input type={showToken?'text':'password'} value={tokenDraft} onChange={e => setTokenDraft(e.target.value)} placeholder="Вставьте Базовый API-ключ" autoComplete="off"/><button type="button" onClick={() => setShowToken(value => !value)}>{showToken?<EyeOff size={18}/>:<Eye size={18}/>}</button></div><small>Категории определятся автоматически. Сам токен обратно в браузер не возвращается.</small><button className="primary-btn" disabled={checking}>{checking?<><RefreshCw className="spin" size={17}/> Проверяем</>:<><PlugZap size={17}/> Проверить и добавить</>}</button></form></div></div>

      {connection.connected && <div className="connection-card service-token-connect-card"><div className="connection-logo service-logo"><ShieldCheck size={28}/></div><div className="connection-copy"><div className="connection-title"><h3>Сервисный токен для расширенных финансовых данных</h3><span className={`connection-status ${connection.serviceFinanceReady?'connected':''}`}>{connection.serviceFinanceReady ? 'Готов' : connection.serviceTokenConnected ? 'Проверить секрет' : 'Не подключён'}</span></div><p>Этот токен используется для официальных сводок реализации, сводок эквайринга и проверки статуса подписки «Джем». Основная финансовая детализация и документы продолжают работать через обычный токен кабинета с нужными категориями.</p><form className="token-form multi-token-form" onSubmit={saveServiceConnection}><label>Название — необязательно<input type="text" value={serviceTokenLabel} onChange={e => setServiceTokenLabel(e.target.value)} placeholder="Например: Расширенные финансы WB" maxLength="80"/></label><label>Сервисный токен Wildberries</label><div className="token-input"><input type={showServiceToken?'text':'password'} value={serviceTokenDraft} onChange={e => setServiceTokenDraft(e.target.value)} placeholder="Вставьте Сервисный токен" autoComplete="off"/><button type="button" onClick={() => setShowServiceToken(value => !value)}>{showServiceToken?<EyeOff size={18}/>:<Eye size={18}/>}</button></div><small>{serviceSecretText}. Токен проверяется на backend и никогда не возвращается в браузер.</small><button className="primary-btn" disabled={checkingServiceToken}>{checkingServiceToken?<><RefreshCw className="spin" size={17}/> Проверяем сервисный доступ</>:<><PlugZap size={17}/> Проверить и подключить</>}</button></form></div></div>}

      <div className="security-note"><RefreshCw size={22}/><div><strong>Автоповторы без сброса прогресса</strong><p>После 429, 502, 503 или 504 ELISEI сохраняет taskId, страницу и курсор, назначает время следующей попытки и продолжает тот же этап автоматически.</p></div></div>
      <div className="security-note"><ShieldCheck size={22}/><div><strong>Один токен — один набор запросов</strong><p>Обычные потоки не переключаются на сервисный токен. Финансовые сводки, наоборот, никогда не запускаются Базовым ключом.</p></div></div>
      <div className="security-note"><Warehouse size={22}/><div><strong>СГТ-склады — только чтение</strong><p>После 5 августа 2026 года ELISEI показывает уже созданные СГТ-склады и их остатки, но не создаёт и не редактирует такие склады через API.</p></div></div>
      {connection.connected && <div className="connection-danger-zone"><div><strong>Отключить магазин полностью</strong><p>Удалятся токены и загруженные данные этого магазина.</p></div><button className="danger-btn" onClick={disconnect}>Отключить Wildberries</button></div>}
    </section>
  }

  const renderSyncHistory = () => {
    const stages = [
      ['products','Товары'], ['orders','Заказы'], ['sales','Продажи'], ['stocks','Остатки FBO'], ['sellerStocks','Остатки FBS'], ['advertising','Реклама'],
      ['finance','Финансы WB'], ['paidStorage','Хранение'], ['acceptance','Приёмка'], ['acquiring','Эквайринг'], ['financeReports','Сводки реализации'], ['acquiringReports','Сводки эквайринга'],
      ['fbsArchive','Архив FBS'], ['measurementPenalties','Штрафы за габариты'], ['deductionsReport','Подмены и вложения'], ['warehouseMeasurements','Замеры склада'], ['antifraudRetention','Самовыкупы'], ['labelingRetention','Маркировка'],
      ['goodsReturns','Возвраты и перемещения'], ['tariffs','Тарифы WB'], ['funnel','Воронка карточек'], ['documents','Документы WB'], ['jamSubscription','Подписка Джем'], ['searchQueries','Поисковые запросы'], ['stockHistory','История остатков'], ['reviews','Отзывы'], ['questions','Вопросы'], ['chats','Чаты']
    ]
    const stateFor = stage => connection.syncStates?.find(item => item.stage === stage)
    const statusCopy = (state, stage) => {
      if (!state) return { tone:'idle', title:'Не запускалось', text:'Данные этого раздела ещё не запрашивались.' }
      if (state.status === 'success') {
        if (stage === 'acquiring' && Number(state.lastCount || 0) === 0) {
          const financeState = stateFor('finance')
          if (!financeState || financeState.status !== 'success') return {
            tone:'pending', title:'Ожидает финансы WB',
            text:'Эквайринг будет рассчитан после загрузки финансовой детализации. Ноль пока не подтверждён.',
          }
        }
        if (stage === 'stocks') {
          const schemaValid = Number(state.metadata?.schemaVersion || 0) === 5
          if (!schemaValid) return { tone:'warning', title:'Нужен новый отчёт', text:'Старые остатки скрыты как неподтверждённые. Запустите или дождитесь нового отчёта WB.' }
          return { tone:'success', title:`${formatNumber(state.lastCount)} строк · ${formatNumber(state.metadata?.totalQuantity || 0)} шт.`, text:state.lastSuccessAt ? `Обновлено ${new Date(state.lastSuccessAt).toLocaleString('ru-RU')}` : 'Этап завершён.' }
        }
        if (stage === 'sellerStocks') {
          const sgtCount = Number(state.metadata?.sgtWarehouses || 0)
          const suffix = sgtCount > 0 ? ` · СГТ-складов только для чтения: ${formatNumber(sgtCount)}` : ''
          return { tone:'success', title:`Загружено: ${formatNumber(state.lastCount)}`, text:`${state.lastSuccessAt ? `Обновлено ${new Date(state.lastSuccessAt).toLocaleString('ru-RU')}` : 'Этап завершён.'}${suffix}` }
        }
        if (stage === 'fbsArchive') {
          const completed = Number(state.metadata?.monthsCompleted || 0)
          const requested = Number(state.metadata?.monthsScanned || state.metadata?.monthsRequested || 0)
          const cutoff = state.metadata?.archiveCutoff ? new Date(state.metadata.archiveCutoff).toLocaleDateString('ru-RU') : 'границы трёх месяцев'
          return {
            tone:'success',
            title:`Загружено: ${formatNumber(state.lastCount)}`,
            text:`Архив старше ${cutoff}. Проверено месяцев: ${formatNumber(completed)}${requested ? ` из ${formatNumber(requested)}` : ''}.`,
          }
        }
        return { tone:'success', title:`Загружено: ${formatNumber(state.lastCount)}`, text:state.lastSuccessAt ? `Обновлено ${new Date(state.lastSuccessAt).toLocaleString('ru-RU')}` : 'Этап завершён.' }
      }
      if (state.status === 'pending') {
        const generated = ['paidStorage','acceptance'].includes(stage) && state.taskId
        return generated
          ? { tone:'pending', title:'WB формирует отчёт', text:state.nextAllowedAt ? `Задание сохранено. Проверка статуса после ${new Date(state.nextAllowedAt).toLocaleString('ru-RU')}` : 'Задание сохранено. ELISEI проверит готовность автоматически.' }
          : { tone:'pending', title:'Формируется в фоне', text:state.nextAllowedAt ? `Автопроверка после ${new Date(state.nextAllowedAt).toLocaleString('ru-RU')}` : 'ELISEI проверит готовность автоматически.' }
      }
      if (state.status === 'queued') {
        if (stage === 'finance' && Number(state.metadata?.persistedCount || state.lastCount || 0) > 0) return {
          tone:'pending',title:'Финансы загружены частично',
          text:`Сохранено ${formatNumber(state.metadata?.persistedCount || state.lastCount || 0)} строк. ${state.nextAllowedAt ? `Следующий разрешённый запрос после ${new Date(state.nextAllowedAt).toLocaleString('ru-RU')}.` : 'Продолжение поставлено в очередь.'}`,
        }
        if (stage === 'documents' && Number(state.metadata?.persistedCount || state.lastCount || 0) > 0) return {
          tone:'pending',title:'Документы загружены частично',
          text:`Сохранено ${formatNumber(state.metadata?.persistedCount || state.lastCount || 0)} документов. ${state.nextAllowedAt ? `Продолжение после ${new Date(state.nextAllowedAt).toLocaleString('ru-RU')}.` : 'Продолжение поставлено в очередь.'}`,
        }
        if (stage === 'fbsArchive' && state.metadata?.currentMonth) {
          const month = state.metadata.currentMonth
          return {
            tone:'pending',
            title:'Архив FBS загружается помесячно',
            text:`Сохранено ${formatNumber(state.metadata?.persistedCount || state.lastCount || 0)} заданий. Сейчас: ${String(month.month).padStart(2,'0')}.${month.year}, страница ${formatNumber(Number(state.metadata?.monthPageNumber || 0) + 1)}.`,
          }
        }
        const completed = Number(state.metadata?.completedChunks || 0)
        return completed > 0
          ? { tone:'pending', title:'Период загружается частями', text:`Сохранено частей: ${completed}. Следующая часть запустится автоматически.` }
          : { tone:'pending', title:'В фоновой очереди', text:'Этап запустится автоматически после освобождения очереди.' }
      }
      if (state.status === 'rate_limited') {
        const due = state.nextAllowedAt && new Date(state.nextAllowedAt).getTime() <= Date.now()
        const generatedTask = ['paidStorage','acceptance'].includes(stage) && state.taskId
        if (generatedTask) return due
          ? { tone:'pending', title:'Проверяем готовность отчёта', text:'taskId сохранён. Срок паузы закончился, фоновая очередь продолжает тот же отчёт.' }
          : { tone:'warning', title:'Отчёт создан · ждём WB', text:state.nextAllowedAt ? `taskId сохранён. Следующая проверка после ${new Date(state.nextAllowedAt).toLocaleString('ru-RU')}` : (state.lastError || 'ELISEI продолжит тот же отчёт автоматически.') }
        return due
          ? { tone:'pending', title:'Автоповтор запускается', text:'Срок паузы закончился. Интерфейс разбудил фоновую очередь; статус обновится автоматически.' }
          : { tone:'warning', title:'Пауза Wildberries', text:state.nextAllowedAt ? `Автоповтор после ${new Date(state.nextAllowedAt).toLocaleString('ru-RU')}` : state.lastError }
      }
      if (state.status === 'retry_scheduled') {
        const due = state.nextAllowedAt && new Date(state.nextAllowedAt).getTime() <= Date.now()
        const attempt = Number(state.metadata?.automaticRetryAttempt || 0)
        return due
          ? { tone:'pending', title:'Повтор запускается автоматически', text:`Прогресс сохранён${state.taskId ? ' вместе с taskId' : ''}. Очередь продолжает этап с прежней страницы.` }
          : { tone:'warning', title:'Временная ошибка WB', text:`Прогресс не потерян. Автоповтор${attempt ? ` №${attempt}` : ''}${state.nextAllowedAt ? ` после ${new Date(state.nextAllowedAt).toLocaleString('ru-RU')}` : ' запланирован'}.` }
      }
      if (state.status === 'service_token_required') return { tone:'danger', title:'Требуется сервисный токен', text:state.lastError || 'Подключите отдельный Сервисный токен в разделе «Подключения».' }
      if (state.status === 'service_secret_required') return { tone:'danger', title:'Не настроен секрет сервиса', text:state.lastError || 'Добавьте действующий WB_CLIENT_SECRET в backend Render.' }
      if (state.status === 'service_token_invalid') return { tone:'danger', title:'Сервисный токен недействителен', text:state.lastError || 'Замените сервисный токен в разделе «Подключения».' }
      if (state.status === 'service_permission_required') return { tone:'danger', title:'WB не дал доступ к сводке', text:state.lastError || 'Проверьте тип токена, категорию «Финансы» и принадлежность сервису.' }
      if (state.status === 'token_invalid') return { tone:'danger', title:'Токен недействителен', text:state.lastError || 'Обновите токен кабинета.' }
      if (state.status === 'missing_token') return { tone:'danger', title:'Нет подходящего токена', text:state.lastError || 'Добавьте нужную категорию доступа.' }
      if (state.status === 'running') return { tone:'pending', title:'Загрузка', text:'Запрос выполняется.' }
      return { tone:'danger', title:'Не загружено', text:state.lastError || 'Запустите этап повторно.' }
    }
    return <section className="app-page glass-panel"><div className="page-title"><span>Контроль данных</span><h1>Журнал синхронизаций</h1><p>Каждый поток работает независимо. Лимит одного метода больше не останавливает остальные разделы.</p></div>{connection.connected && <div className="quality-center">
      <div className="quality-center-head">
        <div className={`quality-score ${dataQuality?.overall || 'loading'}`}>
          <strong>{dataQualityLoading && !dataQuality ? '…' : `${formatNumber(dataQuality?.score || 0)}%`}</strong>
          <span>готовность данных</span>
        </div>
        <div className="quality-center-summary">
          <span>Выбранный период</span>
          <h2>{formatDate(dataQuality?.requestedPeriod?.from || analyticsPeriod.from)} — {formatDate(dataQuality?.requestedPeriod?.to || analyticsPeriod.to)}</h2>
          <p>{dataQuality?.confirmedPeriod ? `Общий подтверждённый период: ${formatDate(dataQuality.confirmedPeriod.from)} — ${formatDate(dataQuality.confirmedPeriod.to)}.` : 'Общий подтверждённый период ещё формируется.'}</p>
        </div>
        <div className={`quality-confidence ${dataQuality?.profitConfidence?.status || 'unavailable'}`}>
          <ShieldCheck size={21}/><div><strong>{dataQuality?.profitConfidence?.label || 'Проверяем качество'}</strong><span>{dataQuality?.profitConfidence?.text || 'Собираем паспорта источников.'}</span></div>
        </div>
        <button className="secondary-btn" disabled={dataQualityLoading} onClick={()=>loadDataQuality(connection.connectionId,analyticsPeriod)}><RefreshCw className={dataQualityLoading?'spin':''} size={17}/>Проверить</button>
      </div>
      <div className="quality-kpis">
        <div><span>Подтверждено</span><strong>{formatNumber(dataQuality?.summary?.ready || 0)}</strong></div>
        <div><span>Догружается</span><strong>{formatNumber(dataQuality?.summary?.partial || 0)}</strong></div>
        <div><span>Критично</span><strong>{formatNumber(dataQuality?.summary?.critical || 0)}</strong></div>
        <div><span>Предупреждения</span><strong>{formatNumber(dataQuality?.summary?.warnings || 0)}</strong></div>
      </div>
      <div className="quality-tabs">
        <button className={qualityView==='problems'?'active':''} onClick={()=>setQualityView('problems')}>Проблемы и действия</button>
        <button className={qualityView==='streams'?'active':''} onClick={()=>setQualityView('streams')}>Паспорта потоков</button>
        <button className={qualityView==='finance'?'active':''} onClick={()=>setQualityView('finance')}>Финансовая сверка</button>
      </div>
      {qualityView==='problems' && <div className="quality-problems">
        {dataQualityLoading && !dataQuality ? <div className="quality-empty"><RefreshCw className="spin" size={22}/>Собираем покрытие источников…</div> : dataQuality?.issues?.length ? dataQuality.issues.map(item=><div className={`quality-issue ${item.severity}`} key={item.id}><span>{item.severity==='critical'?<AlertTriangle size={19}/>:item.severity==='warning'?<Info size={19}/>:<CheckCircle2 size={19}/>}</span><div><strong>{item.title}</strong><p>{item.text}</p><small>{item.action}</small></div>{item.stage&&<button onClick={()=>document.getElementById(`sync-stage-${item.stage}`)?.scrollIntoView({behavior:'smooth',block:'center'})}>Показать карточку</button>}</div>) : <div className="quality-empty success"><CheckCircle2 size={22}/>Критических разрывов не найдено. Итоги можно использовать в рамках указанного покрытия.</div>}
      </div>}
      {qualityView==='streams' && <div className="quality-stream-table">
        <div className="quality-stream-row head"><span>Источник</span><span>Статус</span><span>Строки</span><span>Покрытие</span><span>Свежесть</span><span>Что дальше</span></div>
        {(dataQuality?.streams || []).map(item=><div className={`quality-stream-row ${item.status}`} key={item.stage}><span><strong>{item.label}</strong><small>{item.source || item.rawStatus}</small></span><span><b>{item.statusLabel}</b></span><span>{formatNumber(item.rowCount)}</span><span>{item.coverage ? `${formatDate(item.coverage.from)} — ${formatDate(item.coverage.to)}` : item.metadata?.monthsCompleted ? `${formatNumber(item.metadata.monthsCompleted)} мес.` : 'текущий снимок'}</span><span>{item.updatedAt ? new Date(item.updatedAt).toLocaleString('ru-RU') : 'нет даты'}</span><span>{item.action}</span></div>)}
      </div>}
      {qualityView==='finance' && <div className="quality-finance-grid">
        <div><span>Движений в реестре</span><strong>{formatNumber(dataQuality?.finance?.movements || 0)}</strong></div>
        <div><span>К перечислению</span><strong>{formatMoney(dataQuality?.finance?.movements ? dataQuality.finance.sellerPayable : null)}</strong></div>
        <div><span>Выручка по строкам</span><strong>{formatMoney(dataQuality?.finance?.movements ? dataQuality.finance.grossRevenue : null)}</strong></div>
        <div><span>Расходы</span><strong>{formatMoney(dataQuality?.finance?.movements ? dataQuality.finance.expenses : null)}</strong></div>
        <div><span>Расхождение сверки</span><strong className={dataQuality?.finance?.withinTolerance?'positive':'negative'}>{formatMoney(dataQuality?.finance?.movements ? dataQuality.finance.difference : null)}</strong></div>
        <div><span>Допуск сверки</span><strong>{formatMoney(dataQuality?.finance?.threshold || 0)}</strong></div>
        <div className="quality-finance-note"><ShieldCheck size={20}/><p>{dataQuality?.finance?.status==='confirmed'?'Финансовый период покрыт полностью, а расхождение находится в допустимом диапазоне.':dataQuality?.finance?.movements?'Итог предварительный: дождись полного покрытия или устранения расхождения.':'Финансовый реестр ожидает данные WB; нулевые расходы не считаются подтверждёнными.'}</p></div>
      </div>}
    </div>}{integrationDiagnostics && <div className="data-integrity-strip"><div><strong>Единое ядро товаров</strong><span>{formatNumber(integrationDiagnostics.productMaster?.products)} карточек · {formatNumber(integrationDiagnostics.productMaster?.withBarcodes)} со ШК</span></div><div><strong>Остатки</strong><span>{integrationDiagnostics.stockAllocation?`${formatNumber(integrationDiagnostics.stockAllocation.matchedQuantity)} шт. сопоставлено`:'снимок ожидается'}</span></div><div><strong>Реклама</strong><span>{formatNumber(integrationDiagnostics.advertisingMeta?.campaigns)} кампаний · {formatNumber(integrationDiagnostics.advertisingMeta?.campaignsWithStats)} со статистикой</span></div></div>}{!connection.connected ? <div className="empty-state"><RefreshCw size={38}/><h3>Wildberries не подключён</h3><button className="primary-btn" onClick={() => setActive('Подключения')}>Подключить</button></div> : <>
      <div className="sync-summary"><div><span>Последнее успешное обновление</span><strong>{connection.lastSync ? new Date(connection.lastSync).toLocaleString('ru-RU') : 'Ещё не выполнялось'}</strong></div><button className="secondary-btn" disabled={syncing} onClick={() => syncConnection()}><RefreshCw className={syncing?'spin':''} size={17}/>{syncing?'Запускаем этапы':'Запустить доступные этапы'}</button></div>
      <div className="sync-stage-grid">{stages.map(([stage,label]) => { const state=stateFor(stage); const copy=statusCopy(state,stage); const serviceBlocked=['service_token_required','service_secret_required','service_token_invalid','service_permission_required'].includes(state?.status); const blocked=syncing || state?.status === 'pending' || (state?.nextAllowedAt && new Date(state.nextAllowedAt).getTime() > Date.now()); const buttonText=serviceBlocked?'Открыть подключения':blocked?(state?.status==='pending'?'Ожидаем WB':'Повтор будет автоматически'):(['rate_limited','retry_scheduled'].includes(state?.status)?'Повторить сейчас':'Обновить отдельно'); return <div id={`sync-stage-${stage}`} className={`sync-stage-card ${copy.tone}`} key={stage}><div className="sync-stage-head"><span>{copy.tone==='success'?<CheckCircle2 size={19}/>:copy.tone==='pending'?<RefreshCw className="spin" size={19}/>:<AlertTriangle size={19}/>}</span><div><small>{label}</small><strong>{copy.title}</strong></div></div><p>{copy.text}</p><button disabled={blocked && !serviceBlocked} onClick={() => serviceBlocked ? setActive('Подключения') : syncConnection(connection.connectionId,[stage],{period:['advertising','searchQueries','stockHistory','finance','acquiring','documents'].includes(stage)?analyticsPeriod:null})}>{buttonText}</button></div> })}</div>
      {coreData?.syncWarnings?.length > 0 && <div className="warning-stack">{coreData.syncWarnings.map((warning,index) => <div key={index}><AlertTriangle size={17}/>{warning}</div>)}</div>}
      <div className="sync-log">{syncHistory.length === 0 ? <div className="sync-empty">В журнале пока нет записей.</div> : syncHistory.map(item => { const warnings=Boolean(item.warnings?.length); const counts=item.counts || {}; return <div className={`sync-log-row ${warnings?'warning':item.status}`} key={item.id}><div className="sync-log-icon">{item.status==='success'&&!warnings?<CheckCircle2 size={18}/>:<AlertTriangle size={18}/>}</div><div><strong>{item.automatic?'Автоматический повтор':item.status==='success'?(warnings?'Завершено частично':'Завершено успешно'):'Не все этапы завершены'}</strong><span>{new Date(item.at).toLocaleString('ru-RU')}</span></div><div className="sync-log-details"><span>{counts.products ?? 0} товаров</span><span>{counts.orders ?? 0} заказов</span><span>{counts.sales ?? 0} продаж</span><span>{counts.stocks ?? 0} строк остатков</span><span>{counts.advertising ?? 0} кампаний</span>{warnings&&<span className="sync-warning-text">{item.warnings[0]}</span>}</div></div>})}</div>
    </>}</section>
  }

  const renderElPersonalityControls = ({ compact = false } = {}) => (
    <div className={`el-personality-editor ${compact ? 'compact' : ''}`}>
      <div className="el-personality-head">
        <div className="el-personality-avatar"><ElMascot compact mood={elMood}/></div>
        <div>
          <span>Характер Эла</span>
          <h3>{elCharacterMeta[elSettings.character]?.title || 'Свой человек'}</h3>
          <p>{elCharacterMeta[elSettings.character]?.text}</p>
        </div>
        <button type="button" className="primary-btn" onClick={saveElProfile} disabled={elProfileSaving}>
          {elProfileSaving ? <RefreshCw className="spin" size={17}/> : <Save size={17}/>} Сохранить характер
        </button>
      </div>
      <div className="el-character-grid" role="radiogroup" aria-label="Характер Эла">
        {Object.entries(elCharacterMeta).map(([key, meta]) => <button
          type="button" key={key} role="radio" aria-checked={elSettings.character === key}
          className={elSettings.character === key ? 'active' : ''}
          onClick={() => updateElSetting('character', key)}
        ><strong>{meta.title}</strong><span>{meta.text}</span></button>)}
      </div>
      <div className="el-personality-fields">
        <label>Как Эл будет обращаться<input type="text" value={elSettings.preferredName} placeholder={displayName || 'Например, Мария'} onChange={event => updateElSetting('preferredName', event.target.value)}/></label>
        <label>Юмор<select value={elSettings.humor} onChange={event => updateElSetting('humor', event.target.value)}>
          {Object.entries(elHumorMeta).map(([key,label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <label>Обращение<select value={elSettings.address} onChange={event => updateElSetting('address', event.target.value)}>
          <option value="auto">Подстраиваться</option><option value="formal">На «вы»</option><option value="informal">На «ты»</option>
        </select></label>
      </div>
      <div className="el-personality-toggles">
        <label><input type="checkbox" checked={elSettings.support} onChange={event => updateElSetting('support', event.target.checked)}/><span><strong>Поддержка</strong><small>Спокойно помочь, когда тяжело или всё раздражает.</small></span></label>
        <label><input type="checkbox" checked={elSettings.celebrations} onChange={event => updateElSetting('celebrations', event.target.checked)}/><span><strong>Поздравления</strong><small>Отмечать подтверждённые успехи без фальшивой мотивации.</small></span></label>
      </div>
      <div className="el-critical-safety"><ShieldCheck size={17}/><span><strong>В критических ситуациях шутки всегда выключены.</strong> Убытки, штрафы, блокировки и серьёзные ошибки Эл разбирает спокойно и прямо.</span></div>
    </div>
  )

  const renderSettings = () => <section className="app-page glass-panel">
    <div className="page-title"><span>Настройки</span><h1>Параметры бизнеса и Эла</h1><p>Финансовые допущения и характер AI-помощника сохраняются отдельно для вашего аккаунта и кабинета.</p></div>
    <div className="settings-card standalone"><h3><Settings size={20}/> Основные параметры</h3><div className="settings-grid"><label>Комиссия WB, %<input type="number" value={settingsDraft.commissionPercent ?? 0} onChange={e => updateSetting('commissionPercent',e.target.value)}/></label><label>Логистика за продажу, ₽<input type="number" value={settingsDraft.logisticsPerSale ?? 0} onChange={e => updateSetting('logisticsPerSale',e.target.value)}/></label><label>Налог, %<input type="number" value={settingsDraft.taxPercent ?? 0} onChange={e => updateSetting('taxPercent',e.target.value)}/></label><label>Целевая маржа, %<input type="number" value={settingsDraft.targetMarginPercent ?? 20} onChange={e => updateSetting('targetMarginPercent',e.target.value)}/></label></div><button className="primary-btn" onClick={saveSettings} disabled={savingSettings}><Save size={17}/> Сохранить</button></div>
    {renderElPersonalityControls()}
    <div className="security-note"><ShieldCheck size={22}/><div><strong>MAXADORRE и ELISEI не связаны данными</strong><p>В ELISEI перенесена проверенная бизнес-логика, но репозитории, базы, API-ключи и клиентские данные полностью раздельны.</p></div></div>
  </section>

  const renderChat = () => {
    const planTitle = elPlan.tier === 'pro' ? 'Эл Pro' : elPlan.tier === 'gpt' ? 'Эл GPT' : 'Эл Аналитик'
    const modeAvailable = mode => mode === 'analyst' || Boolean(elPlan.features?.[mode])
    const chooseMode = mode => {
      if (!modeAvailable(mode)) {
        notify(`${elModeMeta[mode].title} — дополнительная функция. Сейчас доступен бесплатный Эл Аналитик по WB-кабинету.`)
        return
      }
      setElMode(mode)
      if (mode !== 'pro') setElSettings(current => ({ ...current, allowWeb:false }))
    }
    const suggestions = elMode === 'analyst'
      ? [
          'Какие рекламные кампании съедают прибыль?',
          'Что сейчас важнее всего по кабинету?',
          'Какие товары скоро закончатся и стоит ли их дозаказывать?',
          'Свяжи возвраты с отзывами и карточками',
          'Почему прибыль ниже выручки?',
          'Эл, я устала. Помоги выбрать одно главное действие.',
          'Похвали меня по делу: что в кабинете уже хорошо?',
        ]
      : elMode === 'gpt'
        ? ['Помоги написать ответ покупателю', 'Придумай идеи для карточки товара', 'Поболтай со мной и оцени идею', 'Составь план запуска нового товара']
        : ['Найди свежие изменения правил Wildberries', 'Сравни мой кабинет с трендами рынка', 'Проведи исследование конкурентов', 'Проверь свежие новости маркетплейсов']

    return (
      <section className="app-page glass-panel chat-page el-embedded-chat">
        <div className="page-title el-chat-title">
          <div>
            <span>AI-партнёр</span>
            <h1>Спросить ЭЛа</h1>
            <p>Вопросы по WB-кабинету обрабатывает собственный аналитический движок Елисея без расходов OpenAI. GPT-общение и внешние исследования подключаются отдельно.</p>
          </div>
          <div className="el-chat-actions">
            <div className={`el-chat-presence ${elMood}`}><ElMascot compact mood={elMood}/><span><small>Эл сейчас</small><strong>{elMoodMeta[elMood] || 'На связи'}</strong></span></div>
            <span className="el-current-plan">Тариф Эла: <strong>{planTitle}</strong></span>
            {elMode === 'pro' && <label className="el-chat-toggle"><input type="checkbox" checked={elSettings.allowWeb} onChange={event => setElSettings(current => ({ ...current, allowWeb:event.target.checked }))}/> Интернет</label>}
            <button type="button" className={`secondary-btn ${showElPersonality ? 'active' : ''}`} onClick={() => setShowElPersonality(current => !current)}><Sparkles size={16}/> Характер Эла</button>
            <button type="button" className="secondary-btn" onClick={startNewElConversation} disabled={chatBusy}>Новый диалог</button>
          </div>
        </div>

        <div className="el-mode-switcher" role="tablist" aria-label="Режим Эла">
          {Object.entries(elModeMeta).map(([mode, meta]) => {
            const available = modeAvailable(mode)
            return <button
              key={mode}
              type="button"
              className={`el-mode-card ${elMode === mode ? 'active' : ''} ${available ? '' : 'locked'}`}
              onClick={() => chooseMode(mode)}
              aria-selected={elMode === mode}
            >
              <span className="el-mode-card-top"><strong>{meta.title}</strong><small>{mode === 'analyst' ? 'Включён' : available ? 'Подключён' : meta.subtitle}</small></span>
              <span>{meta.description}</span>
              <b>{mode === 'analyst' ? '0 ₽ за вопросы по кабинету' : available ? 'Доступно' : 'Подключить отдельно'}</b>
            </button>
          })}
        </div>

        <div className={`el-mode-notice ${elMode}`}>
          <ShieldCheck size={18}/>
          <div>
            <strong>{elModeMeta[elMode].title}{elEngineVersion ? ` · ядро ${elEngineVersion}` : ''}</strong>
            <span>{elMode === 'analyst'
              ? 'Работает на данных и расчётах ELISEI. OpenAI API не вызывается.'
              : elMode === 'gpt'
                ? 'Использует OpenAI API только для свободного общения. Вопросы по кабинету автоматически остаются в бесплатном аналитике.'
                : 'Использует OpenAI API и интернет-поиск. Вопросы только по кабинету всё равно маршрутизируются в бесплатный аналитик.'}</span>
          </div>
        </div>

        {showElPersonality && renderElPersonalityControls({ compact:true })}

        <div className="chat-suggestions">
          {suggestions.map(text => <button key={text} disabled={chatBusy} onClick={() => sendChat(null, text)}>{text}</button>)}
        </div>

        <div className="chat-stream" aria-live="polite">
          {messages.map((message,index) => (
            <div key={`${message.createdAt || index}-${index}`} className={`chat-message ${message.role} ${message.error ? 'error' : ''}`}>
              {message.role === 'el' && <div className="el-message-head"><b>ЭЛ</b>{message.reaction?.label && <span className={`el-reaction-chip ${message.reaction.mood || ''}`}>{message.reaction.label}</span>}</div>}
              <p>{message.text}</p>
              {message.role === 'el' && message.mode && <div className="el-response-mode">
                <span>{message.mode === 'analyst' ? 'Эл Аналитик' : message.mode === 'gpt' ? 'Эл GPT' : 'Эл Pro'}</span>
                <small>{message.apiUsed ? 'использован AI API' : 'без расходов OpenAI'}</small>
              </div>}
              {message.modules?.length > 0 && <div className="el-chat-badges">{message.modules.map(module => <span key={module}>{elModuleNames[module] || module}</span>)}</div>}
              {message.usedWeb && <div className="el-web-note">Проверил актуальные источники в интернете</div>}
              {message.role === 'el' && (message.grounding?.facts?.length > 0 || message.grounding?.assumptions?.length > 0) && <details className="el-grounding">
                <summary>На чём основан ответ</summary>
                {message.grounding?.facts?.length > 0 && <div><strong>Факты:</strong> {message.grounding.facts.map(item => elModuleNames[item] || item).join(', ')}</div>}
                {message.grounding?.assumptions?.length > 0 && <div><strong>Ограничения:</strong> {message.grounding.assumptions.slice(0,3).join('; ')}</div>}
              </details>}
              {message.sources?.length > 0 && <div className="el-chat-sources">
                {message.sources.map((source,sourceIndex) => <a key={`${source.url}-${sourceIndex}`} href={source.url} target="_blank" rel="noreferrer">{source.title || source.url}</a>)}
              </div>}
            </div>
          ))}
          {chatBusy && <div className="chat-message el el-thinking-message"><b>ЭЛ</b><p><RefreshCw size={16} className="spin"/> {elMode === 'analyst' ? 'Считаю по данным кабинета…' : 'Думаю и проверяю источники…'}</p></div>}
        </div>

        <form className="chat-form" onSubmit={sendChat}>
          <input value={chat} disabled={chatBusy} onChange={event => setChat(event.target.value)} placeholder={elMode === 'analyst' ? 'Например: почему реклама даёт заказы, но не даёт прибыль?' : 'Напишите Элу сообщение…'}/>
          <button className="primary-btn" aria-label="Отправить" disabled={chatBusy || !chat.trim()}>{chatBusy ? <RefreshCw size={18} className="spin"/> : <Send size={18}/>}</button>
        </form>
        <small className="el-chat-safety">Эл только анализирует и предлагает действия. Изменение цен, ставок, бюджетов и данных — после отдельного подтверждения.</small>
      </section>
    )
  }

  const renderers = {
    'Главная':renderHome, 'Аналитика':renderAnalytics, 'Товары':renderProducts, 'Остатки':renderStocks, 'История остатков':renderStockHistory,
    'Финансы':renderFinance, 'Документы WB':renderDocuments, 'Цены и акции':renderPricing, 'Реклама':renderAdvertising, 'Поисковые запросы':renderSearchQueries, 'Коммуникации':renderCommunications,
    'Сезонность':renderSeasonality, 'Отчёты':renderReports, 'Импорт данных':renderImport, 'AI CRM':renderCrm, 'Спросить ЭЛа':renderChat,
    'Подключения':renderConnections, 'Синхронизации':renderSyncHistory, 'Настройки':renderSettings,
  }
  const content = (renderers[active] || renderHome)()

  return <div className="shell"><aside className="sidebar glass-panel"><button className="brand brand-button" onClick={() => onNavigate('/')}><div className="brand-mark">E</div><div><strong>ELISEI</strong><span>AI Operating System</span></div></button><nav>{nav.map(([label,Icon]) => <button key={label} className={active===label?'nav-item active':'nav-item'} onClick={() => setActive(label)}><Icon size={18}/><span>{label}</span></button>)}</nav><div className="sidebar-foot"><div className="status-dot"/><span>{connection.connected?'Wildberries подключён':'Демо-режим'}</span></div></aside><main className="main"><header className="topbar"><div className="search"><Search size={17}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Найти товар, артикул или модель"/></div><div className="top-actions"><button className="icon-btn" onClick={() => notify(recommendations[0]?.title || 'Новых уведомлений нет')}><Bell size={18}/><span className="ping"/></button><button className="icon-btn" title="Подключения" onClick={() => setActive('Подключения')}><PlugZap size={18}/></button><button className="icon-btn" title="Выйти" onClick={onLogout}><LogOut size={18}/></button><button className="profile" title={rawName || 'Профиль'}>{profileInitial}</button></div></header>{content}</main>{toast&&<div className="app-toast"><CheckCircle2 size={18}/>{toast}</div>}</div>
}
