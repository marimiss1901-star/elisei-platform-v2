import { useState } from 'react'
import { ArrowLeft, ArrowRight, Building2, LockKeyhole, Mail, UserRound } from 'lucide-react'
import ElMascot from '../components/ElMascot'
import { authApi } from '../lib/api'

export default function RegisterPage({ onNavigate, onRegister }) {
  const [form, setForm] = useState({ name: '', company: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const submit = async (e) => { e.preventDefault(); setError(''); setLoading(true); try { onRegister(await authApi.register(form)) } catch (err) { setError(err.message) } finally { setLoading(false) } }
  return <div className="auth-page"><button className="auth-back" onClick={()=>onNavigate('/')}><ArrowLeft size={17}/> На главную</button><section className="auth-card register-card glass-panel"><div className="auth-brand"><span>E</span><strong>ELISEI</strong></div><div className="auth-el"><ElMascot compact/></div><div className="trial-pill">3 дня бесплатно</div><h1>Создайте аккаунт</h1><p>После регистрации вы сможете подключить Wildberries и начать настройку рабочего пространства.</p><form onSubmit={submit}><label><span>Ваше имя</span><div><UserRound size={17}/><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Мария" required/></div></label><label><span>Компания или магазин</span><div><Building2 size={17}/><input value={form.company} onChange={e=>setForm({...form,company:e.target.value})} placeholder="Название магазина" required/></div></label><label><span>Электронная почта</span><div><Mail size={17}/><input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="name@company.ru" required/></div></label><label><span>Пароль</span><div><LockKeyhole size={17}/><input type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} placeholder="Минимум 8 символов" required minLength={8}/></div></label>{error && <div className="auth-error">{error}</div>}<button className="primary-btn auth-submit" disabled={loading}>{loading ? 'Создаём…' : <>Создать аккаунт <ArrowRight size={17}/></>}</button></form><small>Уже есть аккаунт? <button onClick={()=>onNavigate('/login')}>Войти</button></small></section></div>
}
