import fs from 'node:fs'

function replaceOnce(source, from, to, label) {
  if (source.includes(to)) return source
  const count = source.split(from).length - 1
  if (count !== 1) throw new Error(`${label}: expected one marker, found ${count}`)
  return source.replace(from, to)
}

const path = 'src/pages/DashboardPage.jsx'
let source = fs.readFileSync(path, 'utf8')

source = replaceOnce(
  source,
  "  const preferredElName = elSettings.preferredName || displayName\n",
  "  const preferredElName = elSettings.preferredName || displayName\n  const preferredProfileInitial = preferredElName ? preferredElName.slice(0,1).toUpperCase() : profileInitial\n",
  'preferred display name'
)

source = replaceOnce(
  source,
  "<em>{displayName || 'рады вас видеть'}</em>",
  "<em>{preferredElName || 'рады вас видеть'}</em>",
  'home greeting name'
)

source = replaceOnce(
  source,
  "<button className=\"profile\" title={rawName || 'Профиль'}>{profileInitial}</button>",
  "<button className=\"profile\" title={preferredElName || rawName || 'Профиль'}>{preferredProfileInitial}</button>",
  'profile avatar name'
)

if (!source.includes("<em>{preferredElName || 'рады вас видеть'}</em>")) throw new Error('home greeting still ignores preferredName')
if (!source.includes('>{preferredProfileInitial}</button>')) throw new Error('profile initial still ignores preferredName')
fs.writeFileSync(path, source)
console.log('ELISEI display-name hotfix applied')
