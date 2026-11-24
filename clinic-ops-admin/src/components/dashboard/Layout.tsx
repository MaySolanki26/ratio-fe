import { pageZoom } from '../../lib/zoom';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';

/**
 * Drag-and-place dashboard cards (owner, 2026-11-24): drag a card by its title bar and drop it on another card.
 * **A card never changes size** — it keeps its own width wherever it goes, and rows always stay full:
 * same row → the two swap sides; another row → it swaps with the same-width card there and takes the spot it was
 * dropped on; no same-width card there → the two rows swap. No edit mode; once something moved, Undo · Redo ·
 * Reset to default show on the tab line (also Ctrl/⌘+Z, Ctrl/⌘+Shift+Z). Saved per tab in this browser.
 *
 * How it works: the tab body is one 10-column grid; rows are `display: contents`, so every card is a grid item with
 * its own span (wide-left 6 | 4, wide-right 4 | 6, halves 5 | 5, a lone card 10, from where the tab renders it). The saved layout is
 * rows of card titles; each card gets a CSS `order`. The DOM never moves, so charts keep their state.
 */
export interface LayoutState {
  /** rows of card titles, top to bottom; [] = the default */
  rows: string[][];
}

interface Ctx {
  dragging: string | null;
  over: string | null;
  cardProps: (title: string) => {
    onDragOver: (e: DragEvent<HTMLElement>) => void;
    onDragLeave: (e: DragEvent<HTMLElement>) => void;
    onDrop: (e: DragEvent<HTMLElement>) => void;
  };
  handleProps: (title: string) => {
    draggable: boolean;
    onDragStart: (e: DragEvent<HTMLElement>) => void;
    onDragEnd: () => void;
  };
  moveBy: (title: string, key: 'left' | 'right' | 'up' | 'down') => void;
}

const noop = () => undefined;
const LayoutCtx = createContext<Ctx>({
  dragging: null,
  over: null,
  cardProps: () => ({ onDragOver: noop, onDragLeave: noop, onDrop: noop }),
  handleProps: () => ({ draggable: false, onDragStart: noop, onDragEnd: noop }),
  moveBy: noop,
});
export const useDashLayout = () => useContext(LayoutCtx);

const EMPTY: LayoutState = { rows: [] };
const keyOf = (tab: string) => `uab.dashboard.layout.${tab}`;
const read = (tab: string): LayoutState => {
  try {
    const v = JSON.parse(localStorage.getItem(keyOf(tab)) ?? 'null');
    return v && Array.isArray(v.rows) && v.rows.every(Array.isArray) ? { rows: v.rows.map((r: unknown[]) => r.map(String)) } : EMPTY;
  } catch {
    return EMPTY;
  }
};
const write = (tab: string, s: LayoutState) => {
  try {
    if (s.rows.length) localStorage.setItem(keyOf(tab), JSON.stringify(s));
    else localStorage.removeItem(keyOf(tab));
  } catch {
    /* storage blocked: the layout lasts for this visit */
  }
};

interface History {
  tab: string;
  past: LayoutState[];
  state: LayoutState;
  future: LayoutState[];
}
const fresh = (tab: string): History => ({ tab, past: [], state: read(tab), future: [] });

/** Layout + undo/redo history for one tab (history starts fresh when the tab changes) */
export function useLayoutHistory(tab: string) {
  const [raw, setH] = useState<History>(() => fresh(tab));
  const h = raw.tab === tab ? raw : fresh(tab);
  useEffect(() => {
    if (raw.tab !== tab) setH(fresh(tab));
  }, [raw.tab, tab]);
  const apply = useCallback(
    (fn: (h: History) => History | null) => {
      setH((cur) => {
        const base = cur.tab === tab ? cur : fresh(tab);
        const next = fn(base);
        if (!next) return base;
        write(tab, next.state);
        return next;
      });
    },
    [tab],
  );
  const commit = useCallback((next: LayoutState) => apply((c) => ({ ...c, past: [...c.past.slice(-49), c.state], state: next, future: [] })), [apply]);
  const undo = useCallback(() => apply((c) => (c.past.length ? { ...c, past: c.past.slice(0, -1), state: c.past[c.past.length - 1], future: [c.state, ...c.future] } : null)), [apply]);
  const redo = useCallback(() => apply((c) => (c.future.length ? { ...c, past: [...c.past, c.state], state: c.future[0], future: c.future.slice(1) } : null)), [apply]);
  const reset = useCallback(() => apply((c) => (c.state.rows.length ? { ...c, past: [...c.past.slice(-49), c.state], state: EMPTY, future: [] } : null)), [apply]);
  return { state: h.state, commit, undo, redo, reset, canUndo: h.past.length > 0, canRedo: h.future.length > 0, isDefault: !h.state.rows.length };
}

