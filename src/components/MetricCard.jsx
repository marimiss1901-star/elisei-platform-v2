export default function MetricCard({label,value,delta,icon:Icon}) {
 return <article className="metric-card glass-panel"><div className="metric-icon"><Icon size={19}/></div><span>{label}</span><strong>{value}</strong><small>{delta}</small></article>
}
