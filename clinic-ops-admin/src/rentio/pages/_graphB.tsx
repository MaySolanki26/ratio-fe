/**
 * Graphical views for distribution, sales, finance and home pages (graphics fork B).
 * Every figure is computed from the scoped rows/derivations the page already shows — callers pass data
 * that is already read-scoped; nothing here reads unscoped stock for display.
 */
import type { RActor } from '../../domain/rentio/access';
import * as C from '../../domain/rentio/commerce';
import { tripProgress } from '../../domain/rentio/delivery';
import { computePositions, type StockRow } from '../../domain/rentio/engine';
import { scopedShipments } from '../../domain/rentio/scope';
import type { Complaint, Order, RentioState, Shipment, Trip } from '../../domain/rentio/types';
import { fmtINR, fmtKg, type Grams, sum } from '../../domain/rentio/units';
import type { Alert } from '../../domain/rentio/views';
import { CAT, ChartGrid, FlowChain, type FlowNode, type Seg, ShareStrip, StackBars, STATUS } from '../graphics';

const count = (n: number) => String(Math.round(n));
const shipQty = (sh: Shipment) => sum(sh.lines.map((l) => l.qty));

// ---------------------------------------------------------------- orders

/** Exclusive fulfilment buckets of factory order lines (sum = ordered quantity). */
const ORDER_SEGS: Seg[] = [
  { key: 'delivered', label: 'Received by distributor', color: STATUS.good },
  { key: 'road', label: 'On the road', color: STATUS.info },
  { key: 'settled', label: 'Short / returned (settled)', color: STATUS.warn, pattern: true },
  { key: 'reserved', label: 'Reserved in godown', color: CAT[4] },
  { key: 'open', label: 'Not yet reserved', color: STATUS.faint },
  { key: 'cancelled', label: 'Cancelled', color: STATUS.muted, pattern: true },
];

function orderBuckets(s: RentioState, o: Order) {
  const v = { delivered: 0, road: 0, settled: 0, reserved: 0, open: 0, cancelled: 0 };
  for (const l of o.lines) {
    const b = C.lineBalance(s, o, l);
    v.delivered += b.delivered;
    v.road += b.inTransit;
    v.settled += Math.max(0, b.dispatched - b.inTransit - b.delivered);
    v.reserved += b.reserved;
    v.open += b.unallocated;
    v.cancelled += b.cancelled;
  }
  return v;
}

export function OrderCharts({ s, orders, order, base, focus, rows, shipments, only }: { s: RentioState; orders: Order[]; order?: Order; base: string; focus?: string; rows: StockRow[]; shipments: Shipment[]; /** render just one graphic (page layouts place them separately) */ only?: 'pipeline' | 'fulfilment' }) {
  const barRows = orders.map((o) => ({
    id: o.id,
    label: `${o.id} · ${o.partyId}`,
    text: `${o.id} for ${o.partyId} (${o.lines.map((l) => l.grade).join('/')})`,
    to: `${base}/distribution/orders?focus=${o.id}`,
    values: orderBuckets(s, o),
    note: o.status === 'credit_hold' ? 'credit hold' : o.advance ? 'advance booking — no stock reserved' : undefined,
  }));
  if (only === 'pipeline') return order ? <OrderPipeline s={s} order={order} rows={rows} shipments={shipments} /> : null;
  const fulfilment = <StackBars title="Fulfilment by order" caption="kg per order · each bar = ordered quantity, split into exclusive stages" segs={ORDER_SEGS} rows={barRows} rowHeader="Order" focus={focus ?? order?.id} empty="No factory orders in your area." />;
  if (only === 'fulfilment') return fulfilment;
  return (
    <ChartGrid>
      {order ? <OrderPipeline s={s} order={order} rows={rows} shipments={shipments} /> : <span />}
      <StackBars title="Fulfilment by order" caption="kg per order · each bar = ordered quantity, split into exclusive stages" segs={ORDER_SEGS} rows={barRows} rowHeader="Order" focus={focus ?? order?.id} empty="No factory orders in your area." />
    </ChartGrid>
  );
}

