<<<<<<< HEAD
# Mnemosyne — The Private Knowledge Archive

A single-user, password-protected Next.js knowledge archive for topics, rich-text notes, images and full-archive search. The interface uses a quiet obsidian-and-gold editorial design inspired by the supplied Marginalia bookshelf and reader examples.

## Included

- First-run vault setup and master-password unlock.
- Argon2id password-based key derivation and AES-256-GCM encryption for topic fields, note fields, tags, image files and original image names.
- Random vault key wrapped by the master-password-derived key.
- HttpOnly, SameSite=Strict session cookie; server-side session records; 12-hour session expiry; 20-minute inactivity lock; failed-password lockout.
- PostgreSQL storage for metadata and encrypted content.
- Custom topic covers and encrypted note image attachments.
- Tiptap rich-text note editor with headings, lists, quotations, formatting, inline images, tags and pinning.
- Topic management, note reader, edit flow, recently deleted notes and restore/permanent deletion.
- Move notes between topics without changing their identity or attachments. The editor saves pending changes before applying the transfer.
- Copy notes into another topic, preserving encrypted text, formatting, tags and pin state while creating independent encrypted copies of embedded image attachments. The copy has its own note ID and attachment records, so either note can be edited or deleted independently.
- Global search over topic titles, subjects, descriptions, categories, note titles, subjects, body text and tags. Search decrypts the user's own records on the server and does not persist a plaintext search index.
- Responsive dashboard and navigation.

## Requirements

- Node.js 22 LTS recommended.
- PostgreSQL 18 (or a supported PostgreSQL release).
- npm.

## Local setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start PostgreSQL with Docker Compose, or create an empty PostgreSQL database named `mnemosyne` yourself:

   ```bash
   docker compose up -d postgres
   ```

3. Create your local environment file and generate a stable session-encryption secret:

   ```bash
   cp .env.example .env.local
   openssl rand -hex 32
   ```

   Put the generated 64-character hexadecimal value into `SESSION_ENCRYPTION_SECRET` in `.env.local`. Keep this secret stable and private. Set `DATABASE_URL` to your PostgreSQL connection string.

4. Create the database tables:

   ```bash
   npm run db:migrate
   ```

5. Start Next.js:

   ```bash
   npm run dev
   ```

6. Open `http://localhost:3000`. The first visit opens the vault setup screen. Create a strong master password and keep it safe.

## Useful commands

```bash
npm run dev
npm run typecheck
npm run build
npm run db:check
npm run db:migrate
```

## Note organization

On a note reader or editor screen, use **Move / copy**. Select either **Move note** or **Copy note**, then choose a destination topic. Move updates the existing note's topic relation and keeps the same note ID and image attachment records. Copy creates a separate note and duplicates each embedded local image attachment into a new encrypted storage file and asset record, rewriting the copied editor document to point at those new asset IDs. This feature does not require a database schema migration.

## Data and storage

- PostgreSQL stores encrypted topic titles, subjects, descriptions, categories, note titles, note subjects, note bodies and tags.
- Image bytes are encrypted with AES-256-GCM before they are written under `STORAGE_DIR` (defaults to `./storage`).
- The original upload filename is encrypted. Storage filenames are random identifiers.
- Back up the PostgreSQL database, the encrypted storage directory and `SESSION_ENCRYPTION_SECRET` together.
- Do not delete or rotate `SESSION_ENCRYPTION_SECRET` casually. Rotating it invalidates active server sessions; it does not re-encrypt the stored vault content.

## Production deployment notes

This project uses Node.js APIs (Argon2 and filesystem storage), so deploy it to a persistent Node.js runtime. Do not deploy with the default local `storage/` directory on an ephemeral serverless filesystem. Configure `STORAGE_DIR` to a persistent encrypted volume, or implement an S3-compatible storage adapter that stores the already-encrypted bytes. Use a managed PostgreSQL database, HTTPS, a strong secret manager for `SESSION_ENCRYPTION_SECRET`, database backups, storage backups and restrictive server access.

## Security model and limitations

This is **server-side encryption at rest**, not zero-knowledge end-to-end encryption. The application server decrypts data while a valid vault session is active so it can render notes and perform search. An operator who controls the running server and its secrets may be able to access data. Protect the host, database, storage volume, logs and environment secrets.

The schema leaves item identifiers, relations, timestamps, image MIME types and image byte sizes available as metadata. Search currently decrypts up to 500 topics and 2,000 notes in memory per request; it is appropriate for a personal archive, not a multi-user or very large-scale search workload.

There is no independent recovery key in this first implementation. If you forget the master password, the encrypted vault key cannot be unwrapped. Do not treat an ordinary database backup as a password-recovery mechanism.

The app is single-user per deployment. It does not yet include multi-user accounts, sharing, collaboration, version history, offline sync or automatic cloud backup.

## Suggested next hardening steps

- Add a tested recovery-key workflow before storing irreplaceable data.
- Add a configurable idle-lock policy and session management UI.
- Add background upload streaming and configurable per-file limits.
- Add regular automated database and storage backup verification.
- Add integration tests for authentication, encryption, authorization, upload validation, search, move/copy (including embedded image duplication), trash and restore.
- Move file storage behind a storage interface and use a durable object store for cloud deployments.

## Urdu and Arabic writing support

Mnemosyne detects Arabic-script content per title, field and rich-text block.
Urdu is displayed right-to-left in Noto Nastaliq Urdu; Arabic uses Noto Naskh
Arabic for long-form reading. Noto Sans Arabic is loaded as a compact UI
fallback. Latin/English text remains left-to-right, including mixed-language
notes where individual paragraphs can switch direction automatically.

The typefaces are requested from Google Fonts at runtime. An internet connection
is needed for the preferred typefaces to load; system serif/sans-serif fallbacks
remain available offline. For a fully offline or air-gapped deployment, host
licensed font assets on the same server and replace the Google Fonts @import.
=======
Mnemosyne — The Private Knowledge Archive

Initial repository commit. The complete application source and setup instructions will follow.
>>>>>>> origin/main
