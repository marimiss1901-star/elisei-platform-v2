export default function ElMascot({ compact=false, mood='happy' }) {
  return (
    <div className={`${compact?'el compact':'el'} el-${mood}`} aria-label="ЭЛ — AI-директор ELISEI">
      <div className="el-orbit orbit-one"/><div className="el-orbit orbit-two"/>
      <div className="el-glow"/>
      <svg viewBox="0 0 360 390" role="img" aria-hidden="true">
        <defs>
          <linearGradient id="shell" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#f4ecff"/><stop offset=".28" stopColor="#b794f6"/><stop offset=".62" stopColor="#7c3aed"/><stop offset="1" stopColor="#312e81"/></linearGradient>
          <linearGradient id="shellDark" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#312e81"/><stop offset="1" stopColor="#111827"/></linearGradient>
          <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#302651"/><stop offset=".5" stopColor="#171329"/><stop offset="1" stopColor="#080711"/></linearGradient>
          <radialGradient id="core" cx="50%" cy="45%" r="55%"><stop stopColor="#ffffff"/><stop offset=".22" stopColor="#a7f3d0"/><stop offset=".55" stopColor="#67e8f9"/><stop offset="1" stopColor="#7c3aed"/></radialGradient>
          <filter id="soft"><feGaussianBlur stdDeviation="11"/></filter>
          <filter id="shine"><feGaussianBlur stdDeviation="2"/></filter>
        </defs>
        <ellipse cx="180" cy="350" rx="104" ry="22" fill="#6d5dfc" opacity=".26" filter="url(#soft)"/>
        <path d="M104 188c0-69 30-106 76-106s76 37 76 106v75c0 62-31 99-76 99s-76-37-76-99z" fill="url(#shell)"/>
        <path d="M120 242c22 15 98 15 120 0v34c0 51-25 80-60 80s-60-29-60-80z" fill="url(#shellDark)" opacity=".92"/>
        <rect x="109" y="75" width="142" height="119" rx="48" fill="url(#glass)" stroke="#ede9fe" strokeOpacity=".55" strokeWidth="2"/>
        <path d="M128 98c18-12 36-17 54-17" stroke="#fff" strokeOpacity=".3" strokeWidth="5" strokeLinecap="round"/>
        <g className="el-eyes">
          <rect x="135" y="128" width="31" height="14" rx="7" fill="#d9fbff"/>
          <rect x="194" y="128" width="31" height="14" rx="7" fill="#d9fbff"/>
        </g>
        <path className="el-smile" d="M150 158c17 13 43 13 60 0" fill="none" stroke="#b8fff4" strokeWidth="6" strokeLinecap="round"/>
        <circle cx="180" cy="59" r="8" fill="#b8fff4"/>
        <path d="M180 60V35" stroke="#c4b5fd" strokeWidth="7" strokeLinecap="round"/>
        <circle cx="180" cy="33" r="6" fill="#f5f3ff"/>
        <path d="M102 205 62 231c-16 11-14 35 4 43l35 15" fill="none" stroke="url(#shell)" strokeWidth="23" strokeLinecap="round"/>
        <path d="m258 205 40 26c16 11 14 35-4 43l-35 15" fill="none" stroke="url(#shell)" strokeWidth="23" strokeLinecap="round"/>
        <circle cx="58" cy="270" r="15" fill="#8b5cf6"/><circle cx="302" cy="270" r="15" fill="#8b5cf6"/>
        <circle cx="180" cy="285" r="34" fill="#0f0d1c" stroke="#ddd6fe" strokeOpacity=".7" strokeWidth="2"/>
        <circle className="el-core" cx="180" cy="285" r="23" fill="url(#core)"/>
        <path d="m180 269 7 11 13 4-9 10 1 14-12-6-12 6 1-14-9-10 13-4z" fill="#fff" opacity=".94"/>
        <path d="M126 214c14 9 28 12 54 12s40-3 54-12" fill="none" stroke="#fff" strokeOpacity=".16" strokeWidth="4" strokeLinecap="round"/>
      </svg>
    </div>
  )
}
