/**
 * Arabic-script language and paragraph-direction helpers.
 *
 * Direction is computed independently for every text block so Urdu, Arabic
 * and English can be mixed in one note without inheriting the wrong direction.
 */
export type TextLanguage = "ur" | "ar" | "en";
export type TextDirection = "rtl" | "ltr";

// Characters commonly used in Urdu but not in standard Arabic orthography.
const URDU_SPECIFIC_CHARACTERS = /[پٹڈڑںھہےگچژک]/u;
const ARABIC_SCRIPT_CHARACTERS = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/u;
const RTL_STRONG_CHARACTER = /[\u05D0-\u05EA\u05EF-\u05F4\u0620-\u064A\u066E-\u066F\u0671-\u06D3\u06D5\u06E5-\u06E6\u06EE-\u06EF\u06FA-\u06FC\u06FF\u0750-\u077F\u08A0-\u08C9\uFB1D-\uFB4F\uFB50-\uFDCF\uFDF0-\uFDFF\uFE70-\uFEFC]/u;
const LTR_STRONG_CHARACTER = /[A-Za-z\u00C0-\u02AF]/u;

export function detectTextLanguage(value: string): TextLanguage {
  if (URDU_SPECIFIC_CHARACTERS.test(value)) return "ur";
  if (ARABIC_SCRIPT_CHARACTERS.test(value)) return "ar";
  return "en";
}

/** Return the direction of the first strong (non-neutral) character. */
export function detectTextDirection(value: string): TextDirection {
  for (const character of value) {
    if (RTL_STRONG_CHARACTER.test(character)) return "rtl";
    if (LTR_STRONG_CHARACTER.test(character)) return "ltr";
  }
  return "ltr";
}

/** Explicit direction avoids browser-dependent dir=auto behaviour in editors. */
export function getBidiAttributes(value: string): { dir: TextDirection; lang: TextLanguage } {
  return { dir: detectTextDirection(value), lang: detectTextLanguage(value) };
}

/**
 * Apply explicit direction to ProseMirror blocks after create/update/paste.
 * Do not leave paragraphs at dir=auto: Chromium can calculate editable
 * paragraph direction inconsistently when pasted markup contains mixed runs.
 */
export function applyBidiAttributes(root: HTMLElement): void {
  root.setAttribute("dir", "ltr");
  root.style.textAlign = "start";

  const blocks = root.querySelectorAll<HTMLElement>("p,h1,h2,h3,h4,h5,h6,blockquote,li");
  blocks.forEach((block) => {
    const text = block.innerText || block.textContent || "";
    const direction = detectTextDirection(text);
    block.setAttribute("dir", direction);
    block.setAttribute("lang", detectTextLanguage(text));
    block.style.direction = direction;
    block.style.textAlign = direction === "rtl" ? "right" : "left";
    block.style.unicodeBidi = "plaintext";
  });

  root.querySelectorAll<HTMLElement>("ul,ol").forEach((list) => {
    const text = list.innerText || list.textContent || "";
    const direction = detectTextDirection(text);
    list.setAttribute("dir", direction);
    list.style.direction = direction;
    list.style.textAlign = direction === "rtl" ? "right" : "left";
  });
}