/** A card's own width (of 10 columns), from the row the tab renders it in */
const spanOf = (card: HTMLElement) => {
  const row = card.parentElement;
  if (!row || !row.classList.contains('dv-row')) return 10;
  const cards = Array.from(row.children).filter((c) => c.classList.contains('dv-card'));
  if (cards.length < 2) return 10;
  const i = cards.indexOf(card);
  if (row.classList.contains('is-wide-left')) return i === 0 ? 6 : 4;
  if (row.classList.contains('is-wide-right')) return i === 0 ? 4 : 6;
  if (row.classList.contains('is-thirds')) return i === 2 ? 4 : 3;
  return 5;
};
const reduceMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const keyOfRows = (rows: string[][]) => rows.map((r) => r.join('|')).join('/');

interface Defaults {
  rows: string[][];
  span: Record<string, number>;
}

/** The saved rows when they still fit this tab (same cards, every row full), else the default rows */
const validRows = (saved: string[][], d: Defaults) => {
  const all = d.rows.flat();
  const flat = saved.flat();
  const ok = flat.length === all.length && all.every((t) => flat.includes(t)) && saved.every((r) => r.reduce((w, t) => w + (d.span[t] ?? 0), 0) === 10);
  return ok ? saved : d.rows;
};

/** Move card `a` onto card `b`, never changing any card's width */
export const placeCard = (rows: string[][], span: Record<string, number>, a: string, b: string): string[][] => {
  const next = rows.map((r) => [...r]);
  const ra = next.findIndex((r) => r.includes(a));
  const rb = next.findIndex((r) => r.includes(b));
  if (ra < 0 || rb < 0 || a === b) return rows;
  if (ra === rb) {
    const r = next[ra];
    const i = r.indexOf(a);
    const j = r.indexOf(b);
    [r[i], r[j]] = [r[j], r[i]];
    return next;
  }
  const c = span[b] === span[a] ? b : next[rb].find((t) => span[t] === span[a]);
  if (!c) {
    [next[ra], next[rb]] = [next[rb], next[ra]];
    return next;
  }
  // a and c trade places, then a takes the spot it was dropped on
  next[ra][next[ra].indexOf(a)] = c;
  const row = next[rb];
  row[row.indexOf(c)] = a;
  const ia = row.indexOf(a);
  const ib = row.indexOf(b);
  if (ib >= 0 && ib !== ia) [row[ia], row[ib]] = [row[ib], row[ia]];
  return next;
};

