import assert from 'node:assert/strict'
import fs from 'node:fs'

const source=fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx',import.meta.url),'utf8')

assert.match(source,/const ELISEI_CANONICAL_FRONTEND_PATCHES = '5\.16\.3'/,
  'the canonical frontend marker must protect the period visibility fix from legacy prebuild patches')
assert.doesNotMatch(source,/else if \(previousKey\) \{\s*setAnalyticsCore\(null\)/,
  'switching to an uncached period must never erase the visible analytics snapshot')
assert.match(source,/const \[analyticsVisiblePeriod, setAnalyticsVisiblePeriod\] = useState\(null\)/,
  'the UI must track which period the retained numbers actually belong to')
assert.match(source,/readLatestAnalyticsCache\(connectionId\)/,
  'a fresh login must recover the latest saved snapshot for the same WB connection')
assert.match(source,/shouldRetainKnownAnalytics\(retainedCore,retainedPeriod,nextCore,period\)/,
  'a wider period must not replace known activity with an inconsistent empty result')
assert.match(source,/Новый период пересчитывается — цифры не скрываем/,
  'the home screen must explain that saved values remain visible during recalculation')
assert.match(source,/Сейчас показаны последние сохранённые данные за \{analyticsVisiblePeriodLabel\}/,
  'retained values must be labelled with their real source period')

console.log('ELISEI 5.16.3 period transition visibility regression: OK')
