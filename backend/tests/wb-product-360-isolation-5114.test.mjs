import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildProduct360, SEARCH_BINDING_VERSION } from '../src/wb/product-360.js'

const here=path.dirname(fileURLToPath(import.meta.url))
const backendRoot=path.resolve(here,'..')
const projectRoot=path.resolve(backendRoot,'..')

const product={
  nmID:111,vendorCode:'SKU-111',barcode:'460111',title:'Сетевой фильтр',
  advertising:999999, // may include cabinet-level allocation in core; SKU 360 must ignore it
  revenue:50000,salesCount:20,ordersCount:22,returnsCount:1,returnRate:5,stock:10,
  averagePrice:2500,profit:10000,margin:20,cogs:10000,commission:5000,logistics:3000,
}
const coverage={
  core:{sales:true,orders:true,finance:true,advertising:true,stockDetails:true,fboStocks:true,sellerStocks:true},
  stages:{sales:{status:'success'},orders:{status:'success'},finance:{status:'success'},advertising:{status:'success'},stocks:{status:'success'},sellerStocks:{status:'success'}},
  streams:{searchQueries:{status:'success'},reviews:{status:'success'},questions:{status:'success'},stockHistory:{status:'success'}},
  finance:{status:'success'},
}
const view=buildProduct360({
  product,coverage,
  advertisingRows:[
    {nmID:111,advertId:1,campaignName:'Exact',spend:500,views:1000,clicks:100,orders:5,revenue:4000,mapped:true},
    {vendorCode:'SKU-111',advertId:2,campaignName:'Vendor fallback must not count',spend:7000,orders:50,revenue:30000,mapped:true},
    {nmID:222,advertId:3,campaignName:'Other SKU',spend:9000,orders:90,revenue:50000,mapped:true},
  ],
  searchRows:[
    {rowType:'group',nmID:111,searchText:'зубная паста детская',orders:100,revenue:99999},
    {rowType:'query',nmID:111,sourceNmID:111,searchBindingVersion:SEARCH_BINDING_VERSION,searchOrigin:'organic_product_search_texts',searchText:'сетевой фильтр 3м',orders:4,revenue:8000,avgPosition:8},
    {rowType:'query',nmID:222,sourceNmID:222,searchBindingVersion:SEARCH_BINDING_VERSION,searchOrigin:'organic_product_search_texts',searchText:'коврик для мышки игровой',orders:50,revenue:50000},
  ],
})
assert.equal(view.demand.search.rows.length,1,'overview/group search rows must never appear in a single SKU')
assert.equal(view.demand.search.rows[0].phrase,'сетевой фильтр 3м')
assert.equal(view.demand.advertising.rows.length,1,'SKU advertising must be attributed only by exact nmID')
assert.equal(view.demand.advertising.summary.spend,500)
assert.equal(view.overview.advertising,500,'SKU KPI must not use allocated cabinet advertising from core')
assert.equal(view.economics.advertising,500,'unit economics line must use exact SKU campaign spend')
assert.equal(view.demand.advertising.matching,'nmID_exact')

const server=fs.readFileSync(path.join(backendRoot,'src/server.js'),'utf8')
const drawer=fs.readFileSync(path.join(projectRoot,'src/components/Product360Drawer.jsx'),'utf8')
assert.ok(server.includes('productOffset+20'),'WB search-texts batches must stay within the official 20 nmIds request limit')
assert.ok(server.includes("where.push(`COALESCE(payload->>'rowType','')='query'`)"),'full SKU 360 must query only product-level search rows')
assert.ok(!drawer.includes('demand.advertising?.summary?.spend ?? overview.advertising'),'frontend must not fall back to allocated cabinet advertising')
console.log('WB 5.11.4 SKU 360 data isolation regression tests passed')
