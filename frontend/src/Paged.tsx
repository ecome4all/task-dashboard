import { useState } from "react";

export interface Paged<T> {
  /** Just the rows for the page being shown. */
  items: T[];
  page: number;
  pageCount: number;
  /** Index of the first row on this page, within the full list. */
  start: number;
  total: number;
  pageSize: number;
  setPage: (page: number) => void;
  /** Back to page 1 — call when a filter changes, so you aren't left on a
   *  page that no longer exists for the narrowed list. */
  reset: () => void;
}

// Splits a list into pages. The page number is clamped rather than stored
// blindly, so deleting the last row on the last page slides you back a page
// instead of showing an empty table.
export function usePaged<T>(items: T[], pageSize = 10): Paged<T> {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: current,
    pageCount,
    start,
    total: items.length,
    pageSize,
    setPage,
    reset: () => setPage(1),
  };
}

// Hidden entirely when everything fits on one page — a Prev/Next pair that
// can never do anything is just noise above a five-row table.
export default function Pagination<T>({ paged }: { paged: Paged<T> }) {
  if (paged.pageCount <= 1) return null;

  return (
    <div className="pagination">
      <span className="pagination-info">
        {paged.start + 1}–{Math.min(paged.start + paged.pageSize, paged.total)} of {paged.total}
      </span>
      <button
        className="btn btn-ghost btn-sm"
        disabled={paged.page <= 1}
        onClick={() => paged.setPage(paged.page - 1)}
      >
        Prev
      </button>
      <span className="pagination-info">Page {paged.page} of {paged.pageCount}</span>
      <button
        className="btn btn-ghost btn-sm"
        disabled={paged.page >= paged.pageCount}
        onClick={() => paged.setPage(paged.page + 1)}
      >
        Next
      </button>
    </div>
  );
}
