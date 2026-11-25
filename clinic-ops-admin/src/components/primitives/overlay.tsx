import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../../lib/format';
import { Button } from './Button';
import { Icon } from './Icon';
import { unzoomRect, viewport } from '../../lib/zoom';

// ---------------------------------------------------------------- open / close motion
// Owner rule 49: every popover, dropdown, menu, dialog and drawer opens and closes smoothly.
// Closing keeps the layer mounted for EXIT_MS with `is-closing` so the exit animation can play.
// Reduced motion (or no matchMedia, e.g. tests) = instant, synchronous unmount.
export const EXIT_MS = 170;
export const motionOK = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function usePresence(open: boolean) {
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) {
      setShown(true);
      return;
    }
    if (!shown) return;
    if (!motionOK()) {
      setShown(false);
      return;
    }
    const t = setTimeout(() => setShown(false), EXIT_MS);
    return () => clearTimeout(t);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const lingering = !open && shown && motionOK();
  return { mounted: open || lingering, closing: lingering };
}

// ---------------------------------------------------------------- layer stack
// Escape closes only the topmost layer (§1.5).
const stack: string[] = [];
const handlers = new Map<string, () => void>();
let listening = false;

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !stack.length) return;
  const top = stack[stack.length - 1];
  const h = handlers.get(top);
  if (h) {
    e.preventDefault();
    e.stopPropagation();
    h();
  }
}

export function useLayer(open: boolean, onClose: () => void) {
  const id = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    if (!listening) {
      document.addEventListener('keydown', onKey, true);
      listening = true;
    }
    stack.push(id);
    handlers.set(id, () => closeRef.current());
    return () => {
      const i = stack.lastIndexOf(id);
      if (i >= 0) stack.splice(i, 1);
      handlers.delete(id);
    };
  }, [open, id]);
}

/** True when any overlay layer (dialog, drawer, popover) is open. */
export const hasOpenLayer = () => stack.length > 0;

// Last focused element outside any dialog — the control that opened the topmost layer.
let lastOutside: HTMLElement | null = null;
if (typeof document !== 'undefined')
  document.addEventListener('focusin', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && !t.closest?.('[role="dialog"],[role="alertdialog"]')) lastOutside = t;
  });

/** Save focus on open; restore it to the invoking control on close. */
export function useFocusReturn(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement as HTMLElement | null;
    const prev = active && !active.closest('[role="dialog"],[role="alertdialog"]') && active !== document.body ? active : lastOutside;
    return () => {
      if (!prev || !document.contains(prev)) return;
      setTimeout(() => {
        // a still-open layer keeps focus (StrictMode re-runs effects; nested layers close one at a time)
        const now = document.activeElement as HTMLElement | null;
        if (now && now !== document.body && now.closest('[role="dialog"],[role="alertdialog"]')) return;
        prev.focus();
      }, 0);
    };
  }, [open]);
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useFocusTrap(ref: RefObject<HTMLElement>, open: boolean) {
  useEffect(() => {
    if (!open || !ref.current) return;
    const el = ref.current;
    const first = el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelectorAll<HTMLElement>(FOCUSABLE)[0];
    (first ?? el).focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent !== null);
      if (!items.length) return;
      const a = items[0];
      const z = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    el.addEventListener('keydown', trap);
    return () => el.removeEventListener('keydown', trap);
  }, [open, ref]);
}

// ---------------------------------------------------------------- dialog

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  role?: 'dialog' | 'alertdialog';
  /** Controls on the right of the header (e.g. Simple | Canvas, Drawer | Popup). */
  headerExtra?: ReactNode;
}

