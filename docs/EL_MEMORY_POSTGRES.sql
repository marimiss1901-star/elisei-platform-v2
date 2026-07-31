-- Production-ready schema for persistent, tenant-isolated El memory.
-- Connect it through app.locals.elMemoryStore when the ELISEI DB adapter is ready.
CREATE TABLE IF NOT EXISTS el_conversations (
  id text NOT NULL,
  user_id text NOT NULL,
  cabinet_id text NOT NULL,
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, cabinet_id, id)
);

CREATE TABLE IF NOT EXISTS el_messages (
  id bigserial PRIMARY KEY,
  conversation_id text NOT NULL,
  user_id text NOT NULL,
  cabinet_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS el_messages_tenant_conversation_idx ON el_messages(user_id, cabinet_id, conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS el_memories (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  cabinet_id text NOT NULL,
  category text NOT NULL,
  memory_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS el_memories_tenant_idx ON el_memories(user_id, cabinet_id, updated_at DESC);
