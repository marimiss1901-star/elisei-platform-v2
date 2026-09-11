import fs from 'node:fs'

const enginePath = new URL('./src/services/elAnalystEngine.cjs', import.meta.url)
let source = fs.readFileSync(enginePath, 'utf8')

const replacements = [
  ['/за\\\\s+\\(\\\\d+\\)\\\\s*\\(дн', '/за\\s+(\\d+)\\s*(дн'],
  ['/за\\\\s+\\(\\?:один\\\\s+\\)\\?месяц/i', '/за\\s+(?:один\\s+)?месяц/i'],
  ['/за\\\\s+\\(\\?:одну\\\\s+\\)\\?недел/i', '/за\\s+(?:одну\\s+)?недел/i'],
  ['где\\\\s+взять', 'где\\s+взять'],
  ['оборотн[а-яё]*\\\\s+капитал', 'оборотн[а-яё]*\\s+капитал'],
  ['из\\\\s+бизнеса', 'из\\s+бизнеса'],
  ['кассов[а-яё]*\\\\s+цель', 'кассов[а-яё]*\\s+цель'],
  ["split(/\\\\s+/)[0]", "split(/\\s+/)[0]"],
]

for (const [from, to] of replacements) source = source.split(from).join(to)

// The days expression is easier to assert semantically after the narrow replacements.
if (!source.includes("text.match(/за\\s+(\\d+)\\s*(дн[а-яё]*|недел[а-яё]*|месяц[а-яё]*)/i)")) {
  // Fallback exact repair if escaping differed after a previous patch run.
  source = source.replace(
    "text.match(/за\\\\s+(\\\\d+)\\\\s*(дн[а-яё]*|недел[а-яё]*|месяц[а-яё]*)/i)",
    "text.match(/за\\s+(\\d+)\\s*(дн[а-яё]*|недел[а-яё]*|месяц[а-яё]*)/i)",
  )
}

if (!source.includes("text.match(/за\\s+(\\d+)\\s*(дн[а-яё]*|недел[а-яё]*|месяц[а-яё]*)/i)")) {
  throw new Error('ELISEI 5.19.17 anti-crisis days regex was not repaired')
}

fs.writeFileSync(enginePath, source)
console.log('ELISEI 5.19.17 anti-crisis regex literals repaired')
