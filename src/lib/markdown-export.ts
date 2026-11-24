export type MarkdownNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: MarkdownNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
};

function renderText(node: MarkdownNode): string {
  let value = node.text ?? "";
  for (const mark of node.marks ?? []) {
    if (mark.type === "bold") value = `**${value}**`;
    else if (mark.type === "italic") value = `*${value}*`;
    else if (mark.type === "strike") value = `~~${value}~~`;
    else if (mark.type === "code") value = `\`${value}\``;
    else if (mark.type === "underline") value = `<u>${value}</u>`;
    else if (mark.type === "textHighlight") value = `<mark>${value}</mark>`;
    else if (mark.type === "link") {
      const href = String(mark.attrs?.href ?? "");
      if (/^(https?:\/\/|mailto:|tel:|\/(?!\/)|[?#])/i.test(href)) value = `[${value}](${href.replace(/\)/g, "\\\\)")})`;
    }
  }
  return value;
}

function renderList(node: MarkdownNode, origin: string, depth: number): string {
  const ordered = node.type === "orderedList";
  const rawStart = Number(node.attrs?.start ?? 1);
  const start = Number.isSafeInteger(rawStart) && rawStart >= 0 ? rawStart : 1;
  const indentation = "  ".repeat(depth);

  const items = (node.content ?? []).map((item, index) => {
    const marker = ordered ? `${start + index}.` : "-";
    const blocks: string[] = [];
    const nestedLists: string[] = [];

    for (const child of item.content ?? []) {
      if (child.type === "bulletList" || child.type === "orderedList") {
        nestedLists.push(renderList(child, origin, depth + 1).trimEnd());
      } else {
        const rendered = renderNode(child, origin, depth).trim();
        if (rendered) blocks.push(rendered);
      }
    }

    const lines = blocks.join("\n").split("\n");
    const firstLine = lines.shift() ?? "";
    const continuationIndent = indentation + " ".repeat(marker.length + 1);
    const itemLines = [
      indentation + marker + " " + firstLine,
      ...lines.map((line) => continuationIndent + line),
    ];
    if (nestedLists.length) {
      itemLines.push(...nestedLists.flatMap((list) => list.split("\n")));
    }
    return itemLines.join("\n");
  });

  return items.join("\n") + "\n\n";
}

function renderNode(node: MarkdownNode, origin: string, depth = 0): string {
  if (node.type === "text") return renderText(node);
  if (node.type === "bulletList" || node.type === "orderedList") {
    return renderList(node, origin, depth);
  }

  const inner = (node.content ?? []).map((child) => renderNode(child, origin, depth)).join("");
  if (node.type === "paragraph") return inner + "\n\n";
  if (node.type === "heading") {
    const level = Math.min(3, Math.max(1, Number(node.attrs?.level ?? 2)));
    return `${"#".repeat(level)} ${inner}\n\n`;
  }
  if (node.type === "blockquote") {
    return inner.split("\n").filter(Boolean).map((line) => `> ${line}`).join("\n") + "\n\n";
  }
  if (node.type === "listItem") return inner;
  if (node.type === "horizontalRule") return "---\n\n";
  if (node.type === "hardBreak") return "  \n";
  if (node.type === "image") {
    const src = String(node.attrs?.src ?? "");
    const alt = String(node.attrs?.alt ?? "Image");
    return src.startsWith("/api/assets/")
      ? `![${alt}](${origin}${src})\n\n`
      : "";
  }
  return inner;
}

/** Export a note while preserving ordered numbering and nested list structure. */
export function noteToMarkdown(title: string, content: unknown, origin: string): string {
  const root = content && typeof content === "object"
    ? content as MarkdownNode
    : { content: [] };
  return `# ${title}\n\n${(root.content ?? []).map((node) => renderNode(node, origin)).join("")}`.trim() + "\n";
}
