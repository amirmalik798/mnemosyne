# Mnemosyne — The Private Knowledge Archive

Mnemosyne is a single-user, password-protected knowledge archive for topics, rich-text notes, images and full-archive search. It uses a quiet Obsidian-and-gold editorial interface with a complete light theme.

## Features

- First-run vault setup and master-password unlock.
- Argon2id password-based key derivation and AES-256-GCM encryption for topic fields, note fields, tags, image bytes and original image names.
- A random vault key wrapped by the master-password-derived key.
- HttpOnly, SameSite=Strict session cookies; server-side session records; 12-hour absolute session expiry; 20-minute inactivity expiry; failed-password lockout.
- PostgreSQL storage for encrypted content, metadata and image blobs. Large image payloads live in a separate table so ordinary note and topic queries do not load them.
- Encrypted topic covers and note image attachments.
- Rich-text editing with headings, lists, quotations, formatting, inline images, tags and pinning.
- Topic management, note reading and editing, trash, restore and permanent deletion.
- Move notes between topics without changing their identity or attachments.
- Copy notes into another topic, creating independent encrypted copies of embedded image attachments.
- Global search across topic and note fields. Search decrypts records on the server for matching and does not persist a plaintext search index.
- Responsive navigation, pagination and dark/light themes.
- Urdu and Arabic right-to-left writing support, including mixed-direction content.

## Requirements

- Node.js 22 LTS recommended.
- PostgreSQL 18 or another supported PostgreSQL release.
- npm.

## Local setup

1. Install dependencies:

   ~~~bash
   npm install
   ~~~

2. Start PostgreSQL with Docker Compose, or create an empty PostgreSQL database named **mnemosyne**:

   ~~~bash
   docker compose up -d postgres
   ~~~

3. Create the local environment file and generate a stable session-encryption secret:

   ~~~bash
   cp .env.example .env.local
   openssl rand -hex 32
   ~~~

   Put the generated 64-character hexadecimal value in **SESSION_ENCRYPTION_SECRET**. Keep it private and stable. Set **DATABASE_URL** to your PostgreSQL connection string. Do not set **PGSSLMODE** for ordinary local loopback PostgreSQL.

4. Apply the schema:

   ~~~bash
   npm run db:migrate
   ~~~

5. Verify the database schema:

   ~~~bash
   npm run db:check
   ~~~

6. For an existing installation that has image files in **STORAGE_DIR**, stop application writes and import them into PostgreSQL:

   ~~~bash
   npm run assets:migrate-to-db
   ~~~

   New installations have no legacy files to import, so this step is not needed.

7. Verify that every image has a valid encrypted database blob:

   ~~~bash
   npm run storage:check
   ~~~

8. Start Next.js:

   ~~~bash
   npm run dev
   ~~~

7. Open **http://localhost:3000**, create your vault and choose a strong master password.

## Useful commands

~~~bash
npm run dev
npm run db:migrate
npm run db:check
npm run assets:migrate-to-db
npm run storage:check
npm run test:unit
npm run typecheck
npm run build
npm run start
~~~

- **db:migrate** applies the idempotent schema. It uses the same PostgreSQL connection and TLS validation rules as the application.
- **db:check** verifies database connectivity and required tables/columns, including the **vault_sessions.last_active_at** session-hardening migration.
- **assets:migrate-to-db** imports legacy **.enc** files into **asset_blobs** one asset at a time. It verifies path safety and encrypted size, commits the blob and clears its legacy file key in the same transaction, can be safely rerun, and never deletes the source files. Use **--dry-run** to validate legacy files without changing the database.
- **storage:check** is read-only. It verifies that every asset has an encrypted database blob of the expected size and reports assets still relying on legacy files. It never modifies or deletes files.
- **test:unit** runs fast, database-independent tests for PostgreSQL connection and TLS validation.

## Note organization

On a note reader or editor screen, use **Move / copy**. Choose **Move note** or **Copy note**, then select a destination topic. Moving preserves the note ID and existing attachment records. Copying creates a separate note and duplicates embedded images as independent encrypted PostgreSQL blob and asset records. Either copy can then be edited or deleted independently.

## Data and backups

