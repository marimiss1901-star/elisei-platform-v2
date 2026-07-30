import crypto from 'node:crypto'

function checksum(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex')
}

export async function ensureSnapshotSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wb_api_snapshots (
      id BIGSERIAL PRIMARY KEY,
      connection_id UUID NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,
      stream TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      request_key TEXT,
      raw_payload JSONB,
      normalized_payload JSONB,
      checksum TEXT NOT NULL,
      validation JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS wb_api_snapshots_connection_stream_idx
      ON wb_api_snapshots(connection_id, stream, created_at DESC);
  `)
}

export async function saveSnapshot(pool, { connectionId, stream, endpoint, requestKey = '', rawPayload = null, normalizedPayload = null, validation = {}, keep = 3 }) {
  const digest = checksum({ rawPayload, normalizedPayload })
  const result = await pool.query(`
    INSERT INTO wb_api_snapshots (connection_id,stream,endpoint,request_key,raw_payload,normalized_payload,checksum,validation)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8::jsonb)
    RETURNING id,created_at
  `, [connectionId, stream, endpoint, requestKey || null, JSON.stringify(rawPayload), JSON.stringify(normalizedPayload), digest, JSON.stringify(validation || {})])
  await pool.query(`
    DELETE FROM wb_api_snapshots
    WHERE connection_id=$1 AND stream=$2 AND id NOT IN (
      SELECT id FROM wb_api_snapshots WHERE connection_id=$1 AND stream=$2 ORDER BY created_at DESC LIMIT $3
    )
  `, [connectionId, stream, Math.max(1, Number(keep || 3))])
  return { id:result.rows[0]?.id, createdAt:result.rows[0]?.created_at, checksum:digest }
}

export async function latestSnapshot(pool, connectionId, stream) {
  const result = await pool.query(`
    SELECT id,stream,endpoint,request_key,raw_payload,normalized_payload,checksum,validation,created_at
    FROM wb_api_snapshots WHERE connection_id=$1 AND stream=$2 ORDER BY created_at DESC LIMIT 1
  `, [connectionId, stream])
  return result.rows[0] || null
}
