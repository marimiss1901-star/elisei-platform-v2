import crypto from 'node:crypto'

export const WB_STREAMS = Object.freeze(['products', 'orders', 'sales', 'stocks', 'advertising'])

function checksum(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload ?? null)).digest('hex')
}

export function streamCount(stream, payload) {
  if (stream === 'advertising') return Array.isArray(payload?.campaigns) ? payload.campaigns.length : 0
  return Array.isArray(payload) ? payload.length : 0
}

export function normalizeStreamPayload(stream, payload) {
  if (stream === 'advertising') {
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload
      : { campaigns: [], totals: {}, period: null, truncated: false }
  }
  return Array.isArray(payload) ? payload : []
}

export async function ensureStreamSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS wb_stream_data (
      connection_id UUID NOT NULL REFERENCES marketplace_connections(id) ON DELETE CASCADE,
      stream TEXT NOT NULL,
      payload JSONB NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      checksum TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      source TEXT NOT NULL DEFAULT 'sync',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(connection_id, stream),
      CHECK (stream IN ('products','orders','sales','stocks','advertising'))
    );
    CREATE INDEX IF NOT EXISTS wb_stream_data_updated_idx
      ON wb_stream_data(connection_id, updated_at DESC);
  `)
}

export async function saveStreamData(db, {
  connectionId,
  stream,
  payload,
  metadata = {},
  source = 'sync',
}) {
  if (!WB_STREAMS.includes(stream)) throw new Error(`Неизвестный поток WB: ${stream}`)
  const normalized = normalizeStreamPayload(stream, payload)
  const count = streamCount(stream, normalized)
  const digest = checksum(normalized)
  const result = await db.query(`
    INSERT INTO wb_stream_data (connection_id,stream,payload,row_count,checksum,metadata,source,updated_at)
    VALUES ($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7,NOW())
    ON CONFLICT (connection_id,stream) DO UPDATE SET
      payload=EXCLUDED.payload,
      row_count=EXCLUDED.row_count,
      checksum=EXCLUDED.checksum,
      metadata=EXCLUDED.metadata,
      source=EXCLUDED.source,
      updated_at=NOW()
    RETURNING connection_id,stream,row_count,checksum,metadata,source,updated_at
  `, [connectionId, stream, JSON.stringify(normalized), count, digest, JSON.stringify(metadata || {}), source])
  return { ...result.rows[0], payload: normalized }
}

export async function loadStreamRows(db, connectionId) {
  const result = await db.query(`
    SELECT connection_id,stream,payload,row_count,checksum,metadata,source,updated_at
    FROM wb_stream_data
    WHERE connection_id=$1
  `, [connectionId])
  return result.rows
}

export async function latestSnapshotForStream(db, connectionId, stream) {
  const result = await db.query(`
    SELECT id,stream,endpoint,request_key,raw_payload,normalized_payload,validation,created_at
    FROM wb_api_snapshots
    WHERE connection_id=$1 AND stream=$2
    ORDER BY created_at DESC
    LIMIT 1
  `, [connectionId, stream])
  return result.rows[0] || null
}

export function snapshotPayload(stream, snapshot) {
  if (!snapshot) return null
  const normalized = snapshot.normalized_payload
  if (stream === 'advertising') {
    if (normalized && typeof normalized === 'object' && !Array.isArray(normalized)) return normalized
    return null
  }
  if (Array.isArray(normalized)) return normalized
  if (Array.isArray(snapshot.raw_payload)) return snapshot.raw_payload
  return null
}

export async function hydrateStreamData(db, connectionId, legacyData = {}, { repair = true } = {}) {
  const rows = await loadStreamRows(db, connectionId)
  const byStream = new Map(rows.map(row => [row.stream, row]))
  const data = { ...(legacyData && typeof legacyData === 'object' ? legacyData : {}) }
  const sources = {}
  const recovered = []

  for (const stream of WB_STREAMS) {
    const stored = byStream.get(stream)
    if (stored) {
      data[stream] = normalizeStreamPayload(stream, stored.payload)
      sources[stream] = {
        source: stored.source || 'stream_store',
        count: Number(stored.row_count || streamCount(stream, stored.payload)),
        updatedAt: stored.updated_at || null,
        checksum: stored.checksum || null,
      }
      continue
    }

    const legacyValue = normalizeStreamPayload(stream, data[stream])
    const legacyHasValue = stream === 'advertising'
      ? Boolean(data[stream] && typeof data[stream] === 'object' && !Array.isArray(data[stream]))
      : Array.isArray(data[stream])

    if (legacyHasValue && streamCount(stream, legacyValue) > 0) {
      data[stream] = legacyValue
      sources[stream] = { source: 'legacy_connection_data', count: streamCount(stream, legacyValue), updatedAt: null, checksum: null }
      if (repair) {
        const saved = await saveStreamData(db, { connectionId, stream, payload: legacyValue, source: 'legacy_backfill' })
        recovered.push({ stream, from: 'legacy_connection_data', count: Number(saved.row_count || 0) })
      }
      continue
    }

    const snapshot = await latestSnapshotForStream(db, connectionId, stream)
    const recoveredPayload = snapshotPayload(stream, snapshot)
    if (recoveredPayload != null) {
      data[stream] = normalizeStreamPayload(stream, recoveredPayload)
      const count = streamCount(stream, data[stream])
      sources[stream] = { source: 'snapshot_recovery', count, updatedAt: snapshot?.created_at || null, checksum: null }
      if (repair) {
        await saveStreamData(db, {
          connectionId,
          stream,
          payload: data[stream],
          metadata: { snapshotId: snapshot.id, endpoint: snapshot.endpoint, validation: snapshot.validation || {} },
          source: 'snapshot_recovery',
        })
        recovered.push({ stream, from: 'snapshot', count })
      }
      continue
    }

    data[stream] = normalizeStreamPayload(stream, null)
    sources[stream] = { source: 'empty', count: 0, updatedAt: null, checksum: null }
  }

  return { data, sources, recovered }
}
