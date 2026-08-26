import fs from 'node:fs'

const file='src/server.js'
let source=fs.readFileSync(file,'utf8')

function replaceOnce(oldText,newText,label){
  if(source.includes(newText)) return
  if(!source.includes(oldText)) throw new Error(`Order Feed primary patch: ${label} target not found`)
  source=source.replace(oldText,newText)
}

if(!source.includes("from './wb/order-feed.js'")){
  replaceOnce(
    "const { buildDecisionAnalysis, previousEqualPeriod } = elDecisionEngine",
    "import { ORDER_FEED_ENDPOINT, ORDER_FEED_PAGE_LIMIT, ORDER_FEED_PRIMARY_VERSION, buildOrderFeedRequest, unwrapOrderFeedResponse, normalizeOrderFeedOrder, orderFeedSalesRows, mergeOrderFeedOrders, mergeOrderFeedSales, orderFeedRateLimitSeconds } from './wb/order-feed.js'\n\nconst { buildDecisionAnalysis, previousEqualPeriod } = elDecisionEngine",
    'order feed import')
}

replaceOnce("orders: { label: 'Заказы', scope: 'statistics' }","orders: { label: 'Заказы', scope: 'analytics' }",'orders analytics scope')
replaceOnce("sales: { label: 'Продажи', scope: 'statistics' }","sales: { label: 'Продажи', scope: 'analytics' }",'sales analytics scope')

const loader=`async function loadOrderFeedPrimary(token, { deadlineAt = 0, previousOrders = [], previousSales = [] } = {}) {\n  const tokenInfo=inspectWbToken(token)\n  const serviceSecretReady=Boolean(publicServiceSecretStatus().valid)\n  const minimumIntervalSeconds=orderFeedRateLimitSeconds({typeId:tokenInfo.typeId,serviceSecretReady})\n  const end=new Date()\n  const start=new Date(end.getTime()-30*86400000)\n  let offset=0\n  let snapshotTime=null\n  let currency='RUB'\n  const rawOrders=[]\n  const rawPages=[]\n  for(let page=0;page<20;page+=1){\n    const request=buildOrderFeedRequest({start,end,offset,limit:ORDER_FEED_PAGE_LIMIT,snapshotTime})\n    const payload=await wbFetch(request.url,token,{\n      method:request.method,headers:request.headers,body:request.body,\n      label:'Лента заказов WB',timeoutMs:45000,maxAttempts:1,maxRetryDelayMs:0,deadlineAt,\n    })\n    const pageData=unwrapOrderFeedResponse(payload)\n    const pageRows=pageData.orders\n    if(!snapshotTime&&pageData.snapshotTime) snapshotTime=pageData.snapshotTime\n    if(pageData.currency) currency=String(pageData.currency)\n    rawPages.push({snapshotTime:pageData.snapshotTime||snapshotTime,currency,orders:pageRows})\n    rawOrders.push(...pageRows)\n    if(pageRows.length<ORDER_FEED_PAGE_LIMIT) break\n    if(Number(tokenInfo.typeId)===1&&!serviceSecretReady){\n      throw Object.assign(new Error('Лента заказов WB: следующий лист доступен только в следующее окно базового токена. Предыдущие подтверждённые данные сохранены.'),{\n        status:429,code:'WB_ORDER_FEED_NEXT_PAGE_WINDOW',retryAfterSeconds:minimumIntervalSeconds,\n      })\n    }\n    offset+=pageRows.length\n  }\n  const feedOrders=rawOrders.map(row=>normalizeOrderFeedOrder(row,{snapshotTime}))\n  const orders=mergeOrderFeedOrders(previousOrders,feedOrders)\n  const sales=mergeOrderFeedSales(previousSales,orderFeedSalesRows(feedOrders),feedOrders)\n  const statusCounts=feedOrders.reduce((out,row)=>{const key=String(row.orderFeedStatus||'unknown');out[key]=(out[key]||0)+1;return out},{})\n  return {\n    orders,sales,rawPayload:{snapshotTime,currency,pages:rawPages},endpoint:ORDER_FEED_ENDPOINT,\n    validation:{\n      source:'order_feed',primaryVersion:ORDER_FEED_PRIMARY_VERSION,snapshotTime,currency,\n      incomingRows:feedOrders.length,ordersRows:orders.length,salesRows:sales.length,statusCounts,\n      minimumIntervalSeconds,tokenType:tokenInfo.type||tokenInfo.typeLabel||tokenInfo.typeId||null,\n    },\n  }\n}\n\n`
if(!source.includes('async function loadOrderFeedPrimary(')){
  const marker='async function runSyncStage({ connection, tokens, data, stage, deadlineAt }) {'
  if(!source.includes(marker)) throw new Error('Order Feed primary patch: runner insertion target not found')
  source=source.replace(marker,loader+marker)
}

replaceOnce(
"    let value\n    let meta = null\n    let snapshot = null",
"    let value\n    let meta = null\n    let snapshot = null\n    let siblingSalesValue = null\n    let siblingSalesMeta = null",
'runner sibling sales variables')

