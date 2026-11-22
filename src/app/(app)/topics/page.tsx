import { requireVaultSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptText } from "@/lib/crypto";
import { type TopicItem, ArchiveIntegrityNotice } from "@/components/archive-ui";
import { TopicArchive } from "@/components/topic-archive";
import { ARCHIVE_PAGE_SIZE, ArchivePagination, parseArchivePage } from "@/components/archive-pagination";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{
    page?: string | string[];
    category?: string | string[];
  }>;
};

type TopicCategory = { id: string; category: string; available: boolean };

function decryptTopicValue(value: unknown, key: Buffer, id: string, field: string): string | null {
  try {
    if (!Buffer.isBuffer(value)) throw new Error("Encrypted field is not a byte buffer.");
    return decryptText(value, key);
  } catch (error) {
    console.error("[Mnemosyne] Topic archive encrypted field failed authentication.", {
      recordType: "topic",
      recordId: id,
      field,
      reason: error instanceof Error ? error.message : "Unknown decryption error",
    });
    return null;
  }
}

export default async function TopicsPage({ searchParams }: Props) {
  const [{ page: requestedPage, category: requestedCategoryValue }, session] = await Promise.all([
    searchParams,
    requireVaultSession(),
  ]);
  const requestedPageNumber = parseArchivePage(requestedPage);
  const requestedCategory = Array.isArray(requestedCategoryValue)
    ? requestedCategoryValue[0] ?? ""
    : requestedCategoryValue ?? "";

  // Ciphertext is randomized, so category matching must happen after
  // authenticated server-side decryption. Only the small category and id
  // columns are read for this filter; full topic records are fetched only
  // for the requested page.
  const categoryResult = await db.query("SELECT id, category_enc FROM topics");
  const categoryLabels = new Map<string, string>();
  const categoryCounts = new Map<string, number>();
  const topicCategories: TopicCategory[] = [];

  for (const row of categoryResult.rows) {
    const id = String(row.id);
    const category = decryptTopicValue(row.category_enc, session.key, id, "category_enc");
    topicCategories.push({ id, category: category ?? "", available: category !== null });
    if (category === null || !category.trim()) continue;
    const key = category.toLocaleLowerCase();
    if (!categoryLabels.has(key)) categoryLabels.set(key, category);
    categoryCounts.set(key, (categoryCounts.get(key) ?? 0) + 1);
  }

  const categories = Array.from(categoryLabels.values()).sort((a, b) => a.localeCompare(b));
  const uncategorizedCount = topicCategories.filter((topic) => topic.available && !topic.category.trim()).length;
  const allTopicsCount = categoryResult.rows.length;
  const normalizedRequested = requestedCategory.toLocaleLowerCase();
  const selectedCategory = requestedCategory === "__uncategorized__"
    ? "__uncategorized__"
    : categoryLabels.get(normalizedRequested) ?? "";

  const matchingTopicIds = selectedCategory === "__uncategorized__"
    ? topicCategories.filter((topic) => topic.available && !topic.category.trim()).map((topic) => topic.id)
    : selectedCategory
      ? topicCategories
          .filter((topic) => topic.available && topic.category.toLocaleLowerCase() === selectedCategory.toLocaleLowerCase())
          .map((topic) => topic.id)
      : [];

  const totalTopics = selectedCategory
    ? matchingTopicIds.length
    : allTopicsCount;
  const totalPages = Math.max(1, Math.ceil(totalTopics / ARCHIVE_PAGE_SIZE));
  const currentPage = Math.min(requestedPageNumber, totalPages);

  const pageResult = selectedCategory
    ? matchingTopicIds.length
      ? await db.query(
          `SELECT t.id, t.title_enc, t.subject_enc, t.description_enc, t.category_enc,
                  t.cover_asset_id, t.updated_at,
                  (SELECT COUNT(*)::int FROM notes n
                   WHERE n.topic_id = t.id AND n.deleted_at IS NULL) AS note_count
           FROM topics t
           WHERE t.id = ANY($1::uuid[])
           ORDER BY t.updated_at DESC, t.id DESC
           LIMIT $2 OFFSET $3`,
          [matchingTopicIds, ARCHIVE_PAGE_SIZE, (currentPage - 1) * ARCHIVE_PAGE_SIZE],
        )
      : { rows: [] }
    : await db.query(
        `SELECT t.id, t.title_enc, t.subject_enc, t.description_enc, t.category_enc,
                t.cover_asset_id, t.updated_at,
                (SELECT COUNT(*)::int FROM notes n
                 WHERE n.topic_id = t.id AND n.deleted_at IS NULL) AS note_count
         FROM topics t
         ORDER BY t.updated_at DESC, t.id DESC
         LIMIT $1 OFFSET $2`,
        [ARCHIVE_PAGE_SIZE, (currentPage - 1) * ARCHIVE_PAGE_SIZE],
      );

  const topics: TopicItem[] = [];
  const unavailableTopicIds = new Set<string>();
  for (const row of pageResult.rows) {
    const id = String(row.id);
    const title = decryptTopicValue(row.title_enc, session.key, id, "title_enc");
    const subject = decryptTopicValue(row.subject_enc, session.key, id, "subject_enc");
    const description = decryptTopicValue(row.description_enc, session.key, id, "description_enc");
    const category = decryptTopicValue(row.category_enc, session.key, id, "category_enc");

    if (title === null || subject === null || description === null || category === null) {
      unavailableTopicIds.add(id);
      continue;
    }

    topics.push({
      id,
      title,
      subject,
      description,
      category,
      coverUrl: row.cover_asset_id ? `/api/assets/${row.cover_asset_id}` : null,
      noteCount: row.note_count,
      updatedAt: row.updated_at,
    });
  }

  const unavailableCount = new Set([
    ...topicCategories.filter((topic) => !topic.available).map((topic) => topic.id),
    ...unavailableTopicIds,
  ]).size;

  return (
    <main className="page">
      <ArchiveIntegrityNotice count={unavailableCount} itemLabel="topic" />
      <div className="page-heading">
        <div>
          <div className="eyebrow">The archive</div>
          <h1 className="page-title">Your topics</h1>
          <p className="page-subtitle">Organize your thinking into collections that make sense to you.</p>
        </div>
        <div className="stats">
          <div className="stat"><strong>{allTopicsCount}</strong><span>Collections</span></div>
          <div className="stat"><strong>{categories.length}</strong><span>Categories</span></div>
        </div>
      </div>
      <TopicArchive
        topics={topics}
        categories={categories}
        categoryCounts={Object.fromEntries(categoryCounts)}
        uncategorizedCount={uncategorizedCount}
        totalTopics={totalTopics}
        allTopicsCount={allTopicsCount}
        selectedCategory={selectedCategory}
      />
      <ArchivePagination
        currentPage={currentPage}
        totalItems={totalTopics}
        basePath="/topics"
        query={selectedCategory ? `category=${encodeURIComponent(selectedCategory)}` : undefined}
      />
    </main>
  );
}
