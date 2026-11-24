import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { ColumnState, FieldAccess, FieldDefinition, RecordData, ResourceDefinition } from '../../metadata/types';
import { cx } from '../../lib/format';
import type { Actor } from '../../services/authz';
import { Button, IconButton } from '../primitives/Button';
import { Icon } from '../primitives/Icon';
import { InfoTip } from '../primitives/InfoTip';
import { MultiSelectMenu } from '../primitives/MultiSelectMenu';
import { Popover, type MenuItem } from '../primitives/overlay';
import { DataGrid } from './DataGrid';
import { GridFooter, PAGE_SIZES } from './GridFooter';

/**
 * Owner rule 66: every list in the product — records AND admin lists (roles, audit log, event trace,
 * configuration values, registry, tokens…) — is the SAME DataGrid. `ListGrid` adapts plain rows to it:
 * column definitions in → sorting, column drag / pin / hide, selection, truncation tooltips and the sticky
 * Actions column come from the shared grid. Custom cells (links, code, inputs) go through `renderCell`.
 */
export interface ListColumn {
  key: string;
  label: string;
  type?: FieldDefinition['type'];
  width?: number;
  /** Default true for read-only lists; set false for columns holding controls. */
  sortable?: boolean;
}

export function listResource(key: string, label: string, labelPlural: string, columns: ListColumn[]): ResourceDefinition {
  return {
    id: `res_${key}`,
    key,
    module: 'admin',
    label,
    labelPlural,
    icon: 'list',
    version: 1,
    idPrefix: key.toUpperCase(),
    titleField: columns[0].key,
    subtitleFields: [],
    fields: columns.map((c) => ({ id: `fld_${key}_${c.key}`, key: c.key, label: c.label, type: c.type ?? 'text', width: c.width, capabilities: { list: true, sort: c.sortable !== false, search: true } })),
    relationships: [],
    form: { sections: [], quickCreate: [] },
    views: [],
    description: '',
    status: 'published',
  } as unknown as ResourceDefinition;
}

export function ListGrid({
  resKey,
  label,
  labelPlural,
  columns,
  rows,
  actor,
  onOpen,
  onEdit,
  editBlockedReason,
  viewBlockedReason,
  rowMenu,
  renderCell,
  rowActions,
  highlight,
  selectable = false,
}: {
  resKey: string;
  label: string;
  labelPlural: string;
  columns: ListColumn[];
  rows: RecordData[];
  actor: Actor;
  onOpen?: (id: string) => void;
  onEdit?: (id: string) => void;
  editBlockedReason?: (r: RecordData) => string | undefined;
  viewBlockedReason?: (r: RecordData) => string | undefined;
  rowMenu?: (r: RecordData) => MenuItem[];
  renderCell?: (key: string, r: RecordData) => ReactNode | undefined;
  rowActions?: { view?: boolean; edit?: boolean };
  /** search text to highlight in the rows */
  highlight?: string;
  /** checkboxes only when the list has bulk actions (owner rule 83) */
  selectable?: boolean;
}) {
  const res = useMemo(() => listResource(resKey, label, labelPlural, columns), [resKey, label, labelPlural, columns]);
  const access = useMemo(() => Object.fromEntries(columns.map((c) => [c.key, 'view'])) as Record<string, FieldAccess>, [columns]);
  const [cols, setCols] = useState<ColumnState[]>(() => columns.map((c) => ({ key: c.key, width: c.width })));
  const [sort, setSort] = useState<{ field: string; dir: 'asc' | 'desc' }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const sk = sort[0];
  const shown = sk ? [...rows].sort((x, y) => (sk.dir === 'asc' ? 1 : -1) * String(x[sk.field] ?? '').localeCompare(String(y[sk.field] ?? ''), undefined, { numeric: true })) : rows;
  // same footer + paging as the record lists (owner rule 78)
  const pageCount = Math.max(1, Math.ceil(shown.length / pageSize));
  const cur = Math.min(page, pageCount - 1);
  const pageRows = shown.slice(cur * pageSize, cur * pageSize + pageSize);
  return (
    <div className="content-surface is-table list-grid">
      <DataGrid
        res={res}
        actor={actor}
        rows={pageRows}
        columns={cols}
        onColumnsChange={setCols}
        sort={sort}
        onSortChange={setSort}
        density="comfortable"
        selected={selected}
        onSelectedChange={setSelected}
        onOpen={onOpen ?? (() => {})}
        onEdit={onEdit ?? (() => {})}
        fieldAccess={access}
        editBlockedReason={editBlockedReason ?? (() => 'Read-only')}
        viewBlockedReason={viewBlockedReason}
        rowMenu={rowMenu ?? (() => [])}
        renderCell={renderCell}
        rowActions={rowActions ?? { view: !!onOpen, edit: !!onEdit }}
        highlight={highlight}
        selectable={selectable}
      />
      <GridFooter page={cur} pageCount={pageCount} pageSize={pageSize} total={shown.length} noun={(shown.length === 1 ? label : labelPlural).toLowerCase()} onPage={setPage} onSize={(n) => (setPageSize(n), setPage(0))} />
    </div>
  );
}

