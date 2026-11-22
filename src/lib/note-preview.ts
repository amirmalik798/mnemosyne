type PreviewNode = {
  type?: unknown;
  text?: unknown;
  content?: unknown;
};

function collectText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(collectText).filter(Boolean).join(" ");
  }
  if (!value || typeof value !== "object") return "";
  const node = value as PreviewNode;
  if (node.type === "text") return typeof node.text === "string" ? node.text : "";
  if (node.type === "hardBreak") return " ";
  if (!Array.isArray(node.content)) return "";
  const children = node.content.map(collectText).filter(Boolean);
  const blockTypes = new Set(["doc", "paragraph", "heading", "blockquote", "listItem", "bulletList", "orderedList"]);
  return children.join(blockTypes.has(String(node.type)) ? " " : "");
}

/** Extract a plain, compact dashboard excerpt from a saved editor document. */
export function extractNotePreview(content: unknown, maxLength = 160): string {
  const safeLength = Number.isSafeInteger(maxLength) && maxLength >= 8 ? maxLength : 160;
  const normalized = collectText(content).replace(/\s+/gu, " ").trim();
  if (!normalized) return "";
  const characters = Array.from(normalized);
  if (characters.length <= safeLength) return normalized;
  return characters.slice(0, safeLength - 1).join("").trimEnd() + "…";
}