function OrderPipeline({ s, order, rows, shipments }: { s: RentioState; order: Order; rows: StockRow[]; shipments: Shipment[] }) {
  const b = orderBuckets(s, order);
  const ordered = sum(order.lines.map((l) => l.qty));
  const dispatched = sum(order.lines.map((l) => C.lineBalance(s, order, l).dispatched));
  const ships = shipments.filter((sh) => sh.orderId === order.id);
  const damaged = sum(ships.map((sh) => sh.receipt?.damaged ?? 0));
  const short = sum(ships.map((sh) => sh.receipt?.short ?? 0));
  const atRisk = s.reservations.some((r) => r.orderId === order.id && r.status === 'active' && rows.some((x) => x.lotId === r.lotId && x.loc === r.location && !x.sellable));
  const nodes: FlowNode[] = [
    {
      key: 'ordered',
      label: 'Ordered',
      value: fmtKg(ordered),
      magnitude: ordered,
      sub: `${order.lines.map((l) => l.grade).join(' / ')} · ${order.partyId}`,
      status: order.status === 'credit_hold' ? { label: 'Credit hold', tone: 'bad' } : order.advance ? { label: 'Advance booking', tone: 'muted' } : { label: 'Approved', tone: 'good' },
      exits: b.cancelled ? [{ label: 'Cancelled', value: fmtKg(b.cancelled) }] : undefined,
      done: true,
    },
    {
      key: 'reserved',
      label: 'Reserved in godown',
      value: fmtKg(b.reserved),
      magnitude: b.reserved,
      sub: b.open ? `${fmtKg(b.open)} not yet reserved` : 'Physical stock unchanged until dispatch',
      status: atRisk ? { label: 'Reserved stock on hold', tone: 'bad' } : b.reserved ? { label: 'Ready to dispatch', tone: 'info' } : undefined,
      current: atRisk || b.reserved > 0,
      done: b.reserved === 0 && b.open === 0 && dispatched > 0,
    },
    {
      key: 'dispatched',
      label: 'Dispatched',
      value: fmtKg(dispatched),
      magnitude: dispatched,
      sub: b.road ? `${fmtKg(b.road)} on the road` : dispatched ? 'Nothing left on the road' : 'Not dispatched yet',
      status: b.road ? { label: 'In transit', tone: 'info' } : undefined,
      current: b.road > 0,
      done: dispatched > 0 && b.road === 0,
    },
    {
      key: 'received',
      label: 'Received at distributor',
      value: fmtKg(b.delivered),
      magnitude: b.delivered,
      sub: b.settled ? `${fmtKg(b.settled)} short / returned and settled` : undefined,
      status: b.delivered && b.delivered + b.settled >= ordered - b.cancelled ? { label: 'Complete', tone: 'good' } : undefined,
      exits: [damaged ? { label: 'Damaged (held)', value: fmtKg(damaged), tone: 'warn' as const } : null, short ? { label: 'Short on arrival', value: fmtKg(short), tone: 'warn' as const } : null].filter(Boolean) as FlowNode['exits'],
      done: b.delivered > 0 && b.road === 0 && b.reserved === 0 && b.open === 0,
    },
  ];
  return <FlowChain title={`Order ${order.id} — where it is`} caption="kg at each step for the selected order" nodes={nodes} />;
}

// ---------------------------------------------------------------- distributors

const DIST_SEGS: Seg[] = [
  { key: 'free', label: 'Free to sell', color: STATUS.good },
  { key: 'reserved', label: 'Reserved for retailers', color: CAT[0] },
  { key: 'held', label: 'Damaged / held / expired', color: STATUS.warn, pattern: true },
  { key: 'transit', label: 'On the road to them', color: STATUS.info },
];

