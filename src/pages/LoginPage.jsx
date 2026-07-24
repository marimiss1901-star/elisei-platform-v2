import { ArrowLeft, ArrowRight, LockKeyhole, Mail } from 'lucide-react'
import ElMascot from '../components/ElMascot'

export default function LoginPage({ onNavigate, onLogin }) {
  const submit = (e) => { e.preventDefault(); onLogin() }
  return <div className="auth-page"><button className="auth-back" onClick={()=>onNavigate('/')}><ArrowLeft size={17}/> На главную</button><section className="auth-card glass-panel"><div className="auth-brand"><span>E</span><strong>ELISEI</strong></div><div className="auth-el"><ElMascot compact/></div><h1>С возвращением</h1><p>Войдите, чтобы открыть утренний разбор и рекомендации ЭЛа.</p><form onSubmit={submit}><label><span>Электронная почта</span><div><Mail size={17}/><input type="email" placeholder="name@company.ru" required/></div></label><label><span>Пароль</span><div><LockKeyhole size={17}/><input type="password" placeholder="••••••••" required/></div></label><button className="primary-btn auth-submit">Войти <ArrowRight size={17}/></button></form><small>Ещё нет аккаунта? <button onClick={()=>onNavigate('/register')}>Создать бесплатно</button></small></section></div>
}
