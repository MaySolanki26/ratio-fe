import { cx } from '../../lib/format';
import { IconButton } from '../primitives/Button';
import { SelectMenu } from '../primitives/SelectMenu';

/** Rows-per-page choices; above 100 rows the grid virtualizes (renders only visible rows). */
export const PAGE_SIZES = [25, 50, 100, 250, 500];

/** Frozen table footer: range, sample-data note, rows per page and numbered pages. */
export function GridFooter({ page, pageCount, pageSize, total, noun, onPage, onSize }: { page: number; pageCount: number; pageSize: number; total: number; noun: string; onPage: (p: number) => void; onSize: (n: number) => void }) {
  const from = total ? page * pageSize + 1 : 0;
  const to = Math.min(total, (page + 1) * pageSize);
  // 1 … p-1 p p+1 … N
  const pages: (number | 'gap')[] = [];
  for (let i = 0; i < pageCount; i++) {
    if (i === 0 || i === pageCount - 1 || Math.abs(i - page) <= 1) pages.push(i);
    else if (pages[pages.length - 1] !== 'gap') pages.push('gap');
  }
  return (
    <div className="grid-footer">
      <span className="grid-footer-range" aria-live="polite">
        <strong>
          {from}–{to}
        </strong>{' '}
        of {total.toLocaleString()} {noun}
      </span>
      <nav className="grid-pages" aria-label="Pagination">
        <IconButton icon="chevron-left" label="Previous page" disabledReason={page === 0 ? 'First page' : undefined} onClick={() => onPage(page - 1)} />
        {pages.map((p, i) =>
          p === 'gap' ? (
            <span key={`g${i}`} className="grid-page-gap" aria-hidden="true">
              …
            </span>
          ) : (
            <button key={p} type="button" className={cx('grid-page', p === page && 'is-current')} aria-current={p === page ? 'page' : undefined} aria-label={`Page ${p + 1}`} onClick={() => onPage(p)}>
              {p + 1}
            </button>
          ),
        )}
        <IconButton icon="chevron-right" label="Next page" disabledReason={page >= pageCount - 1 ? 'Last page' : undefined} onClick={() => onPage(page + 1)} />
      </nav>
      <SelectMenu label="Rows per page" value={pageSize} options={PAGE_SIZES.map((n) => ({ value: n, label: `${n} / page` }))} onChange={onSize} />
    </div>
  );
}

