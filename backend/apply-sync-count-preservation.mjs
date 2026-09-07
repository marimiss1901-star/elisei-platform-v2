import fs from 'node:fs'

const file='src/server.js'
let source=fs.readFileSync(file,'utf8')

const oldText="    lastCount: patch.lastCount === undefined ? Number(row.last_count || 0) : Number(patch.lastCount || 0),"
const newText=`    lastCount: patch.lastCount === undefined
      ? Number(row.last_count || 0)
      : (String(patch.status ?? row.status ?? '') !== 'success' && Number(patch.lastCount || 0) === 0 && Number(row.last_count || 0) > 0
          ? Number(row.last_count || 0)
          : Number(patch.lastCount || 0)),`

if(!source.includes(newText)) {
  if(!source.includes(oldText)) throw new Error('Sync count preservation patch target not found')
  source=source.replace(oldText,newText)
  fs.writeFileSync(file,source)
}

console.log('Sync last-success count preservation applied')
