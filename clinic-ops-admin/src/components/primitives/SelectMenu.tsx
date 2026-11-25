import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../../lib/format';
import { Icon } from './Icon';
import { ImageTile } from './People';
import { Popover } from './overlay';

export interface SelectMenuOption<T extends string | number> {
  value: T;
  label: string;
  disabled?: boolean;
  /** Optional colour dot before the label (master values with a meaning colour). */
  tone?: string;
  /** Person options: avatar (photo or initials) before the name. */
  avatar?: { name: string; src?: string | null };
}

/**
 * THE dropdown for the whole project (owner rule: no native <select>).
 * Trigger button + listbox popover; flips up near the bottom; selected option = accent tint + ✓.
 * Keyboard: Enter/Space/↑/↓ open, ↑/↓ move, Enter selects, Esc closes, typing jumps (or searches
 * when the list is long). `block` = full-width form control; otherwise compact toolbar size.
 */
export function SelectMenu<T extends string | number>({
  value,
  options,
  onChange,
  label,
  id,
  placeholder = 'Select…',
  disabled,
  invalid,
  describedBy,
  block,
  className,
  searchable,
  icon,
  renderValue,
}: {
  /** Draw the trigger's value yourself (inline chip editors show the very same chip while the list is open). */
  renderValue?: (value: T | '' | null | undefined) => ReactNode;
  /** Optional leading icon inside the trigger (shown in full-page forms). */
  icon?: string;
  value: T | '' | null | undefined;
  options: SelectMenuOption<T>[];
  onChange: (v: T) => void;
  /** Accessible name (also used when no visible <label htmlFor>). */
  label: string;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  block?: boolean;
  className?: string;
  /** Show a search box; defaults to on for lists longer than 8. */
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [q, setQ] = useState('');
  // two-option switch: the new value eases in instead of jumping (owner rule 92) — counts real switches only
  const [swaps, setSwaps] = useState(0);
  const [prevValue, setPrevValue] = useState<T | '' | null | undefined>(undefined);
  const [rolling, setRolling] = useState(false);
  // forward through the options (One → Two) rolls UP; back (Two → One) rolls DOWN
  const [rollDir, setRollDir] = useState<'up' | 'down'>('up');
  const trigger = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value);
  const withSearch = searchable ?? options.length > 8;
  // Owner rule 55: exactly two choices and one is set → a click simply switches to the other (no list to open)
  const other = options.length === 2 && current && options.every((o) => !o.disabled) ? options.find((o) => o.value !== value) : undefined;
  const shown = useMemo(() => (q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options), [q, options]);

  const openMenu = () => {
    if (disabled) return;
    setQ('');
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const choose = (o: SelectMenuOption<T> | undefined) => {
    if (!o || o.disabled) return;
    onChange(o.value);
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);

  // what the trigger shows for a value: avatar / tone dot / icon + label (or the caller's own rendering)
  const face = (v: T | '' | null | undefined) => {
    if (renderValue) return renderValue(v);
    const o = options.find((x) => x.value === v);
    return (
      <>
        {o?.avatar ? <ImageTile src={o.avatar.src} name={o.avatar.name} size={20} shape="circle" /> : o?.tone ? <span className={cx('opt-dot', `tone-${o.tone}`)} aria-hidden="true" /> : icon && <Icon name={icon} size={14} className="trigger-icon" />}
        <span className="select-menu-value">{o?.label ?? placeholder}</span>
      </>
    );
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(shown.length - 1, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' || (e.key === ' ' && !withSearch)) {
      e.preventDefault();
      choose(shown[active]);
    } else if (e.key === 'Tab') {
      setOpen(false);
    } else if (!withSearch && e.key.length === 1) {
      const i = shown.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      if (i >= 0) setActive(i);
    }
  };

  return (
    <>
      <button
        ref={trigger}
        id={id}
        type="button"
        className={cx('select-menu-trigger', block && 'is-block', open && 'is-open', !current && 'is-placeholder', className)}
        aria-haspopup="listbox"
        data-value={value == null ? '' : String(value)}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${label}: ${current?.label ?? placeholder}${other ? ` (click to switch to ${other.label})` : ''}`}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        onClick={() => {
          if (open) return setOpen(false);
          if (other) {
            setPrevValue(value);
            setRollDir(options.findIndex((o) => o.value === other.value) > options.findIndex((o) => o.value === value) ? 'up' : 'down');
            setRolling(true);
            setSwaps((n) => n + 1);
            return onChange(other.value);
          }
          openMenu();
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            openMenu();
          }
        }}
      >
        {/* two-value switch rolls: the old value slides up and out, the new one rises in from below — no fade (owner rule 94) */}
        <span className="sm-roll">
          {rolling && (
            <span key={`out-${swaps}`} className={`select-menu-face sm-roll-out is-${rollDir}`} aria-hidden="true" onAnimationEnd={() => setRolling(false)}>
              {face(prevValue)}
            </span>
          )}
          <span key={swaps} className={cx('select-menu-face', swaps > 0 && `sm-roll-in is-${rollDir}`)}>
            {face(value)}
          </span>
        </span>
        <Icon name="chevron-down" size={14} className="trigger-caret" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={trigger} label={label} align="start" className="select-menu-pop" maxWidth={block ? Math.max(240, trigger.current?.offsetWidth ?? 0) : undefined}>
        {withSearch && (
          <input
            className="input input-compact select-menu-search"
            placeholder="Search…"
            aria-label={`Search ${label}`}
            value={q}
            data-autofocus
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
          />
        )}
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
          tabIndex={withSearch ? -1 : 0}
          data-autofocus={withSearch ? undefined : true}
          className="select-menu-list"
          onKeyDown={onKey}
        >
          {shown.map((o, i) => (
            <li
              key={String(o.value)}
              id={`${listId}-${i}`}
              data-index={i}
              data-value={String(o.value)}
              role="option"
              aria-selected={o.value === value}
              aria-disabled={o.disabled || undefined}
              className={cx('select-menu-option', o.value === value && 'is-selected', i === active && 'is-active', o.disabled && 'is-disabled')}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(o)}
            >
              <span className="select-menu-label">
                {o.tone && <span className={cx("opt-dot", `tone-${o.tone}`)} aria-hidden="true" />}
                {o.avatar && <ImageTile src={o.avatar.src} name={o.avatar.name} size={20} shape="circle" />}
                {o.label}
              </span>
              {o.value === value && <Icon name="check" size={14} />}
            </li>
          ))}
          {!shown.length && <li className="select-menu-empty muted">No matches</li>}
        </ul>
      </Popover>
    </>
  );
}
