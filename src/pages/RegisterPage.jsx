import { ArrowLeft, ArrowRight, Building2, Mail, UserRound } from 'lucide-react'
import ElMascot from '../components/ElMascot'

export default function RegisterPage({ onNavigate, onRegister }) {
  const submit = (e) => { e.preventDefault(); onRegister() }
  return <div className="auth-page"><button className="auth-back" onClick={()=>onNavigate('/')}><ArrowLeft size={17}/> На главную</button><section className="auth-card register-card glass-panel"><div className="auth-brand"><span>E</span><strong>ELISEI</strong></div><div className="auth-el"><ElMascot compact/></div><div className="trial-pill">3 дня бесплатно</div><h1>Создайте аккаунт</h1><p>После регистрации вы сможете подключить Wildberries и начать настройку рабочего пространства.</p><form onSubmit={submit}><label><span>Ваше имя</span><div><UserRound size={17}/><input placeholder="Мария" required/></div></label><label><span>Компания или магазин</span><div><Building2 size={17}/><input placeholder="Название магазина" required/></div></label><label><span>Электронная почта</span><div><Mail size={17}/><input type="email" placeholder="name@company.ru" required/></div></label><button className="primary-btn auth-submit">Создать аккаунт <ArrowRight size={17}/></button></form><small>Уже есть аккаунт? <button onClick={()=>onNavigate('/login')}>Войти</button></small></section></div>
}
