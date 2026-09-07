import fs from 'node:fs'

const file='src/server.js'
let source=fs.readFileSync(file,'utf8')

function replaceOnce(oldText,newText,label){
  if(source.includes(newText)) return
  if(!source.includes(oldText)) throw new Error(`Seller statistics rate-window patch: ${label} target not found`)
  source=source.replace(oldText,newText)
}

replaceOnce(
  "    SELECT s.connection_id,s.stage,s.status,s.task_id,s.next_allowed_at,s.updated_at,s.metadata\n    FROM wb_sync_states s",
  "    SELECT s.connection_id,s.stage,s.status,s.task_id,s.next_allowed_at,s.last_attempt_at,s.last_success_at,s.updated_at,s.metadata,c.seller_id\n    FROM wb_sync_states s",
  'scheduler seller identity',
)

replaceOnce(
  "  const dueRows = result.rows\n  smartSchedulerWinners = chooseCycleWinners(dueRows)",
  `  const dueRows = result.rows

  // WB Statistics API limits are account-level. Basic tokens are especially
  // strict (orders: 1/3h, sales: 1/2h), and multiple ELISEI connections for
  // the same seller_id must therefore share one runtime window. Otherwise one
  // duplicate consumes the account quota and siblings receive hours-long 429s.
  const sellerWindowResult = await pool.query(\`
    SELECT c.seller_id,s.stage,
      MAX(s.last_attempt_at) AS last_attempt_at,
      MAX(s.next_allowed_at) FILTER (WHERE s.next_allowed_at > NOW()) AS next_allowed_at
    FROM wb_sync_states s
    JOIN marketplace_connections c ON c.id=s.connection_id
    WHERE c.status='connected'
      AND c.seller_id IS NOT NULL AND c.seller_id<>''
      AND s.stage IN ('orders','sales')
    GROUP BY c.seller_id,s.stage
  \`)
  const sellerWindows=new Map(sellerWindowResult.rows.map(row=>[\`\${row.seller_id}:\${row.stage}\`,row]))
  const minimumStatisticsMs={orders:3*60*60*1000,sales:2*60*60*1000}
  const schedulerNow=Date.now()
  const normalDueRows=[]
  const sellerStageCandidates=new Map()

  for(const row of dueRows){
    const stage=String(row.stage || '')
    const sellerId=String(row.seller_id || '')
    if(!sellerId || !Object.hasOwn(minimumStatisticsMs,stage)){
      normalDueRows.push(row)
      continue
    }
    const window=sellerWindows.get(\`\${sellerId}:\${stage}\`) || {}
    const lastAttempt=window.last_attempt_at ? new Date(window.last_attempt_at).getTime() : 0
    const explicitNext=window.next_allowed_at ? new Date(window.next_allowed_at).getTime() : 0
    const cadenceNext=lastAttempt ? lastAttempt+minimumStatisticsMs[stage] : 0
    const sellerNext=Math.max(explicitNext || 0,cadenceNext || 0)
    if(sellerNext>schedulerNow) continue
    const key=\`\${sellerId}:\${stage}\`
    if(!sellerStageCandidates.has(key)) sellerStageCandidates.set(key,[])
    sellerStageCandidates.get(key).push(row)
  }

  for(const rows of sellerStageCandidates.values()){
    rows.sort((a,b)=>{
      const successA=a.last_success_at ? new Date(a.last_success_at).getTime() : 0
      const successB=b.last_success_at ? new Date(b.last_success_at).getTime() : 0
      if(successA!==successB) return successA-successB
      const updatedA=a.updated_at ? new Date(a.updated_at).getTime() : 0
      const updatedB=b.updated_at ? new Date(b.updated_at).getTime() : 0
      return updatedA-updatedB
    })
    normalDueRows.push(rows[0])
  }

  smartSchedulerWinners = chooseCycleWinners(normalDueRows)`,
  'shared seller statistics window',
)

fs.writeFileSync(file,source)
console.log('Seller-level WB Statistics rate window applied')
