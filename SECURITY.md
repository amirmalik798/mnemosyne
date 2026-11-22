# Mnemosyne Security Guide

This document describes the application's security controls and the deployment work that is still required. It is not a claim that the application is unbreakable or that data leakage is impossible.

## Security controls in the application

- Topic fields, note fields, tags, image bytes and original image names are encrypted at rest with AES-256-GCM using a random vault key.
- The vault key is wrapped using a key derived from the master password with Argon2id.
- Session tokens are random 256-bit values. Only their SHA-256 hashes are stored in PostgreSQL; the active vault key is encrypted in the session record.
- Production uses an HttpOnly, Secure, SameSite=Strict, host-only `__Host-` session cookie.
- Sessions have a 12-hour absolute lifetime and a server-enforced 20-minute idle timeout. The session heartbeat does not extend the idle timeout.
- Unlock attempts are serialized across app instances using a PostgreSQL advisory lock. Five consecutive incorrect attempts trigger a 10-minute vault lockout.
- Production vault initialization requires a one-time setup secret.
- JSON and multipart upload bodies have server-side byte limits. Image signatures are checked before encrypted storage.
- Encrypted asset files are written with restrictive file permissions; on POSIX systems the storage directory is set to mode `0700` and files to `0600`.
- Nonce-based Content Security Policy, HSTS in production, clickjacking protection, cross-origin restrictions, and no-store response headers are configured.
- API exceptions are logged without emitting raw error messages or stack details into normal application logs.

## Required production setup

### 1. Generate separate secrets

Generate two independent values on a trusted machine:

```bash
openssl rand -hex 32
openssl rand -hex 32
```

Set the first 64-character hexadecimal value as `SESSION_ENCRYPTION_SECRET`.

Set the second value as `VAULT_SETUP_TOKEN`. It must be at least 32 characters. Keep it in the server's secret manager or protected environment configuration; do not commit it, expose it in a `NEXT_PUBLIC_*` variable, or paste it into an issue.

The setup token is required only while the vault is uninitialized. The first production setup request must include it in the setup form. A production instance without a valid setup token intentionally refuses first-time initialization.

Keep `SESSION_ENCRYPTION_SECRET` stable. Changing it invalidates active sessions and prevents old session records from being decrypted. It does not re-encrypt vault data.

### 2. Protect the deployment

- Serve the production app only over HTTPS. Do not expose `next dev` or a development server to the public internet.
- Use a supported production Node.js runtime with a persistent, private storage volume for `STORAGE_DIR`.
- Restrict direct network access to PostgreSQL. Use TLS for remote database connections and set `PGSSLMODE=require` when the database provider supports certificate verification.
- Give the app's database role only the permissions needed for this database. Do not use a shared PostgreSQL superuser account in production.
- Keep the storage directory outside the public web root. Do not configure a static file server to expose it.
- Restrict access to the application host, PostgreSQL, storage volume, environment secrets, backup system and operational logs.
- Keep Node.js, Next.js, PostgreSQL, the operating system and reverse proxy updated. Put request-rate and connection limits at the reverse proxy/WAF as well as in the application.

### 3. Back up the complete vault

Back up these three items together and protect the backups separately:

1. PostgreSQL database.
2. The complete encrypted `STORAGE_DIR`.
3. `SESSION_ENCRYPTION_SECRET`.

A database-only backup is incomplete because image bytes are held in the encrypted storage directory. The session secret is required to decrypt persisted session keys; users can create a new session by unlocking after restoring the database and storage with the same secret.

Test restores periodically in an isolated environment. Encrypt backups, restrict who can restore them, and do not store the only copy beside the production server.

## Important security limitations

Mnemosyne currently uses **server-side encryption at rest**, not zero-knowledge end-to-end encryption. The server decrypts content while a valid vault session is active so it can render notes, search content and serve image attachments. An attacker who fully compromises the running application host, its process memory or its secrets may be able to read the vault.

The controls in this repository cannot protect data from:
- Malware, browser extensions or a compromised operating system on the device while the vault is unlocked.
- A malicious or compromised production host, Node.js process, PostgreSQL administrator or storage administrator.
- A compromised deployment pipeline, secret manager, DNS provider, TLS endpoint or reverse proxy.
- Someone who obtains the master password and can access the deployed vault.
- Screenshots, clipboard copies, downloaded exports, or files saved outside the encrypted storage directory.
- Traffic floods or distributed denial-of-service attacks. Production still needs network-level rate limiting, monitoring and capacity controls.

The application does not currently provide multi-factor authentication, a hardware security key, independent recovery keys, client-side end-to-end encryption, multi-user access controls, or automated off-site backups. Do not describe the vault as zero-knowledge or promise zero data leakage.

## Before storing irreplaceable data

- Configure both production secrets before first-time setup.
- Confirm HTTPS, HSTS, the Content Security Policy and secure session cookie in browser developer tools.
- Run `npm run db:migrate` after updating the application so the server-side session activity column exists.
- Run `npm run typecheck` and `npm run build`.
- Verify unlock throttling, server idle timeout, image upload limits, logout, password changes, browser refresh and restored backups.
- Perform a security review and penetration test against the actual production environment. Source-level changes alone do not validate the host, network, database, proxy or deployment configuration.
