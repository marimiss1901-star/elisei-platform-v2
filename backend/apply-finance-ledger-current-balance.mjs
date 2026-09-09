import fs from 'node:fs'

// ELISEI 5.19.14 — Finance ledger carries the dedicated current balance stream.
// The ledger is period-filtered; account balance is not. Do not fall back to the
// old balance embedded in a stale finance realization payload when the dedicated
// balance stream has a newer WB snapshot.
const file=new URL('./src/server.js',import.meta.url)
let source=fs.readFileSync(file,'utf8')

function replaceOnce(before,after,label){
  if(source.includes(after)) return
  if(!source.includes(before)) throw new Error(`ELISEI 5.19.14 current finance balance: ${label} marker not found`)
  source=source.replace(before,after)
}

replaceOnce(
`    const supportingStreams = ['finance','financeReports','acquiringReports','documents','jamSubscription','measurementPenalties','deductionsReport','warehouseMeasurements','antifraudRetention','labelingRetention']`,
`    const supportingStreams = ['finance','balance','financeReports','acquiringReports','documents','jamSubscription','measurementPenalties','deductionsReport','warehouseMeasurements','antifraudRetention','labelingRetention']`,
'finance supporting streams')

replaceOnce(
`    const financePayload = payloadByStream.finance?.payload || {}\n    const financeEverReady = Boolean(`,
`    const financePayload = payloadByStream.finance?.payload || {}\n    const dedicatedBalancePayload = payloadByStream.balance?.payload && typeof payloadByStream.balance.payload === 'object' && !Array.isArray(payloadByStream.balance.payload)\n      ? payloadByStream.balance.payload\n      : null\n    const currentBalancePayload = dedicatedBalancePayload && (dedicatedBalancePayload.current != null || dedicatedBalancePayload.for_withdraw != null)\n      ? dedicatedBalancePayload\n      : financePayload.balance || null\n    const financeEverReady = Boolean(`,
'current balance payload')

replaceOnce(
`      balance:financePayload.balance || null,`,
`      balance:currentBalancePayload,`,
'finance ledger response balance')

fs.writeFileSync(file,source)
console.log('ELISEI 5.19.14 Finance ledger current balance stream applied')
