const STREAMS = ['finance','acquiring','paidStorage','acceptance','measurementPenalties','deductionsReport','antifraudRetention','labelingRetention']

const money = (row, aliases, fallback = 0) => {
  for (const key of aliases) {
    const raw = row?.[key]
    if (raw === '' || raw == null) continue
    const value = Number(String(raw).replace(',','.'))
    if (Number.isFinite(value)) return value
  }
  return fallback
}

const text = (row, aliases, fallback = '') => {
  for (const key of aliases) {
    const value = row?.[key]
    if (value != null && String(value).trim()) return String(value).trim()
  }
  return fallback
}

const compactDate = value => {
  if (!value) return null
  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0,10)
  const match = String(value).match(/^\d{4}-\d{2}-\d{2}/)
  return match ? match[0] : null
}

const rowSign = row => {
  const reason = `${text(row,['docTypeName','doc_type_name'])} ${text(row,['sellerOperName','seller_oper_name','supplier_oper_name'])} ${text(row,['bonusTypeName','bonus_type_name'])}`.toLowerCase()
  return /возврат|сторно|отмена|refund|return/.test(reason) ? -1 : 1
}

export function classifyFinanceSpecialOperation(row = {}) {
  const source = [
    text(row,['docTypeName','doc_type_name']),
    text(row,['sellerOperName','seller_oper_name','supplier_oper_name']),
    text(row,['bonusTypeName','bonus_type_name']),
    text(row,['paymentProcessing','payment_processing']),
    text(row,['serviceName','service_name']),
    text(row,['name','title','subjectName','subject_name']),
  ].join(' ').toLowerCase()
  if (/(?:^|[^a-zа-яё])(джем|jam)(?:[^a-zа-яё]|$)/i.test(source)) {
    return { code:'jam_subscription', group:'subscriptions', name:'Подписка «Джем»', confirmed:true }
  }
  if (/подписк|конструктор\s+тариф|тарифн(?:ый|ого)\s+план|пакет\s+опци|опци[яи]\s+тариф/i.test(source)) {
    return { code:'subscription_charge', group:'subscriptions', name:text(row,['bonusTypeName','bonus_type_name','sellerOperName','supplier_oper_name'],'Подписка или тарифная опция WB'), confirmed:false }
  }
  if (/реклам|продвижен|wb\s*продвиж|вб\s*продвиж/i.test(source)) {
    return { code:'promotion_charge', group:'advertising', name:text(row,['bonusTypeName','bonus_type_name','sellerOperName','supplier_oper_name'],'Расходы на продвижение WB'), confirmed:true }
  }
  return null
}

export function financeFulfillmentMode(row = {}) {
  const value = `${text(row,['fulfillmentMode','deliveryMethod','delivery_method','warehouseType','warehouse_type'])} ${text(row,['officeName','office_name'])}`.toUpperCase()
  if (Boolean(row?.srvDbs) || /FBS|DBS|СКЛАД ПРОДАВ|ПРОДАВЦ/.test(value)) return 'FBS'
  if (/FBO|FBW|СКЛАД WB|СКЛАД ВБ|WILDBERRIES/.test(value)) return 'FBO'
  return ''
}

const identity = (row = {}) => ({
  nmId:text(row,['nmId','nm_id','nmID']),
  vendorCode:text(row,['vendorCode','vendor_code','saName','sa_name','supplierArticle','oldVendorCode','newVendorCode']),
  barcode:text(row,['sku','barcode','oldSku','newSku']),
  srid:text(row,['srid','rid']),
  orderId:text(row,['orderId','order_id']),
  warehouse:text(row,['officeName','office_name','warehouse','warehouseName']),
  documentType:text(row,['docTypeName','doc_type_name']),
  sellerOperation:text(row,['sellerOperName','seller_oper_name','supplier_oper_name']),
  bonusType:text(row,['bonusTypeName','bonus_type_name']),
  paymentProcessing:text(row,['paymentProcessing','payment_processing']),
  currency:text(row,['currency'],'RUB'),
  reportId:text(row,['reportId','report_id','realizationreport_id']),
  rrdId:text(row,['rrdId','rrd_id']),
  operationDate:compactDate(text(row,['operationDate','rrDate','rr_dt','saleDt','sale_dt','saleDate','acqDate','orderDt','order_dt','orderDate','date','dateFrom','date_from','dtBonus','originalDate','shkCreateDate','giCreateDate','createDate'])),
  fulfillmentMode:financeFulfillmentMode(row),
})

function movementKey(stream, sourceRowKey, code, sourceField = '') {
  // sourceRowKey is already stable (rrdId/report row identity). Do not use the
  // page-local array index: page boundaries can change between WB responses and
  // would otherwise create duplicate money movements after a re-normalization.
  return [stream,sourceRowKey,code,sourceField || 'value'].join(':')
}

function directionFor(value) {
  if (value > 0) return 'income'
  if (value < 0) return 'expense'
  return 'info'
}

function addMovement(target, base, {
  code, group, name, amount, metricRole='breakdown', detailOnly=false,
  includedInPnl=false, sourceField='', note='', index=0,
}) {
  const numeric = Number(amount || 0)
  if (!Number.isFinite(numeric) || Math.abs(numeric) < 0.000001) return
  target.push({
    ...base,
    movementKey:movementKey(base.sourceStream,base.sourceRowKey,code,sourceField),
    operationCode:code,
    operationGroup:group,
    operationName:name,
    direction:directionFor(numeric),
    amount:Math.round(numeric * 100) / 100,
    metricRole,
    detailOnly:Boolean(detailOnly),
    includedInPnl:Boolean(includedInPnl),
    sourceField,
    note,
  })
}

