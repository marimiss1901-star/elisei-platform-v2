import { useState } from 'react'
import { ArrowLeft, ArrowRight, LockKeyhole, Mail } from 'lucide-react'
import ElMascot from '../components/ElMascot'
import { authApi } from '../lib/api'

export default function LoginPage({ onNavigate, onLogin }) {
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const submit = async (e) => { e.preventDefault(); setError(''); setLoading(true); try { onLogin(await authApi.login(form)) } catch (err) { setError(err.message) } finally { setLoading(false) } }
  return <div className="auth-page"><button className="auth-back" onClick={()=>onNavigate('/')}><ArrowLeft size={17}/> На главную</button><section className="auth-card glass-panel"><div className="auth-brand"><span>E</span><strong>ELISEI</strong></div><div className="auth-el"><ElMascot compact/></div><h1>С возвращением</h1><p>Войдите, чтобы открыть утренний разбор и рекомендации ЭЛа.</p><form onSubmit={submit}><label><span>Электронная почта</span><div><Mail size={17}/><input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="name@company.ru" required/></div></label><label><span>Пароль</span><div><LockKeyhole size={17}/><input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="••••••••" required minLength={8}/></div></label>{error && <div className="auth-error">{error}</div>}<button className="primary-btn auth-submit" disabled={loading}>{loading ? 'Входим…' : <>Войти <ArrowRight size={17}/></>}</button></form><small>Ещё нет аккаунта? <button onClick={()=>onNavigate('/register')}>Создать бесплатно</button></small></section></div>
}