export function Dialog({ open, onClose, title, description, children, footer, size = 'md', role = 'dialog', headerExtra }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  useLayer(open, onClose);
  useFocusReturn(open);
  const presence = usePresence(open);
  // trap once the panel is actually mounted (it mounts after the open-animation presence check)
  useFocusTrap(ref, open && presence.mounted);
  if (!presence.mounted) return null;
  return createPortal(
    <div className={cx('overlay-scrim', presence.closing && 'is-closing')} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={cx('dialog', `dialog-${size}`)} role={role} aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descId : undefined} tabIndex={-1}>
        <header className="dialog-header">
          <div className="dialog-title-row">
            <h2 id={titleId} className="dialog-title">
              {title}
            </h2>
            {/* no ⓘ next to popup titles (owner rule) — description is screen-reader text */}
            {description && (
              <span id={descId} className="sr-only">
                {description}
              </span>
            )}
          </div>
          {headerExtra}
          {/* Owner rule: popups have no × icon — they close with the footer Cancel button (or Esc / scrim click).
          <IconButton icon="x" label="Close dialog" onClick={onClose} /> */}
        </header>
        <div className="dialog-body">{children}</div>
        <footer className="dialog-footer">{footer ?? <Button onClick={onClose}>Cancel</Button>}</footer>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- drawer (modal side sheet for forms)

// ---------------------------------------------------------------- confirm before delete (shared)

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
}
let pushConfirm: ((o: ConfirmOptions) => void) | null = null;

/**
 * Owner rule: anything that deletes / removes / discards data first shows this alert box —
 * "Cancel" (focused) + a red confirm button. Call `confirmDelete({...})` from any click handler.
 */
export function confirmDelete(o: ConfirmOptions) {
  if (pushConfirm) pushConfirm(o);
  // Never window.confirm (skill rule 30): without the host nothing is deleted.
  else console.warn('confirmDelete: ConfirmHost is not mounted; nothing was deleted.');
}

/** Mounted once in App (next to TooltipLayer). */
export function ConfirmHost() {
  const [cur, setCur] = useState<ConfirmOptions | null>(null);
  useEffect(() => {
    pushConfirm = setCur;
    return () => {
      pushConfirm = null;
    };
  }, []);
  return (
    <Dialog
      open={!!cur}
      onClose={() => setCur(null)}
      title={cur?.title ?? ''}
      size="sm"
      role="alertdialog"
      footer={
        <>
          <Button onClick={() => setCur(null)} data-autofocus>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              const c = cur;
              setCur(null);
              c?.onConfirm();
            }}
          >
            {cur?.confirmLabel ?? 'Delete'}
          </Button>
        </>
      }
    >
      <p>{cur?.message}</p>
    </Dialog>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
  headerExtra,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Controls on the right of the drawer header (e.g. the Simple | Canvas layout switch). */
  headerExtra?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useLayer(open, onClose);
  useFocusReturn(open);
  const presence = usePresence(open);
  // trap once the panel is actually mounted (it mounts after the open-animation presence check)
  useFocusTrap(ref, open && presence.mounted);
  if (!presence.mounted) return null;
  return createPortal(
    <div className={cx('overlay-scrim overlay-scrim-drawer', presence.closing && 'is-closing')} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={cx('drawer', wide && 'drawer-wide')} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <header className="dialog-header">
          <div className="dialog-title-row">
            <h2 id={titleId} className="dialog-title">
              {title}
            </h2>
            {/* no ⓘ next to popup titles (owner rule) — description is screen-reader text */}
            {description && <span className="sr-only">{description}</span>}
          </div>
          {headerExtra}
          {/* Owner rule: side drawers have no × icon — they close with the footer Cancel button (or Esc / scrim click).
          <IconButton icon="x" label="Close panel" onClick={onClose} /> */}
        </header>
        <div className="drawer-body">{children}</div>
        <footer className="dialog-footer">{footer ?? <Button onClick={onClose}>Cancel</Button>}</footer>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- form surface (rule 50)

/**
 * Owner rule 50: a FORM with more than 2 fields opens in the side drawer; a form with 1–2 fields
 * (or a confirmation) stays a centred dialog. Use this for every form popup instead of choosing by hand.
 */
export function FormDialog({ fieldCount, size, role, wide, ...p }: DialogProps & { fieldCount: number; wide?: boolean }) {
  return fieldCount > 2 ? <Drawer {...p} wide={wide} /> : <Dialog {...p} size={size} role={role} />;
}

// ---------------------------------------------------------------- popover (anchored, flips)

export function Popover({
  open,
  onClose,
  anchor,
  children,
  label,
  width,
  maxWidth,
  align = 'start',
  side = 'bottom',
  className,
}: {
  open: boolean;
  onClose: () => void;
  anchor: RefObject<HTMLElement>;
  children: ReactNode;
  label: string;
  width?: number;
  /** Cap the panel width (e.g. a dropdown never wider than its trigger). */
  maxWidth?: number;
  align?: 'start' | 'end';
  /** 'right' opens beside the anchor (used by icon-rail buttons), bottom-aligned to it and kept on screen. */
  side?: 'bottom' | 'right';
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null);
  useLayer(open, onClose);
  useFocusReturn(open);

  const place = useCallback(() => {
    const raw = anchor.current?.getBoundingClientRect();
    const el = ref.current;
    if (!raw || !el) return;
    const a = unzoomRect(raw);
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const { vw, vh } = viewport();
    if (side === 'right') {
      const top = Math.min(Math.max(8, a.bottom - h), vh - h - 8);
      setPos({ top, left: Math.min(a.right + 8, vw - w - 8), maxH: vh - 16 });
      return;
    }
    const below = vh - a.bottom - 8;
    const above = a.top - 8;
    const flip = h > below && above > below;
    const top = flip ? Math.max(8, a.top - 4 - Math.min(h, above)) : a.bottom + 4;
    let left = align === 'end' ? a.right - w : a.left;
    left = Math.min(Math.max(8, left), vw - w - 8);
    setPos({ top, left, maxH: Math.max(160, (flip ? above : below) - 4) });
  }, [anchor, align, side]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    // Re-place whenever the panel itself changes size (e.g. switching to a wider mode),
    // so it always stays fully inside the viewport.
    const ro = typeof ResizeObserver !== 'undefined' && ref.current ? new ResizeObserver(place) : null;
    if (ro && ref.current) ro.observe(ref.current);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      ro?.disconnect();
    };
  }, [open, place, width]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      // Ignore clicks inside nested portals (e.g. a popover opened from this popover).
      if ((t as HTMLElement).closest?.('.popover') && !ref.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [open, onClose, anchor]);

  useEffect(() => {
    if (open && ref.current) {
      const first = ref.current.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus();
    }
  }, [open]);

  const presence = usePresence(open);
  if (!presence.mounted) return null;
  return createPortal(
    <div
      ref={ref}
      className={cx('popover', className, presence.closing && 'is-closing')}
      role="dialog"
      aria-label={label}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width, maxWidth, maxHeight: pos?.maxH }}
    >
      {children}
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- menu

