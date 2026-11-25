/**
 * Rentio UI kit — thin compositions of the shared primitives (Button, Dialog/Drawer,
 * StatusChip, InlineAlert, PageHeader) so every module screen looks and behaves alike.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../components/primitives/Button';
import { EmptyState, InlineAlert, StatusChip } from '../components/primitives/feedback';
import { Icon } from '../components/primitives/Icon';
import { Drawer, FormDialog } from '../components/primitives/overlay';
import { PageHeader } from '../components/shell/PageHeader';
import { hasCap, ractor, userName } from '../domain/rentio/access';
import { switchSession } from '../services/settings';
import { orderStatus, type OrderStatusCode } from '../domain/rentio/commerce';
import { ancestors, descendants, holdReasons, isExpired, lotHolds, stockRows } from '../domain/rentio/engine';
import { canReadLot, scopedMovements, scopedPositions } from '../domain/rentio/scope';
import type { Basis, Order, RentioState } from '../domain/rentio/types';
import { fmtKg, type Grams } from '../domain/rentio/units';
import { alertsFor, fmtLotQty } from '../domain/rentio/views';
import { cx } from '../lib/format';
import { wsBase } from '../lib/routes';
import type { Tone } from '../metadata/types';
import { type ActResult, newKey, useR } from './store';

// ---------------------------------------------------------------- time

const IST: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false };
export const fmtTime = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-IN', IST) : '—');
export const fmtDay = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '—');
/** ISO → value for <input type="datetime-local"> in IST. */
export const toLocalInput = (iso: string) => {
  const d = new Date(Date.parse(iso) + 330 * 60_000);
  return d.toISOString().slice(0, 16);
};
/** IST wall time → ISO. An empty/invalid entry is passed through so the service rejects it with a clear message. */
export const fromLocalInput = (v: string) => {
  const d = new Date(`${v}:00+05:30`);
  return Number.isNaN(d.getTime()) ? `invalid:${v}` : d.toISOString();
};

/**
 * Minute-precision picker → event instant. The picker cannot show seconds, but predecessor events
 * (an issue, a receipt) are stamped to the second. If the chosen minute CONTAINS the predecessor
 * instant, the event resolves to that instant — still not before it, so service ordering stays
 * strict and staff never have to wait for the next minute. An earlier minute is left as is and the
 * service refuses it.
 */
export const fromLocalInputAfter = (v: string, earliest?: string) => {
  const iso = fromLocalInput(v);
  if (!earliest || iso.startsWith('invalid')) return iso;
  const t = Date.parse(iso);
  const e = Date.parse(earliest);
  return e > t && e < t + 60_000 ? new Date(e).toISOString() : iso;
};

// ---------------------------------------------------------------- layout

export function RPage({ title, description, actions, children, intro }: { title: string; description: string; actions?: ReactNode; children: ReactNode; intro?: ReactNode }) {
  return (
    <div className="page rt-page">
      <PageHeader title={title} description={description} actions={actions} />
      {intro && <p className="rt-intro">{intro}</p>}
      <FocusTask />
      {children}
    </div>
  );
}

/**
 * Opened from an alert / My work link (?focus=<record>): state the exact next step, the named
 * responsible person and the status. Viewers who are not that person keep review-only access;
 * the demo hand-off switches to the responsible user, who then sees and performs the same task.
 */
