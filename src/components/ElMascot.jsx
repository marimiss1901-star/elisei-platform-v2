export default function ElMascot({ compact=false, mood='happy' }) {
  const src = compact ? '/el-premium-avatar.png' : '/el-premium-hero.png'
  return (
    <div className={`${compact ? 'el compact' : 'el'} el-${mood}`} aria-label="Эл — AI-помощник ELISEI">
      <div className="el-aura" />
      <img className="el-render" src={src} alt="Эл — AI-помощник ELISEI" draggable="false" />
    </div>
  )
}
