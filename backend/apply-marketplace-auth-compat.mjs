import fs from 'node:fs'

const file='src/server.js'
let source=fs.readFileSync(file,'utf8')

function replaceOnce(oldText,newText,label){
  if(source.includes(newText)) return
  if(!source.includes(oldText)) throw new Error(`Marketplace auth compatibility patch: ${label} target not found`)
  source=source.replace(oldText,newText)
}

replaceOnce(
  'function authHeaders(token) {',
  "function authHeaders(token, url = '') {",
  'authHeaders signature',
)

replaceOnce(
`  const serviceSecret = publicServiceSecretStatus()\n  if (serviceSecret.valid && (info.typeId === 1 || info.typeId === 4)) headers['X-Client-Secret'] = wbClientSecret`,
`  const serviceSecret = publicServiceSecretStatus()\n  const marketplaceRequest = /^https:\\/\\/marketplace-api\\.wildberries\\.ru(?:\\/|$)/i.test(String(url || ''))\n  // Marketplace FBS endpoints use the seller token exactly as documented.\n  // Do not leak the registered-service secret into this API family: the same\n  // cabinet works with Authorization-only requests in the verified seller flow.\n  if (serviceSecret.valid && !marketplaceRequest && (info.typeId === 1 || info.typeId === 4)) headers['X-Client-Secret'] = wbClientSecret`,
  'service secret host guard',
)

if(!source.includes('headers: { ...authHeaders(token, url), ...(fetchOptions.headers || {}) }')){
  if(!source.includes('headers: { ...authHeaders(token), ...(fetchOptions.headers || {}) }')) throw new Error('Marketplace auth compatibility patch: JSON fetch auth call not found')
  source=source.replace('headers: { ...authHeaders(token), ...(fetchOptions.headers || {}) }','headers: { ...authHeaders(token, url), ...(fetchOptions.headers || {}) }')
}

if(!source.includes("headers:{ ...authHeaders(token, url), Accept:'application/zip,text/csv,*/*', ...(fetchOptions.headers || {}) }")){
  if(!source.includes("headers:{ ...authHeaders(token), Accept:'application/zip,text/csv,*/*', ...(fetchOptions.headers || {}) }")) throw new Error('Marketplace auth compatibility patch: binary fetch auth call not found')
  source=source.replace("headers:{ ...authHeaders(token), Accept:'application/zip,text/csv,*/*', ...(fetchOptions.headers || {}) }","headers:{ ...authHeaders(token, url), Accept:'application/zip,text/csv,*/*', ...(fetchOptions.headers || {}) }")
}

fs.writeFileSync(file,source)
console.log('Marketplace Authorization-only compatibility applied')
