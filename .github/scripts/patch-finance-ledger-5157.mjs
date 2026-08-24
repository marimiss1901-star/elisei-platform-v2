import fs from 'node:fs'

function replaceOnce(source, from, to, label) {
  if (source.includes(to)) return source
  const count = source.split(from).length - 1
  if (count !== 1) throw new Error(`${label}: expected one marker, found ${count}`)
  return source.replace(from, to)
}

const path='backend/src/wb/finance-ledger.js'
let source=fs.readFileSync(path,'utf8')

source=replaceOnce(source,
`function movementKey(stream, sourceRowKey, code, index) {
  return \`${'${stream}:${sourceRowKey}:${code}:${index}'}\`
}`,
`function movementKey(stream, sourceRowKey, code, sourceField = '') {
  // sourceRowKey is already stable (rrdId/report row identity). Do not use the
  // page-local array index: page boundaries can change between WB responses and
  // would otherwise create duplicate money movements after a re-normalization.
  return [stream,sourceRowKey,code,sourceField || 'value'].join(':')
}`,
'stable finance movement key')

source=replaceOnce(source,
`    movementKey:movementKey(base.sourceStream,base.sourceRowKey,code,index),`,
`    movementKey:movementKey(base.sourceStream,base.sourceRowKey,code,sourceField),`,
'stable movement key call')

source=source.replaceAll('COALESCE(item->\'sourcePayload\',\'{}\'::jsonb),3,NOW()','COALESCE(item->\'sourcePayload\',\'{}\'::jsonb),4,NOW()')
source=source.replaceAll('normalization_version=3,updated_at=NOW()','normalization_version=4,updated_at=NOW()')
source=source.replaceAll('minVersion < 3','minVersion < 4')
source=source.replaceAll('normalizationVersion:3','normalizationVersion:4')

source=replaceOnce(source,
`    if(!needsRebuild){ skippedStreams += 1; continue }

    let afterKey=''`,
`    if(!needsRebuild){ skippedStreams += 1; continue }

    // Version 4 is an authoritative rebuild. Remove movements created by the
    // older index-based key so that the same WB source row cannot be counted
    // twice. Raw source rows remain untouched in wb_stream_items.
    await db.query(\`
      DELETE FROM wb_finance_ledger
      WHERE connection_id=$1 AND source_stream=$2 AND normalization_version<4
    \`,[connectionId,stream])

    let afterKey=''`,
'authoritative v4 cleanup')

source=replaceOnce(source,
`    while(seen < limitPerStream){`,
`    const effectiveLimit=Math.max(Number(limitPerStream || 0),sourceRows)
    while(seen < effectiveLimit){`,
'complete migration limit')

fs.writeFileSync(path,source)
console.log('ELISEI 5.15.7 finance normalization v4 hardening applied')
