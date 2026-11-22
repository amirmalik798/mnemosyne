import { requireVaultSession } from "@/lib/auth";
import { NoteEditor } from "@/components/note-editor";
export const dynamic = "force-dynamic";

export default async function NewNotePage({
  searchParams,
}: {
  searchParams: Promise<{ topicId?: string }>;
}) {
  const [{ topicId }] = await Promise.all([searchParams, requireVaultSession()]);
  // The editor loads destination options on demand. Keep only the requested
  // starting topic in the initial payload instead of decrypting every topic.
  return <NoteEditor topics={[]} initialNote={undefined} defaultTopicId={topicId} />;
}
