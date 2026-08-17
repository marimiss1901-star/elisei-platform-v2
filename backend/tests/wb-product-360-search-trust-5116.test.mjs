import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bindWbSearchRowsToNmId, buildProduct360, trustedWbSearchRowForProduct, SEARCH_BINDING_VERSION } from '../src/wb/product-360.js'

const here=path.dirname(fileURLToPath(import.meta.url))
const backendRoot=path.resolve(here,'..')
const projectRoot=path.resolve(backendRoot,'..')
const product={nmID:271964857,vendorCode:'2505 чер 3м'}

const legacy={rowType:'query',nmId:271964857,searchText:'зубная паста детская',orders:99,isSubstitutedSKU:false}
assert.equal(trustedWbSearchRowForProduct(legacy,product),false,'legacy search rows without provenance must never be shown in SKU 360')

const wrongOrigin={rowType:'query',nmId:271964857,sourceNmID:271964857,searchBindingVersion:SEARCH_BINDING_VERSION,searchOrigin:'overview_group',searchText:'ручки'}
assert.equal(trustedWbSearchRowForProduct(wrongOrigin,product),false,'only product/search-texts rows may be trusted')

const wrongSource={rowType:'query',nmId:271964857,sourceNmID:999999,searchBindingVersion:SEARCH_BINDING_VERSION,searchOrigin:'organic_product_search_texts',searchText:'коврик для мышки игровой'}
assert.equal(trustedWbSearchRowForProduct(wrongSource,product),false,'sourceNmID must equal the requested product nmID')

const bound=bindWbSearchRowsToNmId([{nmId:271964857,searchTexts:[{searchText:'удлинитель 3м',orders:8}]}],[271964857])
assert.equal(bound.rows.length,1)
const trusted=bound.rows[0]
assert.equal(Number(trusted.searchBindingVersion),SEARCH_BINDING_VERSION)
assert.equal(trusted.searchOrigin,'organic_product_search_texts')
assert.equal(String(trusted.sourceNmID),'271964857')
assert.equal(trustedWbSearchRowForProduct(trusted,product),true,'fresh rows stamped at ingestion must be trusted')

const view=buildProduct360({product,coverage:{core:{},stages:{},finance:{},streams:{searchQueries:{status:'success'}}},searchRows:[legacy,wrongOrigin,wrongSource,trusted]})
assert.deepEqual(view.demand.search.rows.map(row=>row.phrase),['удлинитель 3м'],'SKU 360 must hide all legacy/unproven search rows')

const server=fs.readFileSync(path.join(backendRoot,'src/server.js'),'utf8')
const drawer=fs.readFileSync(path.join(projectRoot,'src/components/Product360Drawer.jsx'),'utf8')
assert.ok(server.includes('async function recoverLegacySearchQueryBindings'),'backend must queue a fresh verified search sync after the trust-schema upgrade')
assert.ok(server.includes("COALESCE(payload->>'searchBindingVersion','0')"),'extended search reads must require the current binding version')
assert.ok(server.includes("payload->>'sourceNmID'"),'extended search reads must require sourceNmID')
assert.ok(server.includes("payload->>'searchOrigin'"),'extended search reads must require the product search-text origin')
assert.ok(server.includes('searchBindingVerified:true'),'completed search sync must mark verified provenance')
assert.ok(drawer.includes('Подменные SKU/промо-показы исключены'),'UI must keep the organic-search explanation')
console.log('WB 5.11.6 search provenance trust regression tests passed')
