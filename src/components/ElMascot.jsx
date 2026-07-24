export default function ElMascot({ compact=false, mood='happy' }) {
  return (
    <div className={`${compact?'el compact':'el'} el-${mood}`} aria-label="ЭЛ — AI-директор ELISEI">
      <div className="el-orbit orbit-one"/><div className="el-orbit orbit-two"/>
      <svg viewBox="0 0 520 690" role="img" aria-hidden="true">
        <defs>
          <linearGradient id="shell" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ffffff"/><stop offset=".24" stopColor="#f5f3ff"/><stop offset=".55" stopColor="#c4b5fd"/><stop offset=".82" stopColor="#7c70d8"/><stop offset="1" stopColor="#30245f"/></linearGradient>
          <linearGradient id="shellDark" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#7567cd"/><stop offset=".45" stopColor="#261d57"/><stop offset="1" stopColor="#07060e"/></linearGradient>
          <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#302264"/><stop offset=".25" stopColor="#17113a"/><stop offset=".72" stopColor="#070613"/><stop offset="1" stopColor="#020205"/></linearGradient>
          <linearGradient id="purpleEdge" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#e9d5ff"/><stop offset=".35" stopColor="#8b5cf6"/><stop offset="1" stopColor="#4f46e5"/></linearGradient>
          <radialGradient id="core"><stop stopColor="#fff"/><stop offset=".18" stopColor="#e9d5ff"/><stop offset=".45" stopColor="#9f67ff"/><stop offset=".76" stopColor="#5b21b6"/><stop offset="1" stopColor="#15072c"/></radialGradient>
          <radialGradient id="eyeGlow"><stop stopColor="#fff"/><stop offset=".35" stopColor="#d8d4ff"/><stop offset="1" stopColor="#7c3aed" stopOpacity="0"/></radialGradient>
          <filter id="blur"><feGaussianBlur stdDeviation="22"/></filter>
          <filter id="softGlow"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          <filter id="hardShadow"><feDropShadow dx="0" dy="16" stdDeviation="14" floodColor="#05020e" floodOpacity=".75"/></filter>
        </defs>

        <ellipse cx="260" cy="646" rx="185" ry="30" fill="#7546ff" opacity=".45" filter="url(#blur)"/>
        <ellipse cx="260" cy="632" rx="124" ry="16" fill="#03020a" opacity=".8"/>

        {/* legs and feet */}
        <g filter="url(#hardShadow)">
          <path d="M183 438c-7 47-11 96 2 139 8 24 29 38 54 34 19-3 31-17 32-35l2-108z" fill="url(#shell)" stroke="#fff" strokeOpacity=".45" strokeWidth="3"/>
          <path d="M337 438c7 47 11 96-2 139-8 24-29 38-54 34-19-3-31-17-32-35l-2-108z" fill="url(#shell)" stroke="#fff" strokeOpacity=".45" strokeWidth="3"/>
          <path d="M177 565c-26 8-47 29-50 52-2 14 7 24 22 24h94c12 0 20-10 18-22-4-23-32-48-84-54z" fill="url(#shell)" stroke="#fff" strokeOpacity=".4" strokeWidth="3"/>
          <path d="M343 565c26 8 47 29 50 52 2 14-7 24-22 24h-94c-12 0-20-10-18-22 4-23 32-48 84-54z" fill="url(#shell)" stroke="#fff" strokeOpacity=".4" strokeWidth="3"/>
          <path d="M179 497c22 16 49 17 76 2" fill="none" stroke="#47388e" strokeWidth="18" strokeLinecap="round"/>
          <path d="M341 497c-22 16-49 17-76 2" fill="none" stroke="#47388e" strokeWidth="18" strokeLinecap="round"/>
        </g>

        {/* torso */}
        <path d="M153 270c15-72 199-72 214 0l19 137c10 74-42 136-126 136s-136-62-126-136z" fill="url(#shell)" stroke="#fff" strokeOpacity=".55" strokeWidth="4" filter="url(#hardShadow)"/>
        <path d="M183 435c36 29 118 29 154 0l-7 76c-19 20-43 31-70 31s-51-11-70-31z" fill="url(#shellDark)"/>
        <path d="M162 307c53 23 143 23 196 0" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="7" strokeLinecap="round"/>
        <path d="M183 274c35-19 119-19 154 0" fill="none" stroke="#d8d1ff" strokeOpacity=".5" strokeWidth="6" strokeLinecap="round"/>

        {/* head shell */}
        <path d="M126 142c0-88 57-136 134-136s134 48 134 136v46c0 86-57 136-134 136s-134-50-134-136z" fill="url(#shell)" stroke="#fff" strokeOpacity=".62" strokeWidth="4" filter="url(#hardShadow)"/>
        <path d="M158 110c0-57 43-89 102-89s102 32 102 89v78c0 58-43 94-102 94s-102-36-102-94z" fill="url(#glass)" stroke="url(#purpleEdge)" strokeWidth="6"/>
        <path d="M184 69c34-24 86-30 126-13" fill="none" stroke="#fff" strokeOpacity=".58" strokeWidth="10" strokeLinecap="round"/>
        <path d="M154 120c-9 31-9 76 1 105" fill="none" stroke="#fff" strokeOpacity=".18" strokeWidth="8" strokeLinecap="round"/>
        <circle cx="260" cy="10" r="15" fill="url(#purpleEdge)"/><path d="M260 28V4" stroke="#eee9ff" strokeWidth="9" strokeLinecap="round"/>
        <path d="M230 9c12-9 48-9 60 0l-9 18h-42z" fill="#2d205f" stroke="#9f7aea" strokeWidth="2"/>
        <text x="260" y="23" textAnchor="middle" fontSize="20" fontWeight="900" fill="#fff">E</text>

        {/* face */}
        <g className="el-eyes" filter="url(#softGlow)">
          <path d="M197 171c11-17 29-17 40 0" fill="none" stroke="#fff" strokeWidth="12" strokeLinecap="round"/>
          <path d="M283 171c11-17 29-17 40 0" fill="none" stroke="#fff" strokeWidth="12" strokeLinecap="round"/>
        </g>
        <circle cx="217" cy="171" r="28" fill="url(#eyeGlow)" opacity=".16"/><circle cx="303" cy="171" r="28" fill="url(#eyeGlow)" opacity=".16"/>
        <path className="el-smile" d="M204 218c32 31 80 31 112 0" fill="none" stroke="#fff" strokeWidth="12" strokeLinecap="round" filter="url(#softGlow)"/>

        {/* left arm on hip */}
        <path d="M154 317 99 352c-31 20-41 63-19 93l22 29" fill="none" stroke="url(#shell)" strokeWidth="48" strokeLinecap="round" filter="url(#hardShadow)"/>
        <circle cx="101" cy="478" r="31" fill="url(#shellDark)" stroke="#c6baff" strokeWidth="4"/>
        <path d="M106 465c27 4 43 19 47 43" fill="none" stroke="#eeeaff" strokeWidth="10" strokeLinecap="round"/>

        {/* right arm and thumbs-up */}
        <path d="M365 314c29 5 52 20 65 42" fill="none" stroke="url(#shell)" strokeWidth="48" strokeLinecap="round" filter="url(#hardShadow)"/>
        <path d="M429 358c8 26 4 56-13 77" fill="none" stroke="url(#shell)" strokeWidth="43" strokeLinecap="round"/>
        <circle cx="410" cy="443" r="29" fill="url(#shellDark)" stroke="#c6baff" strokeWidth="4"/>
        <g transform="translate(389 397) rotate(-8)">
          <path d="M15 41c-10-4-15-12-13-23 2-9 10-15 19-15h10V-9c0-8 6-15 14-15 9 0 15 7 15 16v24h15c12 0 21 10 20 22l-3 23c-1 10-10 18-21 18H33c-9 0-16-5-18-13z" fill="url(#shell)" stroke="#fff" strokeOpacity=".55" strokeWidth="3"/>
          <path d="M31 16h29" stroke="#8878da" strokeWidth="5" strokeLinecap="round"/>
        </g>

        {/* chest core */}
        <circle cx="260" cy="397" r="66" fill="#090612" stroke="#ded6ff" strokeWidth="5"/>
        <circle className="el-core" cx="260" cy="397" r="48" fill="url(#core)" filter="url(#softGlow)"/>
        <path d="m260 360 11 21 24 4-18 17 4 24-21-11-21 11 4-24-18-17 24-4z" fill="#fff"/>
        <path d="M230 448c20 9 40 9 60 0" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="5" strokeLinecap="round"/>
      </svg>
    </div>
  )
}
