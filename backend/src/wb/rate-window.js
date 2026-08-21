export function rateLimitHeaderSeconds(value,{now=Date.now(),allowHttpDate=false}={}) {
  if (value == null || value === '') return 0
  const numeric=Number(value)
  if (Number.isFinite(numeric) && numeric>0) return Math.ceil(numeric)
  if (!allowHttpDate) return 0
  const timestamp=Date.parse(String(value))
  if (!Number.isFinite(timestamp) || timestamp<=now) return 0
  return Math.max(1,Math.ceil((timestamp-now)/1000))
}

export function wbRateWindowDelaySeconds(response,{now=Date.now()}={}) {
  if (!response?.headers) return 0
  const retryHeader=response.headers.get('x-ratelimit-retry')
  const retryAfter=response.headers.get('retry-after')
  const retry=rateLimitHeaderSeconds(retryHeader,{now})
    || rateLimitHeaderSeconds(retryAfter,{now,allowHttpDate:true})
  if (retry>0) return retry

  // WB documents X-Ratelimit-Retry / X-Ratelimit-Reset specifically as the
  // recovery hints for a 429 response. A successful response may legitimately
  // finish a burst with Remaining=0, but carrying the full Reset value into the
  // next 30-minute live refresh made ELISEI wait tens of minutes longer than its
  // own cadence. Successful calls therefore never create a persisted runtime
  // window; endpoint-specific pagination already has its own cooldowns.
  if (Number(response.status||0)!==429) return 0
  return rateLimitHeaderSeconds(response.headers.get('x-ratelimit-reset'),{now})
}
