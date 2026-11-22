import Link from "next/link";
import { ArrowUpRight, BookOpen, FilePlus, FileText, FolderOpen, ImagePlus, Pin } from "lucide-react";
import { requireVaultSession } from "@/lib/auth";
import { queryAsUser } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { EmptyState, NoteRow, TopicCard, type TopicItem, type NoteItem } from "@/components/archive-ui";
import { OpenTopicDialogButton } from "@/components/open-topic-dialog-button";
import { extractNotePreview } from "@/lib/note-preview";
import { formatArchiveDate } from "@/lib/date-format";

export const dynamic = "force-dynamic";

type LibraryRecordType = "topic" | "note";

type LibraryDecryptionIssue = {
  type: LibraryRecordType;
  id: string;
};

type RecentImageItem = {
  id: string;
  noteId: string;
  noteTitle: string;
  topicTitle: string;
  createdAt: string | Date;
};

function decryptLibraryField(
  value: unknown,
  key: Buffer,
  context: { type: LibraryRecordType; id: string; field: string },
): string {
  try {
    if (!Buffer.isBuffer(value)) {
      throw new Error("Encrypted database field is not a byte buffer.");
    }
    return decryptText(value, key);
  } catch (error) {
    // Log identifiers and the field name only. Never log ciphertext, plaintext,
    // session keys, or other sensitive vault material.
    console.error("[Mnemosyne] Library encrypted field failed authentication.", {
      recordType: context.type,
      recordId: context.id,
      field: context.field,
      reason: error instanceof Error ? error.message : "Unknown decryption error",
    });
    throw error;
  }
}

