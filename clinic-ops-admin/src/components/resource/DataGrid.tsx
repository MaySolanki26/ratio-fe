import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import type { ColumnState, FieldAccess, FieldDefinition, RecordData, ResourceDefinition } from '../../metadata/types';
import { cx, formatMoney } from '../../lib/format';
import { PHONE, useMedia } from '../../lib/useMedia';
import { type Actor, canUpdateRecord, fieldAccessMap } from '../../services/authz';
import { getDb } from '../../services/db';
import { displayText, recordTitle, updateRecord } from '../../services/runtime';
import { ServiceError } from '../../services/types';
import { masterLabel, masterValue } from '../../services/registry';
import { IconButton } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { useToast } from '../primitives/feedback';
import { Menu, type MenuItem } from '../primitives/overlay';
import { FieldInput } from './FormFields';
import { FieldValue } from './FieldValue';
import { EmptyValue } from '../primitives/display';
import { ImageTile } from '../primitives/People';
import { isEmpty } from '../../services/validation';
import { isDragClick } from '../../lib/dragGuard';

export const INLINE_TYPES = new Set(['text', 'number', 'money', 'master', 'date', 'relation', 'multimaster', 'url']);
/** Row action icons (view, edit, more): column width fits exactly this many 30px icons. */
const ROW_ACTION_ICONS = 3;
const ACTIONS_W = ROW_ACTION_ICONS * 30 + (ROW_ACTION_ICONS - 1) * 2 + 16;
const DEFAULT_W = 150;
const CHIP_COL_W = 200;
/**
 * Virtualization rule: when a flat, one-line table renders more than this many rows, only the rows in
 * (and just around) the viewport are in the DOM; spacer rows keep the scroll height exact.
 */
export const VIRTUAL_THRESHOLD = 100;
const VIRTUAL_OVERSCAN = 12;

export interface GridProps {
  res: ResourceDefinition;
  actor: Actor;
  rows: RecordData[];
  columns: ColumnState[];
  onColumnsChange: (c: ColumnState[]) => void;
  sort: { field: string; dir: 'asc' | 'desc' }[];
  onSortChange: (s: { field: string; dir: 'asc' | 'desc' }[]) => void;
  density: 'compact' | 'comfortable';
  /** Lines per row (1–3): extra lines come from each field's `subFields`. */
  rowLines?: 1 | 2 | 3;
  groupBy?: string;
  selected: Set<string>;
  onSelectedChange: (s: Set<string>) => void;
  activeId?: string;
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  rowMenu: (r: RecordData) => MenuItem[];
  /**
   * Non-record lists (roles, teams, templates…) reuse the SAME grid (owner rule 65): pass the field access
   * directly and say per row why it cannot be edited (undefined = editable).
   */
  fieldAccess?: Record<string, FieldAccess>;
  editBlockedReason?: (r: RecordData) => string | undefined;
  /** Custom cell content for a column (links, code, two-line cells, inline inputs…); undefined = the normal typed cell. */
  renderCell?: (key: string, r: RecordData) => ReactNode | undefined;
  /** Hide the 👁 / ✎ row icons where they mean nothing (the ⋯ menu always stays). */
  rowActions?: { view?: boolean; edit?: boolean };
  /** Why 👁 is unavailable for a row (e.g. an audit entry without a record). */
  viewBlockedReason?: (r: RecordData) => string | undefined;
  /** Search text to highlight in the rows (owner rule 80). */
  highlight?: string;
  /** Show the row-selection checkboxes (default true). Lists without bulk actions hide them (owner rule 83). */
  selectable?: boolean;
}

export function DataGrid(props: GridProps) {
  const phone = useMedia(PHONE);
  const ref = useRef<HTMLDivElement>(null);
  useSearchHighlight(ref, props.highlight, props.rows);
  return (
    <div ref={ref} className="grid-host">
      {phone ? <CardList {...props} /> : <Table {...props} />}
    </div>
  );
}

/**
 * Marks every match of the search text inside the rows with the CSS Custom Highlight API — no extra markup,
 * so cell layout, truncation and inline editors stay exactly as they are. Browsers without it simply skip it.
 */
function useSearchHighlight(ref: RefObject<HTMLElement>, text: string | undefined, rows: unknown) {
  useEffect(() => {
    const reg = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
    const HL = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    const root = ref.current;
    const q = text?.trim().toLowerCase();
    if (!reg || !HL || !root) return;
    if (!q) {
      reg.delete('grid-search');
      return;
    }
    const ranges: Range[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement?.closest('tbody, .card-list') && !n.parentElement.closest('input, textarea, button.icon-btn') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = (n.nodeValue ?? '').toLowerCase();
      for (let i = t.indexOf(q); i >= 0; i = t.indexOf(q, i + q.length)) {
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + q.length);
        ranges.push(r);
      }
    }
    reg.set('grid-search', new HL(...ranges));
    return () => void reg.delete('grid-search');
  });
  void rows;
}

