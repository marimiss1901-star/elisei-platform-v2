import fs from 'node:fs'

const file='src/server.js'
let source=fs.readFileSync(file,'utf8')

const marker="app.get('/api/wb/dashboard/:id', authRequired, async (req, res) => {"
if (!source.includes("app.get('/api/wb/workspace/:id'")) {
  if (!source.includes(marker)) throw new Error('Workspace bootstrap patch: dashboard route marker not found')
  const route=`app.get('/api/wb/workspace/:id', authRequired, async (req, res) => {\n  const connection = await getConnection(req.auth.sub, req.params.id)\n  if (!connection) return res.status(404).json({ error: 'Подключение не найдено' })\n  const [{ data, sources, recovered, recoveryQueued }, settings] = await Promise.all([\n    canonicalConnectionData(connection),\n    getBusinessSettings(req.auth.sub),\n  ])\n  const range = analyticsPeriodRange(req.query)\n  const selectedData = analyticsFilterConnectionData(data, range)\n  const core = buildCoreAnalytics(selectedData, settings)\n  res.json({\n    workspace:{\n      dashboard:buildDashboard(data, settings),\n      products:Array.isArray(data?.products) ? data.products : [],\n      history:Array.isArray(connection.sync_history) ? connection.sync_history : [],\n      core,\n      advertising:core?.advertising || selectedData?.advertising || null,\n      advertisingCoverage:core?.periodCoverage?.advertising || null,\n      settings:core?.settings || settings,\n    },\n    period:range ? { from:range.from,to:range.to,days:range.days } : null,\n    dataSources:sources,recovered,recoveryQueued,lastSync:connection.last_sync_at || null,\n  })\n})\n\n\n`
  source=source.replace(marker,route+marker)
}

fs.writeFileSync(file,source)
console.log('Workspace bootstrap endpoint applied')