export default async function LibraryPage() {
  const session = await requireVaultSession();
  const [topicsResult, recentNotesResult, pinnedNotesResult, recentImagesResult, totalResult] = await Promise.all([
    queryAsUser(session.userId, `SELECT t.id, t.title_enc, t.subject_enc, t.description_enc, t.category_enc, t.cover_asset_id, t.updated_at, (SELECT COUNT(*)::int FROM notes n WHERE n.topic_id=t.id AND n.deleted_at IS NULL) AS note_count FROM topics t ORDER BY t.updated_at DESC, t.id DESC LIMIT 6`),
    queryAsUser(session.userId, `SELECT n.id, n.topic_id, n.title_enc, n.subject_enc, n.content_enc, n.pinned, n.updated_at, t.title_enc AS topic_title_enc FROM notes n JOIN topics t ON t.id=n.topic_id WHERE n.deleted_at IS NULL ORDER BY n.updated_at DESC,n.id DESC LIMIT 10`),
    queryAsUser(session.userId, `SELECT n.id, n.topic_id, n.title_enc, n.subject_enc, n.content_enc, n.pinned, n.updated_at, t.title_enc AS topic_title_enc FROM notes n JOIN topics t ON t.id=n.topic_id WHERE n.deleted_at IS NULL AND n.pinned=true ORDER BY n.updated_at DESC,n.id DESC LIMIT 4`),
    queryAsUser(session.userId, `SELECT a.id, a.owner_id AS note_id, a.created_at, n.title_enc, t.title_enc AS topic_title_enc FROM assets a JOIN notes n ON n.id=a.owner_id AND n.user_id=a.user_id JOIN topics t ON t.id=n.topic_id AND t.user_id=n.user_id WHERE a.owner_type='note' AND a.mime_type LIKE 'image/%' AND n.deleted_at IS NULL ORDER BY a.created_at DESC,a.id DESC LIMIT 5`),
    queryAsUser(session.userId, `SELECT (SELECT COUNT(*)::int FROM topics) AS topics, (SELECT COUNT(*)::int FROM notes WHERE deleted_at IS NULL) AS notes, (SELECT COUNT(*)::int FROM assets) AS assets`),
  ]);

  const decryptionIssues: LibraryDecryptionIssue[] = [];
  const decryptionIssueKeys = new Set<string>();
  const recordDecryptionIssue = (type: LibraryRecordType, id: string) => {
    const key = type + ":" + id;
    if (decryptionIssueKeys.has(key)) return;
    decryptionIssueKeys.add(key);
    decryptionIssues.push({ type, id });
  };

  const topics: TopicItem[] = [];
  for (const row of topicsResult.rows) {
    try {
      const id = String(row.id);
      topics.push({
        id,
        title: decryptLibraryField(row.title_enc, session.key, { type: "topic", id, field: "title_enc" }),
        subject: decryptLibraryField(row.subject_enc, session.key, { type: "topic", id, field: "subject_enc" }),
        description: decryptLibraryField(row.description_enc, session.key, { type: "topic", id, field: "description_enc" }),
        category: decryptLibraryField(row.category_enc, session.key, { type: "topic", id, field: "category_enc" }),
        coverUrl: row.cover_asset_id ? `/api/assets/${row.cover_asset_id}` : null,
        noteCount: row.note_count,
        updatedAt: row.updated_at,
      });
    } catch {
      recordDecryptionIssue("topic", String(row.id));
    }
  }

  const decryptNotes = (rows: typeof recentNotesResult.rows): NoteItem[] => {
    const decrypted: NoteItem[] = [];
    for (const row of rows) {
      try {
        const id = String(row.id);
        const contentValue = JSON.parse(
          decryptLibraryField(row.content_enc, session.key, { type: "note", id, field: "content_enc" }),
        ) as unknown;
        decrypted.push({
          id,
          topicId: row.topic_id,
          topicTitle: decryptLibraryField(row.topic_title_enc, session.key, { type: "note", id, field: "topic_title_enc" }),
          title: decryptLibraryField(row.title_enc, session.key, { type: "note", id, field: "title_enc" }),
          subject: decryptLibraryField(row.subject_enc, session.key, { type: "note", id, field: "subject_enc" }),
          preview: extractNotePreview(contentValue),
          pinned: row.pinned,
          updatedAt: row.updated_at,
        });
      } catch {
        recordDecryptionIssue("note", String(row.id));
      }
    }
    return decrypted;
  };

  const recentNotes = decryptNotes(recentNotesResult.rows);
  const pinnedNotes = decryptNotes(pinnedNotesResult.rows);
  const recentImages: RecentImageItem[] = [];
  for (const row of recentImagesResult.rows) {
    try {
      const noteId = String(row.note_id);
      recentImages.push({
        id: String(row.id),
        noteId,
        noteTitle: decryptLibraryField(row.title_enc, session.key, { type: "note", id: noteId, field: "title_enc" }),
        topicTitle: decryptLibraryField(row.topic_title_enc, session.key, { type: "note", id: noteId, field: "topic_title_enc" }),
        createdAt: row.created_at,
      });
    } catch {
      recordDecryptionIssue("note", String(row.note_id));
    }
  }

  const stats = totalResult.rows[0] ?? { topics: 0, notes: 0, assets: 0 };
  const featuredNote = recentNotes[0] ?? null;
  const pinnedForReference = pinnedNotes
    .filter((note) => note.id !== featuredNote?.id)
    .slice(0, 3);
  const recentlyTouched = recentNotes
    .filter((note) => note.id !== featuredNote?.id && !note.pinned)
    .slice(0, 4);
  const topicDecryptionFailed = decryptionIssues.some((issue) => issue.type === "topic");
  const noteDecryptionFailed = decryptionIssues.some((issue) => issue.type === "note");

  return (
    <main className="page overview-page">
      <section className="overview-hero" aria-labelledby="overview-title">
        <div className="overview-hero-copy">
          <div className="eyebrow">A personal athenaeum</div>
          <h1 className="page-title" id="overview-title">Your knowledge, <em>well kept.</em></h1>
          <p className="page-subtitle">A considered space for your research, reflections and the ideas worth returning to.</p>
          <div className="overview-hero-actions">
            <Link href="/notes/new" className="primary-btn overview-quick-action">
              <FilePlus size={16} aria-hidden="true" /><span>Write a note</span>
            </Link>
            <OpenTopicDialogButton className="secondary-btn overview-quick-action" />
          </div>
        </div>
        <div className="overview-stats" role="group" aria-label="Archive totals">
          <div className="overview-stat-card">
            <span className="overview-stat-icon"><FolderOpen size={17} aria-hidden="true" /></span>
            <strong>{stats.topics}</strong><span>Topics</span>
          </div>
          <div className="overview-stat-card">
            <span className="overview-stat-icon"><FileText size={17} aria-hidden="true" /></span>
            <strong>{stats.notes}</strong><span>Notes</span>
          </div>
          <div className="overview-stat-card">
            <span className="overview-stat-icon"><ImagePlus size={17} aria-hidden="true" /></span>
            <strong>{stats.assets}</strong><span>Images</span>
          </div>
        </div>
      </section>

      {decryptionIssues.length > 0 && (
        <section className="panel overview-integrity-notice" role="alert" aria-live="assertive">
          <div className="overview-integrity-title">Some encrypted records could not be authenticated</div>
          <p>
            {decryptionIssues.length} recent {decryptionIssues.length === 1 ? "record was" : "records were"} skipped because the encrypted data could not be verified. No records were changed or deleted.
            Lock the vault and unlock it once to refresh the active session. If this warning returns, leave the affected data untouched and investigate the record identifiers and field names in the server logs. A known-good backup may be needed if the stored ciphertext is damaged.
          </p>
        </section>
      )}

      <section className="overview-section" aria-labelledby="overview-collections-title">
        <div className="overview-section-heading">
          <div>
            <div className="eyebrow">Your archive</div>
            <h2 className="overview-section-title" id="overview-collections-title">Your collections</h2>
            <p className="overview-section-copy">Your subjects and projects, gathered in one place.</p>
          </div>
          <Link className="overview-text-link" href="/topics">View all topics <ArrowUpRight size={15} aria-hidden="true" /></Link>
        </div>

        {topics.length ? (
          <div className="topic-grid overview-topic-grid">
            {topics.map((topic) => <TopicCard key={topic.id} topic={topic} variant="dashboard" />)}
            <OpenTopicDialogButton className="overview-create-topic-card" label="Create a collection" icon="plus" />
          </div>
        ) : topicDecryptionFailed ? (
          <EmptyState title="Some topics are unavailable" copy="Their encrypted data could not be authenticated. The original records remain untouched; investigate the warning above before creating replacement topics." />
        ) : (
          <EmptyState
            title="Your archive begins here"
            copy="Create a collection for a subject you want to explore. Add notes, references and images as your thinking develops."
            action={<OpenTopicDialogButton className="primary-btn overview-quick-action" />}
          />
        )}
      </section>

      <section className="overview-section overview-continue-section" aria-labelledby="overview-continue-title">
        <div className="overview-section-heading">
          <div>
            <div className="eyebrow">Your latest note</div>
            <h2 className="overview-section-title" id="overview-continue-title">Continue thinking</h2>
            <p className="overview-section-copy">Pick up where your latest idea left off.</p>
          </div>
          <Link className="overview-text-link" href="/notes">All notes <ArrowUpRight size={15} aria-hidden="true" /></Link>
        </div>
        {featuredNote ? (
          <Link className="overview-featured-note" href={`/notes/${featuredNote.id}`}>
            <div className="overview-featured-mark" aria-hidden="true"><BookOpen size={29} /></div>
            <div className="overview-featured-body">
              <span className="overview-featured-kicker">MOST RECENTLY MODIFIED</span>
              <h3 dir="auto">{featuredNote.title || "Untitled note"}</h3>
              <p dir="auto">{featuredNote.preview || featuredNote.subject || "Open your latest note and continue developing the idea."}</p>
              <div className="overview-featured-meta">
                <span dir="auto">{featuredNote.topicTitle}</span>
                <span>Edited {formatArchiveDate(featuredNote.updatedAt, true)}</span>
                {featuredNote.pinned && <span className="overview-featured-pinned"><Pin size={12} aria-hidden="true" /> Pinned</span>}
              </div>
            </div>
            <span className="overview-featured-open">Continue writing <ArrowUpRight size={16} aria-hidden="true" /></span>
          </Link>
        ) : noteDecryptionFailed ? (
          <EmptyState title="Your latest note is unavailable" copy="The encrypted note data could not be authenticated. Its original record has not been changed." />
        ) : (
          <div className="overview-quick-capture">
            <div className="overview-quick-capture-icon"><FilePlus size={21} aria-hidden="true" /></div>
            <div>
              <strong>Your next idea starts here.</strong>
              <p>Create a note to capture a thought, reference or question while it is fresh.</p>
            </div>
            <Link href="/notes/new" className="secondary-btn overview-quick-action"><FilePlus size={15} aria-hidden="true" /><span>Write a note</span></Link>
          </div>
        )}
      </section>

      {pinnedForReference.length > 0 && (
        <section className="overview-section" aria-labelledby="overview-pinned-title">
          <div className="overview-section-heading">
            <div>
              <div className="eyebrow">Kept close</div>
              <h2 className="overview-section-title" id="overview-pinned-title">Pinned for reference</h2>
              <p className="overview-section-copy">The notes you have chosen to keep within easy reach.</p>
            </div>
            <Link className="overview-text-link" href="/pinned">All pinned notes <ArrowUpRight size={15} aria-hidden="true" /></Link>
          </div>
          <div className="overview-pinned-grid">
            {pinnedForReference.map((note) => (
              <Link href={`/notes/${note.id}`} className="overview-pinned-card" key={note.id}>
                <span className="overview-pinned-icon"><Pin size={15} aria-hidden="true" /></span>
                <span className="overview-pinned-content">
                  <strong dir="auto">{note.title || "Untitled note"}</strong>
                  <small dir="auto">{note.topicTitle}{note.subject ? " · " + note.subject : ""}</small>
                </span>
                <ArrowUpRight size={15} aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {recentlyTouched.length > 0 && (
        <section className="overview-section" aria-labelledby="overview-recent-title">
          <div className="overview-section-heading">
            <div>
              <div className="eyebrow">Your activity</div>
              <h2 className="overview-section-title" id="overview-recent-title">Recently touched</h2>
              <p className="overview-section-copy">More of the work you have been developing lately.</p>
            </div>
            <Link className="overview-text-link" href="/notes">Browse notes <ArrowUpRight size={15} aria-hidden="true" /></Link>
          </div>
          <section className="panel overview-recent-panel">
            <div className="note-list">
              {recentlyTouched.map((note) => <NoteRow key={note.id} note={note} compactActions />)}
            </div>
          </section>
        </section>
      )}

      {recentImages.length > 0 && (
        <section className="overview-section" aria-labelledby="overview-images-title">
          <div className="overview-section-heading">
            <div>
              <div className="eyebrow">Visual references</div>
              <h2 className="overview-section-title" id="overview-images-title">Recently added images</h2>
              <p className="overview-section-copy">Images saved inside your notes, connected to their original context.</p>
            </div>
          </div>
          <div className="overview-image-grid">
            {recentImages.map((image) => (
              <Link href={`/notes/${image.noteId}`} className="overview-image-card" key={image.id}>
                <img src={`/api/assets/${image.id}`} alt={`Image in ${image.noteTitle}`} loading="lazy" decoding="async" />
                <span className="overview-image-caption">
                  <strong dir="auto">{image.noteTitle || "Untitled note"}</strong>
                  <small dir="auto">{image.topicTitle} · {formatArchiveDate(image.createdAt, true)}</small>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
