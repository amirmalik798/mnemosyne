import { Mark, mergeAttributes } from "@tiptap/core";
import {
  DEFAULT_HIGHLIGHT_COLOR,
  safeFontFamily,
  safeTextColor,
} from "@/lib/note-formatting-utils";

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
    return [{
      tag: "span[style]",
      getAttrs: (element) => {
        const htmlElement = element as HTMLElement;
        const hasSupportedTextStyle =
          safeTextColor(htmlElement.style.color) !== null ||
          safeFontFamily(htmlElement.style.fontFamily) !== null;
        return hasSupportedTextStyle ? null : false;
      },
    }];
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
