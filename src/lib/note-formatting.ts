import { Mark, mergeAttributes } from "@tiptap/core";

export const DEFAULT_TEXT_COLOR = "#e5ece8";
export const DEFAULT_HIGHLIGHT_COLOR = "#fff1a8";

export const NOTE_FONT_OPTIONS = [
  { value: "Georgia, serif", label: "Georgia" },
  { value: "Arial, sans-serif", label: "Arial" },
  { value: "Verdana, sans-serif", label: "Verdana" },
  { value: "'Times New Roman', serif", label: "Times New Roman" },
  { value: "'Courier New', monospace", label: "Courier New" },
  { value: "'Source Sans 3', sans-serif", label: "Source Sans 3" },
  { value: "Inter, sans-serif", label: "Inter" },
  { value: "'Atkinson Hyperlegible', sans-serif", label: "Atkinson Hyperlegible" },
  { value: "Lato, sans-serif", label: "Lato" },
  { value: "'Plus Jakarta Sans', sans-serif", label: "Plus Jakarta Sans" },
  { value: "'EB Garamond', serif", label: "EB Garamond" },
  { value: "Amiri, serif", label: "Amiri" },
  { value: "'Noto Naskh Arabic', serif", label: "Noto Naskh Arabic" },
  { value: "'JetBrains Mono', monospace", label: "JetBrains Mono" },
] as const;

const ALLOWED_FONT_FAMILIES = new Set<string>(NOTE_FONT_OPTIONS.map((option) => option.value));
const SAFE_COLOR_PATTERN = /^(#[0-9a-f]{3,8}|(?:rgb|hsl)a?\(\s*[\d.%\s,/-]+\)|[a-z]{1,20})$/i;

export function safeTextColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const color = value.trim();
  return SAFE_COLOR_PATTERN.test(color) ? color : null;
}

export function safeFontFamily(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return ALLOWED_FONT_FAMILIES.has(value) ? value : null;
}

/**
 * Inline text styling is stored as native Tiptap mark attributes, so formatting
 * remains part of the encrypted note JSON and survives reopening the note.
 */
export const TextStyleMark = Mark.create({
  name: "textStyle",

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element) => safeTextColor((element as HTMLElement).style.color),
        renderHTML: (attributes) => {
          const color = safeTextColor(attributes.color);
          return color ? { style: `color: ${color}` } : {};
        },
      },
      fontFamily: {
        default: null,
        parseHTML: (element) => safeFontFamily((element as HTMLElement).style.fontFamily),
        renderHTML: (attributes) => {
          const fontFamily = safeFontFamily(attributes.fontFamily);
          return fontFamily ? { style: `font-family: ${fontFamily}` } : {};
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[style]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },
});

export const TextHighlightMark = Mark.create({
  name: "textHighlight",

  addAttributes() {
    return {
      color: {
        default: DEFAULT_HIGHLIGHT_COLOR,
        parseHTML: (element) => {
          const htmlElement = element as HTMLElement;
          return safeTextColor(htmlElement.getAttribute("data-highlight") || htmlElement.style.backgroundColor)
            ?? DEFAULT_HIGHLIGHT_COLOR;
        },
        renderHTML: (attributes) => {
          const color = safeTextColor(attributes.color) ?? DEFAULT_HIGHLIGHT_COLOR;
          return {
            "data-highlight": color,
            style: `background-color: ${color}`,
          };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "mark" }, { tag: "span[data-highlight]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["mark", mergeAttributes(HTMLAttributes), 0];
  },
});
