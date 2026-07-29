const compactMoney = value => new Intl.NumberFormat('ru-RU', { notation:'compact', maximumFractionDigits:1 }).format(Number(value || 0))

export default function TrendChart({ data = [], valueKey = 'revenue', height = 240, emptyText = 'Нет данных за выбранный период' }) {
  const rows = Array.isArray(data) ? data.filter(row => Number.isFinite(Number(row?.[valueKey]))) : []
  if (!rows.length || rows.every(row => Number(row?.[valueKey] || 0) === 0)) {
    return <div className="chart-empty">{emptyText}</div>
  }

  const width = 760
  const top = 18
  const bottom = 32
  const values = rows.map(row => Number(row?.[valueKey] || 0))
  const min = Math.min(0, ...values)
  const max = Math.max(...values, 1)
  const range = Math.max(1, max - min)
  const x = index => rows.length === 1 ? width / 2 : (index / (rows.length - 1)) * width
  const y = value => top + ((max - value) / range) * (height - top - bottom)
  const points = rows.map((row, index) => `${x(index).toFixed(1)},${y(Number(row[valueKey] || 0)).toFixed(1)}`).join(' ')
  const area = `0,${height-bottom} ${points} ${width},${height-bottom}`
  const every = Math.max(1, Math.ceil(rows.length / 7))
  const labels = rows.filter((_, index) => index % every === 0 || index === rows.length - 1)

  return <div className="chart-wrap">
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-label="График динамики">
      <defs>
        <linearGradient id="eliseiArea" x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#8b5cf6" stopOpacity=".38"/>
          <stop offset="1" stopColor="#8b5cf6" stopOpacity="0"/>
        </linearGradient>
      </defs>
      {[0,1,2,3].map(index => {
        const lineY = top + index * ((height-top-bottom)/3)
        const labelValue = max - index * (range / 3)
        return <g key={index}>
          <line x1="0" x2={width} y1={lineY} y2={lineY} stroke="rgba(255,255,255,.08)"/>
          <text x="6" y={lineY-5} fill="rgba(255,255,255,.42)" fontSize="11">{compactMoney(labelValue)}</text>
        </g>
      })}
      <polygon points={area} fill="url(#eliseiArea)"/>
      <polyline points={points} fill="none" stroke="#a78bfa" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round"/>
      {rows.map((row, index) => <circle key={row.date || index} cx={x(index)} cy={y(Number(row[valueKey] || 0))} r="3" fill="#67e8f9" opacity={index === rows.length-1 ? 1 : .35}/>) }
    </svg>
    <div className="chart-days">{labels.map((row, index) => <span key={`${row.date}-${index}`}>{row.date ? new Date(`${row.date}T00:00:00`).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'}) : index+1}</span>)}</div>
  </div>
}