export function DistributorCharts({
  s,
  overview,
  rows,
  ships,
  selected,
  base,
  only,
}: {
  s: RentioState;
  overview: { id: string; name: string; physical: number; reserved: number; inTransit: number; lastSyncHours: number; stale: boolean }[];
  rows: StockRow[];
  ships: Shipment[];
  selected: string;
  base: string;
  /** render just one graphic (page layouts place them separately) */
  only?: 'bars' | 'flow';
}) {
  const barRows = overview.map((d) => {
    const mine = rows.filter((r) => r.location?.distributorId === d.id && (r.location.kind === 'distributor' || r.location.kind === 'distributor-held'));
    const sell = mine.filter((r) => r.sellable);
    return {
      id: d.id,
      label: d.id,
      text: `${d.id} ${d.name.replace(' (fictional)', '')}`,
      to: `${base}/distribution/distributors?d=${d.id}`,
      values: { free: sum(sell.map((r) => r.available)), reserved: sum(sell.map((r) => r.reserved)), held: sum(mine.filter((r) => !r.sellable).map((r) => r.qty)), transit: d.inTransit },
      note: d.stale ? `figures ${d.lastSyncHours} h old — not live` : `updated ${d.lastSyncHours} h ago`,
    };
  });
  const d = overview.find((x) => x.id === selected);
  const mineShips = ships.filter((sh) => sh.toDistributor === selected);
  const shipped = sum(mineShips.map(shipQty));
  const good = sum(mineShips.map((sh) => sh.receipt?.good ?? 0));
  const damaged = sum(mineShips.map((sh) => sh.receipt?.damaged ?? 0));
  const short = sum(mineShips.map((sh) => sh.receipt?.short ?? 0));
  const excess = sum(mineShips.map((sh) => sh.receipt?.excess ?? 0));
  const onRoad = sum(mineShips.filter((sh) => !sh.receipt).map(shipQty));
  const from = `DIST:${selected}`;
  const delivered = sum(s.movements.filter((m) => m.kind === 'deliver-retail' && m.from === from).map((m) => m.qty));
  const outside = sum(s.movements.filter((m) => m.kind === 'outside-sale' && m.from === from).map((m) => m.qty));
  const nodes: FlowNode[] = d
    ? [
        { key: 'shipped', label: 'Shipped to them', value: fmtKg(shipped), magnitude: shipped, sub: onRoad ? `${fmtKg(onRoad)} still on the road` : 'All arrived', status: onRoad ? { label: 'In transit', tone: 'info' } : undefined, current: onRoad > 0 },
        {
          key: 'good',
          label: 'Received good',
          value: fmtKg(good),
          magnitude: good,
          exits: [damaged ? { label: 'Damaged (held)', value: fmtKg(damaged), tone: 'warn' as const } : null, short ? { label: 'Short', value: fmtKg(short), tone: 'warn' as const } : null, excess ? { label: 'Extra found (held)', value: fmtKg(excess), tone: 'warn' as const } : null].filter(Boolean) as FlowNode['exits'],
          done: good > 0,
        },
        { key: 'stock', label: 'In stock now', value: fmtKg(d.physical), magnitude: d.physical, sub: d.stale ? `Last update ${d.lastSyncHours} h ago — not live` : 'Live from postings', status: d.stale ? { label: 'Stale figures', tone: 'warn' } : undefined },
        { key: 'reserved', label: 'Reserved for retailers', value: fmtKg(d.reserved), magnitude: d.reserved, status: d.reserved ? { label: 'To deliver', tone: 'info' } : undefined, current: d.reserved > 0 },
        { key: 'delivered', label: 'Delivered to retailers', value: fmtKg(delivered), magnitude: delivered, exits: outside ? [{ label: 'Outside-app sales', value: fmtKg(outside) }] : undefined, done: delivered > 0 },
      ]
    : [];
  const bars = <StackBars title="Distributor stock" caption="kg per distributor in your area · exclusive parts" segs={DIST_SEGS} rows={barRows} rowHeader="Distributor" focus={selected} empty="No distributor in your area." />;
  if (only === 'bars') return bars;
  if (only === 'flow') return d ? <FlowChain title={`${d.id} — goods flow`} caption="From factory dispatch to retailer delivery (kg)" nodes={nodes} /> : null;
  return (
    <ChartGrid>
      <StackBars title="Distributor stock" caption="kg per distributor in your area · exclusive parts" segs={DIST_SEGS} rows={barRows} rowHeader="Distributor" focus={selected} empty="No distributor in your area." />
      {d ? <FlowChain title={`${d.id} — goods flow`} caption="From factory dispatch to retailer delivery (kg)" nodes={nodes} /> : <span />}
    </ChartGrid>
  );
}

// ---------------------------------------------------------------- multi-stop trip

const STOP_SEGS: Seg[] = [
  { key: 'accepted', label: 'Accepted', color: STATUS.good },
  { key: 'damaged', label: 'Damaged (held at stop)', color: STATUS.warn, pattern: true },
  { key: 'refused', label: 'Refused — still in transit', color: STATUS.bad },
  { key: 'returned', label: 'Returned to factory', color: STATUS.muted },
  { key: 'pending', label: 'Not delivered yet', color: STATUS.info },
];
const STOP_TONE = { pending: 'info', accepted: 'good', part_accepted: 'warn', refused: 'bad', returned: 'muted' } as const;
const STOP_TEXT = { pending: 'Pending', accepted: 'Accepted', part_accepted: 'Part accepted', refused: 'Refused', returned: 'Refused qty returned' } as const;

