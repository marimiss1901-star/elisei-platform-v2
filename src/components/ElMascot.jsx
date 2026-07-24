export default function ElMascot({ compact = false, mood = 'welcome' }) {
  return (
    <div className={`el el-${mood}${compact ? ' compact' : ''}`} aria-label="ЭЛ — AI-директор ELISEI">
      <div className="el-orbit orbit-one" />
      <div className="el-orbit orbit-two" />
      <div className="el-glow" />
      <svg viewBox="0 0 420 470" role="img" aria-hidden="true">
        <defs>
          <linearGradient id="elShell" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f2e9ff" />
            <stop offset=".14" stopColor="#c4a7ff" />
            <stop offset=".48" stopColor="#7c3aed" />
            <stop offset=".78" stopColor="#43208f" />
            <stop offset="1" stopColor="#211049" />
          </linearGradient>
          <linearGradient id="elShellDark" x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#8054d9" />
            <stop offset="1" stopColor="#25123f" />
          </linearGradient>
          <radialGradient id="elFace" cx="50%" cy="35%" r="85%">
            <stop stopColor="#2c2547" />
            <stop offset=".48" stopColor="#11101c" />
            <stop offset="1" stopColor="#05050a" />
          </radialGradient>
          <radialGradient id="elCore" cx="50%" cy="42%" r="60%">
            <stop stopColor="#ffffff" />
            <stop offset=".22" stopColor="#b8fff7" />
            <stop offset=".55" stopColor="#8b7cff" />
            <stop offset="1" stopColor="#4d1fb6" />
          </radialGradient>
          <linearGradient id="elGlass" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#ffffff" stopOpacity=".42" />
            <stop offset=".28" stopColor="#ffffff" stopOpacity=".05" />
            <stop offset="1" stopColor="#9eeeff" stopOpacity=".02" />
          </linearGradient>
          <filter id="softGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="12" result="b" />
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <filter id="deepShadow" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="20" stdDeviation="20" floodColor="#15052f" floodOpacity=".75" />
          </filter>
        </defs>

        <ellipse cx="210" cy="428" rx="126" ry="27" fill="#6d28d9" opacity=".25" filter="url(#softGlow)" />

        <g className="el-antenna">
          <path d="M210 77V38" stroke="#8d64df" strokeWidth="11" strokeLinecap="round" />
          <circle cx="210" cy="30" r="14" fill="url(#elCore)" filter="url(#softGlow)" />
          <circle cx="206" cy="25" r="4" fill="white" opacity=".9" />
        </g>

        <g className="el-body" filter="url(#deepShadow)">
          <path d="M105 230c0-74 45-119 105-119s105 45 105 119v73c0 86-43 132-105 132s-105-46-105-132z" fill="url(#elShell)" />
          <path d="M121 274c13 81 46 127 89 127 44 0 77-46 90-127-10 95-43 144-90 144-46 0-79-49-89-144Z" fill="#170d2c" opacity=".18" />
          <path d="M121 229c0-61 37-100 89-100 51 0 89 39 89 100v64c0 10-1 20-3 29-9-70-41-105-86-105-46 0-78 35-87 105-2-9-2-19-2-29z" fill="url(#elGlass)" opacity=".45" />
        </g>

        <g className="el-arms">
          <path d="M111 239 68 273c-17 13-14 40 5 49l37 17" fill="none" stroke="url(#elShellDark)" strokeWidth="28" strokeLinecap="round" />
          <path d="M309 239 352 273c17 13 14 40-5 49l-37 17" fill="none" stroke="url(#elShellDark)" strokeWidth="28" strokeLinecap="round" />
          <circle cx="66" cy="321" r="17" fill="url(#elShell)" />
          <circle cx="354" cy="321" r="17" fill="url(#elShell)" />
        </g>

        <g className="el-face-panel">
          <rect x="128" y="126" width="164" height="148" rx="55" fill="url(#elFace)" stroke="#e1d9ff" strokeOpacity=".3" strokeWidth="3" />
          <path d="M147 142c36-21 91-21 126 0" fill="none" stroke="white" strokeOpacity=".14" strokeWidth="7" strokeLinecap="round" />
          <path d="M150 135c24-8 48-11 72-9" fill="none" stroke="white" strokeOpacity=".35" strokeWidth="4" strokeLinecap="round" />
          <g className="el-eyes" filter="url(#softGlow)">
            <rect x="158" y="184" width="34" height="16" rx="8" fill="#b8fff7" />
            <rect x="228" y="184" width="34" height="16" rx="8" fill="#b8fff7" />
          </g>
          <path className="el-smile" d="M179 228c17 13 45 13 62 0" fill="none" stroke="#b8fff7" strokeWidth="7" strokeLinecap="round" filter="url(#softGlow)" />
        </g>

        <g className="el-core" filter="url(#softGlow)">
          <circle cx="210" cy="336" r="42" fill="#120b22" stroke="#dacdff" strokeOpacity=".45" strokeWidth="3" />
          <circle cx="210" cy="336" r="30" fill="url(#elCore)" opacity=".95" />
          <path d="m210 314 8 12 15 4-10 11 1 16-14-6-14 6 1-16-10-11 15-4z" fill="white" opacity=".96" />
        </g>

        <path d="M137 301c9 27 18 45 30 57" fill="none" stroke="white" strokeOpacity=".12" strokeWidth="8" strokeLinecap="round" />
      </svg>
    </div>
  )
}
