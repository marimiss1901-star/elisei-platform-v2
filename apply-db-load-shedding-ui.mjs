import fs from 'node:fs'

// ELISEI 5.19.12 — status polling is informational and should not compete
// with analytics/finance reads on a 0.1 CPU Postgres instance.
const pageUrl=new URL('./src/pages/DashboardPage.jsx',import.meta.url)
let source=fs.readFileSync(pageUrl,'utf8')

const marker=`        if (shouldReload) await loadDailyReady(connectionId)\n      } catch { /* фоновая проверка не должна мешать работе интерфейса */ }\n    }, 15000)\n    return () => window.clearInterval(timer)`
const replacement=`        if (shouldReload) await loadDailyReady(connectionId)\n      } catch { /* фоновая проверка не должна мешать работе интерфейса */ }\n    }, 45000)\n    return () => window.clearInterval(timer)`

if(!source.includes(replacement)){
  if(!source.includes(marker)) throw new Error('ELISEI 5.19.12 status polling marker not found')
  source=source.replace(marker,replacement)
}

fs.writeFileSync(pageUrl,source)
console.log('ELISEI 5.19.12 UI load shedding applied: WB status poll 45s')
