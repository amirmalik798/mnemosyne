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

function renderText(node: RichNode, key: React.Key): React.ReactNode {
  let result: React.ReactNode = node.text ?? "";
  for (const mark of node.marks ?? []) {
    if (mark.type === "bold") result = <strong key={`${key}-b`}>{result}</strong>;
    else if (mark.type === "italic") result = <em key={`${key}-i`}>{result}</em>;
    else if (mark.type === "underline") result = <u key={`${key}-u`}>{result}</u>;
    else if (mark.type === "strike") result = <s key={`${key}-s`}>{result}</s>;
    else if (mark.type === "code") result = <code key={`${key}-c`}>{result}</code>;
    else if (mark.type === "textStyle") {
      const color = safeTextColor(mark.attrs?.color);
      const fontFamily = safeFontFamily(mark.attrs?.fontFamily);
      const style: React.CSSProperties = {};
      if (color) style.color = color;
      if (fontFamily) style.fontFamily = fontFamily;
      if (color || fontFamily) {
        result = <span key={`${key}-style`} style={style}>{result}</span>;
      }
    }
    else if (mark.type === "textHighlight") {
      const color = safeTextColor(mark.attrs?.color) ?? "#fff1a8";
      result = (
        <mark
          key={`${key}-highlight`}
          style={{ backgroundColor: color, borderRadius: "0.15em", padding: "0.02em 0.12em" }}
        >
          {result}
        </mark>
      );
    }
    else if (mark.type === "link") { const href = String(mark.attrs?.href ?? ""); if (/^https?:\/\//i.test(href)) result = <a key={`${key}-a`} href={href} target="_blank" rel="noreferrer">{result}</a>; }
  }
  return result;
}

function renderNode(
  node: RichNode,
  index: React.Key,
  onImageClick: (src: string, alt: string) => void,
): React.ReactNode {
  if (node.type === "text") return <React.Fragment key={index}>{renderText(node, index)}</React.Fragment>;
  const children = (node.content ?? []).map((child, i) =>
    renderNode(child, `${String(index)}-${i}`, onImageClick),
  );
  // Only block nodes need direction analysis. Text leaves and inline media
  // previously walked their entire subtree even though those results were unused.
  const bidi = BIDI_BLOCK_TYPES.has(node.type ?? "") ? blockBidiProps(node) : {};
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

export function RichContent({ content }: { content: unknown }) {
  const [activeImage, setActiveImage] = useState<{ src: string; alt: string } | null>(null);
  const closeImage = useCallback(() => setActiveImage(null), []);
  const root = content && typeof content === "object" ? content as RichNode : { type: "doc", content: [] };

  return (
    <>
      <div className="reader-content" dir="ltr">
        {(root.content ?? []).map((node, index) =>
          renderNode(node, index, (src, alt) => setActiveImage({ src, alt })),
        )}
      </div>
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
