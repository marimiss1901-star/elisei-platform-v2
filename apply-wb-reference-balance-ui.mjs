import fs from 'node:fs'

const file='src/pages/DashboardPage.jsx'
let source=fs.readFileSync(file,'utf8')

function replaceOnce(oldText,newText,label){
  if(source.includes(newText)) return
  if(!source.includes(oldText)) throw new Error(`WB reference/balance UI patch: ${label} target not found`)
  source=source.replace(oldText,newText)
}

replaceOnce(
`    const sellerPayableAvailable = financeAvailableForPeriod && (financeMovementsInPeriod > 0 || snapshotFinanceState === 'ready')
    const digitizationMetrics = [`,
`    const sellerPayableAvailable = financeAvailableForPeriod && (financeMovementsInPeriod > 0 || snapshotFinanceState === 'ready')
    const wbBalance = analyticsCore?.finance?.balance && typeof analyticsCore.finance.balance === 'object' ? analyticsCore.finance.balance : null
    const moneyOrNull = value => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null
    const wbCurrentBalance = moneyOrNull(wbBalance?.current)
    const wbForWithdraw = moneyOrNull(wbBalance?.for_withdraw)
    const wbBalanceUpdatedAt = wbBalance?.updatedAt || wbBalance?.updated_at || null
    const digitizationMetrics = [`,
'home balance variables')

replaceOnce(
`      { label:'К перечислению',value:sellerPayableAvailable && !(financePartial && Number(ledgerSummary.sellerPayable || 0) === 0) ? formatMoney(ledgerSummary.sellerPayable || 0) : financeHasAnyProgress ? 'Уточняется…' : 'Ожидается',delta:sellerPayableAvailable ? (financePartial ? 'предварительно · финансы догружаются' : 'подтверждено финансовым реестром WB') : financeHasAnyProgress ? 'часть финансов уже сохранена' : 'ожидаем финансовые данные',tone:'',onClick:'Финансы' },`,
`      { label:'К перечислению',value:sellerPayableAvailable && !(financePartial && Number(ledgerSummary.sellerPayable || 0) === 0) ? formatMoney(ledgerSummary.sellerPayable || 0) : financeHasAnyProgress ? 'Уточняется…' : 'Ожидается',delta:sellerPayableAvailable ? (financePartial ? 'предварительно · финансы догружаются' : 'подтверждено финансовым реестром WB') : financeHasAnyProgress ? 'часть финансов уже сохранена' : 'ожидаем финансовые данные',tone:'',onClick:'Финансы' },
      { label:'Доступно к выводу',value:wbForWithdraw == null ? 'Ожидается' : formatMoney(wbForWithdraw),delta:wbForWithdraw == null ? 'ночной снимок баланса WB ещё не загружен' : \`текущий баланс ${'${wbCurrentBalance == null ? "—" : formatMoney(wbCurrentBalance)}'}${'${wbBalanceUpdatedAt ? ` · ${formatLocalDateTime(wbBalanceUpdatedAt)}` : ""}'}\`,tone:'',onClick:'Финансы' },`,
'home withdraw metric')

replaceOnce(
`        <MetricCard label="К перечислению" value={financeValue(ledgerSummary.sellerPayable)} delta="поле forPay из отчёта WB" icon={WalletCards}/>
        <MetricCard label="Расходы WB"`,
`        <MetricCard label="К перечислению" value={financeValue(ledgerSummary.sellerPayable)} delta="поле forPay из отчёта WB · выбранный период" icon={WalletCards}/>
        <MetricCard label="Доступно к выводу" value={analyticsCore?.finance?.balance?.for_withdraw == null ? 'Ожидается' : formatMoney(analyticsCore.finance.balance.for_withdraw)} delta="текущий снимок WB · не зависит от выбранного периода" icon={WalletCards}/>
        <MetricCard label="Баланс WB" value={analyticsCore?.finance?.balance?.current == null ? 'Ожидается' : formatMoney(analyticsCore.finance.balance.current)} delta={analyticsCore?.finance?.balance?.updatedAt ? \`обновлено ${'${formatLocalDateTime(analyticsCore.finance.balance.updatedAt)}'}\` : 'ночной снимок ещё не загружен'} icon={CircleDollarSign}/>
        <MetricCard label="Расходы WB"`,
'finance balance cards')

replaceOnce(
`      { stage:'finance', title:'Финансы', text:'Детализация реализации, комиссия, логистика, удержания, выплаты и баланс' },`,
`      { stage:'finance', title:'Финансы', text:'Детализация реализации, комиссия, логистика, удержания и выплаты за период' },
      { stage:'balance', title:'Баланс WB', text:'Текущий баланс кабинета и сумма, доступная к выводу' },`,
'balance sync requirement')

fs.writeFileSync(file,source)
console.log('WB reference balance UI applied')
