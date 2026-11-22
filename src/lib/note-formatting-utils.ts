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

function normalizeFontFamily(value: string): string {
  // Browsers normalize quoted CSS family names (including quote style) when
  // reading element.style.fontFamily. Normalize before checking the allowlist.
  return value.replace(/["']/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

const ALLOWED_FONT_FAMILIES = new Map<string, string>(
  NOTE_FONT_OPTIONS.map((option) => [normalizeFontFamily(option.value), option.value]),
);
const SAFE_COLOR_PATTERN = /^(#[0-9a-f]{3,8}|(?:rgb|hsl)a?\(\s*[\d.%\s,/-]+\)|[a-z]{1,20})$/i;

export function safeTextColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const color = value.trim();
  return SAFE_COLOR_PATTERN.test(color) ? color : null;
}

export function safeFontFamily(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return ALLOWED_FONT_FAMILIES.get(normalizeFontFamily(value)) ?? null;
}
