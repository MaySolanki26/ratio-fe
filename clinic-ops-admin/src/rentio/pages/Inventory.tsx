import { useState } from 'react';
import { InlineAlert } from '../../components/primitives/feedback';
import { userName } from '../../domain/rentio/access';
import type { StockRow } from '../../domain/rentio/engine';
import { canReadLoc, readScope, scopedMovements, scopedStockRows } from '../../domain/rentio/scope';
import { fmtKg } from '../../domain/rentio/units';
import { bucketOf, fmtLotQty, stockSummary, type Bucket } from '../../domain/rentio/views';
import { useR } from '../store';
import { InventoryGraphics } from './_graphA';
import { wsBase } from '../../lib/routes';
import { Details, ImplNote, Kpi, KpiRow, LotLink, Panel, Qty, Reason, RPage, Status, Table, fmtTime, useFocusId } from '../ui';

const BUCKETS: { id: Bucket; label: string }[] = [
  { id: 'intake', label: 'At the gate (awaiting check)' },
  { id: 'raw', label: 'Raw godown' },
  { id: 'wip', label: 'In process' },
  { id: 'pending', label: 'Being handed over' },
  { id: 'finished', label: 'Finished goods' },
  { id: 'byproduct', label: 'Husk & Churi' },
  { id: 'quarantine', label: 'Quarantine / rejects' },
  { id: 'transit', label: 'In transit' },
  { id: 'distributor', label: 'Distributors' },
  { id: 'stores', label: 'Stores' },
];

/** Condition text — genuine holds only; normal raw/WIP/transit is never "held". */
export function Condition({ r }: { r: StockRow }) {
  if (r.held) return <Reason tone="warning" text={r.holds[0]} />;
  if (r.expired) return <Reason tone="danger" text="Expired — blocked from orders" />;
  if (r.readyToProcess) return <span>Ready to process</span>;
  if (r.sellable) return <span>Good</span>;
  if (r.location?.kind === 'transit') return <span className="muted">In transit</span>;
  if (r.location?.kind === 'pending') return <span className="muted">Awaiting receipt</span>;
  return <span className="muted">In process</span>;
}

