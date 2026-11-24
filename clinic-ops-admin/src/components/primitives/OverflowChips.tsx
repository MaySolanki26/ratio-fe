import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Multi-value cell (shared component): shows as many chips as fit on ONE line, then a "+N" chip.
 * Hovering/focusing "+N" opens the global tooltip with a heading ("5 WORKING DAYS") and the full list.
 * Re-measures when the cell is resized.
 */
export function OverflowChips({ items, label, tone, tones, interactive = true, fill = false }: { items: string[]; label: string; tone?: 'accent'; /** per-item master tone (coloured tags) */ tones?: string[]; interactive?: boolean; /** Use leftover space for one more chip, truncated with an ellipsis (dropdown triggers). */ fill?: boolean }) {
  const wrap = useRef<HTMLSpanElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState(items.length);
  const [cut, setCut] = useState(false);

  useLayoutEffect(() => {
    const calc = () => {
      const box = wrap.current;
      const m = measure.current;
      if (!box || !m) return;
      const avail = box.clientWidth;
      const chips = Array.from(m.children) as HTMLElement[];
      const gap = 4;
      const plusW = 34; // room reserved for the "+N" chip
      let used = 0;
      let n = 0;
      for (let i = 0; i < chips.length; i++) {
        const w = chips[i].offsetWidth + (i ? gap : 0);
        const needPlus = i < chips.length - 1 ? plusW + gap : 0;
        if (used + w + needPlus > avail) break;
        used += w;
        n++;
      }
      const leftover = avail - used - plusW - gap * 2;
      const extra = fill && n < chips.length - 1 && leftover >= 44;
      setCut(extra);
      setFit(Math.max(n + (extra ? 1 : 0), Math.min(1, chips.length)));
    };
    calc();
    if (typeof ResizeObserver === 'undefined' || !wrap.current) return;
    const ro = new ResizeObserver(calc);
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [items.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const hidden = items.length - fit;
  return (
    <span ref={wrap} className={`overflow-chips${tone ? ` overflow-chips--${tone}` : ''}`}>
      {/* invisible copy used only to measure chip widths */}
      <span ref={measure} className="overflow-chips-measure" aria-hidden="true">
        {items.map((t, i) => (
          <span key={t} className={`tag assoc-chip${tones ? ` tag-tone tone-${tones[i]}` : ''}`}>
            {t}
          </span>
        ))}
      </span>
      {items.slice(0, fit).map((t, i) => (
        <span key={t} className={`tag assoc-chip${tones ? ` tag-tone tone-${tones[i]}` : ''}${cut && i === fit - 1 ? ' is-cut' : ''}`}>
          {t}
        </span>
      ))}
      {hidden > 0 && (
        <span
          className="tag tag-more"
          tabIndex={interactive ? 0 : undefined}
          role={interactive ? 'button' : undefined}
          aria-label={interactive ? `${hidden} more: ${items.slice(fit).join(', ')}` : undefined}
          data-tooltip={items.join('\n')}
          data-tooltip-title={`${items.length} ${label}`}
        >
          +{hidden}
        </span>
      )}
    </span>
  );
}
