import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const directory=path.dirname(fileURLToPath(import.meta.url))
const files=fs.readdirSync(directory)
  .filter(name=>name.endsWith('.test.mjs'))
  .sort((a,b)=>a.localeCompare(b,'en'))

if(!files.length) {
  console.error('No backend regression tests found.')
  process.exit(1)
}

console.log(`Running ${files.length} backend regression tests...`)
for(const file of files) {
  console.log(`\n--- ${file} ---`)
  const result=spawnSync(process.execPath,[path.join(directory,file)],{
    stdio:'inherit',
    env:process.env,
  })
  if(result.error) throw result.error
  if(result.status!==0) {
    console.error(`\nRegression suite stopped: ${file} failed with exit code ${result.status}.`)
    process.exit(result.status || 1)
  }
}
console.log(`\nAll ${files.length} backend regression tests passed.`)
