CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Account credentials and the per-account encrypted vault-key envelope.
-- password_hash authenticates the account; password_salt + wrapped_key unlock
-- the independently generated AES-256-GCM vault key.
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL CHECK (email = lower(email)),
  display_name TEXT NOT NULL,
  password_hash TEXT,
  password_salt BYTEA NOT NULL,
  wrapped_key BYTEA NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  email_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON users(email);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS email_verification_user_idx ON email_verification_tokens(user_id);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  action TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL,
  PRIMARY KEY (action, key_hash)
);
CREATE INDEX IF NOT EXISTS auth_rate_limits_window_idx ON auth_rate_limits(window_started_at);

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  encrypted_key BYTEA NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS user_sessions_expires_idx ON user_sessions(expires_at);
CREATE INDEX IF NOT EXISTS user_sessions_user_idx ON user_sessions(user_id, last_active_at DESC);

-- Retain the old single-vault tables only as a one-time migration source.
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
ALTER TABLE vault_sessions
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS vault_sessions_expires_idx ON vault_sessions(expires_at);
CREATE INDEX IF NOT EXISTS vault_sessions_last_active_idx ON vault_sessions(last_active_at);

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
CREATE INDEX IF NOT EXISTS notes_live_recent_idx
  ON notes(pinned DESC, updated_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS notes_live_updated_idx
  ON notes(updated_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS notes_live_topic_order_idx
  ON notes(topic_id, pinned DESC, updated_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS notes_trash_idx ON notes(deleted_at DESC) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS notes_trash_page_idx
  ON notes(deleted_at DESC, id DESC) WHERE deleted_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type TEXT NOT NULL CHECK (owner_type IN ('topic', 'note')),
  owner_id UUID NOT NULL,
  storage_key TEXT UNIQUE,
  original_name_enc BYTEA NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE assets ALTER COLUMN storage_key DROP NOT NULL;
CREATE INDEX IF NOT EXISTS assets_owner_idx ON assets(owner_type, owner_id);

CREATE TABLE IF NOT EXISTS asset_blobs (
  asset_id UUID PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  encrypted_bytes BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add ownership columns, then bind all rows from the former single-user vault
-- to the explicitly configured legacy owner. No existing ciphertext is changed.
ALTER TABLE topics ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE assets ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE asset_blobs ADD COLUMN IF NOT EXISTS user_id UUID;

DO $$
DECLARE
  legacy_email TEXT := lower(trim(coalesce(current_setting('app.legacy_owner_email', true), '')));
  legacy_user_id UUID;
  has_legacy_vault BOOLEAN;
  has_unassigned_data BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM vault_settings WHERE id = 1) INTO has_legacy_vault;
  SELECT
    EXISTS (SELECT 1 FROM topics WHERE user_id IS NULL) OR
    EXISTS (SELECT 1 FROM notes WHERE user_id IS NULL) OR
    EXISTS (SELECT 1 FROM assets WHERE user_id IS NULL) OR
    EXISTS (SELECT 1 FROM asset_blobs WHERE user_id IS NULL)
  INTO has_unassigned_data;

  IF has_legacy_vault AND has_unassigned_data THEN
    IF legacy_email = '' OR length(legacy_email) > 254 OR legacy_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
      RAISE EXCEPTION 'Existing single-user archive detected. Set MNEMOSYNE_LEGACY_OWNER_EMAIL to the original owner email before running npm run db:migrate. Existing encrypted records have not been modified.';
    END IF;

    SELECT id, password_hash INTO legacy_user_id
    FROM users WHERE email = legacy_email FOR UPDATE;

    IF legacy_user_id IS NULL THEN
      INSERT INTO users (email, display_name, password_hash, password_salt, wrapped_key)
      SELECT legacy_email, 'Archive owner', NULL, password_salt, wrapped_key
      FROM vault_settings WHERE id = 1
      RETURNING id INTO legacy_user_id;
    ELSE
      IF (SELECT password_hash IS NOT NULL FROM users WHERE id = legacy_user_id) THEN
        RAISE EXCEPTION 'The configured legacy owner email already belongs to a regular account. Use the exact email reserved for the previous archive or resolve the account collision before migrating.';
      END IF;
    END IF;

    UPDATE topics SET user_id = legacy_user_id WHERE user_id IS NULL;
    UPDATE notes SET user_id = legacy_user_id WHERE user_id IS NULL;
    UPDATE assets SET user_id = legacy_user_id WHERE user_id IS NULL;
    UPDATE asset_blobs b SET user_id = a.user_id
    FROM assets a WHERE a.id = b.asset_id AND b.user_id IS NULL;
  ELSIF NOT has_legacy_vault AND has_unassigned_data THEN
    RAISE EXCEPTION 'Unassigned archive rows exist but the legacy vault key record is missing. Restore the original vault_settings row before migrating; no ownership has been guessed.';
  END IF;

  IF EXISTS (SELECT 1 FROM topics WHERE user_id IS NULL)
    OR EXISTS (SELECT 1 FROM notes WHERE user_id IS NULL)
    OR EXISTS (SELECT 1 FROM assets WHERE user_id IS NULL)
    OR EXISTS (SELECT 1 FROM asset_blobs WHERE user_id IS NULL) THEN
    RAISE EXCEPTION 'Some archive rows could not be assigned to an account. Migration stopped without changing encrypted content.';
  END IF;
END $$;

ALTER TABLE topics ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE notes ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE assets ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE asset_blobs ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE topics
  ALTER COLUMN user_id SET DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid;
ALTER TABLE notes
  ALTER COLUMN user_id SET DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid;
ALTER TABLE assets
  ALTER COLUMN user_id SET DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid;
ALTER TABLE asset_blobs
  ALTER COLUMN user_id SET DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid;

DO $$ BEGIN
  ALTER TABLE topics ADD CONSTRAINT topics_user_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE notes ADD CONSTRAINT notes_user_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE assets ADD CONSTRAINT assets_user_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE asset_blobs ADD CONSTRAINT asset_blobs_user_fk
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS topics_user_id_id_uidx ON topics(user_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS assets_user_id_id_uidx ON assets(user_id, id);
CREATE INDEX IF NOT EXISTS topics_user_updated_idx ON topics(user_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS notes_user_recent_idx
  ON notes(user_id, pinned DESC, updated_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS notes_user_trash_idx
  ON notes(user_id, deleted_at DESC, id DESC) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS assets_user_owner_idx ON assets(user_id, owner_type, owner_id);
DO $$ BEGIN
  ALTER TABLE asset_blobs ADD CONSTRAINT asset_blobs_user_asset_fk
    FOREIGN KEY (user_id, asset_id) REFERENCES assets(user_id, id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


-- The composite relation prevents a note from pointing to another account's topic.
DO $$ BEGIN
  ALTER TABLE notes ADD CONSTRAINT notes_user_topic_fk
    FOREIGN KEY (user_id, topic_id) REFERENCES topics(user_id, id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION mnemosyne_validate_asset_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.owner_type = 'topic' AND NOT EXISTS (
    SELECT 1 FROM topics WHERE id = NEW.owner_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Asset topic owner does not belong to this account' USING ERRCODE = '23503';
  ELSIF NEW.owner_type = 'note' AND NOT EXISTS (
    SELECT 1 FROM notes WHERE id = NEW.owner_id AND user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Asset note owner does not belong to this account' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS assets_validate_owner ON assets;
CREATE TRIGGER assets_validate_owner
  BEFORE INSERT OR UPDATE OF user_id, owner_type, owner_id ON assets
  FOR EACH ROW EXECUTE FUNCTION mnemosyne_validate_asset_owner();

CREATE OR REPLACE FUNCTION mnemosyne_validate_topic_cover() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cover_asset_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM assets
    WHERE id = NEW.cover_asset_id
      AND user_id = NEW.user_id
      AND owner_type = 'topic'
      AND owner_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Topic cover asset does not belong to this topic and account' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS topics_validate_cover ON topics;
CREATE TRIGGER topics_validate_cover
  BEFORE INSERT OR UPDATE OF user_id, cover_asset_id ON topics
  FOR EACH ROW EXECUTE FUNCTION mnemosyne_validate_topic_cover();

-- FORCE means table owners are also subject to RLS. The runtime DB role must
-- still be a non-superuser and NOBYPASSRLS; PostgreSQL superusers bypass RLS.
ALTER TABLE topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE topics FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS topics_account_isolation ON topics;
CREATE POLICY topics_account_isolation ON topics
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notes_account_isolation ON notes;
CREATE POLICY notes_account_isolation ON notes
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assets_account_isolation ON assets;
CREATE POLICY assets_account_isolation ON assets
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

ALTER TABLE asset_blobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_blobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS asset_blobs_account_isolation ON asset_blobs;
CREATE POLICY asset_blobs_account_isolation ON asset_blobs
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- The simple FK remains for asset deletion cascades. The trigger enforces that
-- a topic cover and its asset share both the same owner and parent relation.
DO $$ BEGIN
  ALTER TABLE topics ADD CONSTRAINT topics_cover_asset_fk
    FOREIGN KEY (cover_asset_id) REFERENCES assets(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
