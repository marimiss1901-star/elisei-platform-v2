import fs from 'node:fs'

const file='src/pages/DashboardPage.jsx'
let source=fs.readFileSync(file,'utf8')

function replaceOnce(oldText,newText,label){
  if(source.includes(newText)) return
  if(!source.includes(oldText)) throw new Error(`Dashboard orders local fallback patch: ${label} target not found`)
  source=source.replace(oldText,newText)
}

replaceOnce(
`    const salesAvailableForPeriod = stateAvailable(snapshotSalesState,analyticsAvailability.sales)
    const ordersAvailableForPeriod = stateAvailable(snapshotOrdersState,analyticsAvailability.orders)
    const sellerPayableAvailable = financeAvailableForPeriod && (financeMovementsInPeriod > 0 || snapshotFinanceState === 'ready')`,
`    const salesAvailableForPeriod = stateAvailable(snapshotSalesState,analyticsAvailability.sales)
    // Daily Ready is deliberately last-known-good, so its stored one-day snapshot
    // can lag behind the freshly rebuilt local core for a short time. If the core
    // already contains real order rows for the selected day, those rows are
    // stronger evidence than an older partial snapshot. This is local DB data;
    // opening Main still never triggers an extra WB request.
    const coreOrdersSelectedRows = Number(analyticsCore?.periodCoverage?.orders?.selectedRows || 0)
    const ordersFromFreshCore = Boolean(
      snapshotMode
      && snapshotOrdersState !== 'ready'
      && coreOrdersSelectedRows > 0
      && analyticsCore?.summary?.orders != null
    )
    const ordersAvailableForPeriod = stateAvailable(snapshotOrdersState,analyticsAvailability.orders) || ordersFromFreshCore
    const ordersMetricValue = ordersFromFreshCore ? analyticsCore.summary.orders : businessSummary.orders
    const ordersMetricPartial = statePartial(snapshotOrdersState,!analyticsAvailability.orders && Boolean(syncStateFor('orders'))) && !ordersFromFreshCore
    const sellerPayableAvailable = financeAvailableForPeriod && (financeMovementsInPeriod > 0 || snapshotFinanceState === 'ready')`,
'orders readiness fallback',
)

replaceOnce(
`      metric('Заказы',businessSummary.orders,businessSummary.orders,previousSummary.orders,{ money:false,note:ordersAvailableForPeriod ? \`${'${formatNumber(businessSummary.sales)}'} продаж\` : 'заказы ещё подтверждаются WB',available:ordersAvailableForPeriod,partial:statePartial(snapshotOrdersState,!analyticsAvailability.orders && Boolean(syncStateFor('orders'))) }),`,
`      metric('Заказы',ordersMetricValue,ordersMetricValue,previousSummary.orders,{ money:false,note:ordersFromFreshCore ? 'подтверждено сохранёнными строками заказов ELISEI' : ordersAvailableForPeriod ? \`${'${formatNumber(businessSummary.sales)}'} продаж\` : 'заказы ещё подтверждаются WB',available:ordersAvailableForPeriod,partial:ordersMetricPartial }),`,
'orders metric value',
)

fs.writeFileSync(file,source)
console.log('Dashboard confirmed local orders fallback applied')
