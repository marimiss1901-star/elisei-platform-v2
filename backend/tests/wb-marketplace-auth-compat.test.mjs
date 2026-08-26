import assert from 'node:assert/strict'
import fs from 'node:fs'

const authPatch=fs.readFileSync(new URL('../apply-marketplace-auth-compat.mjs',import.meta.url),'utf8')
const requeuePatch=fs.readFileSync(new URL('../apply-fbs-reader-requeue.mjs',import.meta.url),'utf8')
const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'))

assert.ok(authPatch.includes("function authHeaders(token, url = '')"),'auth headers must know the request host')
assert.ok(authPatch.includes('marketplace-api\\.wildberries\\.ru'),'Marketplace host must be identified explicitly')
assert.ok(authPatch.includes('!marketplaceRequest'),'X-Client-Secret must be excluded from Marketplace API')
assert.ok(authPatch.includes('authHeaders(token, url)'),'WB fetch transport must pass request URL into auth selection')
assert.ok(pkg.scripts.prestart.includes('apply-marketplace-auth-compat.mjs'),'Marketplace auth compatibility must run before backend start')
assert.ok(requeuePatch.includes('marketplaceAuthHeaderCompatRetry'),'existing FBS 403 must be retried once after auth correction')
assert.ok(requeuePatch.includes("stage='sellerStocks'"),'retry must be limited to FBS stock stage')
assert.ok(requeuePatch.includes('token does not satisfy additional requirements'),'retry must be limited to the observed WB authorization failure')

console.log('WB Marketplace Authorization-only compatibility regression passed')
