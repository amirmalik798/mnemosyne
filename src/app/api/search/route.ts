import { NextResponse } from "next/server";
import { apiError } from "@/lib/http";
import { requireVaultSession } from "@/lib/auth";
import { db, queryAsUser, setUserContext } from "@/lib/db";
import { decryptText } from "@/lib/crypto";

function searchableText(value: unknown): string {
  const fragments: string[] = [];
  const pending: unknown[] = [value];

  // An iterative walk avoids creating a new intermediate string array at
  // every ProseMirror node while preserving the previous recursive traversal.
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "string") {
      fragments.push(current);
    } else if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index -= 1) {
        pending.push(current[index]);
      }
    } else if (current && typeof current === "object") {
      const values = Object.values(current as Record<string, unknown>);
      for (let index = values.length - 1; index >= 0; index -= 1) {
        pending.push(values[index]);
      }
    }
  }

  return fragments.join(" ");
}


type SearchNote = {
  id: string;
  topicId: string;
  title: string;
  subject: string;
  topicTitle: string;
  tags: string[];
  pinned: boolean;
  preview: string;
  matchType: "title" | "tag" | "content";
  updatedAt: unknown;
};
/** Search every topic without loading or decrypting the entire collection at once. */
async function searchTopicsInBatches(
  userId: string,
  key: Buffer,
  needle: string,
  scope: "all" | "titles",
  signal: AbortSignal,
): Promise<Array<{
  id: string;
  title: string;
  subject: string;
  description: string;
  category: string;
  coverUrl: string | null;
  updatedAt: unknown;
}> | null> {
  const client = await db.connect();
  let transactionOpen = false;
  const topics: Array<{
    id: string;
    title: string;
    subject: string;
    description: string;
    category: string;
    coverUrl: string | null;
    updatedAt: unknown;
  }> = [];

  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await setUserContext(client, userId);
    await client.query(
      `DECLARE topics_search_cursor NO SCROLL CURSOR FOR
       SELECT id, title_enc, subject_enc, description_enc, category_enc, cover_asset_id, updated_at
       FROM topics
       ORDER BY updated_at DESC, id DESC`,
    );

    let scanned = 0;
    while (topics.length < 25) {
      if (signal.aborted) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return null;
      }
      const batch = await client.query("FETCH FORWARD 25 FROM topics_search_cursor");
      if (batch.rows.length === 0) break;
      scanned += batch.rows.length;

      for (const row of batch.rows) {
        const title = decryptText(row.title_enc, key);
        const subject = decryptText(row.subject_enc, key);
        const description = decryptText(row.description_enc, key);
        const category = decryptText(row.category_enc, key);
        const matches = scope === "titles"
          ? title.toLocaleLowerCase().includes(needle)
          : [title, subject, description, category].join(" ").toLocaleLowerCase().includes(needle);
        if (!matches) continue;
        topics.push({
          id: row.id,
          title,
          subject,
          description,
          category,
          coverUrl: row.cover_asset_id ? `/api/assets/${row.cover_asset_id}` : null,
          updatedAt: row.updated_at,
        });
        if (topics.length === 25) break;
      }

      if (scanned % 100 === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (signal.aborted) {
          await client.query("ROLLBACK");
          transactionOpen = false;
          return null;
        }
      }
    }

    await client.query("CLOSE topics_search_cursor");
    await client.query("COMMIT");
    transactionOpen = false;
    return topics;
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}


/**
 * Search the complete live-note archive through a server-side cursor. Only
 * one small batch of encrypted documents is materialized at a time; the
 * result cap limits response size, not how far back the search can look.
 */
