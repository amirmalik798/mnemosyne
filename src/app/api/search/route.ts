import { NextResponse } from "next/server";
import { requireVaultSession } from "@/lib/auth";
import { db } from "@/lib/db";
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

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await requireVaultSession();
    const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 120) ?? "";
    if (!query) return NextResponse.json({ topics: [], notes: [] });
    const needle = query.toLocaleLowerCase();

    const [topicRows, noteRows] = await Promise.all([
      db.query(
        `SELECT id, title_enc, subject_enc, description_enc, category_enc, cover_asset_id, updated_at
         FROM topics
         ORDER BY updated_at DESC, id DESC
         LIMIT 500`,
      ),
      db.query(
        `SELECT n.id, n.topic_id, n.title_enc, n.subject_enc, n.content_enc, n.tags_enc, n.updated_at,
                t.title_enc AS topic_title_enc
         FROM notes n
         JOIN topics t ON t.id = n.topic_id
         WHERE n.deleted_at IS NULL
         ORDER BY n.updated_at DESC, n.id DESC
         LIMIT 2000`,
      ),
    ]);

    const topics = topicRows.rows.map((row) => ({
      id: row.id,
      title: decryptText(row.title_enc, session.key),
      subject: decryptText(row.subject_enc, session.key),
      description: decryptText(row.description_enc, session.key),
      category: decryptText(row.category_enc, session.key),
      coverUrl: row.cover_asset_id ? `/api/assets/${row.cover_asset_id}` : null,
      updatedAt: row.updated_at,
    })).filter((item) =>
      [item.title, item.subject, item.description, item.category].join(" ").toLocaleLowerCase().includes(needle),
    ).slice(0, 25);

    const notes = noteRows.rows.map((row) => {
      const title = decryptText(row.title_enc, session.key);
      const subject = decryptText(row.subject_enc, session.key);
      const content = JSON.parse(decryptText(row.content_enc, session.key));
      const contentText = searchableText(content);
      const tags = JSON.parse(decryptText(row.tags_enc, session.key)) as string[];
      const topicTitle = decryptText(row.topic_title_enc, session.key);
      const searchable = [title, subject, contentText, tags.join(" "), topicTitle]
        .join(" ")
        .toLocaleLowerCase();

      return {
        id: row.id,
        topicId: row.topic_id,
        title,
        subject,
        topicTitle,
        tags,
        preview: contentText.slice(0, 220),
        updatedAt: row.updated_at,
        matches: searchable.includes(needle),
      };
    }).filter((item) => item.matches).slice(0, 40)
      .map(({ matches: _matches, ...item }) => item);

    return NextResponse.json({ topics, notes });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Please unlock your vault." }, { status: 401 });
    console.error("Search API failure.", { name: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "Search is unavailable right now." }, { status: 500 });
  }
}
