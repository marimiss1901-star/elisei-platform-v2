'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const analytics = require(path.resolve(__dirname, '../payload/backend/src/services/adsAnalytics.cjs'));

const raw = [{
  advertId: 101, views: 10000, clicks: 200, sum: 5000, orders: 20, shks: 18, sum_price: 50000,
  days: [
    { date: '2026-07-01', views: 4000, clicks: 80, sum: 2000, orders: 8, shks: 7, sum_price: 20000,
      apps: [{ nm: [{ nmId: 777, views: 4000, clicks: 80, sum: 2000, orders: 8, shks: 7, sum_price: 20000 }] }] },
    { date: '2026-07-02', views: 6000, clicks: 120, sum: 3000, orders: 12, shks: 11, sum_price: 30000,
      apps: [{ nm: [{ nmId: 777, views: 6000, clicks: 120, sum: 3000, orders: 12, shks: 11, sum_price: 30000 }] }] },
  ],
}];
const result = analytics.aggregate(raw, [{ advertId: 101, status: 9, type: 9 }], {
  economics: { 777: { vendorCode: 'EL-777', cogsPerUnit: 1000, commissionRate: 0.2, logisticsPerUnit: 100 } },
});
assert.equal(result.overall.spend, 5000);
assert.equal(result.overall.revenue, 50000);
assert.equal(Math.round(result.overall.drr), 10);
assert.equal(result.products[0].nmId, 777);
assert.equal(result.products[0].vendorCode, 'EL-777');
assert.equal(result.products[0].adProfit, 15200);
assert.equal(result.daily.length, 2);
assert.equal(result.campaigns[0].recommendation.code, 'scale');

const chunked = analytics.aggregate([
  { advertId: 202, views: 100, clicks: 10, sum: 100, orders: 1, sum_price: 1000 },
  { advertId: 202, views: 200, clicks: 20, sum: 200, orders: 2, sum_price: 2000 },
], [{ advertId: 202, status: 9, type: 9 }], { economics: {} });
assert.equal(chunked.campaigns.length, 1);
assert.equal(chunked.campaigns[0].spend, 300);
assert.equal(chunked.overall.revenue, 3000);

console.log('analytics: ok');
