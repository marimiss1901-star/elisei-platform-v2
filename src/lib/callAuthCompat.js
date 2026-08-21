import { authApi } from './api'

// DashboardPage 5.13.7 still renders a six-digit phone-code field. Until that
// large page is split into smaller settings components, keep it compatible
// with the 5.13.8 four-digit call verification without touching analytics UI.
// The user enters 00 + the final four digits shown by the incoming caller ID;
// only the four real digits are sent to the backend.

const requestPhoneChangeBase = authApi.requestPhoneChange
const confirmPhoneChangeBase = authApi.confirmPhoneChange

authApi.requestPhoneChange = async data => {
  const result = await requestPhoneChangeBase(data)
  return {
    ...result,
    message:`${result.message || 'Сейчас поступит входящий звонок.'} В текущем поле настроек введите 00, затем последние 4 цифры входящего номера.`,
  }
}

authApi.confirmPhoneChange = data => {
  const digits=String(data?.code || '').replace(/\D/g,'')
  const code=digits.length === 6 && digits.startsWith('00') ? digits.slice(-4) : digits
  return confirmPhoneChangeBase({ ...data,code })
}