replaceOnce(
`    } else if (stage === 'orders' || stage === 'sales') {\n      const loaded = await loadStatisticsRows(stage, selected.token, {\n        deadlineAt,previousRows:fallback,dateFromOverride:state?.metadata?.dailyReadyDate || state?.metadata?.dateFrom || '',\n      })\n      value = loaded.value\n      snapshot = loaded\n    } else if (stage === 'advertising') {`,
`    } else if (stage === 'orders') {\n      const hydrated=await hydrateStreamData(pool,connection.id,data,{repair:false})\n      const loaded=await loadOrderFeedPrimary(selected.token,{\n        deadlineAt,previousOrders:fallback,previousSales:Array.isArray(hydrated.data?.sales)?hydrated.data.sales:[],\n      })\n      value=loaded.orders\n      siblingSalesValue=loaded.sales\n      siblingSalesMeta=loaded.validation\n      meta=loaded.validation\n      snapshot={...loaded,normalizedPayload:value}\n    } else if (stage === 'sales') {\n      // Sales are derived from the same authoritative Order Feed snapshot.\n      // This stage never spends a second WB request merely to duplicate the feed.\n      const hydrated=await hydrateStreamData(pool,connection.id,data,{repair:false})\n      const feedOrders=(Array.isArray(hydrated.data?.orders)?hydrated.data.orders:[]).filter(row=>row?.source==='order_feed'||row?.orderFeedStatus)\n      value=mergeOrderFeedSales(fallback,orderFeedSalesRows(feedOrders),feedOrders)\n      meta={source:'order_feed_derived',primaryVersion:ORDER_FEED_PRIMARY_VERSION,derivedFromOrders:true,ordersRows:feedOrders.length,salesRows:value.length}\n      snapshot=null\n    } else if (stage === 'advertising') {`,
'orders/sales runner switch')

replaceOnce(
`    const count = stageCount(stage, value)\n    const stateMetadata = {`,
`    if(stage==='orders'&&Array.isArray(siblingSalesValue)){\n      await saveStreamData(pool,{\n        connectionId:connection.id,stream:'sales',payload:siblingSalesValue,\n        metadata:{endpoint:ORDER_FEED_ENDPOINT,validation:siblingSalesMeta||{},tokenId:selected.row.id,lastSuccessAt:new Date().toISOString()},\n        source:'order_feed_derived',\n      })\n      data.sales=siblingSalesValue\n      await updateSyncState(connection.id,'sales',{\n        status:'success',lastAttemptAt:new Date().toISOString(),lastSuccessAt:new Date().toISOString(),nextAllowedAt:null,lastError:null,\n        lastCount:stageCount('sales',siblingSalesValue),taskId:null,\n        metadata:{...(siblingSalesMeta||{}),tokenId:selected.row.id,tokenLabel:selected.row.label,primary:Boolean(selected.row.is_primary),orderFeedPrimaryVersion:ORDER_FEED_PRIMARY_VERSION,derivedFromOrders:true},\n      })\n    }\n\n    const count = stageCount(stage, value)\n    const stateMetadata = {`,
'save sibling sales')

replaceOnce(
"      automaticRetryReason:null,\n      lastTransientError:null,",
"      automaticRetryReason:null,\n      lastTransientError:null,\n      ...(['orders','sales'].includes(stage)?{orderFeedPrimaryVersion:ORDER_FEED_PRIMARY_VERSION,orderFeedSource:stage==='orders'?'primary':'derived'}:{}),",
'order feed state metadata')

const recovery=`async function recoverLegacyOrderFeedState({ connectionId = null } = {}) {\n  if(!pool) return []\n  const params=[String(ORDER_FEED_PRIMARY_VERSION)]\n  let connectionFilter=''\n  if(connectionId){params.push(connectionId);connectionFilter=' AND connection_id=$2'}\n  const result=await pool.query(\`\n    UPDATE wb_sync_states\n    SET status='queued',next_allowed_at=NOW(),task_id=NULL,\n        last_error='ELISEI обновляет парсер Ленты заказов WB. Последние подтверждённые данные сохранены.',\n        metadata=(COALESCE(metadata,'{}'::jsonb)-'scheduler'-'automaticRetryAttempt'-'automaticRetryReason')\n          || jsonb_build_object('orderFeedMigrationQueuedVersion',$1::int,'orderFeedMigrationQueuedAt',NOW()),\n        updated_at=NOW()\n    WHERE stage='orders'\n      AND COALESCE(metadata->>'orderFeedPrimaryVersion','')<>$1::text\n      AND COALESCE(metadata->>'orderFeedMigrationQueuedVersion','')<>$1::text\n      \${connectionFilter}\n    RETURNING connection_id,stage\n  \`,params)\n  return result.rows\n}\n\n`
if(!source.includes('async function recoverLegacyOrderFeedState(')){
  const marker='async function recoverLegacySearchQueryBindings({ connectionId = null } = {}) {'
  if(!source.includes(marker)) throw new Error('Order Feed primary patch: recovery insertion target not found')
  source=source.replace(marker,recovery+marker)
}

source=source.replaceAll(
"  await recoverLegacyRuntimeRateWindows({ connectionId:connection.id })\n  await recoverLegacySearchQueryBindings({ connectionId:connection.id })",
"  await recoverLegacyRuntimeRateWindows({ connectionId:connection.id })\n  await recoverLegacyOrderFeedState({ connectionId:connection.id })\n  await recoverLegacySearchQueryBindings({ connectionId:connection.id })")
source=source.replaceAll(
"  await recoverStaleSyncStates({ connectionId:connection.id, reason:'status-heartbeat' })\n  await recoverLegacySearchQueryBindings({ connectionId:connection.id })",
"  await recoverStaleSyncStates({ connectionId:connection.id, reason:'status-heartbeat' })\n  await recoverLegacyOrderFeedState({ connectionId:connection.id })\n  await recoverLegacySearchQueryBindings({ connectionId:connection.id })")

fs.writeFileSync(file,source)
console.log('WB Order Feed primary + derived sales applied')
