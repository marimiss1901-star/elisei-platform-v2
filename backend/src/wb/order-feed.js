export const ORDER_FEED_ENDPOINT='https://seller-analytics-api.wildberries.ru/api/analytics/v1/order-feed'
export const ORDER_FEED_MAX_PERIOD_DAYS=31
export const ORDER_FEED_PAGE_LIMIT=10000
export const ORDER_FEED_PRIMARY_VERSION=1

function iso(value,fallback=Date.now()){
  const date=new Date(value ?? fallback)
  if(!Number.isFinite(date.getTime())) throw Object.assign(new Error('Некорректная дата WB Order Feed'),{status:400,code:'WB_ORDER_FEED_INVALID_DATE'})
  return date.toISOString()
}

export function orderFeedWindow({start,end=new Date()}={}){
  const endIso=iso(end)
  const endMs=Date.parse(endIso)
  const defaultStart=new Date(endMs-30*86400000)
  const startIso=iso(start ?? defaultStart)
  const startMs=Date.parse(startIso)
  if(startMs>endMs) throw Object.assign(new Error('Начало периода WB Order Feed позже конца периода'),{status:400})
  if(endMs-startMs>ORDER_FEED_MAX_PERIOD_DAYS*86400000){
    throw Object.assign(new Error('WB Order Feed отдаёт максимум 31 день за запрос'),{status:400,code:'WB_ORDER_FEED_PERIOD_TOO_LONG',maxPeriodDays:ORDER_FEED_MAX_PERIOD_DAYS})
  }
  return {start:startIso,end:endIso}
}

export function buildOrderFeedRequest({start,end,offset=0,limit=ORDER_FEED_PAGE_LIMIT,snapshotTime=null}={}){
  const pagination={offset:Math.max(0,Number(offset)||0),limit:Math.max(1,Math.min(ORDER_FEED_PAGE_LIMIT,Number(limit)||ORDER_FEED_PAGE_LIMIT))}
  if(pagination.offset>0 && snapshotTime) pagination.snapshotTime=iso(snapshotTime,snapshotTime)
  return {
    url:ORDER_FEED_ENDPOINT,
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({selectedPeriod:orderFeedWindow({start,end}),pagination}),
  }
}

const money=value=>Number.isFinite(Number(value))?Number(value):0

export function normalizeOrderFeedOrder(row={},context={}){
  const status=String(row.status||'').trim()
  const createdAt=iso(row.createdAt||row.created_at)
  const updatedAt=iso(row.updatedAt||row.updated_at||createdAt)
  const sellerPrice=money(row.sellerPrice??row.seller_price)
  const isMp=Boolean(row.isMp??row.is_mp)
  const srid=String(row.srid||'').trim()
  return {
    nmId:Number(row.nmId??row.nm_id)||null,
    chrtId:Number(row.chrtId??row.chrt_id)||null,
    srid,
    date:createdAt,
    orderDate:createdAt,
    createdAt,
    lastChangeDate:updatedAt,
    updatedAt,
    status,
    orderFeedStatus:status,
    cancelType:row.cancelType??row.cancel_type??null,
    isCancel:status==='cancel',
    warehouseName:String(row.warehouseName??row.warehouse_name??''),
    warehouseRegion:String(row.warehouseRegion??row.warehouse_region??''),
    isMp,
    fulfillmentMode:isMp?'FBS':'FBO',
    deliveryMethod:isMp?'FBS':'FBO',
    destinationCity:String(row.destinationCity??row.destination_city??''),
    destinationDistrict:String(row.destinationDistrict??row.destination_district??''),
    sellerPrice,
    finishedPrice:sellerPrice,
    priceWithDisc:sellerPrice,
    totalPrice:sellerPrice,
    isB2b:Boolean(row.isB2b??row.is_b2b),
    source:'order_feed',
    orderFeedSnapshotTime:context.snapshotTime||null,
  }
}

export function orderFeedSalesRows(orders=[]){
  const rows=[]
  for(const order of Array.isArray(orders)?orders:[]){
    const status=String(order?.orderFeedStatus||order?.status||'')
    if(!['buyout','return','returnDefective'].includes(status)) continue
    const isReturn=status==='return'||status==='returnDefective'
    const srid=String(order?.srid||'').trim()
    const eventDate=order?.updatedAt||order?.lastChangeDate||order?.createdAt||order?.date
    rows.push({
      ...order,
      date:eventDate,
      sale_dt:eventDate,
      lastChangeDate:eventDate,
      saleID:`${isReturn?'R':'S'}:${srid}`,
      isReturn,
      returnType:isReturn?status:null,
      source:'order_feed',
    })
  }
  return rows
}

function srid(row={}){ return String(row?.srid||row?.rid||'').trim() }

export function mergeOrderFeedOrders(previousRows=[],feedRows=[]){
  const covered=new Set((Array.isArray(feedRows)?feedRows:[]).map(srid).filter(Boolean))
  const map=new Map()
  for(const row of Array.isArray(previousRows)?previousRows:[]){
    const key=srid(row)
    if(key&&covered.has(key)) continue
    map.set(key||`legacy:${map.size}`,row)
  }
  for(const row of Array.isArray(feedRows)?feedRows:[]) map.set(srid(row)||`feed:${map.size}`,row)
  return [...map.values()]
}

export function mergeOrderFeedSales(previousRows=[],derivedRows=[],feedOrders=[]){
  // Order Feed is authoritative for every srid present in its 31-day window.
  // If a formerly bought-out order is now cancelled, its old legacy sale row
  // must disappear instead of being kept as a duplicate/stale sale.
  const authoritativeSrids=new Set((Array.isArray(feedOrders)?feedOrders:[]).map(srid).filter(Boolean))
  const map=new Map()
  for(const row of Array.isArray(previousRows)?previousRows:[]){
    const key=srid(row)
    if(key&&authoritativeSrids.has(key)) continue
    map.set(key||`legacy:${map.size}`,row)
  }
  for(const row of Array.isArray(derivedRows)?derivedRows:[]) map.set(srid(row)||`feed:${map.size}`,row)
  return [...map.values()]
}

export function orderFeedRateLimitSeconds({typeId=0,serviceSecretReady=false}={}){
  // WB's Basic token without client secret is intentionally conservative.
  return Number(typeId)===1&&!serviceSecretReady?3*60*60:60
}
