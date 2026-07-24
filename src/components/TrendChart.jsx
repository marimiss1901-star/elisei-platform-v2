export default function TrendChart(){
 return <div className="chart-wrap">
  <svg viewBox="0 0 760 240" preserveAspectRatio="none" aria-label="График выручки">
   <defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#8b5cf6" stopOpacity=".35"/><stop offset="1" stopColor="#8b5cf6" stopOpacity="0"/></linearGradient></defs>
   {[40,90,140,190].map(y=><line key={y} x1="0" x2="760" y1={y} y2={y} stroke="rgba(255,255,255,.08)"/>) }
   <path d="M0 202 C70 184 110 196 160 160 S255 126 310 145 S405 92 460 108 S550 62 610 80 S700 40 760 52 L760 240 L0 240Z" fill="url(#area)"/>
   <path d="M0 202 C70 184 110 196 160 160 S255 126 310 145 S405 92 460 108 S550 62 610 80" fill="none" stroke="#a78bfa" strokeWidth="4" strokeLinecap="round"/>
   <path d="M610 80 S700 40 760 52" fill="none" stroke="#62e6ff" strokeWidth="4" strokeDasharray="10 10" strokeLinecap="round"/>
  </svg>
  <div className="chart-days"><span>Пн</span><span>Вт</span><span>Ср</span><span>Чт</span><span>Пт</span><span>Сб</span><span>Вс</span></div>
 </div>
}
