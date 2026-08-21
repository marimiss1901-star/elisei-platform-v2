import { useState } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, KeyRound, LockKeyhole, Mail, Phone, ShieldCheck } from 'lucide-react'
import ElMascot from '../components/ElMascot'
import { authApi } from '../lib/api'

const successStyle = { padding:'12px 14px', borderRadius:12, border:'1px solid rgba(87,214,170,.35)', background:'rgba(87,214,170,.08)', color:'inherit', fontSize:13, lineHeight:1.45 }

export default function LoginPage({ onNavigate, onLogin }) {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ email:'', password:'' })
  const [recovery, setRecovery] = useState({ email:'', phone:'', code:'', password:'', confirm:'' })
  const [callStarted, setCallStarted] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const clearNotices = () => { setError(''); setMessage('') }
  const openRecovery = () => {
    clearNotices()
    setRecovery({ email:form.email, phone:'', code:'', password:'', confirm:'' })
    setCallStarted(false)
    setMode('request')
  }
  const backToLogin = () => {
    clearNotices()
    setRecovery({ email:'', phone:'', code:'', password:'', confirm:'' })
    setCallStarted(false)
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
      setCallStarted(true)
      setMode('confirm')
      setMessage(result.message || 'Сейчас поступит входящий звонок. Введите последние 4 цифры номера, с которого звонят.')
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }

  const confirmRecoveryCall = async (e) => {
    e.preventDefault(); clearNotices()
    if (recovery.code.length !== 4) return setError('Введите последние 4 цифры номера входящего звонка.')
    if (recovery.password !== recovery.confirm) return setError('Пароли не совпадают.')
    setLoading(true)
    try {
      const result = await authApi.confirmPasswordResetSms({
        phone:recovery.phone,
        code:recovery.code,
        password:recovery.password,
      })
      setForm(current=>({ ...current,email:result.loginEmail || recovery.email || current.email,password:'' }))
      setRecovery({ email:'', phone:'', code:'', password:'', confirm:'' })
      setCallStarted(false)
      setMode('login')
      setMessage(result.message || 'Пароль изменён. Теперь можно войти с новым паролем.')
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }

  const requestAnotherCall = async () => {
    clearNotices(); setLoading(true)
    try {
      const result = await authApi.requestPasswordResetSms({ email:recovery.email, phone:recovery.phone })
      setCallStarted(true)
      setMessage(result.message || 'Новый звонок запрошен. Введите последние 4 цифры входящего номера.')
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }

  return <div className="auth-page"><button className="auth-back" onClick={()=>onNavigate('/')}><ArrowLeft size={17}/> На главную</button><section className="auth-card glass-panel"><div className="auth-brand"><span>E</span><strong>ELISEI</strong></div><div className="auth-el"><ElMascot compact/></div>
    {mode === 'login' && <><h1>С возвращением</h1><p>Войдите, чтобы открыть утренний разбор и рекомендации ЭЛа.</p><form onSubmit={submit}><label><span>Электронная почта</span><div><Mail size={17}/><input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="name@company.ru" required autoComplete="email"/></div></label><label><span>Пароль</span><div><LockKeyhole size={17}/><input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="••••••••" required minLength={8} autoComplete="current-password"/></div></label><div style={{display:'flex',justifyContent:'flex-end',marginTop:-4,marginBottom:8}}><button type="button" onClick={openRecovery} style={{background:'none',border:0,padding:0,color:'inherit',cursor:'pointer',textDecoration:'underline'}}>Забыли пароль?</button></div>{error && <div className="auth-error">{error}</div>}{message && <div style={successStyle}><CheckCircle2 size={16} style={{verticalAlign:'middle',marginRight:6}}/>{message}</div>}<button className="primary-btn auth-submit" disabled={loading}>{loading ? 'Входим…' : <>Войти <ArrowRight size={17}/></>}</button></form><small>Ещё нет аккаунта? <button onClick={()=>onNavigate('/register')}>Создать бесплатно</button></small></>}

    {mode === 'request' && <><h1>Восстановить доступ</h1><p>Укажите почту аккаунта и телефон восстановления. Для старого аккаунта, созданного до функции телефона, используйте свою прежнюю почту и номер восстановления владельца.</p><form onSubmit={requestRecoveryCall}><label><span>Электронная почта</span><div><Mail size={17}/><input type="email" value={recovery.email} onChange={e=>setRecovery({...recovery,email:e.target.value})} placeholder="name@company.ru" autoComplete="email" required/></div></label><label><span>Телефон восстановления</span><div><Phone size={17}/><input type="tel" value={recovery.phone} onChange={e=>setRecovery({...recovery,phone:e.target.value})} placeholder="+7 999 123-45-67" autoComplete="tel" required/></div></label>{error && <div className="auth-error">{error}</div>}{message && <div style={successStyle}>{message}</div>}<button className="primary-btn auth-submit" disabled={loading || !recovery.email.trim() || !recovery.phone.trim()}>{loading ? 'Запрашиваем звонок…' : <>Получить звонок <Phone size={17}/></>}</button></form><small><button onClick={backToLogin}>Вернуться ко входу</button></small></>}

    {mode === 'confirm' && <><h1>Новый пароль</h1><p>Сейчас на <b>{recovery.phone}</b> поступит входящий звонок. Отвечать не нужно — введите последние 4 цифры номера, с которого звонят, и задайте новый пароль.</p><form onSubmit={confirmRecoveryCall}><label><span>Последние 4 цифры входящего номера</span><div><ShieldCheck size={17}/><input inputMode="numeric" autoComplete="one-time-code" value={recovery.code} onChange={e=>setRecovery({...recovery,code:e.target.value.replace(/\D/g,'').slice(0,4)})} placeholder="0000" maxLength={4} required/></div></label><label><span>Новый пароль</span><div><LockKeyhole size={17}/><input type="password" value={recovery.password} onChange={e=>setRecovery({...recovery,password:e.target.value})} placeholder="Минимум 8 символов" required minLength={8} autoComplete="new-password"/></div></label><label><span>Повторите пароль</span><div><LockKeyhole size={17}/><input type="password" value={recovery.confirm} onChange={e=>setRecovery({...recovery,confirm:e.target.value})} placeholder="Повторите пароль" required minLength={8} autoComplete="new-password"/></div></label>{error && <div className="auth-error">{error}</div>}{message && <div style={successStyle}>{message}</div>}<button className="primary-btn auth-submit" disabled={loading || recovery.code.length !== 4}>{loading ? 'Сохраняем…' : <>Сохранить новый пароль <ArrowRight size={17}/></>}</button><button className="secondary-btn" type="button" onClick={requestAnotherCall} disabled={loading || !callStarted}><Phone size={17}/> Позвонить ещё раз</button></form><small><button onClick={backToLogin}>Вернуться ко входу</button></small></>}
  </section></div>
}