export function TripCharts({ s, trip, actor }: { s: RentioState; trip: Trip; actor: RActor }) {
  const visible = new Set(scopedShipments(s, actor).map((x) => x.id));
  const stops = tripProgress(s, trip).stops.filter((x) => visible.has(x.shipmentId));
  if (!stops.length) return null;
  const nodes: FlowNode[] = stops.map((x) => ({
    key: String(x.seq),
    label: `Stop ${x.seq} · ${x.distributorId}`,
    value: fmtKg(x.total),
    magnitude: x.total,
    sub: x.outcome ? `${fmtKg(x.acceptedQty ?? 0)} accepted${x.refusedQty ? ` · ${fmtKg(x.refusedQty)} refused` : ''}` : 'On board',
    status: { label: STOP_TEXT[x.status], tone: STOP_TONE[x.status] },
    current: x.status === 'pending' && stops.slice(0, stops.indexOf(x)).every((p) => p.status !== 'pending'),
    done: x.status === 'accepted',
  }));
  const rows = stops.map((x) => {
    const ret = x.disposition?.qty ?? 0;
    const v = x.outcome ? { accepted: x.acceptedQty ?? 0, damaged: x.damagedQty ?? 0, refused: x.openInTransit, returned: ret, pending: 0 } : { accepted: 0, damaged: 0, refused: 0, returned: 0, pending: x.total };
    return { id: String(x.seq), label: `#${x.seq} ${x.distributorId}`, text: `Stop ${x.seq} ${x.distributorId}`, values: v };
  });
  return (
    <ChartGrid>
      <FlowChain title={`${trip.id} — stops in order`} caption={`${trip.vehicle} · each stop records its own outcome`} nodes={nodes} />
      <StackBars title="Outcome per stop" caption="kg on board per stop · exclusive outcomes" segs={STOP_SEGS} rows={rows} rowHeader="Stop" />
    </ChartGrid>
  );
}

// ---------------------------------------------------------------- logistics

const FREIGHT_SEGS: Seg[] = [
  { key: 'matched', label: 'Billed = calculated', color: STATUS.good },
  { key: 'over', label: 'Billed above calculated', color: STATUS.bad, pattern: true },
  { key: 'under', label: 'Calculated, not billed', color: STATUS.faint },
  { key: 'await', label: 'Awaiting bill (calculated)', color: STATUS.info },
];
const OUTCOME_SEGS: Seg[] = [
  { key: 'good', label: 'Received good', color: STATUS.good },
  { key: 'damaged', label: 'Damaged (held)', color: STATUS.warn, pattern: true },
  { key: 'road', label: 'On the road', color: STATUS.info },
  { key: 'exception', label: 'Short / refused — in transit', color: STATUS.bad },
  { key: 'other', label: 'Settled / returned', color: STATUS.muted },
];

export function LogisticsCharts({ s, trips, base, focus }: { s: RentioState; trips: Trip[]; base: string; focus?: string }) {
  const pos = computePositions(s);
  const freight = trips.map((t) => {
    const f = C.tripFreight({ s }, t.id);
    const bill = t.freightBill?.amount;
    const v = bill === undefined ? { matched: 0, over: 0, under: 0, await: f.calculated } : { matched: Math.min(bill, f.calculated), over: Math.max(0, bill - f.calculated), under: Math.max(0, f.calculated - bill), await: 0 };
    return { id: t.id, label: t.id, text: `${t.id} ${t.vehicle}`, to: `${base}/distribution/logistics?focus=${t.id}`, values: v, note: bill === undefined ? 'no bill yet' : t.freightBill?.status };
  });
  const outcome = trips.map((t) => {
    const v = { good: 0, damaged: 0, road: 0, exception: 0, other: 0 };
    for (const sh of s.shipments.filter((x) => t.shipmentIds.includes(x.id))) {
      const total = shipQty(sh);
      const open = sh.transitLoc ? sum(sh.lines.map((l) => Math.max(0, pos.get(`${l.lotId}|${sh.transitLoc}`) ?? 0))) : 0;
      const good = sh.receipt?.good ?? 0;
      const dmg = sh.receipt?.damaged ?? 0;
      v.good += good;
      v.damaged += dmg;
      if (sh.receipt || sh.status === 'refused') v.exception += open;
      else v.road += open;
      v.other += Math.max(0, total - good - dmg - open);
    }
    return { id: t.id, label: t.id, text: `${t.id} ${t.vehicle}`, to: `${base}/distribution/logistics?focus=${t.id}`, values: v };
  });
  return (
    <ChartGrid>
      <StackBars title="Freight per trip" caption="₹ · bill checked against weight × the trip's rate card" segs={FREIGHT_SEGS} rows={freight} rowHeader="Trip" format={(p) => fmtINR(p, true)} focus={focus} empty="No trips yet." />
      <StackBars title="Delivery outcome per trip" caption="kg loaded per trip · exclusive outcomes" segs={OUTCOME_SEGS} rows={outcome} rowHeader="Trip" focus={focus} empty="No trips yet." />
    </ChartGrid>
  );
}

