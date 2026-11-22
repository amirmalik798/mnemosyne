import { requireVaultSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { type TopicItem, EmptyState } from "@/components/archive-ui";
import { TopicArchive } from "@/components/topic-archive";
import { ARCHIVE_PAGE_SIZE, ArchivePagination, parseArchivePage } from "@/components/archive-pagination";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ page?: string | string[] }> };

export default async function TopicsPage({ searchParams }: Props) {
  const [{ page: requestedPage }, session] = await Promise.all([
    searchParams,
    requireVaultSession(),
  ]);
  const requestedPageNumber = parseArchivePage(requestedPage);

  const [countResult, categoryResult] = await Promise.all([
    db.query("SELECT COUNT(*)::int AS total FROM topics"),
    db.query("SELECT category_enc FROM topics"),
  ]);

  const totalTopics = Number(countResult.rows[0]?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalTopics / ARCHIVE_PAGE_SIZE));
  const currentPage = Math.min(requestedPageNumber, totalPages);
  const pageResult = await db.query(
    `SELECT t.id, t.title_enc, t.subject_enc, t.description_enc, t.category_enc,
            t.cover_asset_id, t.updated_at,
            (SELECT COUNT(*)::int FROM notes n
             WHERE n.topic_id = t.id AND n.deleted_at IS NULL) AS note_count
     FROM topics t
     ORDER BY t.updated_at DESC, t.id DESC
     LIMIT $1 OFFSET $2`,
    [ARCHIVE_PAGE_SIZE, (currentPage - 1) * ARCHIVE_PAGE_SIZE],
  );

  const topics: TopicItem[] = pageResult.rows.map((row) => ({
    id: row.id,
    title: decryptText(row.title_enc, session.key),
    subject: decryptText(row.subject_enc, session.key),
    description: decryptText(row.description_enc, session.key),
    category: decryptText(row.category_enc, session.key),
    coverUrl: row.cover_asset_id ? `/api/assets/${row.cover_asset_id}` : null,
    noteCount: row.note_count,
    updatedAt: row.updated_at,
  }));
  const categories = Array.from(
    new Map(
      categoryResult.rows
        .map((row) => decryptText(row.category_enc, session.key).trim())
        .filter(Boolean)
        .map((category) => [category.toLocaleLowerCase(), category] as const),
    ).values(),
  ).sort((a, b) => a.localeCompare(b));

  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">The archive</div>
          <h1 className="page-title">Your topics</h1>
          <p className="page-subtitle">Organize your thinking into collections that make sense to you.</p>
        </div>
        <div className="stats">
          <div className="stat"><strong>{totalTopics}</strong><span>Collections</span></div>
          <div className="stat"><strong>{categories.length}</strong><span>Categories</span></div>
        </div>
      </div>
      {topics.length ? (
        <>
          <TopicArchive topics={topics} categories={categories} totalTopics={totalTopics} />
          <ArchivePagination currentPage={currentPage} totalItems={totalTopics} basePath="/topics" />
        </>
      ) : (
        <EmptyState title="No topics created" copy="Create a collection for a subject, project, book or idea you want to develop." />
      )}
    </main>
  );
}
