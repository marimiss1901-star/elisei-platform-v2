const { filterPayloadByPeriod, parsePeriod } = require('../lib/period.cjs');
function periodMiddleware(req, res, next) {
  req.period = parsePeriod(req);
  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    const shouldFilter = req.method === 'GET' && req.period?.from && req.period?.to && req.query?.period_passthrough !== '1';
    return originalJson(shouldFilter ? filterPayloadByPeriod(payload, req.period) : payload);
  };
  next();
}
module.exports = periodMiddleware;
