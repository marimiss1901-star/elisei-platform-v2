import crypto from 'node:crypto'

const CORE_MART_VERSION = 1

export async function ensureCoreMartSchema(pool) {
  if (!pool) return
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wb_core_marts (
      connection_id UUID NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,
      period_from DATE NOT NULL,
      period_to DATE NOT NULL,
      source_revision TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(connection_id,period_from,period_to)
    );
    CREATE INDEX IF NOT EXISTS wb_core_marts_updated_idx ON wb_core_marts(connection_id,updated_at DESC);
  `)
}

export function coreMartRevision(states = [], settings = {}) {
  const stateParts = (Array.isArray(states) ? states : [])
    .map(item => [
      String(item?.stage || ''),
      String(item?.last_success_at || item?.lastSuccessAt || ''),
      String(item?.last_count || item?.lastCount || 0),
    ].join(':'))
    .sort()
  const settingsDigest = crypto.createHash('sha256')
    .update(JSON.stringify(settings && typeof settings === 'object' ? settings : {}))
    .digest('hex')
    .slice(0,16)
  return `${CORE_MART_VERSION}|${stateParts.join('|')}|settings:${settingsDigest}`
}

export async function loadCoreMart(pool, { connectionId, from, to, revision }) {
  if (!pool || !connectionId || !from || !to || !revision) return null
  const result = await pool.query(`
    SELECT payload,generated_at,updated_at
    FROM wb_core_marts
    WHERE connection_id=$1 AND period_from=$2::date AND period_to=$3::date AND source_revision=$4
    LIMIT 1
  `,[connectionId,from,to,revision])
  return result.rows[0] || null
}

export async function saveCoreMart(pool, { connectionId, from, to, revision, payload }) {
  if (!pool || !connectionId || !from || !to || !revision || !payload) return null
  const result = await pool.query(`
    INSERT INTO wb_core_marts(connection_id,period_from,period_to,source_revision,payload,generated_at,updated_at)
    VALUES($1,$2::date,$3::date,$4,$5::jsonb,NOW(),NOW())
    ON CONFLICT(connection_id,period_from,period_to) DO UPDATE SET
      source_revision=EXCLUDED.source_revision,payload=EXCLUDED.payload,generated_at=NOW(),updated_at=NOW()
    RETURNING generated_at,updated_at
  `,[connectionId,from,to,revision,JSON.stringify(payload)])
  return result.rows[0] || null
}

