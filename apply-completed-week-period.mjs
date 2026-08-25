import fs from 'node:fs'

const file='src/pages/DashboardPage.jsx'
let source=fs.readFileSync(file,'utf8')

const oldText="  if (preset === '7') return { preset, from:addDays(to,-6), to }"
const newText="  if (preset === '7') {\n    const completedTo = addDays(to,-1)\n    return { preset, from:addDays(completedTo,-6), to:completedTo }\n  }"

if (!source.includes(newText)) {
  if (!source.includes(oldText)) throw new Error('Completed-week patch: 7-day preset target not found')
  source=source.replace(oldText,newText)
}

fs.writeFileSync(file,source)
console.log('Completed 7-day period applied')