// ---------------------------------------------------------------- salesman

const QUEUE_SEGS: Seg[] = [
  { key: 'queued', label: 'Queued offline', color: STATUS.info },
  { key: 'accepted', label: 'Accepted on sync', color: STATUS.good },
  { key: 'resolved', label: 'Conflict resolved', color: CAT[0] },
  { key: 'conflict', label: 'Needs a decision', color: STATUS.bad },
  { key: 'rejected', label: 'Cancelled / rejected', color: STATUS.muted, pattern: true },
];
const RETAIL_SEGS: Seg[] = [
  { key: 'delivered', label: 'Delivered', color: STATUS.good },
  { key: 'reserved', label: 'Reserved at distributor', color: CAT[0] },
  { key: 'open', label: 'Advance / not reserved', color: STATUS.faint },
  { key: 'cancelled', label: 'Cancelled', color: STATUS.muted, pattern: true },
];

export function SalesmanCharts({ s, queue, orders, base }: { s: RentioState; queue: { status: string }[]; orders: Order[]; base: string }) {
  const q: Record<string, number> = { queued: 0, accepted: 0, resolved: 0, conflict: 0, rejected: 0 };
  queue.forEach((x) => (q[x.status] = (q[x.status] ?? 0) + 1));
  const by = new Map<string, Record<string, Grams>>();
  for (const o of orders) {
    const d = o.distributorId ?? '—';
    const v = by.get(d) ?? { delivered: 0, reserved: 0, open: 0, cancelled: 0 };
    for (const l of o.lines) {
      const b = C.lineBalance(s, o, l);
      v.delivered += b.delivered;
      v.reserved += b.reserved;
      v.open += b.unallocated;
      v.cancelled += b.cancelled;
    }
    by.set(d, v);
  }
  const rows = [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, values]) => ({ id: d, label: d, text: d, to: `${base}/distribution/distributors?d=${d}`, values }));
  return (
    <ChartGrid>
      <ShareStrip title="Offline order queue" caption="requests by outcome (count) — each request has exactly one" segs={QUEUE_SEGS} values={q} format={count} />
      <StackBars title="Retailer orders by distributor" caption="kg ordered, split by where the order is" segs={RETAIL_SEGS} rows={rows} rowHeader="Distributor" empty="No retailer orders yet." />
    </ChartGrid>
  );
}

// ---------------------------------------------------------------- returns

const DISP_SEGS: Seg[] = [
  { key: 'awaiting', label: 'Held — awaiting QC', color: STATUS.warn, pattern: true },
  { key: 'release', label: 'Released for sale', color: STATUS.good },
  { key: 'reprocess', label: 'Sent to reprocess', color: CAT[0] },
  { key: 'dispose', label: 'Disposed / disposal requested', color: STATUS.muted },
];