export function FocusTask() {
  const focus = useFocusId();
  const { db, actor, now } = useR();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  if (!focus) return null;
  const a = alertsFor(db, actor, now).find((x) => x.sourceId === focus);
  if (!a) return null;
  const mine = a.ownerId === actor.id || hasCap(actor, a.actionCap);
  const handoff = () => {
    const next = ractor(a.ownerId);
    switchSession(a.ownerId, db.session.workspaceId);
    const parts = pathname.split('/');
    const key = `${parts[5]}/${parts[6] ?? ''}`;
    const here = hasCap(next, `page:${key}`);
    const target = hasCap(next, `page:${a.link.split('?')[0]}`) ? `${wsBase(db.session.workspaceId)}/${a.link}` : `${wsBase(db.session.workspaceId)}/home/my-work`;
    navigate(here ? `${pathname}${search}` : target, { replace: false });
  };
  return (
    <div className={cx('rt-next', !mine && 'is-delegated')} role="note" aria-label="Task for this record">
      <div>
        <div className="muted">{mine ? 'Your next action on this record' : 'Next action — delegated (you can review)'}</div>
        <div className="rt-next-title">{a.nextStep}</div>
        <div className="muted">
          Status: {a.title}
          {a.qty ? ` · ${a.qty}` : ''}
          {a.due ? ` · due ${fmtTime(a.due)}` : ''}
          {a.escalatedTo ? ` · overdue, escalated to ${userName(a.escalatedTo)}` : ''}
        </div>
      </div>
      {!mine && (
        <Button icon="users" onClick={handoff} title="Demo only: switches the simulated sign-in">
          Demo hand-off: continue as {userName(a.ownerId)}
        </Button>
      )}
    </div>
  );
}

export function Panel({ title, meta, actions, children, className, id }: { title: string; meta?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={cx('rt-panel', className)} aria-label={title} id={id}>
      <header className="rt-panel-head">
        <h2 className="rt-panel-title">{title}</h2>
        {meta && <span className="rt-panel-meta">{meta}</span>}
        <span className="spacer" />
        {actions && <div className="rt-panel-actions">{actions}</div>}
      </header>
      <div className="rt-panel-body">{children}</div>
    </section>
  );
}

export const Grid = ({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 }) => <div className={cx('rt-grid', `rt-cols-${cols}`)}>{children}</div>;

export function Kpi({ label, value, note, tone, to, testId }: { label: string; value: ReactNode; note?: ReactNode; tone?: Tone; to?: string; testId?: string }) {
  const body = (
    <>
      <span className="rt-kpi-label">{label}</span>
      <span className={cx('rt-kpi-value', tone && `tone-text-${tone}`)} data-testid={testId}>
        {value}
      </span>
      {note && <span className="rt-kpi-note">{note}</span>}
    </>
  );
  return to ? (
    <Link className="rt-kpi is-link" to={to}>
      {body}
    </Link>
  ) : (
    <div className="rt-kpi">{body}</div>
  );
}

export const KpiRow = ({ children }: { children: ReactNode }) => <div className="rt-kpis">{children}</div>;

export interface Col<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  num?: boolean;
  width?: number;
}

/** Highlight + scroll to the record a link pointed at (?focus=<id>). */
export function useFocusId(): string | undefined {
  const { search } = useLocation();
  return new URLSearchParams(search).get('focus') ?? undefined;
}

