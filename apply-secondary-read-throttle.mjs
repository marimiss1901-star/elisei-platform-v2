import fs from 'node:fs'

const file = 'src/pages/DashboardPage.jsx'
let source = fs.readFileSync(file, 'utf8')

const oldBlock = `      const secondary = await Promise.allSettled([\n        wbApi.dashboard(connectionId),\n        wbApi.syncHistory(connectionId),\n        wbApi.advertising(connectionId,{ from:analyticsPeriod.from,to:analyticsPeriod.to }),\n        wbApi.diagnostics(connectionId),\n      ])`

const newBlock = `      const secondary = []\n      const secondaryReaders = [\n        () => wbApi.dashboard(connectionId),\n        () => wbApi.syncHistory(connectionId),\n        () => wbApi.advertising(connectionId,{ from:analyticsPeriod.from,to:analyticsPeriod.to }),\n        () => wbApi.diagnostics(connectionId),\n      ]\n      // The Render PostgreSQL tier intentionally uses a tiny pool. Keep the\n      // business core responsive by letting secondary readers use one slot at\n      // a time instead of opening four competing DB requests at once.\n      for (const read of secondaryReaders) {\n        try { secondary.push({ status:'fulfilled', value:await read() }) }\n        catch (reason) { secondary.push({ status:'rejected', reason }) }\n        await new Promise(resolve => window.setTimeout(resolve, 180))\n      }`

if (!source.includes(newBlock)) {
  if (!source.includes(oldBlock)) throw new Error('Secondary-read throttle target not found')
  source = source.replace(oldBlock, newBlock)
  fs.writeFileSync(file, source)
}

console.log('Secondary workspace reads throttled for small PostgreSQL pool')
