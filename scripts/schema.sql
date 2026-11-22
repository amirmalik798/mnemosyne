CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS vault_settings (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  password_salt BYTEA NOT NULL,
  wrapped_key BYTEA NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vault_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  encrypted_key BYTEA NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS vault_sessions_expires_idx ON vault_sessions(expires_at);

CREATE TABLE IF NOT EXISTS topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title_enc BYTEA NOT NULL,
  subject_enc BYTEA NOT NULL,
  description_enc BYTEA NOT NULL,
  category_enc BYTEA NOT NULL,
  cover_asset_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS topics_updated_idx ON topics(updated_at DESC);

CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  title_enc BYTEA NOT NULL,
  subject_enc BYTEA NOT NULL,
  content_enc BYTEA NOT NULL,
  tags_enc BYTEA NOT NULL,
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notes_topic_idx ON notes(topic_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS notes_trash_idx ON notes(deleted_at DESC) WHERE deleted_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type TEXT NOT NULL CHECK (owner_type IN ('topic', 'note')),
  owner_id UUID NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  original_name_enc BYTEA NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS assets_owner_idx ON assets(owner_type, owner_id);

DO $$ BEGIN
  ALTER TABLE topics ADD CONSTRAINT topics_cover_asset_fk
    FOREIGN KEY (cover_asset_id) REFERENCES assets(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
