import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const ARCHIVE_PAGE_SIZE = 50;

export function parseArchivePage(value: string | string[] | undefined): number {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const parsed = Number(rawValue);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 1_000_000) : 1;
}

export function ArchivePagination({
  currentPage,
  totalItems,
  pageSize = ARCHIVE_PAGE_SIZE,
  basePath,
  query,
}: {
  currentPage: number;
  totalItems: number;
  pageSize?: number;
  basePath: string;
  query?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalPages <= 1) return null;

  const firstItem = (currentPage - 1) * pageSize + 1;
  const lastItem = Math.min(currentPage * pageSize, totalItems);
  const href = (page: number) => `${basePath}?${query ? query + "&" : ""}page=${page}`;

  return (
    <nav className="archive-pagination" aria-label="Archive pages">
      <span className="archive-pagination-summary" role="status" aria-live="polite">
        Showing {firstItem}–{lastItem} of {totalItems}
      </span>
      <div className="archive-pagination-controls">
        {currentPage > 1 ? (
          <Link className="secondary-btn icon-only-btn" href={href(currentPage - 1)} aria-label={`Go to page ${currentPage - 1}`} title="Previous page">
            <ChevronLeft size={18} />
          </Link>
        ) : (
          <button type="button" className="secondary-btn icon-only-btn" disabled aria-label="Previous page" title="Previous page">
            <ChevronLeft size={18} />
          </button>
        )}
        <span className="archive-pagination-page" aria-current="page" role="status" aria-live="polite">
          Page {currentPage} of {totalPages}
        </span>
        {currentPage < totalPages ? (
          <Link className="secondary-btn icon-only-btn" href={href(currentPage + 1)} aria-label={`Go to page ${currentPage + 1}`} title="Next page">
            <ChevronRight size={18} />
          </Link>
        ) : (
          <button type="button" className="secondary-btn icon-only-btn" disabled aria-label="Next page" title="Next page">
            <ChevronRight size={18} />
          </button>
        )}
      </div>
    </nav>
  );
}
