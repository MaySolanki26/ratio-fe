import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Chart colours come from six mark tokens --c-mark-1…6 set on the dashboard root (styles/dashboard.css):
 * - "Pastel mix" (default, like the society-management reference): indigo, teal, violet, rose, sky, mint;
 * - a single hue from the palette (chartPalette.ts): that hue in 100 / 66 / 44 / 28 / 18 / 11 % shades.
 * Components only ask for "mark n" — the chosen palette decides the colour.
 */
const MARKS = 6;
const mark = (index: number) => `var(--c-mark-${(index % MARKS) + 1})`;
/** Main colour (first mark) — lines, progress fills, ranked bars */
export const ACCENT = 'var(--c-mark-1)';
/** Colour of a chart mark by its position */
export const paletteSlot = (index: number): string => mark(index);
/** Soft solid fill of a mark (the colour lightened towards the card, no outline) */
export const softFill = (index: number): string => `color-mix(in srgb, ${mark(index)} 72%, var(--s-panel))`;
/** Second trend series: green "done" in Pastel mix, a lighter shade in single-hue palettes */
export const SECOND_SERIES = 'var(--c-trend-2)';

/** Stronger shade of a colour, for text drawn on a light fill */
export const strongOf = (color: string): string => `color-mix(in srgb, ${color} 62%, var(--s-text))`;

/** Meaning colours (rule 74): green good, amber attention, red problem */
export type DashTone = 'success' | 'warning' | 'danger';
export const toneColor = (tone: DashTone): string => `var(--c-dot-${tone})`;

/** Compact number for chart labels: 1,240 → 1.2k */
export const compact = (n: number): string => {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 10_000) return `${Math.round(n / 1000)}k`;
  if (abs >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n * 10) / 10);
};

/** Share of a whole as "42%" (or "—" when there is no whole) */
export const shareOf = (value: number, total: number, digits = 0): string => (total ? `${((value / total) * 100).toFixed(digits)}%` : '—');

/**
 * Width of an element, kept up to date as the card resizes — charts are laid out at their real pixel width so
 * their text never scales (rule 73).
 */
export function useWidth<T extends HTMLElement>(fallback = 320) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Content width (no padding), rounded and only when it really changed — never feeds back into a resize loop
    const measure = () => {
      const cs = getComputedStyle(el);
      const w = Math.floor(el.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0'));
      if (w > 0) setWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, []);
  return { ref, width };
}
