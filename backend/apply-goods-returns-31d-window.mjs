import fs from 'node:fs'

// ELISEI 5.19.7 — WB goods-return accepts at most 31 calendar days.
// Clamp every newly scheduled goodsReturns period before runSyncStage reads it.
const serverUrl = new URL('./src/server.js', import.meta.url)
let source = fs.readFileSync(serverUrl, 'utf8')

const before = `  if (stage==='stockHistory') return boundedSyncPeriod(range,90)\n  if (stage==='advertising') return boundedSyncPeriod(range,92)\n  if (stage==='searchQueries') return boundedSyncPeriod(range,365)\n  return boundedSyncPeriod(range,366)`
const after = `  if (stage==='stockHistory') return boundedSyncPeriod(range,90)\n  if (stage==='advertising') return boundedSyncPeriod(range,92)\n  if (stage==='searchQueries') return boundedSyncPeriod(range,365)\n  if (stage==='goodsReturns') return boundedSyncPeriod(range,31)\n  return boundedSyncPeriod(range,366)`

if (!source.includes(after)) {
  if (!source.includes(before)) throw new Error('ELISEI 5.19.7 goodsReturns 31-day marker not found')
  source = source.replace(before,after)
}

fs.writeFileSync(serverUrl,source)
console.log('ELISEI 5.19.7 goodsReturns 31-day window applied')
