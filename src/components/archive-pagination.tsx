import Link from "next/link";

export const ARCHIVE_PAGE_SIZE = 50;

export function parseArchivePage(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 1_000_000) : 1;
}

export function ArchivePagination({
  currentPage,
  totalItems,
  pageSize = ARCHIVE_PAGE_SIZE,
  basePath,
}: {
  currentPage: number;
  totalItems: number;
  pageSize?: number;
  basePath: string;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalPages <= 1) return null;

  const firstItem = (currentPage - 1) * pageSize + 1;
  const lastItem = Math.min(currentPage * pageSize, totalItems);
  const href = (page: number) => `${basePath}?page=${page}`;

  return (
    <nav className="archive-pagination" aria-label="Archive pages">
      <span className="archive-pagination-summary">Showing {firstItem}–{lastItem} of {totalItems}</span>
      <div className="archive-pagination-controls">
        {currentPage > 1 ? (
          <Link className="secondary-btn" href={href(currentPage - 1)}>Previous</Link>
        ) : (
          <span className="secondary-btn" aria-disabled="true">Previous</span>
        )}
        <span className="archive-pagination-page">Page {currentPage} of {totalPages}</span>
        {currentPage < totalPages ? (
          <Link className="secondary-btn" href={href(currentPage + 1)}>Next</Link>
        ) : (
          <span className="secondary-btn" aria-disabled="true">Next</span>
        )}
      </div>
    </nav>
  );
}
