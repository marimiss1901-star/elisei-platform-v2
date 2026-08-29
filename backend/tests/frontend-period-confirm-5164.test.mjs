import assert from 'node:assert/strict'
import fs from 'node:fs'

const source=fs.readFileSync(new URL('../../src/pages/DashboardPage.jsx',import.meta.url),'utf8')

assert.match(source,/const ELISEI_CANONICAL_FRONTEND_PATCHES = '5\.16\.4'/,
  'the canonical frontend marker must protect the explicit period confirmation flow')
assert.match(source,/const \[analyticsPeriodDraft, setAnalyticsPeriodDraft\] = useState\(analyticsPeriod\)/,
  'period controls must edit a draft without replacing the visible applied period')
assert.match(source,/const setAnalyticsPreset = preset => setAnalyticsPeriodDraft\(periodPresetValue\(preset\)\)/,
  'preset clicks must only update the draft period')
assert.match(source,/const applyAnalyticsPeriod = \(\) => \{[\s\S]*setAnalyticsPeriod\(nextPeriod\)/,
  'only the explicit apply action may commit a new analytics period')
assert.doesNotMatch(source,/onChange=\{event => setAnalyticsPeriod\(/,
  'manual date inputs must not immediately trigger a period reload')
assert.match(source,/Применить период/,
  'all full period controls must expose an explicit apply button')
assert.match(source,/Период выбран, но ещё не применён/,
  'the UI must explain why the previously applied figures remain visible')
assert.match(source,/localStorage\.setItem\(ANALYTICS_PERIOD_KEY, JSON\.stringify\(analyticsPeriod\)\)/,
  'only the applied period may be persisted for the next login')

console.log('ELISEI 5.16.4 explicit period confirmation regression: OK')
