/** Determine the editor's initial direction from the first text block in a note. */
export function getNoteTextDirection(content: unknown): "ltr" | "rtl" {
  const pending: unknown[] = [content];
  while (pending.length > 0) {
    const value = pending.pop();
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) pending.push(value[index]);
      continue;
    }
    const record = value as Record<string, unknown>;
    if (record.type === "paragraph" || record.type === "heading") {
      const attrs = record.attrs && typeof record.attrs === "object"
        ? record.attrs as Record<string, unknown>
        : {};
      return attrs.dir === "rtl" ? "rtl" : "ltr";
    }
    if (Array.isArray(record.content)) {
      for (let index = record.content.length - 1; index >= 0; index -= 1) pending.push(record.content[index]);
    }
  }
  return "ltr";
}
