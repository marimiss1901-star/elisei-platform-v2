import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dashboard = readFileSync(resolve(__dirname,'../../src/pages/DashboardPage.jsx'),'utf8')
const css = readFileSync(resolve(__dirname,'../../src/styles/app.css'),'utf8')

assert.match(dashboard,/const quarterPeriodFor = \(year, quarter\) =>/,'tax page must calculate exact calendar quarters')
assert.match(dashboard,/const taxDeadlinesFor = period =>/,'tax page must show quarterly tax deadlines')
assert.match(dashboard,/\['Финансы', WalletCards\], \['Налоговая', Percent\]/,'tax page must be available in the main navigation')
assert.match(dashboard,/\['Главная','Аналитика','Остатки','Финансы','Налоговая'\]/,'tax page must load saved analytics data')
assert.match(dashboard,/const renderTax = \(\) =>/,'tax page renderer must exist')
assert.match(dashboard,/const usnRate = 6/,'USN income calculation must default to 6 percent')
assert.match(dashboard,/const vatRate = 5/,'VAT calculation must default to 5 percent')
assert.match(dashboard,/Комиссия WB, логистика и другие удержания не уменьшают УСН/,'tax page must explain marketplace commission inclusion')
assert.match(dashboard,/НДС за квартал: 28\./,'VAT must be presented as quarterly payments')
assert.match(dashboard,/const lastClosedTaxDate = \(\) => addDays\(isoLocalDate\(new Date\(\)\),-1\)/,'tax quarters must use the last closed WB day')
assert.match(dashboard,/Ночной квартальный сбор включён/,'tax page must explain overnight quarter loading')
assert.match(dashboard,/taxTemplateText/,'tax page must build a tax office template')
assert.match(dashboard,/Текст для налоговой \/ бухгалтера/,'tax page must show the copyable tax template')
assert.match(dashboard,/navigator\.clipboard\.writeText\(taxTemplateText\)/,'tax page must let the user copy the template')
assert.match(dashboard,/Налоговая':renderTax/,'tax page must be wired into renderers')

assert.match(css,/\.tax-layout\{display:grid/,'tax page needs desktop layout styling')
assert.match(css,/\.tax-template-card pre/,'tax template must be styled as readable text')
assert.match(css,/\.data-row\.tax-product-row/,'tax product table must be styled')
assert.match(css,/html\[data-theme="light"\].*\.tax-rule-list>div/,'tax cards must support the light theme')

console.log('ELISEI frontend tax page regression tests passed')
