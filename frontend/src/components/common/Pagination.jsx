import { ChevronLeft, ChevronRight } from 'lucide-react';

/** "Showing 21–40 of 132" + previous/next and a compact page list. */
export default function Pagination({ page, totalPages, total, limit, onPageChange }) {
  if (!total) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  const pages = [];
  for (let p = Math.max(1, page - 2); p <= Math.min(totalPages, page + 2); p += 1) pages.push(p);

  return (
    <nav className="evsu-pagination" aria-label="Pagination">
      <span className="small text-muted-evsu">
        Showing <strong>{from}–{to}</strong> of <strong>{total}</strong>
      </span>
      <div className="d-flex align-items-center gap-1">
        <button type="button" className="btn btn-sm btn-light" onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="Previous page">
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        {pages.map((p) => (
          <button
            key={p}
            type="button"
            className={`btn btn-sm ${p === page ? 'btn-primary' : 'btn-light'}`}
            onClick={() => onPageChange(p)}
            aria-current={p === page ? 'page' : undefined}
            aria-label={`Page ${p}`}
          >
            {p}
          </button>
        ))}
        <button type="button" className="btn btn-sm btn-light" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} aria-label="Next page">
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
