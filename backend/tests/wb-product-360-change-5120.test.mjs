import assert from 'node:assert/strict'
import { buildProduct360Comparison } from '../src/wb/product-360.js'

const current={
  nmID:111,vendorCode:'SKU-111',revenue:80000,ordersCount:85,salesCount:70,returnsCount:9,returnRate:12.9,
  averagePrice:1143,profit:9000,margin:11.3,commission:12000,logistics:9500,
}
const previous={
  nmID:111,vendorCode:'SKU-111',revenue:100000,ordersCount:100,salesCount:90,returnsCount:4,returnRate:4.4,
  averagePrice:1111,profit:18000,margin:18,commission:11000,logistics:7000,
}
const currentAds=[{nmID:111,spend:14000,views:10000,clicks:500,orders:25,revenue:50000},{nmID:222,spend:999999,orders:0,revenue:0}]
const previousAds=[{nmID:111,spend:8000,views:9000,clicks:450,orders:30,revenue:65000},{nmID:222,spend:888888,orders:0,revenue:0}]

const result=buildProduct360Comparison({
  currentProduct:current,
  previousProduct:previous,
  currentAdvertisingRows:currentAds,
  previousAdvertisingRows:previousAds,
  currentAvailability:{sales:true,orders:true,finance:true,advertising:true},
  previousAvailability:{sales:true,orders:true,finance:true,advertising:true},
  currentPeriod:{from:'2026-08-11',to:'2026-08-17',days:7},
  previousPeriod:{from:'2026-08-04',to:'2026-08-10',days:7},
  comparisonCoverage:true,
})

assert.equal(result.available,true)
assert.equal(result.headlineMetric,'profit')
assert.equal(result.metrics.revenue.delta,-20000)
assert.equal(result.metrics.profit.delta,-9000)
assert.equal(result.metrics.advertising.delta,6000,'advertising must use exact nmID only')
assert.equal(result.metrics.returnRate.delta,8.5)
assert.ok(result.factors.some(item=>item.type==='advertising'))
assert.ok(result.factors.some(item=>item.type==='returns'))
assert.ok(result.action?.text)
assert.ok(result.note.includes('не объявляются доказанной причинностью'))

const incomplete=buildProduct360Comparison({
  currentProduct:current,previousProduct:previous,
  currentAvailability:{sales:true,orders:true,finance:true,advertising:true},
  previousAvailability:{sales:true,orders:true,finance:true,advertising:true},
  currentPeriod:{from:'2026-08-11',to:'2026-08-17',days:7},
  previousPeriod:{from:'2026-08-04',to:'2026-08-10',days:7},
  comparisonCoverage:false,
})
assert.equal(incomplete.metrics.revenue.available,false,'incomplete previous coverage must not create a false sales comparison')
assert.equal(incomplete.confidence,'low')
assert.ok(incomplete.warnings.some(item=>item.includes('предыдущий период') || item.includes('Продажи')))

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname=path.dirname(fileURLToPath(import.meta.url))
const backendRoot=path.resolve(__dirname,'..')
const projectRoot=path.resolve(backendRoot,'..')
const server=fs.readFileSync(path.join(backendRoot,'src/server.js'),'utf8')
const drawer=fs.readFileSync(path.join(projectRoot,'src/components/Product360Drawer.jsx'),'utf8')
assert.ok(server.includes('buildProduct360Comparison'),'SKU 360 endpoint must attach period comparison')
assert.ok(server.includes('previousEqualPeriod(range)'),'comparison must use previous period of equal length')
assert.ok(drawer.includes('Что изменилось и почему'),'frontend must render SKU-level change diagnostics')
assert.ok(drawer.includes('Одно действие'),'frontend must surface one prioritized action')

console.log('WB 5.12.0 SKU 360 change diagnostics regression tests passed')