export function ReturnCharts({ cases }: { cases: Complaint[] }) {
  const open = cases.filter((c) => !c.returnQty && c.status !== 'closed' && c.status !== 'resolved').length;
  const received = cases.filter((c) => c.status === 'return_received').length;
  const decided = cases.filter((c) => c.status === 'resolved' || (!!c.disposition && c.status !== 'closed')).length;
  const closed = cases.filter((c) => c.status === 'closed').length;
  const unknownLot = cases.filter((c) => !c.lotId && c.status !== 'closed').length;
  const nodes: FlowNode[] = [
    { key: 'open', label: 'Open cases', value: count(open), magnitude: open, status: open ? { label: 'Being handled', tone: 'info' } : undefined, exits: unknownLot ? [{ label: 'Lot not identified', value: count(unknownLot), tone: 'warn' }] : undefined, current: open > 0 },
    { key: 'received', label: 'Return received (held)', value: count(received), magnitude: received, status: received ? { label: 'Waiting for QC', tone: 'warn' } : undefined, current: received > 0 },
    { key: 'decided', label: 'Decided', value: count(decided), magnitude: decided },
    { key: 'closed', label: 'Closed', value: count(closed), magnitude: closed, done: closed > 0 },
  ];
  const kg: Record<string, Grams> = { awaiting: 0, release: 0, reprocess: 0, dispose: 0 };
  for (const c of cases.filter((x) => x.returnQty)) kg[c.disposition ?? 'awaiting'] = (kg[c.disposition ?? 'awaiting'] ?? 0) + c.returnQty!;
  return (
    <ChartGrid>
      <FlowChain title="Complaint lifecycle" caption="number of cases at each step (your area)" nodes={nodes} />
      <ShareStrip title="Returned goods by decision" caption="kg physically returned" segs={DISP_SEGS} values={kg} />
    </ChartGrid>
  );
}

// ---------------------------------------------------------------- tally

const DOC_SEGS: Seg[] = [
  { key: 'acknowledged', label: 'Acknowledged / reconciled', color: STATUS.good },
  { key: 'queued', label: 'Queued', color: STATUS.info },
  { key: 'status_unknown', label: 'Result unknown — look up', color: STATUS.warn, pattern: true },
  { key: 'failed', label: 'Failed — retry', color: STATUS.bad },
];
const TYPE_LABEL: Record<string, string> = { purchase: 'Purchases', sale: 'Sales', 'byproduct-sale': 'By-product sales', freight: 'Freight', receipt: 'Receipts' };

export function TallyCharts({ s, base }: { s: RentioState; base: string }) {
  const st = (x: string) => (x === 'reconciled' ? 'acknowledged' : x);
  const counts: Record<string, number> = {};
  s.tally.forEach((t) => (counts[st(t.status)] = (counts[st(t.status)] ?? 0) + 1));
  const types = [...new Set(s.tally.map((t) => t.sourceType))];
  const rows = types.map((ty) => {
    const v: Record<string, number> = {};
    s.tally.filter((t) => t.sourceType === ty).forEach((t) => (v[st(t.status)] = (v[st(t.status)] ?? 0) + t.amount));
    return { id: ty, label: TYPE_LABEL[ty] ?? ty, text: TYPE_LABEL[ty] ?? ty, values: v, to: `${base}/finance/tally` };
  });
  return (
    <ChartGrid>
      <ShareStrip title="Documents by sync status" caption="count of source documents · simulated Tally" segs={DOC_SEGS} values={counts} format={count} />
      <StackBars title="Value by document type" caption="₹ by sync status" segs={DOC_SEGS} rows={rows} rowHeader="Document type" format={(p) => fmtINR(p, true)} empty="No documents yet." />
    </ChartGrid>
  );
}

// ---------------------------------------------------------------- attendance

export function HoursChart({ rows }: { rows: { id: string; name: string; hours: number; ot: number }[] }) {
  return (
    <StackBars
      title="Hours worked this period"
      caption="paired in/out punches · regular and overtime are separate parts"
      segs={[
        { key: 'regular', label: 'Regular hours', color: CAT[0] },
        { key: 'ot', label: 'Overtime (after 8 h)', color: CAT[1] },
      ]}
      rows={rows.map((r) => ({ id: r.id, label: r.name, text: `${r.id} ${r.name}`, values: { regular: Math.max(0, r.hours - r.ot), ot: r.ot } }))}
      rowHeader="Employee"
      format={(h) => `${h.toFixed(1)} h`}
      empty="No punches for this period."
    />
  );
}

// ---------------------------------------------------------------- season

export function TargetChart({ rows }: { rows: { code: string; label: string; target: Grams; actual: Grams }[] }) {
  const withTarget = rows.filter((r) => r.target > 0 || r.actual > 0);
  return (
    <StackBars
      title="Today: output against plan"
      caption="kg forward output completed today · bar = plan target (or actual when there is no target)"
      segs={[
        { key: 'achieved', label: 'Achieved', color: STATUS.good },
        { key: 'remaining', label: 'Still to do for the plan', color: STATUS.faint },
      ]}
      rows={withTarget.map((r) => ({
        id: r.code,
        label: r.label,
        text: r.label,
        values: { achieved: r.target ? Math.min(r.actual, r.target) : r.actual, remaining: Math.max(0, r.target - r.actual) },
        note: !r.target ? 'no target set' : r.actual > r.target ? `over plan by ${fmtKg(r.actual - r.target)}` : undefined,
      }))}
      rowHeader="Stage"
      empty="No plan targets or completed output today."
    />
  );
}