export interface MenuItem {
  id: string;
  label: string;
  icon?: string;
  onSelect: () => void;
  danger?: boolean;
  disabledReason?: string;
  separatorBefore?: boolean;
}

export function Menu({ open, onClose, anchor, items, label, align = 'end' }: { open: boolean; onClose: () => void; anchor: RefObject<HTMLElement>; items: MenuItem[]; label: string; align?: 'start' | 'end' }) {
  const listRef = useRef<HTMLDivElement>(null);
  const move = (dir: 1 | -1) => {
    const els = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const i = els.indexOf(document.activeElement as HTMLButtonElement);
    els[(i + dir + els.length) % els.length]?.focus();
  };
  return (
    <Popover open={open} onClose={onClose} anchor={anchor} label={label} align={align} width={220}>
      <div
        ref={listRef}
        role="menu"
        aria-label={label}
        className="menu"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            move(1);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            move(-1);
          }
        }}
      >
        {items.map((it) => (
          <div key={it.id}>
            {it.separatorBefore && <div className="menu-sep" role="separator" />}
            <button
              type="button"
              role="menuitem"
              className={cx('menu-item', it.danger && 'is-danger')}
              disabled={!!it.disabledReason}
              data-tooltip={it.disabledReason}
              onClick={() => {
                onClose();
                it.onSelect();
              }}
            >
              {it.icon && <span className="menu-icon"><Icon name={it.icon} /></span>}
              <span className="menu-label">
                {it.label}
                {/* Reason lives in the tooltip only (no duplicate visible text); screen readers still get it. */}
                {it.disabledReason && <span className="sr-only">. Unavailable: {it.disabledReason}</span>}
              </span>
            </button>
          </div>
        ))}
      </div>
    </Popover>
  );
}
