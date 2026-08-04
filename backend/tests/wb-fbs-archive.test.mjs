import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  FBS_ARCHIVE_ENDPOINT, buildFbsArchiveUrl, fbsArchiveMonthKey, fbsArchiveMonthSequence,
  fbsArchiveOrderKey, normalizeFbsArchivePlan, parseFbsArchivePage,
} from '../src/wb/fbs-archive.js'

const months=fbsArchiveMonthSequence(5,new Date('2026-08-04T09:00:00Z'))
assert.deepEqual(months,[
  {year:2026,month:5},{year:2026,month:4},{year:2026,month:3},{year:2026,month:2},{year:2026,month:1},
])
assert.equal(fbsArchiveMonthKey(months[0]),'2026-05')

const firstPlan=normalizeFbsArchivePlan({},3,new Date('2026-08-04T09:00:00Z'))
const resumedPlan=normalizeFbsArchivePlan(firstPlan,3,new Date('2026-09-10T09:00:00Z'))
assert.deepEqual(resumedPlan.archiveMonths,firstPlan.archiveMonths,'resume must keep the original month plan')
assert.equal(resumedPlan.archiveAnchor,firstPlan.archiveAnchor)
assert.match(firstPlan.archiveCutoff,/2026-05-04T09:00:00\.000Z/)

const legacyPlan=normalizeFbsArchivePlan({currentMonth:{year:2026,month:4},monthIndex:1},3,new Date('2026-09-10T09:00:00Z'))
assert.deepEqual(legacyPlan.archiveMonths,[{year:2026,month:5},{year:2026,month:4},{year:2026,month:3}])
assert.equal(legacyPlan.legacyPlanRecovered,true)

const url=new URL(buildFbsArchiveUrl({year:2025,month:12},555,500))
assert.equal(`${url.origin}${url.pathname}`,FBS_ARCHIVE_ENDPOINT)
assert.equal(url.searchParams.get('year'),'2025')
assert.equal(url.searchParams.get('month'),'12')
assert.equal(url.searchParams.get('next'),'555')
assert.equal(url.searchParams.get('limit'),'500')

assert.deepEqual(parseFbsArchivePage({orders:[{id:1}],next:77},0),{orders:[{id:1}],next:77,complete:false})
assert.deepEqual(parseFbsArchivePage({orders:[],next:77},0),{orders:[],next:77,complete:false},'empty page with a new cursor must continue')
assert.deepEqual(parseFbsArchivePage({data:{orders:[],next:0}},77),{orders:[],next:0,complete:true})
assert.throws(()=>parseFbsArchivePage({next:0},0),error=>error?.code==='WB_FBS_ARCHIVE_BAD_PAYLOAD')
assert.throws(()=>parseFbsArchivePage({orders:[],next:77},77),error=>error?.code==='WB_FBS_ARCHIVE_CURSOR_LOOP')
assert.throws(()=>parseFbsArchivePage({orders:[],next:'bad'},0),error=>error?.code==='WB_FBS_ARCHIVE_BAD_CURSOR')

assert.equal(fbsArchiveOrderKey({id:123},0),'fbsArchive:id:123')
assert.equal(fbsArchiveOrderKey({orderId:456},99),'fbsArchive:id:456')
assert.equal(fbsArchiveOrderKey({nmId:1,createdAt:'2025-01-01'},0),fbsArchiveOrderKey({createdAt:'2025-01-01',nmId:1},900),'fallback key must be stable across pages')

const server=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8')
for (const marker of [
  'normalizeFbsArchivePlan(state?.metadata || {}, FBS_ARCHIVE_MONTHS)',
  'buildFbsArchiveUrl(selectedMonth, cursor, limit)',
  'parseFbsArchivePage(payload, cursor)',
  'keyOf:(row,index)=>fbsArchiveOrderKey(row,index)',
  'monthStats',
  'cursorComplete:true',
  'previewPage.map(item=>item.payload)',
]) assert.ok(server.includes(marker),`server.js must contain ${marker}`)
assert.ok(!server.includes('if (rows.length > 0 && next > 0'), 'archive pagination must follow next even after an empty page')

console.log('WB FBS archive tests passed')