async function searchNotesInBatches(
  userId: string,
  key: Buffer,
  needle: string,
  scope: "all" | "titles" | "tags" | "pinned",
  signal: AbortSignal,
): Promise<SearchNote[] | null> {
  const client = await db.connect();
  let transactionOpen = false;
  const notes: SearchNote[] = [];
  const contentExpression = scope === "all" || scope === "pinned"
    ? "n.content_enc"
    : "NULL::bytea";
  let scanned = 0;

  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await setUserContext(client, userId);
    await client.query(
      `DECLARE notes_search_cursor NO SCROLL CURSOR FOR
       SELECT n.id, n.topic_id, n.title_enc, n.subject_enc, ${contentExpression} AS content_enc,
              n.tags_enc, n.pinned, n.updated_at, t.title_enc AS topic_title_enc
       FROM notes n
       JOIN topics t ON t.id = n.topic_id
       WHERE n.deleted_at IS NULL
         AND ($1::text <> 'pinned' OR n.pinned = TRUE)
       ORDER BY n.updated_at DESC, n.id DESC`,
      [scope],
    );

    while (notes.length < 40) {
      if (signal.aborted) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return null;
      }

      const batch = await client.query("FETCH FORWARD 25 FROM notes_search_cursor");
      if (batch.rows.length === 0) break;
      scanned += batch.rows.length;

      for (const row of batch.rows) {
        const title = decryptText(row.title_enc, key);
        const subject = decryptText(row.subject_enc, key);
        const topicTitle = decryptText(row.topic_title_enc, key);
        const tags = JSON.parse(decryptText(row.tags_enc, key)) as string[];
        const contentText = contentExpression === "NULL::bytea"
          ? ""
          : searchableText(JSON.parse(decryptText(row.content_enc, key)));

        const searchable = [title, subject, contentText, tags.join(" "), topicTitle]
          .join(" ")
          .toLocaleLowerCase();
        const titleMatch = [title, topicTitle].join(" ").toLocaleLowerCase().includes(needle);
        const tagMatch = tags.join(" ").toLocaleLowerCase().includes(needle);
        const matches = scope === "titles"
          ? titleMatch
          : scope === "tags"
            ? tagMatch
            : searchable.includes(needle);
        if (!matches) continue;

        const matchIndex = contentText.toLocaleLowerCase().indexOf(needle);
        const previewStart = matchIndex > 72 ? matchIndex - 72 : 0;
        const previewEnd = Math.min(contentText.length, previewStart + 220);
        const contextualPreview = (previewStart > 0 ? "…" : "") +
          contentText.slice(previewStart, previewEnd) +
          (previewEnd < contentText.length ? "…" : "");
        notes.push({
          id: row.id,
          topicId: row.topic_id,
          title,
          subject,
          topicTitle,
          tags,
          pinned: Boolean(row.pinned),
          preview: scope === "titles"
            ? subject
            : scope === "tags"
              ? tags.join(" · ")
              : matchIndex >= 0
                ? contextualPreview
                : contentText.slice(0, 220),
          matchType: scope === "tags" ? "tag" : titleMatch ? "title" : tagMatch ? "tag" : "content",
          updatedAt: row.updated_at,
        });
        if (notes.length === 40) break;
      }

      if (scanned % 100 === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        if (signal.aborted) {
          await client.query("ROLLBACK");
          transactionOpen = false;
          return null;
        }
      }
    }

    await client.query("CLOSE notes_search_cursor");
    await client.query("COMMIT");
    transactionOpen = false;
    return notes;
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = await requireVaultSession();
    const params = new URL(request.url).searchParams;
    const query = params.get("q")?.trim().slice(0, 120) ?? "";
    const scopeValue = params.get("scope");
    const scope = scopeValue === "titles" || scopeValue === "tags" || scopeValue === "pinned" ? scopeValue : "all";
    if (!query) return NextResponse.json({ topics: [], notes: [] });
    const needle = query.toLocaleLowerCase();

    const [topics, notes] = await Promise.all([
      scope === "all" || scope === "titles"
        ? searchTopicsInBatches(session.userId, session.key, needle, scope, request.signal)
        : Promise.resolve([]),
      searchNotesInBatches(session.userId, session.key, needle, scope, request.signal),
    ]);
    if (topics === null || notes === null) return new Response(null, { status: 204 });

    return NextResponse.json({ topics, notes });
  } catch (error) {
    return apiError(error);
  }
}
