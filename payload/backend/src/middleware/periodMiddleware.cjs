'use strict';
const { parsePeriod, applyAliases, filterPayloadByPeriod } = require('../lib/period.cjs');
function periodMiddleware(req, res, next) {
  req.period = parsePeriod(req);
  applyAliases(req, req.period);
  if (req.period.from && req.period.to) {
    res.setHeader('X-ELISEI-Period-From', req.period.from);
    res.setHeader('X-ELISEI-Period-To', req.period.to);
    res.setHeader('X-ELISEI-Period-Mode', req.period.mode);
  }
  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    const passthrough = String(req.query?.period_passthrough || '') === '1';
    const shouldFilter = req.method === 'GET' && req.period?.from && req.period?.to && !passthrough;
    return originalJson(shouldFilter ? filterPayloadByPeriod(payload, req.period) : payload);
  };
  next();
}
module.exports = periodMiddleware;