export function normalizeFinanceLedgerRows(stream, row = {}, sourceRowKey = '', index = 0) {
  if (!STREAMS.includes(stream)) return []
  const id = identity(row)
  const base = {
    sourceStream:stream,
    sourceRowKey:String(sourceRowKey || `${stream}:${index}`),
    ...id,
    sourcePayload:row,
  }
  const result = []

  if (stream === 'finance') {
    const sign = rowSign(row)
    const mode = id.fulfillmentMode || 'FBO'
    // Realization rows without an explicit warehouse marker are WB-warehouse
    // operations (FBO). Persist the resolved mode on every generated movement;
    // previously it was used only in the label, leaving FBS/FBO filters empty.
    base.fulfillmentMode = mode
    const gross = sign * Math.abs(money(row,['retailAmount','retail_amount','retailPriceWithDiscRub','retail_price_withdisc_rub','retailPriceWithDisc'],0))
    const sellerPayable = sign * Math.abs(money(row,['forPay','for_pay','ppvzForPay','ppvz_for_pay'],0))
    const vw = money(row,['vw','ppvzVw','ppvz_vw'],Number.NaN)
    const vat = Math.abs(money(row,['vwNds','vw_nds','ppvzVwNds','ppvz_vw_nds'],0))
    const commission = Number.isFinite(vw)
      ? Math.abs(vw) + vat
      : Math.abs(money(row,['ppvzSalesCommission','ppvz_sales_commission'],0)) + vat
    const delivery = Math.abs(money(row,['deliveryService','delivery_service','deliveryRub','delivery_rub'],0))
    const logisticsRebill = Math.abs(money(row,['rebillLogisticCost','rebill_logistic_cost'],0))
    const storage = Math.abs(money(row,['paidStorage','paid_storage','storageFee','storage_fee'],0))
    const acceptance = Math.abs(money(row,['paidAcceptance','paid_acceptance','acceptance'],0))
    const acquiring = Math.abs(money(row,['acquiringFee','acquiring_fee'],0))
    const penalty = Math.abs(money(row,['penalty'],0))
    const deduction = Math.abs(money(row,['deduction'],0))
    const additional = money(row,['additionalPayment','additional_payment'],0)
    const ppvzReward = Math.abs(money(row,['ppvzReward','ppvz_reward'],0))
    const cashbackAmount = money(row,['cashbackAmount','cashback_amount'],0)
    const cashbackCommission = money(row,['cashbackCommissionChange','cashback_commission_change'],0)
    const installment = money(row,['installmentCofinancingAmount','installment_cofinancing_amount'],0)

    addMovement(result,base,{ code:'gross_sale',group:'sales',name:sign < 0 ? 'Возврат товара — розничная сумма' : 'Продажа товара — розничная сумма',amount:gross,metricRole:'control',sourceField:'retailAmount',index })
    addMovement(result,base,{ code:'seller_payable',group:'settlement',name:sign < 0 ? 'Сторно к перечислению продавцу' : 'К перечислению продавцу',amount:sellerPayable,metricRole:'settlement',sourceField:'forPay',index })
    addMovement(result,base,{ code:'wb_commission',group:'commission',name:'Комиссия и вознаграждение WB',amount:-commission,metricRole:'breakdown',includedInPnl:true,sourceField:'vw + vwNds',index })

    const deliveryName = sign < 0
      ? `Обратная логистика ${mode}`
      : mode === 'FBS' ? 'Отправка и доставка FBS' : 'Логистика FBO'
    addMovement(result,base,{ code:sign < 0 ? 'reverse_logistics' : mode === 'FBS' ? 'fbs_delivery' : 'fbo_delivery',group:'logistics',name:deliveryName,amount:-delivery,metricRole:'breakdown',includedInPnl:true,sourceField:'deliveryService',index })
    addMovement(result,base,{ code:'transport_reimbursement',group:'logistics',name:'Возмещение издержек по перевозке и складским операциям',amount:-logisticsRebill,metricRole:'breakdown',includedInPnl:true,sourceField:'rebillLogisticCost',index })
    addMovement(result,base,{ code:'paid_storage',group:'storage',name:'Платное хранение',amount:-storage,metricRole:'breakdown',includedInPnl:true,sourceField:'paidStorage',index })
    addMovement(result,base,{ code:'paid_acceptance',group:'acceptance',name:'Платная приёмка',amount:-acceptance,metricRole:'breakdown',includedInPnl:true,sourceField:'paidAcceptance',index })
    addMovement(result,base,{ code:'acquiring',group:'acquiring',name:id.paymentProcessing || 'Эквайринг и обработка платежа',amount:-acquiring,metricRole:'breakdown',includedInPnl:true,sourceField:'acquiringFee',index })
    addMovement(result,base,{ code:'penalty',group:'penalties',name:id.bonusType || 'Штраф WB',amount:-penalty,metricRole:'breakdown',includedInPnl:true,sourceField:'penalty',index })
    const specialOperation = classifyFinanceSpecialOperation(row)
    addMovement(result,base,{
      code:specialOperation?.code || 'deduction',
      group:specialOperation?.group || 'deductions',
      name:specialOperation?.name || id.bonusType || id.sellerOperation || 'Удержание WB',
      amount:-deduction,metricRole:'breakdown',includedInPnl:true,sourceField:'deduction',
      note:specialOperation ? (specialOperation.confirmed ? 'Категория подтверждена текстом операции WB.' : 'Категория определена по описанию операции; точное название услуги сохранено в исходной строке.') : '',index,
    })
    addMovement(result,base,{
      code:additional < 0 && specialOperation ? specialOperation.code : 'additional_payment',
      group:additional < 0 && specialOperation ? specialOperation.group : (additional >= 0 ? 'compensations' : 'adjustments'),
      name:additional < 0 && specialOperation ? specialOperation.name : id.bonusType || id.sellerOperation || (additional >= 0 ? 'Доплата / компенсация WB' : 'Корректировка WB'),
      amount:additional,metricRole:'adjustment',includedInPnl:true,sourceField:'additionalPayment',
      note:additional < 0 && specialOperation ? 'Специальное списание распознано по официальному описанию операции WB.' : '',index,
    })
    addMovement(result,base,{ code:'pickup_point_service',group:'logistics',name:'Возмещение за выдачу и возврат на ПВЗ',amount:-ppvzReward,metricRole:'breakdown',includedInPnl:false,sourceField:'ppvzReward',note:'Показывается отдельно для прозрачности; не прибавляется повторно к P&L.',index })
    addMovement(result,base,{ code:'cashback',group:cashbackAmount >= 0 ? 'compensations' : 'adjustments',name:'Кешбэк / корректировка кешбэка',amount:cashbackAmount,metricRole:'adjustment',includedInPnl:false,sourceField:'cashbackAmount',index })
    addMovement(result,base,{ code:'cashback_commission_change',group:cashbackCommission >= 0 ? 'compensations' : 'adjustments',name:'Изменение комиссии по кешбэку',amount:cashbackCommission,metricRole:'adjustment',includedInPnl:false,sourceField:'cashbackCommissionChange',index })
    addMovement(result,base,{ code:'installment_cofinancing',group:'compensations',name:'Софинансирование рассрочки',amount:installment,metricRole:'adjustment',includedInPnl:false,sourceField:'installmentCofinancingAmount',index })
  }

  if (stream === 'acquiring') {
    const fee = Math.abs(money(row,['acquiringFee','acquiring_fee','acquiringFeeSum','acquiring_fee_sum'],0))
    const vat = Math.abs(money(row,['acquiringFeeVat','acquiring_fee_vat','acquiringFeeVatSum','acquiring_fee_vat_sum'],0))
    addMovement(result,base,{ code:'acquiring_detail',group:'acquiring',name:text(row,['paymentSystem','payment_system','acquiringBank','acquiring_bank'],'Детализация эквайринга'),amount:-(fee+vat),metricRole:'detail',detailOnly:true,includedInPnl:false,sourceField:'acquiringFee + VAT',note:'Детализация отдельного отчёта; в P&L повторно не суммируется.',index })
  }

  if (stream === 'paidStorage') {
    const amount = Math.abs(money(row,['warehousePrice','warehouse_price','amount','total'],0))
    addMovement(result,{...base,fulfillmentMode:'FBO'},{ code:'paid_storage_detail',group:'storage',name:'Хранение FBO — детализация по товару и складу',amount:-amount,metricRole:'detail',detailOnly:true,includedInPnl:false,sourceField:'warehousePrice',note:'Отдельный отчёт хранения; не суммируется повторно, если сумма уже есть в финансовой детализации.',index })
  }

  if (stream === 'acceptance') {
    const amount = Math.abs(money(row,['total','amount'],0))
    addMovement(result,{...base,fulfillmentMode:'FBO'},{ code:'paid_acceptance_detail',group:'acceptance',name:'Платная приёмка FBO — детализация',amount:-amount,metricRole:'detail',detailOnly:true,includedInPnl:false,sourceField:'total',note:'Отдельный отчёт приёмки; не суммируется повторно, если сумма уже есть в финансовой детализации.',index })
  }

  if (stream === 'measurementPenalties') {
    const amount = Math.abs(money(row,['penaltyAmount','penalty_amount','penaltySum','penalty_sum','fine','penalty','amount','sum','deduction'],0))
    const reversal = Math.abs(money(row,['reversalAmount','reversal_amount','compensationAmount','compensation_amount'],0))
    addMovement(result,base,{ code:'measurement_penalty_detail',group:'penalties',name:text(row,['reason','penaltyReason','penalty_reason','type'],'Штраф за занижение габаритов'),amount:-amount,metricRole:'detail',detailOnly:true,includedInPnl:false,sourceField:'penaltyAmount',note:'Детализация отчёта об удержаниях. В P&L повторно не суммируется, если удержание уже входит в финансовую детализацию.',index })
    addMovement(result,base,{ code:'measurement_penalty_reversal',group:'compensations',name:'Возврат удержания за габариты',amount:reversal,metricRole:'detail',detailOnly:true,includedInPnl:false,sourceField:'reversalAmount',note:'Компенсационная строка отчёта о габаритах. В P&L повторно не суммируется, если возврат уже отражён в финансовой детализации.',index })
  }

  if (stream === 'deductionsReport') {
    const amount = Math.abs(money(row,['bonusSumm','bonus_summ','amount','sum','deduction'],0))
    addMovement(result,base,{ code:'substitution_deduction_detail',group:'deductions',name:text(row,['bonusType','bonus_type','reason'],'Подмена или неверное вложение'),amount:-amount,metricRole:'detail',detailOnly:true,includedInPnl:false,sourceField:'bonusSumm',note:'Детализация удержания за подмену/вложение. В P&L повторно не суммируется, если сумма уже есть в финансовой детализации.',index })
  }

  if (stream === 'antifraudRetention') {
    const amount = Math.abs(money(row,['sum','amount','deduction'],0))
    addMovement(result,base,{ code:'self_purchase_deduction_detail',group:'deductions',name:'Самовыкуп — удержание WB',amount:-amount,metricRole:'detail',detailOnly:true,includedInPnl:false,sourceField:'sum',note:'Официальная детализация удержаний за самовыкупы. В P&L не суммируется повторно, если сумма уже отражена в отчёте реализации.',index })
  }

  if (stream === 'labelingRetention') {
    const amount = Math.abs(money(row,['amount','sum','penalty'],0))
    addMovement(result,base,{ code:'labeling_penalty_detail',group:'penalties',name:'Штраф за отсутствие или нечитаемую маркировку',amount:-amount,metricRole:'detail',detailOnly:true,includedInPnl:false,sourceField:'amount',note:'Официальная детализация нарушения маркировки с фотофиксацией. В P&L не суммируется повторно, если штраф уже отражён в отчёте реализации.',index })
  }

  return result
}

