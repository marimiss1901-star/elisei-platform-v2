export default function ElMascot({ compact=false, mood='happy' }) {
  return (
    <div className={`${compact?'el compact':'el'} el-${mood}`} aria-label="ЭЛ — AI-директор ELISEI">
      <div className="el-orbit orbit-one"/><div className="el-orbit orbit-two"/>
      <svg viewBox="0 0 430 560" role="img" aria-hidden="true">
        <defs>
          <linearGradient id="whiteShell" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ffffff"/><stop offset=".28" stopColor="#e9e7ff"/><stop offset=".63" stopColor="#a99cff"/><stop offset="1" stopColor="#4b3f91"/></linearGradient>
          <linearGradient id="darkJoint" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#251d52"/><stop offset="1" stopColor="#080611"/></linearGradient>
          <linearGradient id="faceGlass" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#1a1440"/><stop offset=".55" stopColor="#080718"/><stop offset="1" stopColor="#020208"/></linearGradient>
          <radialGradient id="brandCore"><stop stopColor="#fff"/><stop offset=".22" stopColor="#c4b5fd"/><stop offset=".58" stopColor="#7c3aed"/><stop offset="1" stopColor="#271458"/></radialGradient>
          <filter id="blur"><feGaussianBlur stdDeviation="18"/></filter><filter id="glow"><feGaussianBlur stdDeviation="4"/></filter>
        </defs>
        <ellipse cx="216" cy="526" rx="155" ry="28" fill="#6d4aff" opacity=".42" filter="url(#blur)"/>
        <path d="M145 224c12-65 131-65 143 0l13 110c8 67-35 129-85 129s-93-62-85-129z" fill="url(#whiteShell)" stroke="#fff" strokeOpacity=".45" strokeWidth="3"/>
        <path d="M162 363c27 18 81 18 108 0l-3 59c-12 28-29 42-51 42s-39-14-51-42z" fill="url(#darkJoint)"/>
        <path d="M122 125c0-72 42-111 94-111s94 39 94 111v36c0 65-42 105-94 105s-94-40-94-105z" fill="url(#whiteShell)" stroke="#fff" strokeOpacity=".55" strokeWidth="3"/>
        <path d="M143 100c0-42 30-65 73-65s73 23 73 65v61c0 44-31 70-73 70s-73-26-73-70z" fill="url(#faceGlass)" stroke="#9b87ff" strokeWidth="4"/>
        <path d="M160 72c24-18 62-22 91-10" fill="none" stroke="#fff" strokeOpacity=".45" strokeWidth="8" strokeLinecap="round"/>
        <g className="el-eyes"><path d="M169 139c9-13 23-13 32 0" fill="none" stroke="#dcd7ff" strokeWidth="9" strokeLinecap="round"/><path d="M231 139c9-13 23-13 32 0" fill="none" stroke="#dcd7ff" strokeWidth="9" strokeLinecap="round"/></g>
        <path className="el-smile" d="M176 174c23 23 57 23 80 0" fill="none" stroke="#fff" strokeWidth="9" strokeLinecap="round"/>
        <circle cx="216" cy="13" r="10" fill="#8b5cf6"/><path d="M216 24v-17" stroke="#ddd6fe" strokeWidth="7" strokeLinecap="round"/>
        <path d="M139 270 87 300c-27 16-35 48-16 72l18 23" fill="none" stroke="url(#whiteShell)" strokeWidth="34" strokeLinecap="round"/>
        <path d="m292 270 54 26c26 13 36 43 22 68l-17 28" fill="none" stroke="url(#whiteShell)" strokeWidth="34" strokeLinecap="round"/>
        <circle cx="84" cy="391" r="22" fill="url(#darkJoint)" stroke="#b8adff" strokeWidth="3"/><circle cx="353" cy="390" r="22" fill="url(#darkJoint)" stroke="#b8adff" strokeWidth="3"/>
        <path d="M75 377c-20-16-28-42-18-66" fill="none" stroke="#e9e7ff" strokeWidth="13" strokeLinecap="round"/><path d="M58 313l-13-5M63 302l-5-16M72 298l5-15" stroke="#fff" strokeWidth="7" strokeLinecap="round"/>
        <circle cx="216" cy="330" r="49" fill="#0a0717" stroke="#cabfff" strokeWidth="4"/><circle className="el-core" cx="216" cy="330" r="34" fill="url(#brandCore)"/>
        <path d="m216 304 9 15 17 5-12 13 2 18-16-8-16 8 2-18-12-13 17-5z" fill="#fff"/>
        <path d="M142 252c36 16 112 16 148 0" fill="none" stroke="#fff" strokeOpacity=".34" strokeWidth="6" strokeLinecap="round"/>
      </svg>
    </div>
  )
}
