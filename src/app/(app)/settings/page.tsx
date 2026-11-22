import { SecuritySettings } from "@/components/security-settings";
import { TypographySettings } from "@/components/theme-provider";

export default function SettingsPage() {
  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Your environment</div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Manage access to your private archive.</p>
        </div>
      </div>

      <div className="settings-grid">
        <nav className="settings-nav" aria-label="Settings sections">
          <span className="settings-nav-heading">On this page</span>
          <a href="#typography">Appearance & typography</a>
          <a href="#security">Security & access</a>
          <a href="#privacy">Privacy model</a>
          <a href="#storage">Storage & backups</a>
        </nav>

        <div className="settings-content">
          <TypographySettings />

          <section id="security" aria-label="Security and access settings">
            <SecuritySettings />
          </section>

          <section id="privacy" className="panel" aria-labelledby="privacy-heading">
            <h2 className="panel-title" id="privacy-heading">Privacy model</h2>
            <p className="page-subtitle">
              Topic names, subjects, note titles, note content, tags and original image filenames
              are encrypted before being written to PostgreSQL. Image files are encrypted before
              they are saved to storage. Search decrypts records on the server for matching and
              does not create a plaintext search index.
            </p>
            <p className="page-subtitle" style={{ marginTop: 12 }}>
              This is server-side encryption at rest, not zero-knowledge end-to-end encryption:
              the application server can decrypt data while you are authenticated. Protect the
              server, database, storage volume and environment secrets accordingly.
            </p>
          </section>

          <section id="storage" className="panel" aria-labelledby="storage-heading">
            <h2 className="panel-title" id="storage-heading">Storage & backups</h2>
            <p className="page-subtitle">
              Local encrypted image files are stored in the configured STORAGE_DIR. Back up the
              PostgreSQL database, encrypted storage directory and SESSION_ENCRYPTION_SECRET
              together. Losing the vault password or vault key material can make the archive
              unrecoverable.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