export function Table<T>({ cols, rows, rowKey, empty = 'Nothing to show.', caption, rowClass, focus }: { cols: Col<T>[]; rows: T[]; rowKey: (r: T) => string; empty?: string; caption?: string; rowClass?: (r: T) => string | undefined; /** record id to highlight and scroll to */ focus?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const hit = focus ? rows.some((r) => rowKey(r) === focus) : false;
  useEffect(() => {
    if (!hit) return;
    const el = wrap.current?.querySelector<HTMLElement>('tr.is-focus');
    el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    el?.focus?.({ preventScroll: true });
  }, [hit, focus]);
  if (!rows.length) return <p className="rt-empty">{empty}</p>;
  return (
    <div className="rt-table-wrap" ref={wrap}>
      <table className="rt-table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} className={cx(c.num && 'num')} style={c.width ? { width: c.width } : undefined} scope="col">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className={cx(rowClass?.(r), focus && rowKey(r) === focus && 'is-focus')} tabIndex={focus && rowKey(r) === focus ? -1 : undefined} aria-current={focus && rowKey(r) === focus ? 'true' : undefined}>
              {cols.map((c) => (
                <td key={c.key} className={cx(c.num && 'num')} data-label={c.label}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- quantity, basis, status

const BASIS_TONE: Record<Basis, Tone> = { Actual: 'success', Counted: 'info', Carried: 'warning' };
export const BasisChip = ({ basis }: { basis: Basis }) => <StatusChip label={basis} tone={BASIS_TONE[basis]} />;
export const Qty = ({ g, strong }: { g: Grams; strong?: boolean }) => <span className={cx('rt-qty', strong && 'is-strong')}>{fmtKg(g)}</span>;

const STATUS_TONE: Record<string, Tone> = {
  open: 'info',
  awaiting: 'warning',
  partial: 'danger',
  received: 'success',
  settled: 'neutral',
  running: 'info',
  on_hold: 'warning',
  completed: 'success',
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  credit_hold: 'danger',
  closed: 'neutral',
  cancelled: 'neutral',
  in_transit: 'info',
  disputed: 'danger',
  partially_received: 'warning',
  under_inspection: 'warning',
  accepted: 'success',
  partially_accepted: 'warning',
  queued: 'info',
  acknowledged: 'success',
  failed: 'danger',
  status_unknown: 'warning',
  reconciled: 'success',
  conflict: 'danger',
  resolved: 'success',
  provisional: 'warning',
  confirmed: 'success',
  active: 'danger',
  released: 'success',
  draft: 'neutral',
  authorized: 'success',
  ready: 'success',
  blocked: 'danger',
  'On Track': 'success',
  'At Risk': 'warning',
  Delayed: 'danger',
  'On Hold': 'warning',
  Completed: 'success',
  'Completed late': 'warning',
  critical: 'danger',
  high: 'danger',
  medium: 'warning',
  low: 'neutral',
  return_authorized: 'info',
  return_received: 'warning',
  replacement: 'info',
  pending_approval: 'warning',
  posted: 'success',
  matched: 'success',
  mismatch: 'danger',
  accepted_difference: 'warning',
};
export const Status = ({ s }: { s: string }) => <StatusChip label={s.replace(/_/g, ' ')} tone={STATUS_TONE[s] ?? 'neutral'} />;
const ORDER_TONE: Record<OrderStatusCode, Tone> = {
  cancelled: 'neutral',
  credit_hold: 'danger',
  advance: 'info',
  at_risk: 'danger',
  awaiting_stock: 'warning',
  partly_allocated: 'warning',
  ready_to_dispatch: 'info',
  in_transit: 'info',
  disputed: 'danger',
  partially_delivered: 'warning',
  delivered: 'success',
};

/** Physical fulfilment status of an order — the single derivation (no payment status is implied). */
export function OrderStatusChip({ order }: { order: Order }) {
  const { s, now } = useR();
  const rows = stockRows(s, now);
  const st = orderStatus(s, order, (lotId, loc) => !!rows.find((x) => x.lotId === lotId && x.loc === loc)?.sellable);
  return (
    <span data-tooltip={st.detail} data-status={st.code}>
      <StatusChip label={st.label} tone={ORDER_TONE[st.code]} />
    </span>
  );
}

export const Sim = ({ what = 'Simulated' }: { what?: string }) => (
  <span className="rt-sim" data-tooltip="No external system is contacted — prototype simulation">
    <Icon name="sparkles" size={12} /> {what}
  </span>
);
/** Long explanation shown as a short clipped line with the full text on hover/focus. */
export const Reason = ({ text, tone }: { text: string; tone?: 'warning' | 'danger' }) => (
  <span className={cx('rt-reason', tone && `tone-text-${tone}`)} data-tooltip={text} tabIndex={0}>
    {text}
  </span>
);
export const Ref = ({ children }: { children: ReactNode }) => <code className="rt-ref">{children}</code>;
export const Who = ({ id }: { id?: string }) => <span className="rt-who">{userName(id)}</span>;

/** Gate a control by capability; explains the restriction instead of hiding it. */
export function useCan() {
  const { actor } = useR();
  return (cap: string, what: string) => (hasCap(actor, cap) ? undefined : `${actor.roleLabel} cannot ${what}`);
}

export function PageLink({ to, children }: { to: string; children: ReactNode }) {
  const { db } = useR();
  return <Link to={`${wsBase(db.session.workspaceId)}/${to}`}>{children}</Link>;
}

// ---------------------------------------------------------------- action form

export type FieldSpec =
  | { key: string; label: string; type: 'number'; unit?: string; min?: number; step?: number; required?: boolean; help?: string }
  | { key: string; label: string; type: 'text' | 'textarea'; required?: boolean; help?: string; placeholder?: string }
  | { key: string; label: string; type: 'select'; options: { value: string; label: string }[]; required?: boolean; help?: string }
  | { key: string; label: string; type: 'datetime'; help?: string; /** ISO bounds; shown by the picker */ min?: string; max?: string }
  | { key: string; label: string; type: 'checkbox'; help?: string }
  | { key: string; label: string; type: 'readonly'; value: ReactNode; help?: string };

export type FormValues = Record<string, string | boolean>;

/**
 * One form → one business command. The idempotency key is fixed while the form is
 * open, so a double click or retry after an unknown outcome cannot post twice.
 */
export function ActionForm({
  open,
  onClose,
  title,
  fields,
  initial,
  submitLabel,
  onSubmit,
  note,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  fields: FieldSpec[];
  initial?: FormValues;
  submitLabel: string;
  onSubmit: (v: FormValues, key: string) => ActResult<unknown>;
  note?: ReactNode;
  children?: (v: FormValues, set: (k: string, val: string | boolean) => void) => ReactNode;
  wide?: boolean;
}) {
  const [values, setValues] = useState<FormValues>(initial ?? {});
  const [error, setError] = useState<string | null>(null);
  const key = useMemo(() => newKey(title), [open, title]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (open) {
      setValues(initial ?? {});
      setError(null);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: string, v: string | boolean) => setValues((x) => ({ ...x, [k]: v }));
  const missing = fields.filter((f) => 'required' in f && f.required && !String(values[f.key] ?? '').trim()).map((f) => f.label);
  const submit = () => {
    if (missing.length) return setError(`Required: ${missing.join(', ')}`);
    const r = onSubmit(values, key);
    if (r.ok) onClose();
    else setError(r.error ?? 'Not posted');
  };
  return (
    <FormDialog
      open={open}
      onClose={onClose}
      title={title}
      fieldCount={fields.length + (children ? 3 : 0)}
      wide={wide}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        className="rt-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {note && <div className="rt-form-note">{note}</div>}
        {fields.map((f) => (
          <FieldInput key={f.key} f={f} value={values[f.key]} onChange={(v) => set(f.key, v)} />
        ))}
        {children?.(values, set)}
        {error && (
          <InlineAlert tone="danger" title="Not posted — nothing changed">
            {error}
          </InlineAlert>
        )}
        <button type="submit" hidden />
      </form>
    </FormDialog>
  );
}

function FieldInput({ f, value, onChange }: { f: FieldSpec; value: string | boolean | undefined; onChange: (v: string | boolean) => void }) {
  const id = `rf-${f.key}`;
  const label = (
    <label className="field-label" htmlFor={id}>
      {f.label}
      {'required' in f && f.required && <span className="req"> *</span>}
      {'unit' in f && f.unit && <span className="optional"> ({f.unit})</span>}
    </label>
  );
  let input: ReactNode;
  switch (f.type) {
    case 'number':
      input = <input id={id} className="input" type="number" inputMode="decimal" min={f.min} step={f.step ?? 'any'} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'textarea':
      input = <textarea id={id} className="textarea input" rows={3} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'select':
      input = (
        <select id={id} className="input" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {f.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    case 'datetime':
      input = <input id={id} className="input" type="datetime-local" min={f.min ? toLocalInput(f.min) : undefined} max={f.max ? toLocalInput(f.max) : undefined} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'checkbox':
      return (
        <label className="rt-check">
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> {f.label}
          {f.help && <span className="field-help"> — {f.help}</span>}
        </label>
      );
    case 'readonly':
      input = <div className="field-readonly">{f.value}</div>;
      break;
    default:
      input = <input id={id} className="input" type="text" placeholder={'placeholder' in f ? f.placeholder : undefined} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <div className="form-field">
      {label}
      {input}
      {f.help && <span className="field-help">{f.help}</span>}
    </div>
  );
}

/** Button that opens an ActionForm; disabled with the genuine reason when the role cannot act. */
export function FormButton(props: Omit<Parameters<typeof ActionForm>[0], 'open' | 'onClose'> & { label: string; icon?: string; variant?: 'primary' | 'secondary' | 'ghost'; disabledReason?: string; /** open on mount (handoff links such as ?new=order) — never when the role cannot act */ defaultOpen?: boolean }) {
  const { label, icon, variant, disabledReason, defaultOpen, ...form } = props;
  const [open, setOpen] = useState(!!defaultOpen && !disabledReason);
  return (
    <>
      <Button variant={variant ?? 'secondary'} icon={icon} onClick={() => setOpen(true)} disabledReason={disabledReason}>
        {label}
      </Button>
      {open && <ActionForm {...form} open={open} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Numeric form value; a non-numeric entry reads as 0 (the service then refuses it) — never NaN in previews. */
export const num = (v: string | boolean | undefined) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
export const str = (v: string | boolean | undefined) => String(v ?? '').trim();

// ---------------------------------------------------------------- lot drawer (traceability)

export function LotLink({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="rt-lot" onClick={() => setOpen(true)} data-tooltip="Open lot genealogy and movements">
        {id}
      </button>
      {open && <LotDrawer id={id} onClose={() => setOpen(false)} />}
    </>
  );
}

export function LotDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { s, now, actor } = useR();
  const lot = s.lots[id];
  // read scope: a lot outside your stages/locations/partners is not revealed (not even its existence)
  if (!lot || !canReadLot(s, actor, id))
    return (
      <Drawer open onClose={onClose} title={id}>
        <EmptyState title="Not available">This lot is not in your area of work, or does not exist.</EmptyState>
      </Drawer>
    );
  const here = scopedPositions(s, actor, id);
  const mv = scopedMovements(s, actor, id);
  const holds = lotHolds(s, id);
  const anc = ancestors(s, id);
  const desc = descendants(s, id).filter((d) => canReadLot(s, actor, d));
  const where = (loc?: string) => (loc ? s.locations[loc]?.label ?? loc : 'outside the network');
  return (
    <Drawer open onClose={onClose} title={`Lot ${id}`} wide>
      <div className="rt-stack">
        <dl className="rt-dl">
          <dt>Material</dt>
          <dd>
            {lot.label}
            {lot.grade ? ` · grade ${lot.grade}` : ''}
          </dd>
          <dt>Origin</dt>
          <dd>{lot.rootId === id ? 'Origin lot' : lot.rootId}</dd>
          {lot.bags ? (
            <>
              <dt>Packing</dt>
              <dd>
                {lot.bags} bags × {fmtKg(lot.bagSize ?? 0)} · packed {lot.mfgDate} · best before {lot.expiry}
              </dd>
            </>
          ) : null}
          <dt>Next step</dt>
          <dd>{lot.nextStage ? `${lot.nextStage}${(lot.pass ?? 1) > 1 ? ` (pass ${lot.pass})` : ''}` : '—'}</dd>
          <dt>Created</dt>
          <dd>
            {fmtTime(lot.createdAt)} by {userName(lot.createdBy)}
          </dd>
        </dl>
        {holds.length > 0 && (
          <InlineAlert tone="warning" title="On hold — cannot be used for normal orders">
            {holds.map((h) => `${h.reason}${h.target !== id ? ` (hold on parent ${h.target})` : ''}`).join(' · ')}
          </InlineAlert>
        )}
        <h3 className="rt-h3">Where it is now</h3>
        <Table
          cols={[
            { key: 'loc', label: 'Location', render: (r) => s.locations[r.loc]?.label ?? r.loc },
            { key: 'qty', label: 'Quantity', num: true, render: (r) => fmtLotQty(lot, r.qty) },
            { key: 'el', label: 'Condition', render: (r) => { const h = holdReasons(s, id, r.loc); return h.length ? <Reason tone="warning" text={h[0]} /> : isExpired(s, id, now) ? 'Expired' : 'Good'; } },
          ]}
          rows={here}
          rowKey={(r) => r.loc}
          empty="Nothing of this lot is in your area now."
        />
        <Details summary={`Genealogy · ${lot.parents.length} parent(s), ${desc.length} visible descendant(s)`}>
          <p className="muted">
            Parents: {lot.parents.length ? lot.parents.map((p) => `${p.lotId} (${fmtKg(p.qty)})`).join(', ') : 'none — origin lot'}
            <br />
            Ancestors: {anc.join(', ') || '—'}
            <br />
            Descendants: {desc.join(', ') || '—'}
          </p>
        </Details>
        <Details summary={`Movement history (${mv.length})`}>
          <Table
            cols={[
              { key: 'at', label: 'When (IST)', render: (m) => fmtTime(m.at) },
              { key: 'kind', label: 'Movement', render: (m) => m.kind },
              { key: 'from', label: 'From', render: (m) => where(m.from) },
              { key: 'to', label: 'To', render: (m) => where(m.to) },
              { key: 'q', label: 'Qty', num: true, render: (m) => fmtLotQty(lot, m.qty) },
              { key: 'b', label: 'Basis', render: (m) => <BasisChip basis={m.basis} /> },
              { key: 'by', label: 'By', render: (m) => userName(m.actorId) },
            ]}
            rows={mv}
            rowKey={(m) => m.id}
          />
        </Details>
      </div>
    </Drawer>
  );
}

/** Progressive detail: secondary information collapsed by default. */
export function Details({ summary, children, open }: { summary: ReactNode; children: ReactNode; open?: boolean }) {
  return (
    <details className="rt-details" open={open}>
      <summary>{summary}</summary>
      <div className="rt-details-body">{children}</div>
    </details>
  );
}

/** Requirement IDs and demo mechanics live here, not in normal operational copy. */
export function ImplNote({ children }: { children: ReactNode }) {
  return (
    <details className="rt-details rt-impl">
      <summary>Implementation details</summary>
      <div className="rt-details-body muted">{children}</div>
    </details>
  );
}

/** Finish-time display: never presents an unsupported estimate as a promise. */
export function Eta({ t }: { t: { forecastFinish?: string; etaSource: string; etaRevision?: { by: string; reason: string }; baselineFinish: string; actualFinish?: string } }) {
  if (t.etaSource === 'actual') return <span>Finished {fmtTime(t.actualFinish)}</span>;
  if (t.etaSource === 'needs_update') return <StatusChip label="ETA needs update" tone="danger" />;
  if (t.etaSource === 'revised') return <span data-tooltip={`Revised by ${userName(t.etaRevision?.by)}: ${t.etaRevision?.reason}`}>{fmtTime(t.forecastFinish)} <span className="muted">(revised by {userName(t.etaRevision?.by)})</span></span>;
  if (t.etaSource === 'hold-adjusted') return <span>{fmtTime(t.forecastFinish)} <span className="muted">(plan + hold time)</span></span>;
  return <span>{fmtTime(t.forecastFinish)}</span>;
}

/** Receive → Start → Output → Issue with done / current / pending distinct (not by colour alone). */
export function Steps({ steps }: { steps: { label: string; state: 'done' | 'current' | 'pending'; note?: string }[] }) {
  return (
    <ol className="rt-stepper" aria-label="Progress">
      {steps.map((x, i) => (
        <li key={x.label} className={cx('rt-stepper-item', `is-${x.state}`)} aria-current={x.state === 'current' ? 'step' : undefined}>
          <span className="rt-stepper-dot" aria-hidden="true">{x.state === 'done' ? '✓' : i + 1}</span>
          <span className="rt-stepper-label">
            {x.label}
            <span className="sr-only"> — {x.state === 'done' ? 'done' : x.state === 'current' ? 'next' : 'not yet'}</span>
            {x.note && <span className="rt-stepper-note">{x.note}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

export const kgOpts = (s: RentioState, filter: (id: string) => boolean) =>
  Object.values(s.lots)
    .filter((l) => filter(l.id))
    .map((l) => ({ value: l.id, label: `${l.id} — ${l.label}` }));
