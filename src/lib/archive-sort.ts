export type ArchiveSort = "created-desc" | "modified-desc" | "title-asc" | "title-desc";

export const DEFAULT_ARCHIVE_SORT: ArchiveSort = "created-desc";

export function parseArchiveSort(value: string | string[] | undefined): ArchiveSort {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === "modified-desc" ||
    candidate === "title-asc" ||
    candidate === "title-desc"
    ? candidate
    : DEFAULT_ARCHIVE_SORT;
}

export function isAlphabeticalArchiveSort(sort: ArchiveSort): boolean {
  return sort === "title-asc" || sort === "title-desc";
}

const archiveTitleCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
  usage: "sort",
});

export function compareArchiveTitles(
  left: { id: string; title: string },
  right: { id: string; title: string },
  sort: ArchiveSort,
): number {
  const comparison = archiveTitleCollator.compare(left.title.trim(), right.title.trim());
  const orderedComparison = sort === "title-desc" ? -comparison : comparison;
  return orderedComparison || left.id.localeCompare(right.id);
}
