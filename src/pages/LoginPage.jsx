import { useState } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, LockKeyhole, Mail, Phone, ShieldCheck } from 'lucide-react'
import ElMascot from '../components/ElMascot'
import { authApi } from '../lib/api'

const successStyle = { padding:'12px 14px', borderRadius:12, border:'1px solid rgba(87,214,170,.35)', background:'rgba(87,214,170,.08)', color:'inherit', fontSize:13, lineHeight:1.45 }

export default function LoginPage({ onNavigate, onLogin }) {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ email:'', password:'' })
  const [recovery, setRecovery] = useState({ email:'', phone:'', password:'', confirm:'' })
  const [callInfo, setCallInfo] = useState({ phone:'', pretty:'' })
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const clearNotices = () => { setError(''); setMessage('') }
  const openRecovery = () => {
    clearNotices()
    setRecovery({ email:form.email, phone:'', password:'', confirm:'' })
    setCallInfo({ phone:'', pretty:'' })
    setMode('request')
  }
  const backToLogin = () => {
    clearNotices()
    setRecovery({ email:'', phone:'', password:'', confirm:'' })
    setCallInfo({ phone:'', pretty:'' })
    setMode('login')
  }

  const submit = async (e) => {
    e.preventDefault(); clearNotices(); setLoading(true)
    try { onLogin(await authApi.login(form)) } catch (err) { setError(err.message) } finally { setLoading(false) }
  }

  const requestRecoveryCall = async (e) => {
    e.preventDefault(); clearNotices(); setLoading(true)
    try {
      const result = await authApi.requestPasswordResetSms({ email:recovery.email, phone:recovery.phone })
      setCallInfo({ phone:result.callPhone || '', pretty:result.callPhonePretty || result.callPhone || '' })
      setMode('confirm')
      setMessage(result.message || 'Позвоните со своего номера на показанный номер. Сервис автоматически сбросит вызов.')
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }

  const confirmRecoveryCall = async (e) => {
    e.preventDefault(); clearNotices()
    if (recovery.password !== recovery.confirm) return setError('Пароли не совпадают.')
    setLoading(true)
    try {
      const result = await authApi.confirmPasswordResetSms({ phone:recovery.phone, password:recovery.password })
      setForm(current=>({ ...current,email:result.loginEmail || recovery.email || current.email,password:'' }))
      setRecovery({ email:'', phone:'', password:'', confirm:'' })
      setCallInfo({ phone:'', pretty:'' })
      setMode('login')
      setMessage(result.message || 'Телефон подтверждён, пароль изменён. Теперь можно войти.')
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }

  const requestAnotherNumber = async () => {
    clearNotices(); setLoading(true)
    try {
      const result = await authApi.requestPasswordResetSms({ email:recovery.email, phone:recovery.phone })
      setCallInfo({ phone:result.callPhone || '', pretty:result.callPhonePretty || result.callPhone || '' })
      setMessage(result.message || 'Получен новый номер для проверки.')
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }

  return <div className="auth-page"><button className="auth-back" onClick={()=>onNavigate('/')}><ArrowLeft size={17}/> На главную</button><section className="auth-card glass-panel"><div className="auth-brand"><span>E</span><strong>ELISEI</strong></div><div className="auth-el"><ElMascot compact/></div>
    {mode === 'login' && <><h1>С возвращением</h1><p>Войдите, чтобы открыть утренний разбор и рекомендации ЭЛа.</p><form onSubmit={submit}><label><span>Электронная почта</span><div><Mail size={17}/><input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="name@company.ru" required autoComplete="email"/></div></label><label><span>Пароль</span><div><LockKeyhole size={17}/><input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="••••••••" required minLength={8} autoComplete="current-password"/></div></label><div style={{display:'flex',justifyContent:'flex-end',marginTop:-4,marginBottom:8}}><button type="button" onClick={openRecovery} style={{background:'none',border:0,padding:0,color:'inherit',cursor:'pointer',textDecoration:'underline'}}>Забыли пароль?</button></div>{error && <div className="auth-error">{error}</div>}{message && <div style={successStyle}><CheckCircle2 size={16} style={{verticalAlign:'middle',marginRight:6}}/>{message}</div>}<button className="primary-btn auth-submit" disabled={loading}>{loading ? 'Входим…' : <>Войти <ArrowRight size={17}/></>}</button></form><small>Ещё нет аккаунта? <button onClick={()=>onNavigate('/register')}>Создать бесплатно</button></small></>}

    {mode === 'request' && <><h1>Восстановить доступ</h1><p>Укажите почту старого аккаунта и телефон восстановления. ELISEI выдаст номер, на который нужно один раз позвонить со своего телефона.</p><form onSubmit={requestRecoveryCall}><label><span>Электронная почта</span><div><Mail size={17}/><input type="email" value={recovery.email} onChange={e=>setRecovery({...recovery,email:e.target.value})} placeholder="name@company.ru" autoComplete="email" required/></div></label><label><span>Телефон восстановления</span><div><Phone size={17}/><input type="tel" value={recovery.phone} onChange={e=>setRecovery({...recovery,phone:e.target.value})} placeholder="+7 999 123-45-67" autoComplete="tel" required/></div></label>{error && <div className="auth-error">{error}</div>}<button className="primary-btn auth-submit" disabled={loading || !recovery.email.trim() || !recovery.phone.trim()}>{loading ? 'Получаем номер…' : <>Получить номер для звонка <Phone size={17}/></>}</button></form><small><button onClick={backToLogin}>Вернуться ко входу</button></small></>}

    {mode === 'confirm' && <><h1>Подтвердите телефон</h1><p>Позвоните <b>со своего номера {recovery.phone}</b> на номер ниже. SMS.RU автоматически сбросит вызов — разговаривать ни с кем не нужно.</p><div style={{...successStyle,textAlign:'center',fontSize:18,fontWeight:700,marginBottom:14}}><Phone size={18} style={{verticalAlign:'middle',marginRight:7}}/>{callInfo.pretty || callInfo.phone || 'Номер загружается…'}</div><form onSubmit={confirmRecoveryCall}><label><span>Новый пароль</span><div><LockKeyhole size={17}/><input type="password" value={recovery.password} onChange={e=>setRecovery({...recovery,password:e.target.value})} placeholder="Минимум 8 символов" required minLength={8} autoComplete="new-password"/></div></label><label><span>Повторите пароль</span><div><LockKeyhole size={17}/><input type="password" value={recovery.confirm} onChange={e=>setRecovery({...recovery,confirm:e.target.value})} placeholder="Повторите пароль" required minLength={8} autoComplete="new-password"/></div></label>{error && <div className="auth-error">{error}</div>}{message && <div style={successStyle}>{message}</div>}<button className="primary-btn auth-submit" disabled={loading || !callInfo.phone}>{loading ? 'Проверяем звонок…' : <><ShieldCheck size={17}/> Я позвонила — проверить и сменить пароль</>}</button><button className="secondary-btn" type="button" onClick={requestAnotherNumber} disabled={loading}><Phone size={17}/> Получить новый номер</button></form><small><button onClick={backToLogin}>Вернуться ко входу</button></small></>}
  </section></div>
}
