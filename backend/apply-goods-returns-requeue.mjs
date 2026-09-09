import fs from 'node:fs'

// ELISEI 5.19.6 — wake legacy goodsReturns requests that failed before the
// 31-day window guard existed. The 5.19.5 loader now clamps the outgoing WB
// request safely; this migration only turns that specific old validation error
// into an immediate retry and preserves all saved rows/metadata.

const serverUrl = new URL('./src/server.js', import.meta.url)
let source = fs.readFileSync(serverUrl,'utf8')

const before = `        OR COALESCE(last_error,'') ILIKE '%gateway%'
      )
    RETURNING connection_id,stage`
const after = `        OR COALESCE(last_error,'') ILIKE '%gateway%'
        OR (
          stage='goodsReturns'
          AND COALESCE(last_error,'') ILIKE '%difference between dateFrom and dateTo should be less or equal 31 days%'
        )
      )
    RETURNING connection_id,stage`

if (!source.includes(after)) {
  if (!source.includes(before)) throw new Error('ELISEI 5.19.6 goodsReturns recovery marker not found')
  source = source.replace(before,after)
}

fs.writeFileSync(serverUrl,source)
console.log('ELISEI 5.19.6 goods returns legacy-error requeue applied')
