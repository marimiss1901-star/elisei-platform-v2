import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bindWbSearchRowsToNmId, buildProduct360, SEARCH_BINDING_VERSION } from '../src/wb/product-360.js'

const here=path.dirname(fileURLToPath(import.meta.url))
const backendRoot=path.resolve(here,'..')
const projectRoot=path.resolve(backendRoot,'..')

const bound=bindWbSearchRowsToNmId([
  {nmId:111,searchTexts:['удлинитель 3м',{searchText:'сетевой фильтр 3м',orders:4}]},
  {nmId:222,searchText:'чужой товар'},
  {searchText:'строка без nmID'},
],[111])
assert.equal(bound.rows.length,2,'nested search texts must inherit the explicit parent nmId')
assert.ok(bound.rows.every(row=>String(row.nmId)==='111' && String(row.sourceNmID)==='111'))
assert.equal(bound.droppedOutsideRequest,1,'rows for nmIds outside the requested batch must be rejected')
assert.equal(bound.droppedUnbound,1,'rows without a provable nmId must be rejected')

const product={nmID:111,vendorCode:'SKU-111',title:'Сетевой фильтр'}
const coverage={
  core:{},stages:{},finance:{},
  streams:{searchQueries:{status:'success'},reviews:{status:'success'},questions:{status:'success'},stockHistory:{status:'success'}},
}
const view=buildProduct360({product,coverage,searchRows:[
  {rowType:'query',nmId:111,sourceNmID:111,searchBindingVersion:SEARCH_BINDING_VERSION,searchOrigin:'organic_product_search_texts',searchText:'сетевой фильтр 3м',orders:3,isSubstitutedSKU:false},
  {rowType:'query',nmId:111,sourceNmID:111,searchBindingVersion:SEARCH_BINDING_VERSION,searchOrigin:'organic_product_search_texts',searchText:'зубная паста детская',orders:99,isSubstitutedSKU:true},
  {rowType:'query',vendorCode:'SKU-111',sourceNmID:111,searchBindingVersion:SEARCH_BINDING_VERSION,searchOrigin:'organic_product_search_texts',searchText:'vendor fallback must not bind',orders:50,isSubstitutedSKU:false},
  {rowType:'query',nmId:222,sourceNmID:222,searchBindingVersion:SEARCH_BINDING_VERSION,searchOrigin:'organic_product_search_texts',searchText:'чужой nmID',orders:50,isSubstitutedSKU:false},
]})
assert.equal(view.demand.search.rows.length,1,'SKU 360 search must keep only organic exact-nmId rows')
assert.equal(view.demand.search.rows[0].phrase,'сетевой фильтр 3м')

const server=fs.readFileSync(path.join(backendRoot,'src/server.js'),'utf8')
const drawer=fs.readFileSync(path.join(projectRoot,'src/components/Product360Drawer.jsx'),'utf8')
assert.ok(server.includes('includeSubstitutedSKUs:false'),'product search-text request must exclude substitute SKU placements at the source')
assert.ok(server.includes('includeSearchTexts:true'),'real search texts must stay enabled')
assert.ok(server.includes('bindWbSearchRowsToNmId(searchReportRows(payload),batch)'),'persisted search rows must be bound to an explicit requested nmId')
assert.ok(server.includes('trustedWbSearchRowForProduct(row,product)'),'SKU 360 search must use the trusted exact-nmID binding gate')
assert.ok(server.includes("payload->>'isSubstitutedSKU'"),'stored substitute rows must be filtered from legacy data')
assert.ok(drawer.includes('Подменные SKU/промо-показы исключены'),'UI must explain the search visibility rule')
console.log('WB 5.11.5 search source integrity regression tests passed')
