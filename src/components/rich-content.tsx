import React from "react";
import { detectTextDirection, detectTextLanguage } from "@/lib/bidi";

type RichNode = { type?: string; text?: string; attrs?: Record<string, unknown>; marks?: Array<{ type: string; attrs?: Record<string, unknown> }>; content?: RichNode[] };

function getNodeText(node: RichNode): string {
  return `${node.text ?? ""} ${(node.content ?? []).map(getNodeText).join(" ")}`.trim();
}

function blockBidiProps(node: RichNode) {
  const text = getNodeText(node);
  const detectedDirection = detectTextDirection(text);
  const detectedLanguage = detectTextLanguage(text);
  const storedDirection = node.attrs?.dir;
  const storedLanguage = node.attrs?.lang;
  const dir = storedDirection === "rtl" || storedDirection === "ltr"
    ? storedDirection
    : detectedDirection;
  const lang = storedLanguage === "ur" || storedLanguage === "ar" || storedLanguage === "en"
    ? storedLanguage
    : detectedLanguage;

  return {
    dir,
    lang,
    style: {
      direction: dir,
      textAlign: dir === "rtl" ? "right" as const : "left" as const,
      unicodeBidi: "plaintext" as const,
    },
  };
}

function renderText(node: RichNode, key: React.Key): React.ReactNode {
  let result: React.ReactNode = node.text ?? "";
  for (const mark of node.marks ?? []) {
    if (mark.type === "bold") result = <strong key={`${key}-b`}>{result}</strong>;
    else if (mark.type === "italic") result = <em key={`${key}-i`}>{result}</em>;
    else if (mark.type === "underline") result = <u key={`${key}-u`}>{result}</u>;
    else if (mark.type === "strike") result = <s key={`${key}-s`}>{result}</s>;
    else if (mark.type === "code") result = <code key={`${key}-c`}>{result}</code>;
    else if (mark.type === "link") { const href = String(mark.attrs?.href ?? ""); if (/^https?:\/\//i.test(href)) result = <a key={`${key}-a`} href={href} target="_blank" rel="noreferrer">{result}</a>; }
  }
  return result;
}

function renderNode(node: RichNode, index: React.Key): React.ReactNode {
  const children = (node.content ?? []).map((child, i) => renderNode(child, `${String(index)}-${i}`));
  const bidi = blockBidiProps(node);
  if (node.type === "text") return <React.Fragment key={index}>{renderText(node, index)}</React.Fragment>;
  if (node.type === "paragraph") return <p key={index} {...bidi}>{children}</p>;
  if (node.type === "heading") {
    const level = Math.min(3, Math.max(1, Number(node.attrs?.level ?? 2)));
    if (level === 1) return <h1 key={index} {...bidi}>{children}</h1>;
    if (level === 2) return <h2 key={index} {...bidi}>{children}</h2>;
    return <h3 key={index} {...bidi}>{children}</h3>;
  }
  if (node.type === "blockquote") return <blockquote key={index} {...bidi}>{children}</blockquote>;
  if (node.type === "bulletList") return <ul key={index} {...bidi}>{children}</ul>;
  if (node.type === "orderedList") return <ol key={index} {...bidi}>{children}</ol>;
  if (node.type === "listItem") return <li key={index} {...bidi}>{children}</li>;
  if (node.type === "hardBreak") return <br key={index} />;
  if (node.type === "horizontalRule") return <hr key={index} />;
  if (node.type === "image") {
    const src = String(node.attrs?.src ?? "");
    if (!src.startsWith("/api/assets/")) return null;
    return <figure key={index}><img src={src} alt={String(node.attrs?.alt ?? "Note image")} /></figure>;
  }
  return <React.Fragment key={index}>{children}</React.Fragment>;
}

export function RichContent({ content }: { content: unknown }) {
  const root = content && typeof content === "object" ? content as RichNode : { type: "doc", content: [] };
  return <div className="reader-content" dir="ltr">{(root.content ?? []).map((node, index) => renderNode(node, index))}</div>;
}

export function extractText(content: unknown): string {
  const visit = (value: unknown): string => {
    if (!value || typeof value !== "object") return "";
    const node = value as RichNode;
    return `${node.text ?? ""} ${(node.content ?? []).map(visit).join(" ")}`;
  };
  return visit(content).replace(/\s+/g, " ").trim();
}
