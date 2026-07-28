export default function ElMascot({ compact=false, mood='happy' }) {
  return (
    <div className={`${compact?'el compact':'el'} el-${mood}`} aria-label="Эл — AI-помощник ELISEI">
      <div className="el-aura" />
      <svg viewBox="0 0 360 430" role="img" aria-hidden="true">
        <defs>
          <linearGradient id="elBody" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#d8c8ff"/><stop offset=".32" stopColor="#8b5cf6"/><stop offset=".72" stopColor="#5b2fc8"/><stop offset="1" stopColor="#2b176b"/>
          </linearGradient>
          <linearGradient id="elGlass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#24145c"/><stop offset=".58" stopColor="#09051e"/><stop offset="1" stopColor="#05020f"/>
          </linearGradient>
          <radialGradient id="elCore"><stop stopColor="#fff"/><stop offset=".22" stopColor="#f0c9ff"/><stop offset=".54" stopColor="#c43cff"/><stop offset="1" stopColor="#5b21b6"/></radialGradient>
          <filter id="softGlow"><feGaussianBlur stdDeviation="14"/></filter>
          <filter id="eyeGlow"><feGaussianBlur stdDeviation="3"/></filter>
        </defs>
        <ellipse cx="180" cy="395" rx="112" ry="22" fill="#9c4dff" opacity=".42" filter="url(#softGlow)"/>
        <path d="M86 115 48 75l12 76z" fill="url(#elBody)" stroke="#d9c9ff" strokeWidth="4"/>
        <path d="M274 115 312 75l-12 76z" fill="url(#elBody)" stroke="#d9c9ff" strokeWidth="4"/>
        <rect x="72" y="61" width="216" height="198" rx="88" fill="url(#elBody)" stroke="#e9ddff" strokeWidth="5"/>
        <rect x="94" y="87" width="172" height="133" rx="58" fill="url(#elGlass)" stroke="#b38cff" strokeWidth="5"/>
        <path d="M114 105c35-26 93-29 132-10" fill="none" stroke="#fff" strokeOpacity=".45" strokeWidth="9" strokeLinecap="round"/>
        <g className="el-eyes" filter="url(#eyeGlow)">
          <path d="M125 153c12-14 27-14 39 0" fill="none" stroke="#9ee7ff" strokeWidth="11" strokeLinecap="round"/>
          <path d="M196 153c12-14 27-14 39 0" fill="none" stroke="#9ee7ff" strokeWidth="11" strokeLinecap="round"/>
        </g>
        <path className="el-smile" d="M138 181c24 22 60 22 84 0" fill="none" stroke="#f5d8ff" strokeWidth="9" strokeLinecap="round"/>
        <circle cx="180" cy="51" r="11" fill="#f2a7ff"/><path d="M180 51V25" stroke="#e9ddff" strokeWidth="8" strokeLinecap="round"/>
        <rect x="91" y="235" width="178" height="123" rx="60" fill="url(#elBody)" stroke="#e9ddff" strokeWidth="5"/>
        <path d="M105 272c44 28 106 28 150 0" fill="none" stroke="#fff" strokeOpacity=".25" strokeWidth="7" strokeLinecap="round"/>
        <path d="M102 277 55 303c-22 12-27 40-10 58" fill="none" stroke="url(#elBody)" strokeWidth="30" strokeLinecap="round"/>
        <path d="m258 277 47 26c22 12 27 40 10 58" fill="none" stroke="url(#elBody)" strokeWidth="30" strokeLinecap="round"/>
        <circle cx="48" cy="366" r="19" fill="#5f35c3" stroke="#d9c9ff" strokeWidth="4"/><circle cx="312" cy="366" r="19" fill="#5f35c3" stroke="#d9c9ff" strokeWidth="4"/>
        <circle cx="180" cy="298" r="39" fill="#100528" stroke="#e0cfff" strokeWidth="4"/><circle className="el-core" cx="180" cy="298" r="26" fill="url(#elCore)"/>
        <path d="m180 277 7 12 14 4-10 10 2 14-13-7-13 7 2-14-10-10 14-4z" fill="#fff"/>
      </svg>
    </div>
  )
}