export async function ensureFinanceLedgerSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS wb_finance_ledger (
      connection_id UUID NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,
      movement_key TEXT NOT NULL,
      source_stream TEXT NOT NULL,
      source_row_key TEXT NOT NULL,
      source_report_id TEXT,
      source_rrd_id TEXT,
      operation_date DATE,
      operation_code TEXT NOT NULL,
      operation_group TEXT NOT NULL,
      operation_name TEXT NOT NULL,
      direction TEXT NOT NULL,
      amount NUMERIC(20,2) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'RUB',
      metric_role TEXT NOT NULL DEFAULT 'breakdown',
      detail_only BOOLEAN NOT NULL DEFAULT FALSE,
      included_in_pnl BOOLEAN NOT NULL DEFAULT FALSE,
      fulfillment_mode TEXT,
      nm_id TEXT,
      vendor_code TEXT,
      barcode TEXT,
      srid TEXT,
      order_id TEXT,
      warehouse TEXT,
      document_type TEXT,
      seller_operation TEXT,
      bonus_type TEXT,
      payment_processing TEXT,
      source_field TEXT,
      note TEXT,
      source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(connection_id,movement_key)
    );
    CREATE INDEX IF NOT EXISTS wb_finance_ledger_period_idx ON wb_finance_ledger(connection_id,operation_date DESC);
    CREATE INDEX IF NOT EXISTS wb_finance_ledger_product_idx ON wb_finance_ledger(connection_id,nm_id,operation_date DESC);
    CREATE INDEX IF NOT EXISTS wb_finance_ledger_group_idx ON wb_finance_ledger(connection_id,operation_group,operation_date DESC);
    CREATE INDEX IF NOT EXISTS wb_finance_ledger_mode_idx ON wb_finance_ledger(connection_id,fulfillment_mode,operation_date DESC);
    ALTER TABLE wb_finance_ledger ADD COLUMN IF NOT EXISTS normalization_version INTEGER NOT NULL DEFAULT 1;
  `)
}

export async function persistFinanceLedgerBatch(db,{ connectionId,stream,rows,keyOf,batchSize=250 }) {
  if (!STREAMS.includes(stream)) return { sourceRows:0,movements:0 }
  const sourceRows = Array.isArray(rows) ? rows : []
  let movementCount = 0
  for (let offset=0; offset<sourceRows.length; offset+=batchSize) {
    const sourceChunk = sourceRows.slice(offset,offset+batchSize)
    const movements = sourceChunk.flatMap((row,index) => normalizeFinanceLedgerRows(stream,row,String(keyOf(row,offset+index)),offset+index))
    if (!movements.length) continue
    await db.query(`
      INSERT INTO wb_finance_ledger (
        connection_id,movement_key,source_stream,source_row_key,source_report_id,source_rrd_id,
        operation_date,operation_code,operation_group,operation_name,direction,amount,currency,
        metric_role,detail_only,included_in_pnl,fulfillment_mode,nm_id,vendor_code,barcode,srid,order_id,
        warehouse,document_type,seller_operation,bonus_type,payment_processing,source_field,note,source_payload,normalization_version,updated_at
      )
      SELECT $1,
        item->>'movementKey',item->>'sourceStream',item->>'sourceRowKey',NULLIF(item->>'reportId',''),NULLIF(item->>'rrdId',''),
        NULLIF(item->>'operationDate','')::date,item->>'operationCode',item->>'operationGroup',item->>'operationName',item->>'direction',
        COALESCE((item->>'amount')::numeric,0),COALESCE(NULLIF(item->>'currency',''),'RUB'),item->>'metricRole',
        COALESCE((item->>'detailOnly')::boolean,false),COALESCE((item->>'includedInPnl')::boolean,false),NULLIF(item->>'fulfillmentMode',''),
        NULLIF(item->>'nmId',''),NULLIF(item->>'vendorCode',''),NULLIF(item->>'barcode',''),NULLIF(item->>'srid',''),NULLIF(item->>'orderId',''),
        NULLIF(item->>'warehouse',''),NULLIF(item->>'documentType',''),NULLIF(item->>'sellerOperation',''),NULLIF(item->>'bonusType',''),
        NULLIF(item->>'paymentProcessing',''),NULLIF(item->>'sourceField',''),NULLIF(item->>'note',''),COALESCE(item->'sourcePayload','{}'::jsonb),4,NOW()
      FROM jsonb_array_elements($2::jsonb) item
      ON CONFLICT (connection_id,movement_key) DO UPDATE SET
        operation_date=EXCLUDED.operation_date,operation_group=EXCLUDED.operation_group,operation_name=EXCLUDED.operation_name,
        direction=EXCLUDED.direction,amount=EXCLUDED.amount,currency=EXCLUDED.currency,metric_role=EXCLUDED.metric_role,
        detail_only=EXCLUDED.detail_only,included_in_pnl=EXCLUDED.included_in_pnl,fulfillment_mode=EXCLUDED.fulfillment_mode,
        nm_id=EXCLUDED.nm_id,vendor_code=EXCLUDED.vendor_code,barcode=EXCLUDED.barcode,srid=EXCLUDED.srid,order_id=EXCLUDED.order_id,
        warehouse=EXCLUDED.warehouse,document_type=EXCLUDED.document_type,seller_operation=EXCLUDED.seller_operation,
        bonus_type=EXCLUDED.bonus_type,payment_processing=EXCLUDED.payment_processing,source_field=EXCLUDED.source_field,
        note=EXCLUDED.note,source_payload=EXCLUDED.source_payload,normalization_version=4,updated_at=NOW()
    `,[connectionId,JSON.stringify(movements)])
    movementCount += movements.length
  }
  return { sourceRows:sourceRows.length,movements:movementCount }
}

export async function backfillFinanceLedgerFromStreamItems(db,{ connectionId,limitPerStream=150000 } = {}) {
  const streamResult = await db.query(`
    SELECT stream,
           COUNT(DISTINCT row_key)::int AS source_rows,
           MAX(updated_at) AS source_updated_at
    FROM wb_stream_items
    WHERE connection_id=$1 AND stream=ANY($2::text[])
    GROUP BY stream
    ORDER BY stream
  `,[connectionId,STREAMS])
  let movements=0
  let processedStreams=0
  let skippedStreams=0

  for(const sourceStats of streamResult.rows){
    const stream=String(sourceStats.stream)
    const sourceRows=Number(sourceStats.source_rows || 0)
    const ledgerStats=await db.query(`
      SELECT COUNT(DISTINCT source_row_key)::int AS ledger_source_rows,
             COALESCE(MIN(normalization_version),1)::int AS min_version,
             MAX(updated_at) AS ledger_updated_at
      FROM wb_finance_ledger
      WHERE connection_id=$1 AND source_stream=$2
    `,[connectionId,stream])
    const ledgerSourceRows=Number(ledgerStats.rows[0]?.ledger_source_rows || 0)
    const minVersion=Number(ledgerStats.rows[0]?.min_version || 1)
    const sourceUpdatedAt=sourceStats.source_updated_at ? new Date(sourceStats.source_updated_at).getTime() : 0
    const ledgerUpdatedAt=ledgerStats.rows[0]?.ledger_updated_at ? new Date(ledgerStats.rows[0].ledger_updated_at).getTime() : 0
    const needsRebuild=minVersion < 4 || ledgerSourceRows < sourceRows || (sourceUpdatedAt && sourceUpdatedAt > ledgerUpdatedAt)
    if(!needsRebuild){ skippedStreams += 1; continue }

    // Version 4 is an authoritative rebuild. Remove movements created by the
    // older index-based key so that the same WB source row cannot be counted
    // twice. Raw source rows remain untouched in wb_stream_items.
    await db.query(`
      DELETE FROM wb_finance_ledger
      WHERE connection_id=$1 AND source_stream=$2 AND normalization_version<4
    `,[connectionId,stream])

    let afterKey=''
    let seen=0
    const effectiveLimit=Math.max(Number(limitPerStream || 0),sourceRows)
    while(seen < effectiveLimit){
      const page=await db.query(`
        SELECT DISTINCT ON (row_key) row_key,payload
        FROM wb_stream_items
        WHERE connection_id=$1 AND stream=$2 AND row_key>$3
        ORDER BY row_key,updated_at DESC
        LIMIT 1000
      `,[connectionId,stream,afterKey])
      if(!page.rows.length) break
      const result=await persistFinanceLedgerBatch(db,{
        connectionId,stream,rows:page.rows.map(item=>item.payload),
        keyOf:(_row,index)=>page.rows[index].row_key,batchSize:250,
      })
      movements += result.movements
      seen += page.rows.length
      afterKey=page.rows.at(-1).row_key
      if(page.rows.length < 1000) break
    }
    processedStreams += 1
  }

  return { skipped:processedStreams===0,movements,processedStreams,skippedStreams,normalizationVersion:4 }
}

function addFilter(filters, params, sql, value) {
  params.push(value)
  filters.push(sql.replace('?',`$${params.length}`))
}

export async function queryFinanceLedger(db,{ connectionId,from,to,group,mode,role,query,page=1,limit=100 }) {
  const filters = ['connection_id=$1']
  const params = [connectionId]
  if (from) addFilter(filters,params,'operation_date>=?::date',from)
  if (to) addFilter(filters,params,'operation_date<=?::date',to)
  if (group && group !== 'all') {
    const groups = String(group).split(',').map(item=>item.trim()).filter(Boolean)
    if (groups.length === 1) addFilter(filters,params,'operation_group=?',groups[0])
    else if (groups.length > 1) {
      params.push(groups)
      filters.push(`operation_group=ANY($${params.length}::text[])`)
    }
  }
  if (mode && mode !== 'all') addFilter(filters,params,'fulfillment_mode=?',mode)
  if (role && role !== 'all') addFilter(filters,params,'metric_role=?',role)
  if (query) {
    params.push(`%${String(query).trim()}%`)
    const p = `$${params.length}`
    filters.push(`(operation_name ILIKE ${p} OR seller_operation ILIKE ${p} OR bonus_type ILIKE ${p} OR vendor_code ILIKE ${p} OR nm_id ILIKE ${p} OR srid ILIKE ${p} OR order_id ILIKE ${p})`)
  }
  const where = filters.join(' AND ')
  const safeLimit = Math.max(20,Math.min(500,Number(limit)||100))
  const safePage = Math.max(1,Number(page)||1)
  const offset = (safePage-1)*safeLimit
  const count = await db.query(`SELECT COUNT(*)::int AS count FROM wb_finance_ledger WHERE ${where}`,params)
  const rows = await db.query(`
    SELECT movement_key AS "movementKey",source_stream AS "sourceStream",source_row_key AS "sourceRowKey",
      source_report_id AS "reportId",source_rrd_id AS "rrdId",operation_date AS "operationDate",
      operation_code AS "operationCode",operation_group AS "operationGroup",operation_name AS "operationName",
      direction,amount::float8 AS amount,currency,metric_role AS "metricRole",detail_only AS "detailOnly",
      included_in_pnl AS "includedInPnl",fulfillment_mode AS "fulfillmentMode",nm_id AS "nmId",
      vendor_code AS "vendorCode",barcode,srid,order_id AS "orderId",warehouse,document_type AS "documentType",
      seller_operation AS "sellerOperation",bonus_type AS "bonusType",payment_processing AS "paymentProcessing",
      source_field AS "sourceField",note,updated_at AS "updatedAt"
    FROM wb_finance_ledger WHERE ${where}
    ORDER BY operation_date DESC NULLS LAST,updated_at DESC
    LIMIT $${params.length+1} OFFSET $${params.length+2}
  `,[...params,safeLimit,offset])

  const summary = await db.query(`
    SELECT
      COUNT(*)::int AS movements,
      COALESCE(SUM(CASE WHEN metric_role='settlement' THEN amount ELSE 0 END),0)::float8 AS seller_payable,
      COALESCE(SUM(CASE WHEN operation_code='gross_sale' THEN amount ELSE 0 END),0)::float8 AS gross_revenue,
      COALESCE(SUM(CASE WHEN included_in_pnl=TRUE AND detail_only=FALSE AND amount<0 THEN ABS(amount) ELSE 0 END),0)::float8 AS expenses,
      COALESCE(SUM(CASE WHEN detail_only=FALSE AND amount<0 THEN ABS(amount) ELSE 0 END),0)::float8 AS all_expenses,
      COALESCE(SUM(CASE WHEN metric_role='adjustment' AND detail_only=FALSE AND amount>0 THEN amount ELSE 0 END),0)::float8 AS compensations,
      COALESCE(SUM(CASE WHEN operation_group='commission' AND detail_only=FALSE THEN ABS(amount) ELSE 0 END),0)::float8 AS commission,
      COALESCE(SUM(CASE WHEN operation_group='logistics' AND detail_only=FALSE THEN ABS(amount) ELSE 0 END),0)::float8 AS logistics,
      COALESCE(SUM(CASE WHEN operation_group='storage' AND detail_only=FALSE THEN ABS(amount) ELSE 0 END),0)::float8 AS storage,
      COALESCE(SUM(CASE WHEN operation_group='acceptance' AND detail_only=FALSE THEN ABS(amount) ELSE 0 END),0)::float8 AS acceptance,
      COALESCE(SUM(CASE WHEN operation_group='acquiring' AND detail_only=FALSE THEN ABS(amount) ELSE 0 END),0)::float8 AS acquiring,
      COALESCE(SUM(CASE WHEN operation_group='penalties' AND detail_only=FALSE THEN ABS(amount) ELSE 0 END),0)::float8 AS penalties,
      COALESCE(SUM(CASE WHEN operation_group='deductions' AND detail_only=FALSE THEN ABS(amount) ELSE 0 END),0)::float8 AS deductions,
      COALESCE(SUM(CASE WHEN operation_group='subscriptions' AND detail_only=FALSE THEN ABS(amount) ELSE 0 END),0)::float8 AS subscriptions,
      COALESCE(SUM(CASE WHEN operation_code='jam_subscription' AND detail_only=FALSE THEN ABS(amount) ELSE 0 END),0)::float8 AS jam_charges,
      COALESCE(SUM(CASE WHEN operation_group='advertising' AND detail_only=FALSE THEN ABS(amount) ELSE 0 END),0)::float8 AS advertising_charges,
      COALESCE(SUM(CASE WHEN fulfillment_mode='FBS' AND operation_group='logistics' AND detail_only=FALSE THEN ABS(amount) ELSE 0 END),0)::float8 AS fbs_logistics,
      MIN(operation_date) AS date_from,MAX(operation_date) AS date_to
    FROM wb_finance_ledger WHERE ${where}
  `,params)
  const groupRows = await db.query(`
    SELECT operation_group AS "group",COUNT(*)::int AS movements,
      COALESCE(SUM(CASE WHEN amount>0 AND detail_only=FALSE THEN amount ELSE 0 END),0)::float8 AS income,
      COALESCE(SUM(CASE WHEN amount<0 AND included_in_pnl=TRUE AND detail_only=FALSE THEN ABS(amount) ELSE 0 END),0)::float8 AS expense,
      COALESCE(SUM(CASE WHEN amount<0 AND detail_only=TRUE THEN ABS(amount) ELSE 0 END),0)::float8 AS "detailExpense"
    FROM wb_finance_ledger WHERE ${where}
    GROUP BY operation_group ORDER BY expense DESC,income DESC
  `,params)
  const sourceRows = await db.query(`
    SELECT source_stream AS stream,COUNT(*)::int AS movements,MAX(updated_at) AS "updatedAt"
    FROM wb_finance_ledger WHERE connection_id=$1 GROUP BY source_stream
  `,[connectionId])
  const productRows = await db.query(`
    SELECT COALESCE(nm_id,'') AS "nmId",COALESCE(vendor_code,'') AS "vendorCode",
      COALESCE(fulfillment_mode,'') AS "fulfillmentMode",COUNT(*)::int AS movements,
      COALESCE(SUM(CASE WHEN metric_role='settlement' THEN amount ELSE 0 END),0)::float8 AS "sellerPayable",
      COALESCE(SUM(CASE WHEN included_in_pnl=TRUE AND detail_only=FALSE AND amount<0 THEN ABS(amount) ELSE 0 END),0)::float8 AS expenses,
      COALESCE(SUM(CASE WHEN detail_only=FALSE AND amount<0 THEN ABS(amount) ELSE 0 END),0)::float8 AS all_expenses,
      COALESCE(SUM(CASE WHEN metric_role='adjustment' AND detail_only=FALSE AND amount>0 THEN amount ELSE 0 END),0)::float8 AS compensations,
      COALESCE(SUM(CASE WHEN operation_group='logistics' AND detail_only=FALSE THEN ABS(amount) ELSE 0 END),0)::float8 AS logistics,
      COALESCE(SUM(CASE WHEN operation_group='penalties' AND detail_only=FALSE THEN ABS(amount) ELSE 0 END),0)::float8 AS penalties,
      COALESCE(SUM(CASE WHEN operation_group='deductions' AND detail_only=FALSE THEN ABS(amount) ELSE 0 END),0)::float8 AS deductions
    FROM wb_finance_ledger WHERE ${where} AND (nm_id IS NOT NULL OR vendor_code IS NOT NULL)
    GROUP BY nm_id,vendor_code,fulfillment_mode
    ORDER BY ABS(COALESCE(SUM(CASE WHEN metric_role='settlement' THEN amount ELSE 0 END),0)) DESC
    LIMIT 300
  `,params)
  const modeRows = await db.query(`
    SELECT COALESCE(fulfillment_mode,'Не определено') AS mode,COUNT(*)::int AS movements,
      COALESCE(SUM(CASE WHEN metric_role='settlement' THEN amount ELSE 0 END),0)::float8 AS "sellerPayable",
      COALESCE(SUM(CASE WHEN metric_role IN ('breakdown','adjustment') AND detail_only=FALSE AND amount<0 THEN ABS(amount) ELSE 0 END),0)::float8 AS expenses
    FROM wb_finance_ledger WHERE ${where}
    GROUP BY fulfillment_mode ORDER BY mode
  `,params)
  const timelineRows = await db.query(`
    SELECT operation_date AS date,COUNT(*)::int AS movements,
      COALESCE(SUM(CASE WHEN metric_role='settlement' THEN amount ELSE 0 END),0)::float8 AS "sellerPayable",
      COALESCE(SUM(CASE WHEN operation_code='gross_sale' THEN amount ELSE 0 END),0)::float8 AS "grossRevenue",
      COALESCE(SUM(CASE WHEN included_in_pnl=TRUE AND detail_only=FALSE AND amount<0 THEN ABS(amount) ELSE 0 END),0)::float8 AS expenses,
      COALESCE(SUM(CASE WHEN metric_role='adjustment' AND detail_only=FALSE AND amount>0 THEN amount ELSE 0 END),0)::float8 AS compensations,
      COALESCE(SUM(CASE WHEN operation_group IN ('penalties','deductions') AND detail_only=FALSE THEN ABS(amount) ELSE 0 END),0)::float8 AS retentions
    FROM wb_finance_ledger WHERE ${where} AND operation_date IS NOT NULL
    GROUP BY operation_date ORDER BY operation_date
  `,params)
  const value = summary.rows[0] || {}
  const componentNet = Number(value.gross_revenue||0) - Number(value.expenses||0) + Number(value.compensations||0)
  const difference = Number(value.seller_payable||0) - componentNet
  return {
    rows:rows.rows,
    pagination:{ page:safePage,limit:safeLimit,total:Number(count.rows[0]?.count||0),pages:Math.max(1,Math.ceil(Number(count.rows[0]?.count||0)/safeLimit)) },
    summary:{
      movements:Number(value.movements||0),sellerPayable:Number(value.seller_payable||0),grossRevenue:Number(value.gross_revenue||0),
      expenses:Number(value.expenses||0),allExpenses:Number(value.all_expenses||0),compensations:Number(value.compensations||0),commission:Number(value.commission||0),
      logistics:Number(value.logistics||0),fbsLogistics:Number(value.fbs_logistics||0),storage:Number(value.storage||0),
      acceptance:Number(value.acceptance||0),acquiring:Number(value.acquiring||0),penalties:Number(value.penalties||0),
      deductions:Number(value.deductions||0),subscriptions:Number(value.subscriptions||0),jamCharges:Number(value.jam_charges||0),
      advertisingCharges:Number(value.advertising_charges||0),componentNet:Math.round(componentNet*100)/100,
      reconciliationDifference:Math.round(difference*100)/100,dateFrom:value.date_from||null,dateTo:value.date_to||null,
    },
    groups:groupRows.rows,
    sources:sourceRows.rows,
    products:productRows.rows,
    modes:modeRows.rows,
    timeline:timelineRows.rows,
  }
}

// The compact stream snapshot is optimized for recovery, while the ledger is
// the durable, date-addressable source of truth for user-selected periods.
// Return the same aggregate shape buildCoreAnalytics already understands so a
// login can render confirmed finance directly from PostgreSQL without waiting
// for another WB request or for the background worker to rebuild JSON.
export async function queryFinanceCoreRows(db,{ connectionId,from,to }) {
  if (!connectionId || !from || !to) return []
  const result = await db.query(`
    SELECT operation_date AS "operationDate",
      COALESCE(nm_id,'') AS "nmId",COALESCE(vendor_code,'') AS "vendorCode",
      COALESCE(barcode,'') AS barcode,COALESCE(fulfillment_mode,'') AS "fulfillmentMode",
      COUNT(DISTINCT source_row_key)::int AS "rowCount",
      COALESCE(SUM(CASE WHEN operation_code='gross_sale' THEN amount ELSE 0 END),0)::float8 AS "grossRevenueAmount",
      COALESCE(SUM(CASE WHEN metric_role='settlement' THEN amount ELSE 0 END),0)::float8 AS "sellerPayableAmount",
      COALESCE(SUM(CASE WHEN operation_group='commission' AND included_in_pnl=TRUE THEN ABS(amount) ELSE 0 END),0)::float8 AS "commissionAmount",
      COALESCE(SUM(CASE WHEN operation_group='logistics' AND operation_code<>'transport_reimbursement' AND included_in_pnl=TRUE THEN ABS(amount) ELSE 0 END),0)::float8 AS "logisticsAmount",
      COALESCE(SUM(CASE WHEN operation_code='transport_reimbursement' AND included_in_pnl=TRUE THEN ABS(amount) ELSE 0 END),0)::float8 AS "logisticsRebillAmount",
      COALESCE(SUM(CASE WHEN operation_group='storage' AND included_in_pnl=TRUE THEN ABS(amount) ELSE 0 END),0)::float8 AS "storageAmount",
      COALESCE(SUM(CASE WHEN operation_group='acceptance' AND included_in_pnl=TRUE THEN ABS(amount) ELSE 0 END),0)::float8 AS "acceptanceAmount",
      COALESCE(SUM(CASE WHEN operation_group='acquiring' AND included_in_pnl=TRUE THEN ABS(amount) ELSE 0 END),0)::float8 AS "acquiringAmount",
      COALESCE(SUM(CASE WHEN operation_group='penalties' AND included_in_pnl=TRUE THEN ABS(amount) ELSE 0 END),0)::float8 AS "penaltiesAmount",
      COALESCE(SUM(CASE WHEN operation_group IN ('deductions','subscriptions') AND included_in_pnl=TRUE THEN ABS(amount) ELSE 0 END),0)::float8 AS "deductionsAmount",
      COALESCE(SUM(CASE WHEN source_field='additionalPayment' AND operation_group NOT IN ('advertising','subscriptions') AND included_in_pnl=TRUE THEN amount ELSE 0 END),0)::float8 AS "additionalPaymentAmount",
      COALESCE(SUM(CASE WHEN included_in_pnl=TRUE AND amount<0 THEN ABS(amount) ELSE 0 END),0)::float8 AS "expenseAmount",
      COALESCE(SUM(CASE WHEN metric_role='adjustment' AND included_in_pnl=TRUE AND amount>0 THEN amount ELSE 0 END),0)::float8 AS "compensationsAmount",
      COALESCE(SUM(CASE WHEN operation_group='deductions' AND included_in_pnl=TRUE THEN ABS(amount) ELSE 0 END),0)::float8 AS "ledgerDeductionsAmount",
      COALESCE(SUM(CASE WHEN operation_group='subscriptions' AND included_in_pnl=TRUE THEN ABS(amount) ELSE 0 END),0)::float8 AS "subscriptionsAmount",
      COALESCE(SUM(CASE WHEN operation_group='advertising' AND included_in_pnl=TRUE THEN ABS(amount) ELSE 0 END),0)::float8 AS "advertisingChargesAmount"
    FROM wb_finance_ledger
    WHERE connection_id=$1 AND source_stream='finance' AND detail_only=FALSE
      AND operation_date >= $2::date AND operation_date <= $3::date
    GROUP BY operation_date,nm_id,vendor_code,barcode,fulfillment_mode
    ORDER BY operation_date,nm_id,vendor_code,barcode,fulfillment_mode
  `,[connectionId,from,to])
  return result.rows.map(row=>({
    __aggregated:true,
    operationDate:row.operationDate || null,
    nmId:row.nmId || null,
    vendorCode:row.vendorCode || '',
    barcode:row.barcode || '',
    fulfillmentMode:row.fulfillmentMode || '',
    rowCount:Number(row.rowCount || 0),
    grossRevenueAmount:Number(row.grossRevenueAmount || 0),
    sellerPayableAmount:Number(row.sellerPayableAmount || 0),
    commissionAmount:Number(row.commissionAmount || 0),
    logisticsAmount:Number(row.logisticsAmount || 0),
    logisticsRebillAmount:Number(row.logisticsRebillAmount || 0),
    storageAmount:Number(row.storageAmount || 0),
    acceptanceAmount:Number(row.acceptanceAmount || 0),
    acquiringAmount:Number(row.acquiringAmount || 0),
    penaltiesAmount:Number(row.penaltiesAmount || 0),
    deductionsAmount:Number(row.deductionsAmount || 0),
    additionalPaymentAmount:Number(row.additionalPaymentAmount || 0),
    expenseAmount:Number(row.expenseAmount || 0),
    compensationsAmount:Number(row.compensationsAmount || 0),
    ledgerDeductionsAmount:Number(row.ledgerDeductionsAmount || 0),
    subscriptionsAmount:Number(row.subscriptionsAmount || 0),
    advertisingChargesAmount:Number(row.advertisingChargesAmount || 0),
  }))
}

export function summarizeFinanceCoreRows(rows = []) {
  const summary={
    movements:0,sellerPayable:0,grossRevenue:0,expenses:0,compensations:0,
    commission:0,logistics:0,storage:0,acceptance:0,acquiring:0,
    penalties:0,deductions:0,subscriptions:0,advertisingCharges:0,
  }
  for(const row of Array.isArray(rows) ? rows : []){
    summary.movements += Number(row.rowCount || 0)
    summary.sellerPayable += Number(row.sellerPayableAmount || 0)
    summary.grossRevenue += Number(row.grossRevenueAmount || 0)
    summary.expenses += Number(row.expenseAmount || 0)
    summary.compensations += Number(row.compensationsAmount || 0)
    summary.commission += Number(row.commissionAmount || 0)
    summary.logistics += Number(row.logisticsAmount || 0)+Number(row.logisticsRebillAmount || 0)
    summary.storage += Number(row.storageAmount || 0)
    summary.acceptance += Number(row.acceptanceAmount || 0)
    summary.acquiring += Number(row.acquiringAmount || 0)
    summary.penalties += Number(row.penaltiesAmount || 0)
    summary.deductions += Number(row.ledgerDeductionsAmount || 0)
    summary.subscriptions += Number(row.subscriptionsAmount || 0)
    summary.advertisingCharges += Number(row.advertisingChargesAmount || 0)
  }
  return Object.fromEntries(Object.entries(summary).map(([key,value])=>[key,Math.round(Number(value || 0)*100)/100]))
}
