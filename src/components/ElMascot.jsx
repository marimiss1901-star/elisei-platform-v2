export default function ElMascot({ compact=false }) {
  return (
    <div className={compact?'el compact':'el'} aria-label="ЭЛ — AI-помощник">
      <div className="el-glow"/>
      <svg viewBox="0 0 320 320" role="img">
        <defs>
          <linearGradient id="body" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#c4b5fd"/><stop offset=".45" stopColor="#7c3aed"/><stop offset="1" stopColor="#312e81"/></linearGradient>
          <linearGradient id="face" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#211d3b"/><stop offset="1" stopColor="#090812"/></linearGradient>
          <filter id="blur"><feGaussianBlur stdDeviation="10"/></filter>
        </defs>
        <ellipse cx="160" cy="284" rx="88" ry="18" fill="#6d5dfc" opacity=".28" filter="url(#blur)"/>
        <path d="M91 130c0-48 29-81 69-81s69 33 69 81v58c0 54-31 86-69 86s-69-32-69-86z" fill="url(#body)"/>
        <rect x="104" y="80" width="112" height="92" rx="38" fill="url(#face)" stroke="#d8d0ff" strokeOpacity=".35"/>
        <rect x="123" y="116" width="25" height="11" rx="5.5" fill="#9ff7ff"/>
        <rect x="172" y="116" width="25" height="11" rx="5.5" fill="#9ff7ff"/>
        <path d="M139 145c12 8 30 8 42 0" fill="none" stroke="#b8fff4" strokeWidth="5" strokeLinecap="round"/>
        <circle cx="160" cy="48" r="8" fill="#b8fff4"/>
        <path d="M160 50V30" stroke="#a78bfa" strokeWidth="6" strokeLinecap="round"/>
        <path d="M92 161 62 184c-11 9-8 27 5 31l34 11M228 161l30 23c11 9 8 27-5 31l-34 11" fill="none" stroke="#8b5cf6" strokeWidth="18" strokeLinecap="round"/>
        <circle cx="160" cy="218" r="23" fill="#0f0d1c" stroke="#c4b5fd" strokeOpacity=".5"/>
        <path d="m160 204 7 10 12 3-8 9 1 12-12-5-12 5 1-12-8-9 12-3z" fill="#a7fff4"/>
      </svg>
    </div>
  )
}
