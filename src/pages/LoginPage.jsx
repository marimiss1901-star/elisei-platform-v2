import { useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, KeyRound, LockKeyhole, Mail } from 'lucide-react'
import ElMascot from '../components/ElMascot'
import { authApi } from '../lib/api'

const successStyle = { padding:'12px 14px', borderRadius:12, border:'1px solid rgba(87,214,170,.35)', background:'rgba(87,214,170,.08)', color:'inherit', fontSize:13, lineHeight:1.45 }

export default function LoginPage({ onNavigate, onLogin }) {
  const query = useMemo(() => new URLSearchParams(window.location.search), [])
  const resetToken = query.get('reset') || ''
  const resetEmail = query.get('email') || ''
  const [mode, setMode] = useState(resetToken ? 'confirm' : 'login')
  const [form, setForm] = useState({ email: resetEmail, password: '' })
  const [resetForm, setResetForm] = useState({ password: '', confirm: '' })
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const clearNotices = () => { setError(''); setMessage('') }
  const submit = async (e) => {
    e.preventDefault(); clearNotices(); setLoading(true)
    try { onLogin(await authApi.login(form)) } catch (err) { setError(err.message) } finally { setLoading(false) }
  }
  const requestReset = async (e) => {
    e.preventDefault(); clearNotices(); setLoading(true)
    try {
      const result = await authApi.requestPasswordReset({ email:form.email })
      setMessage(result.message || 'Ссылка восстановления создана.')
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }
  const confirmReset = async (e) => {
    e.preventDefault(); clearNotices()
    if (resetForm.password !== resetForm.confirm) return setError('Пароли не совпадают.')
    setLoading(true)
    try {
      const result = await authApi.confirmPasswordReset({ token:resetToken, password:resetForm.password })
      window.history.replaceState({}, '', '/login')
      setMessage(result.message || 'Пароль изменён.')
      setForm({ email:resetEmail, password:'' })
      setResetForm({ password:'', confirm:'' })
      setMode('login')
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }

  return <div className="auth-page"><button className="auth-back" onClick={()=>onNavigate('/')}><ArrowLeft size={17}/> На главную</button><section className="auth-card glass-panel"><div className="auth-brand"><span>E</span><strong>ELISEI</strong></div><div className="auth-el"><ElMascot compact/></div>
    {mode === 'login' && <><h1>С возвращением</h1><p>Войдите, чтобы открыть утренний разбор и рекомендации ЭЛа.</p><form onSubmit={submit}><label><span>Электронная почта</span><div><Mail size={17}/><input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="name@company.ru" required/></div></label><label><span>Пароль</span><div><LockKeyhole size={17}/><input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="••••••••" required minLength={8}/></div></label><div style={{display:'flex',justifyContent:'flex-end',marginTop:-4,marginBottom:8}}><button type="button" onClick={()=>{clearNotices();setMode('request')}} style={{background:'none',border:0,padding:0,color:'inherit',cursor:'pointer',textDecoration:'underline'}}>Забыли пароль?</button></div>{error && <div className="auth-error">{error}</div>}{message && <div style={successStyle}>{message}</div>}<button className="primary-btn auth-submit" disabled={loading}>{loading ? 'Входим…' : <>Войти <ArrowRight size={17}/></>}</button></form><small>Ещё нет аккаунта? <button onClick={()=>onNavigate('/register')}>Создать бесплатно</button></small></>}
    {mode === 'request' && <><h1>Сбросить пароль</h1><p>Введите почту аккаунта ELISEI. Одноразовая ссылка действует 15 минут.</p><form onSubmit={requestReset}><label><span>Электронная почта</span><div><Mail size={17}/><input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="name@company.ru" required/></div></label>{error && <div className="auth-error">{error}</div>}{message && <div style={successStyle}>{message}</div>}<button className="primary-btn auth-submit" disabled={loading}>{loading ? 'Создаём ссылку…' : <>Получить ссылку <KeyRound size={17}/></>}</button></form><small><button onClick={()=>{clearNotices();setMode('login')}}>Вернуться ко входу</button></small></>}
    {mode === 'confirm' && <><h1>Новый пароль</h1><p>{resetEmail ? `Аккаунт: ${resetEmail}` : 'Задайте новый пароль для аккаунта ELISEI.'}</p><form onSubmit={confirmReset}><label><span>Новый пароль</span><div><LockKeyhole size={17}/><input type="password" value={resetForm.password} onChange={e=>setResetForm({...resetForm,password:e.target.value})} placeholder="Минимум 8 символов" required minLength={8}/></div></label><label><span>Повторите пароль</span><div><LockKeyhole size={17}/><input type="password" value={resetForm.confirm} onChange={e=>setResetForm({...resetForm,confirm:e.target.value})} placeholder="Повторите пароль" required minLength={8}/></div></label>{error && <div className="auth-error">{error}</div>}<button className="primary-btn auth-submit" disabled={loading}>{loading ? 'Сохраняем…' : <>Сохранить новый пароль <ArrowRight size={17}/></>}</button></form></>}
  </section></div>
}
