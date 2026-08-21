import { useState } from 'react'
import { ArrowLeft, ArrowRight, Building2, CheckCircle2, LockKeyhole, Mail, Phone, ShieldCheck, UserRound } from 'lucide-react'
import ElMascot from '../components/ElMascot'
import { authApi } from '../lib/api'

const successStyle = { padding:'12px 14px', borderRadius:12, border:'1px solid rgba(87,214,170,.35)', background:'rgba(87,214,170,.08)', color:'inherit', fontSize:13, lineHeight:1.45 }

export default function RegisterPage({ onNavigate, onRegister }) {
  const [form, setForm] = useState({ name:'', company:'', email:'', phone:'', password:'' })
  const [callCode, setCallCode] = useState('')
  const [callStarted, setCallStarted] = useState(false)
  const [phoneVerified, setPhoneVerified] = useState(false)
  const [phoneVerificationToken, setPhoneVerificationToken] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [callLoading, setCallLoading] = useState(false)

  const invalidatePhoneVerification = next => {
    setForm(current => ({ ...current, ...next }))
    setPhoneVerified(false)
    setPhoneVerificationToken('')
    setCallStarted(false)
    setCallCode('')
    setMessage('')
  }

  const requestCode = async () => {
    setError(''); setMessage(''); setCallLoading(true)
    try {
      const result = await authApi.requestRegisterPhoneCode({ email:form.email, phone:form.phone })
      setCallStarted(true)
      setMessage(result.message || 'Сейчас поступит входящий звонок. Введите последние 4 цифры номера, с которого звонят.')
    } catch (err) { setError(err.message) } finally { setCallLoading(false) }
  }

  const confirmCode = async () => {
    setError(''); setMessage(''); setCallLoading(true)
    try {
      const result = await authApi.confirmRegisterPhoneCode({ email:form.email, phone:form.phone, code:callCode })
      setPhoneVerificationToken(result.verificationToken || '')
      setPhoneVerified(true)
      setMessage(result.message || 'Телефон подтверждён.')
    } catch (err) { setError(err.message) } finally { setCallLoading(false) }
  }

  const submit = async (e) => {
    e.preventDefault(); setError('')
    if (!phoneVerified || !phoneVerificationToken) return setError('Сначала подтвердите телефон кодом из входящего звонка.')
    setLoading(true)
    try { onRegister(await authApi.register({ ...form, phoneVerificationToken })) }
    catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  return <div className="auth-page"><button className="auth-back" onClick={()=>onNavigate('/')}><ArrowLeft size={17}/> На главную</button><section className="auth-card register-card glass-panel"><div className="auth-brand"><span>E</span><strong>ELISEI</strong></div><div className="auth-el"><ElMascot compact/></div><div className="trial-pill">3 дня бесплатно</div><h1>Создайте аккаунт</h1><p>Телефон подтверждается входящим звонком и потом используется только для безопасного восстановления доступа.</p><form onSubmit={submit}>
    <label><span>Ваше имя</span><div><UserRound size={17}/><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Мария" required/></div></label>
    <label><span>Компания или магазин</span><div><Building2 size={17}/><input value={form.company} onChange={e=>setForm({...form,company:e.target.value})} placeholder="Название магазина" required/></div></label>
    <label><span>Электронная почта</span><div><Mail size={17}/><input type="email" value={form.email} onChange={e=>invalidatePhoneVerification({email:e.target.value})} placeholder="name@company.ru" required/></div></label>
    <label><span>Телефон для восстановления</span><div><Phone size={17}/><input type="tel" value={form.phone} onChange={e=>invalidatePhoneVerification({phone:e.target.value})} placeholder="+7 999 123-45-67" autoComplete="tel" required disabled={phoneVerified}/></div></label>
    {!phoneVerified && <div style={{display:'grid',gap:10,marginBottom:10}}>
      <button className="secondary-btn" type="button" onClick={requestCode} disabled={callLoading || !form.email || !form.phone}><Phone size={17}/>{callLoading ? 'Запрашиваем звонок…' : (callStarted ? 'Позвонить ещё раз' : 'Получить звонок')}</button>
      {callStarted && <><div style={successStyle}>{message || 'Не отвечайте на звонок — нужны только последние 4 цифры входящего номера.'}</div><div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:8}}><input aria-label="Последние 4 цифры входящего номера" inputMode="numeric" autoComplete="one-time-code" value={callCode} onChange={e=>setCallCode(e.target.value.replace(/\D/g,'').slice(0,4))} placeholder="Последние 4 цифры" maxLength={4}/><button className="secondary-btn" type="button" onClick={confirmCode} disabled={callLoading || callCode.length !== 4}><ShieldCheck size={17}/> Проверить</button></div></>}
    </div>}
    {phoneVerified && <div style={successStyle}><CheckCircle2 size={16} style={{verticalAlign:'middle',marginRight:6}}/>Телефон подтверждён</div>}
    <label><span>Пароль</span><div><LockKeyhole size={17}/><input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="Минимум 8 символов" required minLength={8}/></div></label>
    {error && <div className="auth-error">{error}</div>}
    <button className="primary-btn auth-submit" disabled={loading || !phoneVerified}>{loading ? 'Создаём…' : <>Создать аккаунт <ArrowRight size={17}/></>}</button>
  </form><small>Уже есть аккаунт? <button onClick={()=>onNavigate('/login')}>Войти</button></small></section></div>
}
