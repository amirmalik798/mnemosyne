# Mnemosyne — The Private Knowledge Archive

Mnemosyne is a multi-user private knowledge archive. People create separate accounts, confirm their email addresses, and store encrypted topics, rich-text notes and images in PostgreSQL. Each account has its own randomly generated vault key and isolated archive.

## Security model

- **Per-account vault keys:** each user receives a cryptographically random 256-bit key. Topic fields, note fields, tags, image bytes and original image filenames are encrypted using AES-256-GCM with that account's key.
- **Password protection:** Argon2id authenticates passwords and derives a separate wrapping key for the user's vault key. The account password hash and wrapped vault key are stored separately.
- **Email confirmation:** no authenticated session is issued until the user's email is verified. Tokens are random, stored as hashes, single-use and expire after 24 hours.
- **Database tenant isolation:** topics, notes, assets and image blobs have a non-null `user_id`. PostgreSQL row-level security is enabled and forced on these four tables. Composite foreign keys and triggers enforce same-owner note/topic, image/owner, image/blob and topic-cover relationships.
- **Least-privileged runtime role:** Next.js uses `APP_DATABASE_URL`, which must be non-superuser, `NOBYPASSRLS`, not the owner of protected tables, and unable to create objects in the application schema. `DATABASE_URL` is reserved for migrations and administration.
- **Transaction-scoped account context:** every archive query sets the authenticated account ID locally inside its transaction. Queries without that context see no archive rows.
- **Sessions:** random 256-bit tokens are stored as SHA-256 hashes. Cookies are HttpOnly, SameSite=Strict, host-only and Secure in production. Server sessions expire after 12 hours or 20 minutes idle.
- **Abuse protection:** registration, login, verification and resend endpoints have database-backed rate limits. Five failed password attempts trigger a temporary lockout.
- **Request protection:** mutating endpoints validate same-origin requests and enforce request-size limits. New images are encrypted in PostgreSQL.

**Important limitation:** Mnemosyne uses server-side encryption at rest, not zero-knowledge end-to-end encryption. The application server can decrypt content while a user is authenticated. A compromised application server, its secrets, or a privileged database administrator could expose data. No system can promise an absolute zero-leakage probability. These controls reduce accidental cross-account access and increase the difficulty of compromise, but secure hosting, patching, monitoring, backups and secret management remain essential.

## Features

- Individual accounts with email-confirmation and account-password sign-in.
- Separate encrypted vaults for every user.
- Topic collections, category filters, rich-text notes, tags, pinned notes and search.
- Encrypted topic covers and note image attachments stored as PostgreSQL blobs.
- Move notes between topics; copy notes with independent encrypted image copies.
- Trash, restore, permanent deletion and archive pagination.
- Responsive interface, dark/light themes, Urdu and Arabic right-to-left support.

## Requirements

- Node.js 22 LTS recommended.
- PostgreSQL 18 or another supported PostgreSQL release.
- npm.
- A Google account to deploy the Google Apps Script email gateway.

## Environment variables

Copy `.env.example` to `.env.local`.

- `DATABASE_URL`: privileged migration/administration connection. Do not use it for the app runtime.
- `APP_DATABASE_URL`: dedicated restricted application role. Required by the app and `npm run db:check`.
- `SESSION_ENCRYPTION_SECRET`: 64 hexadecimal characters. Keep it stable and backed up; it protects vault keys in server-side sessions.
- `APP_BASE_URL`: canonical app origin, for example `https://archive.example.com`.
- `GOOGLE_APPS_SCRIPT_URL`: deployed Apps Script Web App URL ending in `/exec`.
- `GOOGLE_APPS_SCRIPT_SECRET`: high-entropy shared secret known only to the app server and Apps Script.
- `MNEMOSYNE_LEGACY_OWNER_EMAIL`: existing single-user installations only; see migration section.

Use HTTPS for the app and Apps Script in production. Remote PostgreSQL requires `PGSSLMODE=verify-full`.

## One-time PostgreSQL runtime-role setup

Do not run Next.js as `postgres` or another superuser. A superuser bypasses RLS. The application role must not own protected tables or have schema-creation privileges.

First run `npm run db:migrate` using `DATABASE_URL`. Then connect as a database administrator and create the restricted runtime role. Replace the password and database name:

```sql
CREATE ROLE mnemosyne_app
  LOGIN PASSWORD 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;

GRANT CONNECT ON DATABASE mnemosyne TO mnemosyne_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO mnemosyne_app;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public TO mnemosyne_app;
GRANT USAGE, SELECT
  ON ALL SEQUENCES IN SCHEMA public TO mnemosyne_app;

-- Replace postgres with the role used by DATABASE_URL for migrations.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mnemosyne_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO mnemosyne_app;
```

