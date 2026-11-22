import { NextResponse } from "next/server";
import { requireVaultSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptText } from "@/lib/crypto";

function searchableText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(searchableText).join(" ");
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).map(searchableText).join(" ");
  return "";
}

export async function GET(request: Request) {
  try {
    const session = await requireVaultSession();
    const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 120) ?? "";
    if (!query) return NextResponse.json({ topics: [], notes: [] });
    const needle = query.toLocaleLowerCase();
    const [topicRows, noteRows] = await Promise.all([
      db.query("SELECT * FROM topics ORDER BY updated_at DESC LIMIT 500"),
      db.query("SELECT n.*, t.title_enc AS topic_title_enc FROM notes n JOIN topics t ON t.id=n.topic_id WHERE n.deleted_at IS NULL ORDER BY n.updated_at DESC LIMIT 2000"),
    ]);
    const topics = topicRows.rows.map((row) => ({
      id: row.id,
      title: decryptText(row.title_enc, session.key),
      subject: decryptText(row.subject_enc, session.key),
      description: decryptText(row.description_enc, session.key),
      category: decryptText(row.category_enc, session.key),
      coverUrl: row.cover_asset_id ? `/api/assets/${row.cover_asset_id}` : null,
      updatedAt: row.updated_at,
    })).filter((item) => [item.title, item.subject, item.description, item.category].join(" ").toLocaleLowerCase().includes(needle)).slice(0, 25);
    const notes = noteRows.rows.map((row) => {
      const title = decryptText(row.title_enc, session.key);
      const subject = decryptText(row.subject_enc, session.key);
      const content = JSON.parse(decryptText(row.content_enc, session.key));
      const tags = JSON.parse(decryptText(row.tags_enc, session.key)) as string[];
      const topicTitle = decryptText(row.topic_title_enc, session.key);
      const all = [title, subject, searchableText(content), tags.join(" "), topicTitle].join(" ");
      return { id: row.id, topicId: row.topic_id, title, subject, topicTitle, tags, preview: searchableText(content).slice(0, 220), updatedAt: row.updated_at, matches: all.toLocaleLowerCase().includes(needle) };
    }).filter((item) => item.matches).slice(0, 40).map(({ matches: _matches, ...item }) => item);
    return NextResponse.json({ topics, notes });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    if (message === "UNAUTHORIZED") return NextResponse.json({ error: "Please unlock your vault." }, { status: 401 });
    console.error(error);
    return NextResponse.json({ error: "Search is unavailable right now." }, { status: 500 });
  }
}