export function DashLayoutProvider({ layout, bodyRef, children }: { layout: ReturnType<typeof useLayoutHistory>; bodyRef: RefObject<HTMLElement>; children: ReactNode }) {
  const { state, commit } = layout;
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const defaults = useRef<Defaults>({ rows: [], span: {} });
  const lastKey = useRef('');

  const cardsOf = useCallback(() => (bodyRef.current ? Array.from(bodyRef.current.querySelectorAll<HTMLElement>(':scope > .dv-card, :scope > .dv-row > .dv-card')) : []), [bodyRef]);
  const currentRows = useCallback(() => validRows(state.rows, defaults.current), [state.rows]);

  // give every card its place (CSS order, row by row) and its own width; glide cards to new places (FLIP)
  useLayoutEffect(() => {
    const cards = cardsOf();
    const span: Record<string, number> = {};
    const rows: string[][] = [];
    let lastRow: Element | null = null;
    cards.forEach((c) => {
      const t = c.dataset.card ?? '';
      span[t] = spanOf(c);
      const row = c.parentElement?.classList.contains('dv-row') ? c.parentElement : c;
      if (row !== lastRow) rows.push([]);
      rows[rows.length - 1].push(t);
      lastRow = row;
    });
    defaults.current = { rows, span };
    const placed = validRows(state.rows, defaults.current);
    const order: Record<string, number> = {};
    placed.flat().forEach((t, i) => (order[t] = i + 1));
    const key = keyOfRows(placed);
    const animate = lastKey.current && lastKey.current !== key && !reduceMotion();
    const before = animate ? cards.map((c) => c.getBoundingClientRect()) : [];
    cards.forEach((c) => {
      const t = c.dataset.card ?? '';
      c.style.order = String(order[t] ?? 0);
      c.style.setProperty('--span', String(span[t]));
    });
    if (animate) {
      cards.forEach((c, i) => {
        const a = before[i];
        const b = c.getBoundingClientRect();
        const z = pageZoom();
        const dx = (a.left - b.left) / z;
        const dy = (a.top - b.top) / z;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
        c.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.7,.2,1)' });
      });
    }
    lastKey.current = key;
  });

  const save = useCallback(
    (rows: string[][]) => {
      if (keyOfRows(rows) === keyOfRows(currentRows())) return;
      commit({ rows: keyOfRows(rows) === keyOfRows(defaults.current.rows) ? [] : rows });
    },
    [commit, currentRows],
  );
  const drop = useCallback((a: string, b: string) => save(placeCard(currentRows(), defaults.current.span, a, b)), [save, currentRows]);

  const value = useMemo<Ctx>(
    () => ({
      dragging,
      over,
      handleProps: (title) => ({
        draggable: true,
        onDragStart: (e) => {
          const card = (e.currentTarget as HTMLElement).closest('.dv-card') as HTMLElement | null;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', title);
          if (card) {
            const r = card.getBoundingClientRect();
            e.dataTransfer.setDragImage(card, Math.min(e.clientX - r.left, r.width - 1), Math.min(e.clientY - r.top, 40));
          }
          // let the browser take the drag picture before the card fades
          requestAnimationFrame(() => setDragging(title));
        },
        onDragEnd: () => {
          setDragging(null);
          setOver(null);
        },
      }),
      cardProps: (title) => ({
        onDragOver: (e) => {
          if (!dragging || dragging === title) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (over !== title) setOver(title);
        },
        onDragLeave: (e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === title ? null : o));
        },
        onDrop: (e) => {
          e.preventDefault();
          if (dragging && dragging !== title) drop(dragging, title);
          setDragging(null);
          setOver(null);
        },
      }),
      // keyboard: ← → swap with the row-mate, ↑ ↓ swap the whole row with the one above / below
      moveBy: (title, key) => {
        const rows = currentRows().map((r) => [...r]);
        const ri = rows.findIndex((r) => r.includes(title));
        if (ri < 0) return;
        if (key === 'left' || key === 'right') {
          const r = rows[ri];
          const i = r.indexOf(title);
          const j = i + (key === 'left' ? -1 : 1);
          if (j < 0 || j >= r.length) return;
          [r[i], r[j]] = [r[j], r[i]];
        } else {
          const rj = ri + (key === 'up' ? -1 : 1);
          if (rj < 0 || rj >= rows.length) return;
          [rows[ri], rows[rj]] = [rows[rj], rows[ri]];
        }
        save(rows);
      },
    }),
    [dragging, over, drop, save, currentRows],
  );
  return <LayoutCtx.Provider value={value}>{children}</LayoutCtx.Provider>;
}

/** Arrow keys on a card's grip: ← → swap sides within the row, ↑ ↓ move the row (keyboard drag) */
export const gripKeys = (moveBy: Ctx['moveBy'], title: string) => (e: KeyboardEvent<HTMLElement>) => {
  const map: Record<string, 'left' | 'right' | 'up' | 'down'> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  const k = map[e.key];
  if (!k) return;
  e.preventDefault();
  moveBy(title, k);
};
