/**
 * Lightweight Arabic-script direction and language helpers.
 *
 * Direction is deliberately detected per text block (not for the entire app),
 * so English and RTL paragraphs can coexist inside one note without forcing
 * the surrounding application chrome to reverse.
 */

export type TextLanguage = "ur" | "ar" | "en";
export type TextDirection = "rtl" | "ltr";

// Characters commonly used in Urdu but not in standard Arabic orthography.
// This is a practical script heuristic rather than full language identification.
const URDU_SPECIFIC_CHARACTERS = /[پٹڈڑںھہےگچژک]/u;
const ARABIC_SCRIPT_CHARACTERS = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/u;
const RTL_STRONG_CHARACTER = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC]/u;
const LTR_STRONG_CHARACTER = /[A-Za-z\u00C0-\u02AF]/u;

export function detectTextLanguage(value: string): TextLanguage {
  if (URDU_SPECIFIC_CHARACTERS.test(value)) return "ur";
  if (ARABIC_SCRIPT_CHARACTERS.test(value)) return "ar";
  return "en";
}

export function detectTextDirection(value: string): TextDirection {
  for (const character of value) {
    if (RTL_STRONG_CHARACTER.test(character)) return "rtl";
    if (LTR_STRONG_CHARACTER.test(character)) return "ltr";
  }
  return "ltr";
}

export function getBidiAttributes(value: string): { dir: "auto"; lang: TextLanguage } {
  return { dir: "auto", lang: detectTextLanguage(value) };
}

/** Set auto direction and an appropriate font-language hint on rich-editor blocks. */
export function applyBidiAttributes(root: HTMLElement): void {
  root.setAttribute("dir", "auto");

  const blocks = root.querySelectorAll<HTMLElement>("p,h1,h2,h3,h4,h5,h6,blockquote,li");
  blocks.forEach((block) => {
    const text = block.innerText || block.textContent || "";
    block.setAttribute("dir", "auto");
    block.setAttribute("lang", detectTextLanguage(text));
  });

  root.querySelectorAll<HTMLElement>("ul,ol").forEach((list) => {
    list.setAttribute("dir", "auto");
  });
}
