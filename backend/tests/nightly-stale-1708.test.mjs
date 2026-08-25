import assert from 'node:assert/strict'
import { dailyHeavyStagePlan } from '../src/wb/daily-ready.js'

const now=Date.parse('2026-08-25T00:00:00Z') // 03:00 Moscow
const stale='2026-08-17T00:00:00Z'
const stages=['products','advertising','finance','acquiring','paidStorage','acceptance','documents','reviews','questions','chats','searchQueries','stockHistory']
const states=stages.map(stage=>({stage,status:'success',last_success_at:stale}))
const plan=dailyHeavyStagePlan({states,now,timeZone:'Europe/Moscow'})
for(const stage of stages) assert.ok(plan.includes(stage),`${stage} stale since 17.08 must be picked up by nightly ready`)

console.log('Stale 17.08 streams are eligible for nightly catch-up')
