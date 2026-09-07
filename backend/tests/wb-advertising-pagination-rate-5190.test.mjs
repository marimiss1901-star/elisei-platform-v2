import assert from 'node:assert/strict'
import fs from 'node:fs'

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'))

assert.ok(server.includes('const reusableCampaigns=previousRawOffset>0'),'advertising continuation must reuse the already saved campaign catalogue')
assert.ok(server.includes("allCampaigns=normalizeCampaignListStrict(reusableCampaigns)"),'continuation must normalize cached campaign definitions instead of refetching the list')
assert.ok(server.includes("const statsCampaigns=campaigns.filter(item=>[7,9,11].includes(Number(item.status)))"),'fullstats must receive only supported campaign statuses')
assert.ok(server.includes('const paginationVersion=2'),'new eligible-only pagination must invalidate old all-campaign offsets')
assert.ok(server.includes('statsEligibleCampaigns:statsCampaigns.length'),'advertising metadata must expose the eligible campaign count')
assert.ok(server.includes('nextAllowedAt:new Date(Date.now()+21000).toISOString()'),'fullstats continuation must wait more than the WB 20-second minimum interval')
assert.ok(!server.includes('nextAllowedAt:new Date(Date.now()+13000).toISOString()'),'old too-fast 13-second advertising continuation must be removed')
assert.ok(pkg.scripts.prestart.includes('apply-advertising-pagination-rate.mjs'),'production prestart must apply the advertising pagination guard')
assert.ok(pkg.scripts.pretest.includes('apply-advertising-pagination-rate.mjs'),'tests must exercise the patched production server')
assert.equal(pkg.dependencies.cors,'^2.8.5','advertising patch must not mutate unrelated dependencies')

console.log('ELISEI 5.19.0 advertising pagination/rate regression: OK')
