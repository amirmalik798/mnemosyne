"use client";

import React, { useCallback, useState } from "react";
import { ImageLightbox } from "@/components/image-lightbox";
import { detectTextDirection, detectTextLanguage } from "@/lib/bidi";
import { safeFontFamily, safeTextColor } from "@/lib/note-formatting-utils";

type RichNode = { type?: string; text?: string; attrs?: Record<string, unknown>; marks?: Array<{ type: string; attrs?: Record<string, unknown> }>; content?: RichNode[] };

const nodeTextCache = new WeakMap<object, string>();
const BIDI_BLOCK_TYPES = new Set(["paragraph", "heading", "blockquote", "bulletList", "orderedList", "listItem"]);

function getNodeText(node: RichNode): string {
  const cached = nodeTextCache.get(node);
  if (cached !== undefined) return cached;
  const value = `${node.text ?? ""} ${(node.content ?? []).map(getNodeText).join(" ")}`.trim();
  nodeTextCache.set(node, value);
  return value;
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

function renderMarkedText(text: string, marks: NonNullable<RichNode["marks"]>, keyString: string): React.ReactNode {
  let result: React.ReactNode = text;
  for (const mark of marks) {
    if (mark.type === "bold") result = <strong key={`${keyString}-b`}>{result}</strong>;
    else if (mark.type === "italic") result = <em key={`${keyString}-i`}>{result}</em>;
    else if (mark.type === "underline") result = <u key={`${keyString}-u`}>{result}</u>;
    else if (mark.type === "strike") result = <s key={`${keyString}-s`}>{result}</s>;
    else if (mark.type === "code") result = <code key={`${keyString}-c`}>{result}</code>;
    else if (mark.type === "textStyle") {
      const color = safeTextColor(mark.attrs?.color);
      const fontFamily = safeFontFamily(mark.attrs?.fontFamily);
      const style: React.CSSProperties = {};
      if (color) style.color = color;
      if (fontFamily) style.fontFamily = fontFamily;
      if (color || fontFamily) {
        result = <span key={`${keyString}-style`} style={style}>{result}</span>;
      }
    }
    else if (mark.type === "textHighlight") {
      const color = safeTextColor(mark.attrs?.color) ?? "#fff1a8";
      result = (
        <mark
          key={`${keyString}-highlight`}
          style={{ backgroundColor: color, borderRadius: "0.15em", padding: "0.02em 0.12em" }}
        >
          {result}
        </mark>
      );
    }
    else if (mark.type === "link") { const href = String(mark.attrs?.href ?? ""); if (/^https?:\/\//i.test(href)) result = <a key={`${keyString}-a`} href={href} target="_blank" rel="noreferrer">{result}</a>; }
  }
  return result;
}

function renderText(node: RichNode, key: React.Key, wikiLinks: Record<string, string>): React.ReactNode {
  const rawText = node.text ?? "";
  if (!rawText.includes("[[")) return renderMarkedText(rawText, node.marks ?? [], String(key));

  const chunks = rawText.split(/(\[\[[^\]]+\]\])/g);
  return <>
    {chunks.map((chunk, index) => {
      const match = chunk.match(/^\[\[([^\]]+)\]\]$/);
      if (!match) return <React.Fragment key={index}>{renderMarkedText(chunk, node.marks ?? [], `${String(key)}-${index}`)}</React.Fragment>;
      const target = match[1].trim();
      const href = wikiLinks[target.toLocaleLowerCase()];
      const linkedText = renderMarkedText(target, node.marks ?? [], `${String(key)}-${index}`);
      return href
        ? <a key={index} className="wiki-note-link" href={href}>{linkedText}</a>
        : <span key={index} className="wiki-note-unresolved" title="No note with this exact title was found">{linkedText}</span>;
    })}
  </>;
}
type ReaderHeading = { id: string; title: string; level: number; path: string };

function collectReaderHeadings(nodes: RichNode[]): ReaderHeading[] {
  const headings: ReaderHeading[] = [];
  const usedIds = new Map<string, number>();

  function visit(node: RichNode, path: string) {
    if (node.type === "heading") {
      const title = getNodeText(node).trim();
      if (title) {
        const base = title.normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLocaleLowerCase()
          .replace(/[^\p{L}\p{N}]+/gu, "-")
          .replace(/^-+|-+$/g, "") || "section";
        const occurrence = (usedIds.get(base) ?? 0) + 1;
        usedIds.set(base, occurrence);
        const levelValue = Number(node.attrs?.level ?? 2);
        const level = Number.isFinite(levelValue) ? Math.min(3, Math.max(1, levelValue)) : 2;
        headings.push({
          id: `note-section-${base}${occurrence > 1 ? `-${occurrence}` : ""}`,
          title,
          level,
          path,
        });
      }
    }
    node.content?.forEach((child, index) => visit(child, `${path}-${index}`));
  }

  nodes.forEach((node, index) => visit(node, String(index)));
  return headings;
}

function renderNode(
  node: RichNode,
  index: React.Key,
  onImageClick: (src: string, alt: string) => void,
  wikiLinks: Record<string, string>,
  headingIds: Record<string, string>,
): React.ReactNode {
  if (node.type === "text") return <React.Fragment key={index}>{renderText(node, index, wikiLinks)}</React.Fragment>;
  const children = (node.content ?? []).map((child, i) =>
    renderNode(child, `${String(index)}-${i}`, onImageClick, wikiLinks, headingIds),
  );
  // Only block nodes need direction analysis. Text leaves and inline media
  // previously walked their entire subtree even though those results were unused.
  const bidi = BIDI_BLOCK_TYPES.has(node.type ?? "") ? blockBidiProps(node) : {};
  if (node.type === "paragraph") return <p key={index} {...bidi}>{children}</p>;
  if (node.type === "heading") {
    const level = Math.min(3, Math.max(1, Number(node.attrs?.level ?? 2)));
    const headingId = headingIds[String(index)];
    if (level === 1) return <h1 key={index} id={headingId} tabIndex={-1} {...bidi}>{children}</h1>;
    if (level === 2) return <h2 key={index} id={headingId} tabIndex={-1} {...bidi}>{children}</h2>;
    return <h3 key={index} id={headingId} tabIndex={-1} {...bidi}>{children}</h3>;
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
    const alt = String(node.attrs?.alt ?? "Note image");
    return (
      <figure key={index}>
        <button
          type="button"
          className="note-image-trigger"
          aria-label={`View image: ${alt}`}
          onClick={() => onImageClick(src, alt)}
        >
          <img src={src} alt={alt} loading="lazy" decoding="async" />
        </button>
      </figure>
    );
  }
  return <React.Fragment key={index}>{children}</React.Fragment>;
}

export function RichContent({ content, wikiLinks = {} }: { content: unknown; wikiLinks?: Record<string, string> }) {
  const [activeImage, setActiveImage] = useState<{ src: string; alt: string } | null>(null);
  const closeImage = useCallback(() => setActiveImage(null), []);
  const root = content && typeof content === "object" ? content as RichNode : { type: "doc", content: [] };
  const headings = collectReaderHeadings(root.content ?? []);
  const headingIds = Object.fromEntries(headings.map((heading) => [heading.path, heading.id]));

  return (
    <>
      {headings.length >= 3 && (
        <details className="reader-toc">
          <summary>
            <span>On this page</span>
            <span className="reader-toc-count">{headings.length} sections</span>
          </summary>
          <nav aria-label="Note sections">
            <ol>
              {headings.map((heading) => (
                <li key={heading.id}>
                  <a
                    href={`#${heading.id}`}
                    className={`reader-toc-link reader-toc-link--level-${heading.level}`}
                    dir="auto"
                    lang={detectTextLanguage(heading.title)}
                  >
                    {heading.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </details>
      )}
      <article className="reader-content" dir="ltr" aria-label="Note content">
        {(root.content ?? []).map((node, index) =>
          renderNode(node, index, (src, alt) => setActiveImage({ src, alt }), wikiLinks, headingIds),
        )}
      </article>
      <ImageLightbox
        src={activeImage?.src ?? null}
        alt={activeImage?.alt ?? "Note image"}
        onClose={closeImage}
      />
    </>
  );
}

export function extractText(content: unknown): string {
  const visit = (value: unknown): string => {
    if (!value || typeof value !== "object") return "";
    const node = value as RichNode;
    return `${node.text ?? ""} ${(node.content ?? []).map(visit).join(" ")}`;
  };
  return visit(content).replace(/\s+/g, " ").trim();
}
