import fs from 'node:fs'

const enginePath = new URL('./src/services/elAnalystEngine.cjs', import.meta.url)
let source = fs.readFileSync(enginePath, 'utf8')

const replacements = [
  ['оборотн\\w*\\s+капитал', 'оборотн[а-яё]*\\s+капитал'],
  ['кассов\\w*\\s+разрыв', 'кассов[а-яё]*\\s+разрыв'],
  ['месяц\\w*', 'месяц[а-яё]*'],
  ['проеда\\w*\\s+капитал', 'проеда[а-яё]*\\s+капитал'],
  ['денежн\\w*\\s+поток\\s+собствен', 'денежн[а-яё]*\\s+поток\\s+собствен'],
  ['к\\s+вывод\\w*', 'к\\s+вывод[а-яё]*'],
  ['обрабатыва\\w*', 'обрабатыва[а-яё]*'],
  ['долг\\w*\\s+(?:перед\\s+)?поставщик\\w*|поставщик\\w*[^.!?\\n]{0,25}долг', 'долг[а-яё]*\\s+(?:перед\\s+)?поставщик[а-яё]*|поставщик[а-яё]*[^.!?\\n]{0,25}долг[а-яё]*'],
]

for (const [from, to] of replacements) source = source.split(from).join(to)

if (!source.includes('долг[а-яё]*\\s+(?:перед\\s+)?поставщик[а-яё]*')) {
  throw new Error('ELISEI 5.19.16 Russian supplier-debt regex was not patched')
}
if (!source.includes('кассов[а-яё]*\\s+разрыв')) {
  throw new Error('ELISEI 5.19.16 Russian cash-gap regex was not patched')
}

fs.writeFileSync(enginePath, source)
console.log('ELISEI 5.19.16 Russian cash-safety phrase matching applied')