export default function Inventory() {
  const { s, db, now, actor } = useR();
  const focus = useFocusId();
  const [bucket, setBucket] = useState<'' | Bucket>('');
  const [q, setQ] = useState('');
  const sc = readScope(actor);
  const all = scopedStockRows(s, actor, now);
  const sum = stockSummary(s, now, (r) => canReadLoc(s, actor, r.loc, sc));
  const needle = q.trim().toLowerCase();
  const rows = all
    .filter((r) => r.loc !== 'STORES')
    .filter((r) => !bucket || bucketOf(r) === bucket)
    .filter((r) => !needle || `${r.lotId} ${r.lot.label} ${r.lot.grade ?? ''} ${r.location?.label ?? r.loc}`.toLowerCase().includes(needle))
    .sort((a, b) => bucketOf(a).localeCompare(bucketOf(b)) || (a.lot.grade ?? '').localeCompare(b.lot.grade ?? '') || (a.lot.expiry ?? '9').localeCompare(b.lot.expiry ?? '9') || a.loc.localeCompare(b.loc));
  const stores = all.filter((r) => r.loc === 'STORES');
  // a link may point at a lot id (first matching row) or an exact position
  const focusKey = focus ? (rows.find((r) => `${r.lotId}|${r.loc}` === focus) ? focus : rows.find((r) => r.lotId === focus) ? `${rows.find((r) => r.lotId === focus)!.lotId}|${rows.find((r) => r.lotId === focus)!.loc}` : undefined) : undefined;
  const focusMissing = !!focus && !all.some((r) => r.lotId === focus || `${r.lotId}|${r.loc}` === focus);
  const totals = BUCKETS.filter((b) => b.id !== 'stores' && sum[b.id].physical > 0).map((b) => ({ ...b, t: sum[b.id] }));
  const storeMoves = (lotId: string) => scopedMovements(s, actor, lotId).filter((m) => m.kind === 'addition' || m.kind === 'pack-material').reduce((a, m) => a + m.qty, 0);
  const failures = sc.all ? s.failures : s.failures.filter((f) => f.actorId === actor.id);

  return (
    <RPage title="Stock by lot" description="Every lot position in your area with condition, reservation and what is available." intro={`Showing: ${sc.label}.`}>
      {focusMissing && <InlineAlert tone="warning">That record is not in your area or no longer open.</InlineAlert>}
      <KpiRow>
        {totals.map((b) => (
          <Kpi
            key={b.id}
            label={b.label}
            value={fmtKg(b.t.physical)}
            note={
              b.id === 'raw' || b.id === 'wip'
                ? `ready to process ${fmtKg(b.t.readyToProcess)}${b.t.held ? ` · on hold ${fmtKg(b.t.held)}` : ''}`
                : b.id === 'finished' || b.id === 'distributor' || b.id === 'byproduct'
                  ? `available to sell ${fmtKg(b.t.available)} · reserved ${fmtKg(b.t.reserved)}${b.t.held ? ` · on hold ${fmtKg(b.t.held)}` : ''}${b.t.bags ? ` · ${b.t.bags} bags` : ''}`
                  : `${b.t.lots} lot(s)`
            }
            tone={b.t.held || b.t.expired ? 'warning' : undefined}
          />
        ))}
      </KpiRow>

      <InventoryGraphics s={s} actor={actor} now={now} base={wsBase(db.session.workspaceId)} rows={all} buckets={BUCKETS} bucketOf={bucketOf} />

      <Panel
        title="Positions"
        meta={`${rows.length} shown`}
        actions={
          <div className="rt-row">
            <select className="input" aria-label="Filter by where the stock is" value={bucket} onChange={(e) => setBucket(e.target.value as Bucket | '')}>
              <option value="">Everywhere</option>
              {BUCKETS.filter((b) => b.id !== 'stores').map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
            <input className="input" type="search" placeholder="Search lot, grade, location" aria-label="Search positions" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        }
      >
        <Table
          cols={[
            { key: 'lot', label: 'Lot', render: (r) => <LotLink id={r.lotId} /> },
            { key: 'g', label: 'Grade', render: (r) => r.lot.grade ?? '—' },
            { key: 'loc', label: 'Location', render: (r) => r.location?.label ?? r.loc },
            { key: 'p', label: 'Quantity', num: true, render: (r) => (<>{fmtLotQty(r.lot, r.qty)}{r.lot.bagSize ? <span className="muted"> · {Math.floor(r.qty / r.lot.bagSize)} bags</span> : null}</>) },
            { key: 'c', label: 'Condition', render: (r) => <Condition r={r} /> },
            { key: 'r', label: 'Reserved', num: true, render: (r) => (r.reserved ? fmtKg(r.reserved) : '—') },
            { key: 'a', label: 'Available to sell', num: true, render: (r) => (r.sellable ? <Qty g={r.available} strong /> : '—') },
            { key: 'x', label: 'Best before', render: (r) => r.lot.expiry ?? '—' },
          ]}
          rows={rows}
          rowKey={(r) => `${r.lotId}|${r.loc}`}
          rowClass={(r) => (r.held || r.expired ? 'is-held' : undefined)}
          focus={focusKey}
          empty="No stock matches."
        />
      </Panel>

      <Details summary={`Stores — oil and packaging (${stores.length})`}>
        <Table
          cols={[
            { key: 'lot', label: 'Item lot', render: (r) => <LotLink id={r.lotId} /> },
            { key: 'l', label: 'Item', render: (r) => r.lot.label },
            { key: 'q', label: 'On hand', num: true, render: (r) => fmtLotQty(r.lot, r.qty) },
            { key: 'used', label: 'Used in production', num: true, render: (r) => fmtLotQty(r.lot, storeMoves(r.lotId)) },
          ]}
          rows={stores}
          rowKey={(r) => r.lotId}
          empty="No stores in your area."
        />
      </Details>

      <Details summary={`Blocked attempts (${failures.length})`}>
        <Table
          cols={[
            { key: 'at', label: 'When', render: (f) => fmtTime(f.at) },
            { key: 'who', label: 'User', render: (f) => userName(f.actorId) },
            { key: 'a', label: 'Action', render: (f) => f.action },
            { key: 'c', label: 'Rule', render: (f) => <Status s={f.code} /> },
            { key: 'r', label: 'Reason', render: (f) => <Reason text={f.reason} /> },
          ]}
          rows={failures.slice(0, 30)}
          rowKey={(f) => f.id}
          empty="No blocked attempts."
        />
      </Details>

      <ImplNote>
        Inventory (M6). Physical quantity, condition (genuine holds/expiry) and reservation are independent dimensions (FR-031, FR-038); they overlap and are not added together. Available to sell = sellable physical − active reservations (BR-019). Rows sorted FEFO within grade (FR-032). Stores: FR-034; packaging never added to food weight (BR-028). Visibility follows the read scope in scope.ts (§20).
      </ImplNote>
    </RPage>
  );
}