export function ForecastChart({ rows, lowConfidence }: { rows: { day: string; out: Grams }[]; lowConfidence: boolean }) {
  return (
    <StackBars
      title="Projected packed output — next 7 days"
      caption={`kg per day · projection only, not stock${lowConfidence ? ' · low confidence (demo baseline)' : ''}`}
      segs={[{ key: 'out', label: 'Projected output', color: CAT[0], pattern: true }]}
      rows={rows.map((r) => ({ id: r.day, label: r.day.slice(5), text: r.day, values: { out: r.out } }))}
      rowHeader="Day"
    />
  );
}

// ---------------------------------------------------------------- alerts / approvals / incidents / inbox

const SEV_SEGS: Seg[] = [
  { key: 'critical', label: 'Critical', color: STATUS.bad },
  { key: 'high', label: 'High', color: STATUS.warn },
  { key: 'medium', label: 'Medium', color: STATUS.info },
  { key: 'low', label: 'Low', color: STATUS.muted },
];

export function AlertsChart({ alerts, families }: { alerts: Pick<Alert, 'family' | 'severity'>[]; families: { id: string; label: string }[] }) {
  const rows = families
    .map((f) => {
      const v: Record<string, number> = {};
      alerts.filter((a) => a.family === f.id).forEach((a) => (v[a.severity] = (v[a.severity] ?? 0) + 1));
      return { id: f.id, label: f.label, text: f.label, values: v };
    })
    .filter((r) => Object.keys(r.values).length);
  return <StackBars title="Open exceptions by type" caption="count, by severity — your area only" segs={SEV_SEGS} rows={rows} rowHeader="Type" format={count} empty="No open exceptions." />;
}

export function ApprovalsChart({ pending, isMine, label }: { pending: { type: string }[]; isMine: (a: { type: string }) => boolean; label: (t: string) => string }) {
  const types = [...new Set(pending.map((a) => a.type))];
  const rows = types.map((t) => ({ id: t, label: label(t), text: label(t), values: { mine: pending.filter((a) => a.type === t && isMine(a)).length, others: pending.filter((a) => a.type === t && !isMine(a)).length } }));
  return (
    <StackBars
      title="Pending requests by type"
      caption="count · yours to decide vs waiting for someone else"
      segs={[
        { key: 'mine', label: 'Yours to decide', color: CAT[0] },
        { key: 'others', label: 'Another approver', color: STATUS.faint },
      ]}
      rows={rows}
      rowHeader="Type"
      format={count}
      empty="No pending requests."
    />
  );
}

export function IncidentsChart({ rows }: { rows: { id: string; label: string; open: number; resolved: number; detached: number }[] }) {
  return (
    <StackBars
      title="Linked alerts per incident"
      caption="count · an incident can close only when nothing is open"
      segs={[
        { key: 'open', label: 'Still open', color: STATUS.bad },
        { key: 'resolved', label: 'Resolved', color: STATUS.good },
        { key: 'detached', label: 'Detached', color: STATUS.muted, pattern: true },
      ]}
      rows={rows.map((r) => ({ id: r.id, label: r.id, text: r.label, values: { open: r.open, resolved: r.resolved, detached: r.detached } }))}
      rowHeader="Incident"
      format={count}
      empty="No incidents."
    />
  );
}

export function InboxChart({ items }: { items: { source: 'task' | 'alert'; severity: string }[] }) {
  const rows = (['task', 'alert'] as const).map((src) => {
    const v: Record<string, number> = {};
    items.filter((i) => i.source === src).forEach((i) => (v[i.severity] = (v[i.severity] ?? 0) + 1));
    return { id: src, label: src === 'task' ? 'Your actions' : 'Alerts', text: src === 'task' ? 'Your next actions' : 'Alerts you are accountable for', values: v };
  });
  return <StackBars title="What is waiting for you" caption="count of open items by urgency" segs={SEV_SEGS} rows={rows} rowHeader="Kind" format={count} empty="Nothing open." />;
}