// ---------------------------------------------------------------- list toolbar + filters

export interface ListFilter {
  key: string;
  label: string;
  icon: string;
  options: { value: string; label: string }[];
}

/** Filters popover for plain lists — same look as the record lists' Filters (rows · Clear all · Apply). */
export function ListFilterButton({ filters, values, onChange }: { filters: ListFilter[]; values: Record<string, string[]>; onChange: (v: Record<string, string[]>) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(values);
  const ref = useRef<HTMLButtonElement>(null);
  const activeCount = Object.values(values).filter((v) => v.length).length;
  const active = activeCount > 0;
  return (
    <>
      {/* icon-only at the right end of the list toolbar (owner rule 89); badge = fields filtered */}
      <IconButton
        ref={ref}
        icon="filter"
        label={active ? `Filters (${activeCount} active)` : 'Filters'}
        badge={activeCount}
        pressed={open}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cx('tools-icon-btn', open && 'is-open')}
        onClick={() => {
          setDraft(values);
          setOpen((o) => !o);
        }}
      />
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} label="Filters" width={380} className="filter-pop" align="end">
        <div className="qf qf-rows">
          <div className="qf-title">
            <Icon name="filter" size={16} />
            <strong>Filter</strong>
          </div>
          {filters.map((f) => (
            <div key={f.key} className="qf-field">
              <span className="qf-label">
                <Icon name={f.icon} size={16} className="qf-icon" />
                {f.label}
              </span>
              <MultiSelectMenu block label={f.label} emptyLabel="All" values={draft[f.key] ?? []} options={f.options} onChange={(vs) => setDraft((d) => ({ ...d, [f.key]: vs }))} />
            </div>
          ))}
        </div>
        <div className="qf-foot">
          <Button
            variant="ghost"
            className="qf-clear"
            onClick={() => {
              onChange({});
              setOpen(false);
            }}
          >
            Clear all
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onChange(draft);
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
      </Popover>
    </>
  );
}

/** First row of a plain list page: search · Filters (left) … count · ⓘ · actions (right) — 48px, rule 61. */
export function ListToolbar({ search, onSearch, placeholder = 'Search', filter, count, info, actions }: { search: string; onSearch: (v: string) => void; placeholder?: string; filter?: ReactNode; count?: string; info?: string; actions?: ReactNode }) {
  return (
    <div className="list-toolbar">
      <div className="search-field">
        <Icon name="search" size={14} className="search-icon" />
        <input type="search" className="input input-compact" placeholder={placeholder} aria-label={placeholder} value={search} onChange={(e) => onSearch(e.target.value)} />
      </div>
      <span className="spacer" />
      {count && <span className="toolbar-count muted">{count}</span>}
      {info && <InfoTip text={info} label="About this list" />}
      {actions}
      {filter}
    </div>
  );
}

/** Apply ListFilter selections to rows. */
export const applyListFilters = (rows: RecordData[], values: Record<string, string[]>) => rows.filter((r) => Object.entries(values).every(([k, vs]) => !vs.length || vs.includes(String(r[k]))));