/** Row title: record types use the registry; non-record lists (roles…) use their title field. */
const titleOf = (res: ResourceDefinition, r: RecordData, actor: Actor) => (getDb().records[res.key] ? recordTitle(res.key, r.id, actor) : String(r[res.titleField] ?? r.id));

function colLabel(res: ResourceDefinition, key: string) {
  return key === 'id' ? 'ID' : res.fields.find((f) => f.key === key)?.label ?? key;
}

function Table({ res, actor, rows, columns, onColumnsChange, sort, onSortChange, density, rowLines = 1, groupBy, selected, onSelectedChange, activeId, onOpen, onEdit, rowMenu, fieldAccess, editBlockedReason, renderCell, rowActions, viewBlockedReason, selectable = true }: GridProps) {
  // width of the checkbox column (0 when the list has no bulk actions)
  const SEL = selectable ? 40 : 0;
  const access = useMemo(() => fieldAccess ?? fieldAccessMap(actor, res), [actor, res, fieldAccess]);
  const visible = columns.filter((c) => !c.hidden && (c.key === 'id' || (access[c.key] && access[c.key] !== 'hide')));
  const pinL = (c: ColumnState) => c.pinned === true || c.pinned === 'left';
  const pinR = (c: ColumnState) => c.pinned === 'right';
  const ordered = [...visible.filter(pinL), ...visible.filter((c) => !c.pinned), ...visible.filter(pinR)];
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [colMenu, setColMenu] = useState<string | null>(null);
  const colMenuAnchor = useRef<HTMLElement | null>(null);
  const setPin = (key: string, pin: ColumnState['pinned']) => onColumnsChange(columns.map((x) => (x.key === key ? { ...x, pinned: pin } : x)));
  const moveCol = (from: string, to: string) => {
    if (from === to) return;
    const next = columns.filter((x) => x.key !== from);
    const i = next.findIndex((x) => x.key === to);
    next.splice(i < 0 ? next.length : i, 0, columns.find((x) => x.key === from)!);
    onColumnsChange(next);
  };
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string; key: string } | null>(null);
  const [menu, setMenu] = useState<{ row: RecordData } | null>(null);
  const menuAnchor = useRef<HTMLElement | null>(null);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  // Shadow before the sticky Actions column only while more columns are hidden behind it.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [moreRight, setMoreRight] = useState(false);
  const [wrapW, setWrapW] = useState(0);
  const measureRight = () => {
    const el = wrapRef.current;
    if (!el) return;
    setMoreRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    setWrapW((w) => (Math.abs(w - el.clientWidth) > 1 ? el.clientWidth : w));
  };
  useLayoutEffect(() => {
    measureRight();
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measureRight);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [columns, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const masterDetail = res.fields.some((f) => f.type === 'lineitems' && access[f.key] !== 'hide' && access[f.key] !== 'mask');

  // Pinned column offsets (sticky left after the select column).
  // Configured widths are minimums. When the table has spare room, share it across the data
  // columns in proportion to their width (Actions/checkbox keep their fixed size).
  // choice (chip) columns are wide enough for the longest chip + its always-visible caret (owner rule 68)
  const baseW = (c: ColumnState) => {
    const w = c.width ?? fieldWidth(res, c.key);
    return res.fields.find((x) => x.key === c.key)?.type === 'master' ? Math.max(w, CHIP_COL_W) : w;
  };
  const fixedW = SEL + (masterDetail ? 32 : 0) + ACTIONS_W;
  const dataW = ordered.reduce((sum, c) => sum + baseW(c), 0);
  const scale = wrapW && dataW ? Math.max(1, (wrapW - fixedW) / dataW) : 1;
  const widths = new Map(ordered.map((c) => [c.key, Math.floor(baseW(c) * scale)]));
  if (scale > 1 && ordered.length) {
    // Last data column absorbs rounding so Actions sits exactly at the right edge.
    const used = [...widths.values()].reduce((a, b) => a + b, 0);
    const last = ordered[ordered.length - 1].key;
    widths.set(last, widths.get(last)! + Math.max(0, Math.floor(wrapW - fixedW - used)));
  }
  const colW = (c: ColumnState) => widths.get(c.key) ?? baseW(c);
  const offsets: Record<string, number> = {};
  let acc = SEL + (masterDetail ? 32 : 0);
  ordered.forEach((c) => {
    if (pinL(c)) {
      offsets[c.key] = acc;
      acc += colW(c);
    }
  });
  // right-pinned columns stick before the Actions column
  const rightOffsets: Record<string, number> = {};
  let accR = ACTIONS_W;
  [...ordered].reverse().forEach((c) => {
    if (pinR(c)) {
      rightOffsets[c.key] = accR;
      accR += colW(c);
    }
  });
  const stickStyle = (c: ColumnState) => (pinL(c) ? { left: offsets[c.key] } : pinR(c) ? { right: rightOffsets[c.key] } : {});
  const stickClass = (c: ColumnState) => (pinL(c) ? 'sticky-left' : pinR(c) ? 'sticky-right pinned-right' : undefined);

  const groups = useMemo(() => {
    if (!groupBy) return [{ key: '', label: '', rows }];
    const f = res.fields.find((x) => x.key === groupBy);
    const map = new Map<string, RecordData[]>();
    rows.forEach((r) => {
      const label = f ? displayText(f, r[groupBy], actor) || 'Not set' : 'Not set';
      map.set(label, [...(map.get(label) ?? []), r]);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, rs]) => ({ key: label, label, rows: rs }));
  }, [rows, groupBy, res, actor]);

  // ---- virtualization (flat one-line tables with many rows)
  const virtual = !groupBy && rowLines === 1 && expanded.size === 0 && rows.length > VIRTUAL_THRESHOLD;
  const [scroll, setScroll] = useState({ top: 0, height: 800 });
  const [rowPx, setRowPx] = useState(density === 'compact' ? 35 : 41);
  useLayoutEffect(() => {
    if (!virtual) return;
    const el = wrapRef.current;
    if (el && Math.abs(el.clientHeight - scroll.height) > 1) setScroll({ top: el.scrollTop, height: el.clientHeight });
    const tr = tbodyRef.current?.querySelector<HTMLTableRowElement>('tr[data-row]');
    if (tr && tr.offsetHeight > 0 && Math.abs(tr.offsetHeight - rowPx) > 0.5) setRowPx(tr.offsetHeight);
  });
  const vStart = virtual ? Math.max(0, Math.floor(scroll.top / rowPx) - VIRTUAL_OVERSCAN) : 0;
  const vEnd = virtual ? Math.min(rows.length, Math.ceil((scroll.top + scroll.height) / rowPx) + VIRTUAL_OVERSCAN) : rows.length;

  const sortedKey = sort[0]?.field;
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSelected = rows.some((r) => selected.has(r.id));

  const toggleSort = (key: string) => {
    const cur = sort.find((s) => s.field === key);
    if (!cur) onSortChange([{ field: key, dir: 'asc' }]);
    else if (cur.dir === 'asc') onSortChange([{ field: key, dir: 'desc' }]);
    else onSortChange([]);
  };

  const startResize = (key: string, startX: number, startW: number) => {
    const move = (e: PointerEvent) => {
      const w = Math.max(80, Math.min(520, startW + (e.clientX - startX) / pageZoom()));
      onColumnsChange(columns.map((c) => (c.key === key ? { ...c, width: w } : c)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onRowKey = (e: ReactKeyboardEvent<HTMLTableRowElement>, r: RecordData) => {
    if (e.target !== e.currentTarget) return;
    const rowsEls = Array.from(tbodyRef.current?.querySelectorAll<HTMLTableRowElement>('tr[data-row]') ?? []);
    const i = rowsEls.indexOf(e.currentTarget);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      rowsEls[i + 1]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      rowsEls[i - 1]?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onOpen(r.id);
    } else if (e.key === ' ') {
      e.preventDefault();
      toggle(r.id);
    }
  };

  const toggle = (id: string) => {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    onSelectedChange(n);
  };

  return (
    <div
      ref={wrapRef}
      onScroll={(e) => {
        measureRight();
        if (virtual) setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight });
      }}
      data-virtual={virtual || undefined}
      className={cx('grid-wrap', density === 'compact' ? 'density-compact' : 'density-comfortable', rowLines > 1 && `rows-${rowLines}`, moreRight && 'has-more-right')}>
      <table className={cx('grid', !selectable && 'no-select')} aria-label={`${res.labelPlural} table`} aria-rowcount={rows.length + 1}>
        <thead>
          <tr>
            {selectable && (
              <th className="col-select sticky-left" style={{ left: 0 }} scope="col">
                <input
                  type="checkbox"
                  aria-label="Select all rows on this page"
                  checked={allSelected}
                  ref={(el) => el && (el.indeterminate = !allSelected && someSelected)}
                  onChange={() => onSelectedChange(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                />
              </th>
            )}
            {masterDetail && (
              <th className="col-expand sticky-left" style={{ left: SEL }} scope="col">
                <span className="sr-only">Expand</span>
              </th>
            )}
            {ordered.map((c) => {
              const s = sort.find((x) => x.field === c.key);
              const w = colW(c);
              const f = res.fields.find((x) => x.key === c.key);
              const sortable = c.key === 'id' || (f?.capabilities.sort && access[c.key] !== 'mask');
              return (
                <th
                  key={c.key}
                  scope="col"
                  style={{ width: w, minWidth: w, maxWidth: w, ...stickStyle(c) }}
                  className={cx(stickClass(c), f && ['money', 'number'].includes(f.type) && 'th-num', s && 'is-sorted', c === ordered[ordered.length - 1] && 'is-last', dragKey === c.key && 'is-dragging', dropKey === c.key && dragKey !== c.key && 'is-drop-target')}
                  aria-sort={s ? (s.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  // drag a column title to reorder columns
                  draggable
                  onDragStart={(e) => {
                    setDragKey(c.key);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', c.key);
                  }}
                  onDragOver={(e) => {
                    if (!dragKey) return;
                    e.preventDefault();
                    setDropKey(c.key);
                  }}
                  onDragLeave={() => setDropKey((k) => (k === c.key ? null : k))}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragKey) moveCol(dragKey, c.key);
                    setDragKey(null);
                    setDropKey(null);
                  }}
                  onDragEnd={() => {
                    setDragKey(null);
                    setDropKey(null);
                  }}
                >
                  {sortable ? (
                    <button type="button" className="th-btn" onClick={() => toggleSort(c.key)}>
                      <span className="th-label" data-tooltip={f?.type === 'money' ? `${colLabel(res, c.key)} · amounts in ${f.currency ?? 'USD'}` : undefined}>
                        {colLabel(res, c.key)}
                      </span>
                      <Icon name={s ? (s.dir === 'asc' ? 'arrow-up' : 'arrow-down') : 'chevrons-up-down'} size={12} className={cx(!s && 'th-sort-idle')} />
                      {/* column-type icon on the RIGHT end of the title cell (owner rule) */}
                      <Icon name={fieldIcon(f)} size={14} className="th-type th-type-right" />
                    </button>
                  ) : (
                    <span className="th-label th-static">
                      {colLabel(res, c.key)}
                      {access[c.key] === 'mask' && <Icon name="lock" size={12} className="muted" />}
                      <Icon name={fieldIcon(f)} size={14} className="th-type th-type-right" />
                    </span>
                  )}
                  <button
                    type="button"
                    className="th-menu"
                    aria-label={`${colLabel(res, c.key)} column options`}
                    aria-haspopup="menu"
                    onClick={(e) => {
                      e.stopPropagation();
                      colMenuAnchor.current = e.currentTarget;
                      setColMenu((m) => (m === c.key ? null : c.key));
                    }}
                  >
                    <Icon name="chevron-down" size={12} />
                  </button>
                  <span
                    draggable={false}
                    onDragStart={(e) => e.preventDefault()}
                    className="col-resize"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Resize ${colLabel(res, c.key)} column`}
                    aria-valuenow={w}
                    tabIndex={0}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      startResize(c.key, e.clientX, baseW(c));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                        e.preventDefault();
                        const nw = Math.max(80, Math.min(520, baseW(c) + (e.key === 'ArrowRight' ? 16 : -16)));
                        onColumnsChange(columns.map((x) => (x.key === c.key ? { ...x, width: nw } : x)));
                      }
                    }}
                  />
                </th>
              );
            })}
            <th className="col-actions sticky-right" scope="col" style={{ width: ACTIONS_W, minWidth: ACTIONS_W, maxWidth: ACTIONS_W }}>
              Actions
            </th>
          </tr>
        </thead>
        <tbody ref={tbodyRef}>
          {groups.map((g) => (
            <Fragment key={g.key || 'all'}>
              {groupBy && (
                <tr className="group-row">
                  <td colSpan={ordered.length + 1 + (selectable ? 1 : 0) + (masterDetail ? 1 : 0)}>
                    <button
                      type="button"
                      className="group-toggle"
                      aria-expanded={!collapsed.has(g.key)}
                      onClick={() => {
                        const n = new Set(collapsed);
                        if (n.has(g.key)) n.delete(g.key);
                        else n.add(g.key);
                        setCollapsed(n);
                      }}
                    >
                      <Icon name={collapsed.has(g.key) ? 'chevron-right' : 'chevron-down'} size={14} />
                      <strong>{g.label}</strong>
                      <span className="muted">{g.rows.length}</span>
                    </button>
                  </td>
                </tr>
              )}
              {virtual && vStart > 0 && (
                <tr className="virtual-spacer" aria-hidden="true" style={{ height: vStart * rowPx }}>
                  <td colSpan={ordered.length + 1 + (selectable ? 1 : 0) + (masterDetail ? 1 : 0)} />
                </tr>
              )}
              {!collapsed.has(g.key) &&
                (virtual ? g.rows.slice(vStart, vEnd) : g.rows).map((r) => {
                  const isOpen = expanded.has(r.id);
                  const raw = getDb().records[res.key]?.find((x) => x.id === r.id);
                  const blocked = editBlockedReason ? editBlockedReason(r) : !raw || !canUpdateRecord(actor, res, raw) ? 'Read-only for your role' : undefined;
                  const rowCanEdit = !blocked;
                  return (
                    <Fragment key={r.id}>
                      <tr
                        data-row
                        tabIndex={0}
                        className={cx(selected.has(r.id) && 'is-selected', activeId === r.id && 'is-active')}
                        aria-selected={selected.has(r.id)}
                        onKeyDown={(e) => onRowKey(e, r)}
                        // selecting / copying text in a row must not open the record
                        onClick={(e) => {
                          if (isDragClick(e)) return;
                          onOpen(r.id);
                        }}
                      >
                        {selectable && (
                          <td className="col-select sticky-left" style={{ left: 0 }} onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" aria-label={`Select ${titleOf(res, r, actor)}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                          </td>
                        )}
                        {masterDetail && (
                          <td className="col-expand sticky-left" style={{ left: SEL }} onClick={(e) => e.stopPropagation()}>
                            <IconButton
                              icon={isOpen ? 'chevron-down' : 'chevron-right'}
                              label={isOpen ? 'Collapse details' : 'Expand line items'}
                              aria-expanded={isOpen}
                              onClick={() => {
                                const n = new Set(expanded);
                                if (n.has(r.id)) n.delete(r.id);
                                else n.add(r.id);
                                setExpanded(n);
                              }}
                            />
                          </td>
                        )}
                        {ordered.map((c) => {
                          const f = res.fields.find((x) => x.key === c.key);
                          const w = colW(c);
                          const isEditing = editing?.id === r.id && editing.key === c.key;
                          const inline = !!f && rowCanEdit && access[c.key] === 'edit' && INLINE_TYPES.has(f.type) && !f.visibleWhen && !f.relation?.filterBy && rowLines === 1; // 2/3-line tables are read-only in place — edit through the form (rule 67)
                          return (
                            <td
                              key={c.key}
                              style={{ width: w, minWidth: w, maxWidth: w, ...stickStyle(c) }}
                              className={cx(stickClass(c), f && ['money', 'number'].includes(f.type) && 'td-num', sortedKey === c.key && 'is-sorted', inline && 'is-editable', inline && f?.type === 'master' && 'is-choice', inline && f?.type === 'master' && ['status', 'priority', 'urgency'].includes(f.key) && 'is-status-choice', isEditing && 'is-editing')}
                              // ClickUp-style: hovering an editable cell outlines it; a single click edits it in place
                              onClick={(e) => {
                                if (isDragClick(e)) {
                                  e.stopPropagation();
                                  return;
                                }
                                if (!inline || isEditing) return;
                                e.stopPropagation();
                                setEditing({ id: r.id, key: c.key });
                              }}
                            >
                              {isEditing && f ? (
                                <InlineEditor res={res} actor={actor} field={f} record={r} onDone={() => setEditing(null)} />
                              ) : c.key === 'id' ? (
                                <IdCell id={r.id} onOpen={() => onOpen(r.id)} />
                              ) : f ? (
                                <span className="cell">
                                  {renderCell?.(c.key, r) ?? <RichCell res={res} actor={actor} field={f} record={r} access={access} lines={rowLines} />}
                                  {inline && (
                                    <button
                                      type="button"
                                      className={cx('cell-edit', ['master', 'relation', 'multimaster'].includes(f.type) && 'is-caret')}
                                      aria-label={`Edit ${f.label}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setEditing({ id: r.id, key: c.key });
                                      }}
                                    >
                                      <Icon name={f && ['master', 'relation', 'multimaster'].includes(f.type) ? 'chevron-down' : 'pencil'} size={14} />
                                    </button>
                                  )}
                                </span>
                              ) : null}
                            </td>
                          );
                        })}
                        <td className="col-actions sticky-right" style={{ width: ACTIONS_W, minWidth: ACTIONS_W, maxWidth: ACTIONS_W }} onClick={(e) => e.stopPropagation()}>
                          <span className="row-actions">
                            {rowActions?.view !== false && <IconButton icon="eye" label={`View ${titleOf(res, r, actor)}`} onClick={() => onOpen(r.id)} disabledReason={viewBlockedReason?.(r)} />}
                            {rowActions?.edit !== false && <IconButton icon="pencil" label={`Edit ${titleOf(res, r, actor)}`} onClick={() => onEdit(r.id)} disabledReason={blocked} />}
                            <IconButton
                              icon="more"
                              label={`More actions for ${r.id}`}
                              aria-haspopup="menu"
                              onClick={(e) => {
                                menuAnchor.current = e.currentTarget;
                                setMenu((m) => (m?.row.id === r.id ? null : { row: r })); // click again closes
                              }}
                            />
                          </span>
                        </td>
                      </tr>
                      {isOpen && masterDetail && (
                        <tr className="detail-row-expanded">
                          <td colSpan={ordered.length + 2 + (selectable ? 1 : 0)}>
                            <div className="detail-card" style={wrapW ? { width: Math.max(320, wrapW - 56 - ACTIONS_W - 12) } : undefined}>
                              <LineItemsSummary record={r} title={`${res.label} line items`} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              {virtual && vEnd < rows.length && (
                <tr className="virtual-spacer" aria-hidden="true" style={{ height: (rows.length - vEnd) * rowPx }}>
                  <td colSpan={ordered.length + 1 + (selectable ? 1 : 0) + (masterDetail ? 1 : 0)} />
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      {menu && <Menu open onClose={() => setMenu(null)} anchor={menuAnchor} label={`Actions for ${menu.row.id}`} items={rowMenu(menu.row)} />}
      {colMenu && (
        <Menu
          open
          onClose={() => setColMenu(null)}
          anchor={colMenuAnchor}
          label={`${colLabel(res, colMenu)} column`}
          items={(() => {
            const c = columns.find((x) => x.key === colMenu)!;
            return [
              { id: 'pl', label: 'Pin left', icon: 'pin', onSelect: () => setPin(colMenu, 'left'), disabledReason: pinL(c) ? 'Already pinned left' : undefined },
              { id: 'pr', label: 'Pin right', icon: 'pin', onSelect: () => setPin(colMenu, 'right'), disabledReason: pinR(c) ? 'Already pinned right' : undefined },
              ...(c.pinned ? [{ id: 'un', label: 'Unpin', icon: 'pin-off', onSelect: () => setPin(colMenu, false) }] : []),
              { id: 'hide', label: 'Hide column', icon: 'eye-off', separatorBefore: true, onSelect: () => onColumnsChange(columns.map((x) => (x.key === colMenu ? { ...x, hidden: true } : x))) },
            ];
          })()}
        />
      )}
    </div>
  );
}

/** Record ID as a visible hyperlink (opens the record) + a copy button pinned to the cell's right edge. */
function IdCell({ id, onOpen }: { id: string; onOpen: () => void }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <span className="id-cell">
      <button
        type="button"
        className="id-link mono"
        onClick={(e) => {
          e.stopPropagation();
          if (isDragClick(e)) return; // selecting the ID to copy it never opens the record
          onOpen();
        }}
      >
        {id}
      </button>
      <button
        type="button"
        className={cx('cell-trail', copied && 'is-copied')}
        aria-label={copied ? `${id} copied` : `Copy ${id}`}
        data-tooltip={copied ? 'Copied' : 'Copy ID'}
        onClick={(e) => {
          e.stopPropagation();
          navigator.clipboard?.writeText(id).catch(() => {}); // clipboard may be blocked — never crash
          toast(`${id} copied`, 'success');
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }}
      >
        <Icon name={copied ? 'check' : 'copy'} size={14} />
      </button>
    </span>
  );
}

export { fieldIcon } from './fieldIcon';
import { fieldIcon } from './fieldIcon';
import { pageZoom } from '../../lib/zoom';

/**
 * Cell content for every row style: optional leading picture (image field or initials tile), the value,
 * and — in two-/three-line rows — the field's `subFields` as muted lines 2 and 3 (permission-aware).
 */
function RichCell({ res, actor, field, record, access, lines }: { res: ResourceDefinition; actor: Actor; field: FieldDefinition; record: RecordData; access: Record<string, FieldAccess>; lines: number }) {
  const main = <FieldValue field={field} value={record[field.key]} access={access[field.key]} actor={actor} rich={lines > 1} />;
  const subs = lines > 1 ? (field.subFields ?? []).slice(0, lines - 1).map((k) => res.fields.find((x) => x.key === k)).filter((x): x is FieldDefinition => !!x && !!access[x.key] && access[x.key] !== 'hide' && !isEmpty(record[x.key])) : []; // empty lines are skipped, never "N/A"
  let leading: ReactNode = null;
  if (field.leadingImage && lines >= (field.leadingImageMinLines ?? 2)) {
    const size = lines >= 3 ? 40 : lines === 2 ? 32 : 24;
    const name = String(record[field.key] ?? record.id);
    const src = field.leadingImage === 'initials' || access[field.leadingImage] === 'hide' ? null : ((record[field.leadingImage] as string | null) ?? null);
    leading = <ImageTile src={src} name={name} size={size} />;
  }
  if (!leading && !subs.length) return main;
  return (
    <span className="cell-rich">
      {leading}
      <span className="cell-lines">
        <span className="cell-line cell-line-1">{main}</span>
        {subs.map((sf) => (
          <span key={sf.key} className="cell-line cell-line-sub">
            {sf.type === 'master' && access[sf.key] !== 'mask' ? (
              // owner rule 63: no chips (and no dots) inside 2/3-line cells — plain secondary text
              <span className="cell-sub-text">{masterValue(sf.master!, record[sf.key])?.label ?? String(record[sf.key])}</span>
            ) : (
              <FieldValue field={sf} value={record[sf.key]} access={access[sf.key]} actor={actor} linkRelations={false} />
            )}
          </span>
        ))}
      </span>
    </span>
  );
}

/** Expanded row (master–detail): a plain numbered table — no card, no title line. */
function LineItemsSummary({ record, title }: { record: RecordData; title: string }) {
  const items = (record.lineItems as { serviceCode: string; description?: string; qty: number; unitPrice: number }[] | undefined) ?? [];
  const total = items.reduce((t, li) => t + li.qty * li.unitPrice, 0);
  return (
    <div className="detail-items">
      {/* Owner rule: no title line above the expanded table (screen readers still get the caption).
      <div className="detail-items-head">
        <strong className="detail-items-title">{title}</strong>
        <span className="muted">
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </span>
      </div> */}
      <table className="mini-table detail-items-table">
        <caption className="sr-only">
          {title} for {record.id}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="col-n">
              #
            </th>
            <th scope="col">Service</th>
            <th scope="col">Description</th>
            <th scope="col">Qty</th>
            <th scope="col">Unit price</th>
            <th scope="col">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((li, i) => (
            <tr key={i}>
              <td className="col-n">{i + 1}</td>
              <td>{masterLabel('serviceCode', li.serviceCode)}</td>
              <td>{li.description || <EmptyValue />}</td>
              <td>{li.qty}</td>
              <td>{formatMoney(li.unitPrice)}</td>
              <td>{formatMoney(li.qty * li.unitPrice)}</td>
            </tr>
          ))}
        </tbody>
        {items.length > 1 && (
          <tfoot>
            <tr>
              <td colSpan={5} className="detail-items-total-label">
                Total
              </td>
              <td className="detail-items-total">{formatMoney(total)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export function InlineEditor({ res, actor, field, record, onDone }: { res: ResourceDefinition; actor: Actor; field: FieldDefinition; record: RecordData; onDone: () => void }) {
  const [value, setValue] = useState<unknown>(record[field.key]);
  const [error, setError] = useState('');
  const toast = useToast();
  const saving = useRef(false);
  const latest = useRef<unknown>(record[field.key]);
  latest.current = value;
  const save = (v: unknown = value) => {
    if (saving.current) return;
    if (JSON.stringify(v ?? null) === JSON.stringify(record[field.key] ?? null)) return onDone();
    saving.current = true;
    try {
      updateRecord(actor, res.key, record.id, { [field.key]: v }, record.version);
      toast(`${record.id}: ${field.label} updated`);
      onDone();
    } catch (e) {
      const msg = e instanceof ServiceError ? e.fieldErrors?.[field.key] ?? e.message : 'Save failed';
      setError(msg);
      toast(msg, 'danger');
      saving.current = false;
    }
  };
  // One click: the cell click opened the editor — open its dropdown / calendar (or focus the input) right away
  const boxRef = useRef<HTMLDivElement>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  // open exactly once (React StrictMode runs effects twice — a second click would close the calendar again)
  const autoOpened = useRef(false);
  useLayoutEffect(() => {
    if (autoOpened.current) return;
    autoOpened.current = true;
    const el = boxRef.current;
    const trigger = el?.querySelector<HTMLElement>('.select-menu-trigger, .date-trigger');
    if (trigger) trigger.click();
    else el?.querySelector<HTMLInputElement>('input')?.focus();
    if (!trigger || typeof MutationObserver === 'undefined') return;
    // closing the list / calendar without a change (Esc, click outside) returns the cell to normal (owner rule 75)
    const mo = new MutationObserver(() => {
      if (trigger.getAttribute('aria-expanded') === 'false') setTimeout(() => !saving.current && saveRef.current(latest.current), 0);
    });
    mo.observe(trigger, { attributes: true, attributeFilter: ['aria-expanded'] });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // every chip value (incl. status / priority / urgency pills) keeps its exact look while its list is open
  const chipEdit = field.type === 'master' || field.type === 'multimaster';
  return (
    <div
      ref={boxRef}
      className={cx('inline-editor', chipEdit && 'is-chip-edit', field.type === 'master' && `is-pill tone-${masterValue(field.master!, value)?.tone ?? 'neutral'}`, field.type === 'master' && ['status', 'priority', 'urgency'].includes(field.key) && 'is-status', (field.type === 'relation' || field.type === 'date') && 'is-pill-plain')}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onDone();
        if (e.key === 'Enter') save();
      }}
      onBlur={(e) => {
        const to = e.relatedTarget as Element | null;
        // Focus moving into the dropdown's floating list is not "leaving" the editor.
        if (e.currentTarget.contains(to) || to?.closest?.('.popover')) return;
        save();
      }}
    >
      <FieldInput
        field={field}
        value={value}
        onChange={(v) => {
          setValue(v);
          // Picking from a dropdown commits immediately.
          if (field.type === 'master' || field.type === 'relation') save(v);
        }}
        values={{ ...record, [field.key]: value }}
        actor={actor}
        id={`inline-${record.id}-${field.key}`}
        invalid={!!error}
        compact
        // chip-style masters keep the exact chip while their list is open (owner rule 80)
        renderValue={chipEdit ? (v) => <FieldValue field={field} value={Array.isArray(v) ? (v.length ? v : undefined) : v || undefined} access="view" actor={actor} linkRelations={false} /> : undefined}
      />
      {error && <span className="sr-only">{error}</span>}
    </div>
  );
}

/** Responsive / mobile row variant: deliberate card list instead of a squeezed table. */
function CardList({ res, actor, rows, onOpen, activeId, columns, selected, onSelectedChange, fieldAccess, selectable = true }: GridProps) {
  const access = fieldAccess ?? fieldAccessMap(actor, res);
  const extra = columns.filter((c) => !c.hidden && c.key !== res.titleField && c.key !== 'id' && access[c.key] && access[c.key] !== 'hide').slice(0, 3);
  return (
    <ul className="card-list" aria-label={`${res.labelPlural} list`}>
      {rows.map((r) => (
        <li key={r.id} className={cx('card-row', activeId === r.id && 'is-active')}>
          {selectable && (
            <input
              type="checkbox"
              aria-label={`Select ${r.id}`}
              checked={selected.has(r.id)}
              onChange={() => {
                const n = new Set(selected);
                if (n.has(r.id)) n.delete(r.id);
                else n.add(r.id);
                onSelectedChange(n);
              }}
            />
          )}
          <button type="button" className="card-main" onClick={() => onOpen(r.id)}>
            <span className="card-title">{titleOf(res, r, actor)}</span>
            <span className="card-meta mono">{r.id}</span>
            <span className="card-fields">
              {extra.map((c) => {
                const f = res.fields.find((x) => x.key === c.key)!;
                return (
                  <span key={c.key} className="card-field">
                    <span className="muted">{f.label}: </span>
                    <FieldValue field={f} value={r[c.key]} access={access[c.key]} actor={actor} linkRelations={false} />
                  </span>
                );
              })}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function fieldWidth(res: ResourceDefinition, key: string) {
  if (key === 'id') return 132; // ID link + copy button fit without truncating (e.g. INV-1098)
  const f = res.fields.find((x) => x.key === key);
  if (!f) return DEFAULT_W;
  if (f.width) return f.width;
  if (f.type === 'date') return 140;
  if (f.type === 'email') return 330; // whole masked email + icons fit
  if (f.type === 'phone') return 220; // calendar icon + "19 Oct, 2026"
  if (f.type === 'money' || f.type === 'number') return 120;
  if (f.type === 'datetime') return 170;
  return DEFAULT_W;
}