- PostgreSQL stores encrypted topic and note content, metadata, encrypted original image bytes and encrypted original upload filenames.
- The **asset_blobs** table stores image ciphertext as PostgreSQL **BYTEA**. The separate **assets** table stores ownership and image metadata; normal note and topic queries do not fetch the large blob payloads.
- For older installations, stop application writes, take a database backup and preserve the complete **STORAGE_DIR** before running **npm run assets:migrate-to-db**. The importer copies each legacy encrypted file byte-for-byte into PostgreSQL and clears its legacy path pointer in the same transaction.
- The importer is safe to rerun after interruption. It does not decrypt, recompress or resize images, and it never deletes the original files.
- Run **npm run storage:check** after the import. Keep the old **STORAGE_DIR** until the database backup has been verified and image reads have been tested. You can then remove the old directory manually; the application no longer needs it for normal image uploads, reads or deletion.
- Back up PostgreSQL and **SESSION_ENCRYPTION_SECRET** together. The database backup now contains the encrypted images as well as the encrypted notes and topics.
- Test restoration periodically in an isolated environment. A backup that has never been restored is not a verified recovery plan.
- Do not delete or casually rotate **SESSION_ENCRYPTION_SECRET**. Changing it invalidates active server sessions; it does not re-encrypt vault content.
- Do not manually delete or recreate the **vault_settings** row to reset the password. That row contains the salt and wrapped vault key. Reinitializing setup creates a new vault key and does not make older records decryptable with the new vault.

## Production deployment

Mnemosyne uses Node.js APIs (including Argon2), so deploy it to a Node.js runtime. Image uploads, image reads and asset deletion use PostgreSQL; the application no longer requires a persistent filesystem volume for normal image storage. **STORAGE_DIR** is used only by the one-time importer for legacy file-backed images. Use a managed PostgreSQL database and serve the application over HTTPS.

Configure these environment variables:

| Variable | Requirement |
| --- | --- |
| **DATABASE_URL** | PostgreSQL URL containing the real database hostname. Do not add **host=...**, **sslmode=...** or other SSL/host overrides as query parameters. |
| **SESSION_ENCRYPTION_SECRET** | Keep the existing 64-character hexadecimal secret unchanged across deployments and restarts. |
| **PGSSLMODE** | Set to **verify-full** for remote production PostgreSQL. Certificate and hostname verification remain enabled. |
| **VAULT_SETUP_TOKEN** | Set a separate random value of at least 32 characters before first-time production vault setup. |

Generate a random 32-byte hexadecimal secret with:

~~~bash
openssl rand -hex 32
~~~

Use a different value for **SESSION_ENCRYPTION_SECRET** and **VAULT_SETUP_TOKEN**. Never paste real secrets into source control, issue reports or logs.

Before deploying an application update:

~~~bash
git pull --ff-only origin main
npm run db:migrate
npm run db:check
npm run storage:check
npm run test:unit
npm run typecheck
npm run build
~~~

After successfully initializing a new production vault, remove **VAULT_SETUP_TOKEN** from the server environment and restart the application. Existing sessions may need to authenticate again after session-cookie hardening. Do not change **SESSION_ENCRYPTION_SECRET** as part of routine deployment.

## Security model and limitations

This is **server-side encryption at rest**, not zero-knowledge end-to-end encryption. The application server decrypts data while a valid vault session is active so it can render notes and perform search. An operator who controls the running server and its secrets may be able to access data. Protect the host, database, storage volume, logs and environment secrets.

The master password is currently the vault authentication factor. TOTP authenticator support and passkeys are not implemented. Multi-factor authentication, client-side end-to-end encryption and an independent recovery-key workflow remain future security milestones. Do not describe the current system as unbreakable or zero-knowledge.

The schema leaves item identifiers, relations, timestamps, image MIME types and image byte sizes available as metadata. Search currently examines up to 500 topics and 2,000 notes per request; it is intended for a personal archive, not a multi-user or very large-scale search workload.

There is no independent recovery key in this implementation. If the master password is forgotten and no valid copy of the original vault key can be recovered, the encrypted archive may be unrecoverable. Keep and test backups; do not treat a database backup as a password-reset mechanism.

The app is single-user per deployment. It does not yet include multi-user accounts, sharing, collaboration, version history, offline sync or automatic cloud backup.

## Themes and typography

Mnemosyne includes two themes:

- **Dark Obsidian** — midnight surfaces, parchment text and antique brass-gold accents.
- **Light Papyrus** — alabaster canvas, warm vellum panels, literary ink and bronze accents.

Urdu is displayed right-to-left in Noto Nastaliq Urdu; Arabic uses Noto Naskh Arabic for long-form reading. Latin/English text remains left-to-right, and mixed-language notes can switch direction per field and paragraph. Preferred typefaces are requested from Google Fonts at runtime; system fallbacks remain available offline. For an air-gapped deployment, host licensed font assets locally and replace the Google Fonts import.
