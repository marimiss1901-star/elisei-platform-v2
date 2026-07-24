import { ArrowUpRight } from 'lucide-react'
export default function RecommendationCard({index, eyebrow, title, text, effect, tone}) {
  return <article className={`recommend-card glass-panel ${tone}`}>
    <div className="recommend-top"><span className="recommend-index">0{index}</span><span className="recommend-tag">{eyebrow}</span></div>
    <h3>{title}</h3><p>{text}</p>
    <div className="effect"><span>{effect}</span><button><ArrowUpRight size={18}/></button></div>
  </article>
}