If your migration role is not named `postgres`, use its actual name in both `ALTER DEFAULT PRIVILEGES` statements. Keep table ownership with the migration role; do not transfer protected tables to `mnemosyne_app`. Configure `APP_DATABASE_URL` to use the new role. The database checker verifies role flags, ownership, schema privileges, table permissions and forced RLS.

## Google Apps Script email gateway

1. Open [Google Apps Script](https://script.google.com/) and create a standalone project.
2. Paste the source from `scripts/google-apps-script-email-gateway.gs` into its editor and save.
3. In **Project Settings → Script Properties**, create `MNEMOSYNE_EMAIL_SECRET` with exactly the same random value configured as `GOOGLE_APPS_SCRIPT_SECRET` on the server. Generate it with `openssl rand -hex 32`. Never expose this secret in client code or commit it.
4. Choose **Deploy → New deployment → Web app**.
5. Set **Execute as** to your Google account and **Who has access** to **Anyone**. The endpoint must be reachable by the server; the shared secret is checked on every request.
6. Copy the Web App URL ending in `/exec` into `GOOGLE_APPS_SCRIPT_URL`.
7. Set `APP_BASE_URL` to the public app origin and restart/redeploy Mnemosyne.

The script sends mail through Google's `MailApp` and is subject to Google account quotas and policies. It is suitable for initial use; a transactional email provider may be preferable at scale. Rotate both copies of the secret together if exposed.

The verification token is placed in a URL fragment, not a query string. The browser reads the fragment, removes it from the address bar, and then posts it once to the verification endpoint.

## Fresh local installation

1. Start PostgreSQL and create an empty database named `mnemosyne`.
2. Copy `.env.example` to `.env.local`. Generate `SESSION_ENCRYPTION_SECRET` and `GOOGLE_APPS_SCRIPT_SECRET`, and configure the Apps Script gateway.
3. Set `DATABASE_URL` to your privileged migration connection.
4. Install and migrate:

   ```bash
   npm install
   npm run db:migrate
   ```

5. Create the restricted `mnemosyne_app` role using the SQL above and set `APP_DATABASE_URL`.
6. Verify the runtime role and schema:

   ```bash
   npm run db:check
   ```

7. Start Next.js with `npm run dev`, open `http://localhost:3000/register`, create an account, confirm the email and sign in.

## Migration from the former single-user vault

**Back up first.** Stop the app and create a full PostgreSQL backup. Preserve `.env.local` (especially the existing `SESSION_ENCRYPTION_SECRET`) and the old `STORAGE_DIR` until image integrity is verified.

1. Choose the email address that should own the old archive.
2. Set `MNEMOSYNE_LEGACY_OWNER_EMAIL` to that exact address before the first multi-user migration.
3. Run `npm run db:migrate` using the migration-owner `DATABASE_URL`.
4. The migration creates the legacy owner from the original `vault_settings.password_salt` and `wrapped_key`, then assigns every old topic, note, asset and image blob to that account. It does not decrypt, re-encrypt, delete or rewrite archive ciphertext. If the original vault settings are missing or ownership is ambiguous, migration stops instead of guessing.
5. Create the restricted app role, configure `APP_DATABASE_URL`, and run `npm run db:check`.
6. Open `/login` and use the **original archive email and original master password**. The first successful legacy login upgrades the password hash and sends the verification email. Confirm it, then sign in again.
7. Confirm that all existing topics, notes and images are present. Keep backups until you have verified the data and made a fresh backup.

Do not register another account using the legacy email; migration reserves that email for the old archive. Other users can register independently.

## Commands

```bash
npm run dev
npm run db:migrate
npm run db:check
npm run assets:migrate-to-db
npm run storage:check
npm run test:unit
npm run test:tenant-isolation
npm run typecheck
npm run build
npm run start
```

- `db:migrate` uses `DATABASE_URL` and applies the idempotent schema.
- `db:check` uses `APP_DATABASE_URL` and verifies its role and RLS boundaries.
- `assets:migrate-to-db` imports legacy encrypted filesystem images into PostgreSQL; it can be rerun and never deletes source files. Use `--dry-run` first.
- `storage:check` checks that image metadata has a valid encrypted DB blob or legacy file.
- `test:unit` runs database-independent tests.
- `test:tenant-isolation` runs rollback-only database checks for cross-account reads and relationships using the restricted runtime role.

## Data and privacy

- PostgreSQL stores encrypted topic fields, note fields, tags, image bytes and original image filenames. Image ciphertext is in `asset_blobs`, separate from `assets` metadata.
- Back up the database and `SESSION_ENCRYPTION_SECRET` together. Keep legacy encrypted image files until `storage:check` confirms they are unnecessary.
- Each account's vault key is wrapped using a key derived from that account's password. Losing password and wrapped-key material can make the archive unrecoverable.
- The server remains part of the trust boundary because it decrypts content during authenticated requests. This is not zero-knowledge end-to-end encryption.
- Never log passwords, verification tokens, session tokens, plaintext archive content, vault keys or ciphertext payloads.
