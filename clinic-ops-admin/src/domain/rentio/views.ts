/**
 * Derived views — the ONLY way screens obtain quantities. Control Tower, My Work,
 * stage screens, godowns, orders and reports all call these functions over the
 * same ledger, so their totals cannot drift apart.
 */
import type { Db } from '../../services/types';
import { hasCap, type RActor, userName } from './access';
import { lineBalance } from './commerce';
import { DEMO } from './config';
import { DISTRIBUTORS, PEOPLE, STAGES } from './data';
import { canReadLoc, readScope } from './scope';
import { computePositions, descendants, familyOf, stockRows, type StockRow } from './engine';
import { outstanding, purchaseBalances, runTiming } from './ops';
import { openSuggestions, scopedSuggestions } from './replenish';
import type { Lot, Movement, RentioState, StageCode } from './types';
import { fmtKg, type Grams, sum } from './units';

export const R = (db: Db) => db.rentio as RentioState;

export const stageName = (st: StageCode) => STAGES.find((x) => x.code === st)?.label.split(' /')[0].split(' ·')[0] ?? st;
const fmtDurationShort = (ms: number) => {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
};

/** "24 Nov 18:24" in Asia/Kolkata for alert text. */
export const istHm = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

// ---------------------------------------------------------------- formatting

export const fmtLotQty = (lot: Lot | undefined, g: Grams) => (lot?.unit === 'bag' ? `${(g / 1000).toLocaleString('en-IN')} bags` : fmtKg(g));

// ---------------------------------------------------------------- lot accounting (closed boundary per root)

export interface LotAccounting {
  rootId: string;
  input: Grams;
  additions: { lotId: string; qty: Grams }[];
  buckets: { key: string; label: string; qty: Grams; kind: 'live' | 'out' }[];
  total: Grams;
  expected: Grams;
  balanced: boolean;
}

const SINK_LABEL: Partial<Record<Movement['kind'], string>> = {
  'deliver-retail': 'Retailer delivered',
  'internal-use': 'By-product internal use',
  'external-dispatch': 'By-product external dispatch',
  loss: 'Recorded process / transit loss',
  dispose: 'Disposed',
  'outside-sale': 'Distributor outside-app sales',
  adjust: 'Approved negative adjustment',
};

/**
 * Closed-boundary reconciliation for one root lot (§18 network equation):
 * accepted intake + measured additions = live positions + outward sinks.
 * Internal run conversions (consume/produce) cancel; parents are never counted with children.
 */
export function lotAccounting(s: RentioState, rootId: string): LotAccounting {
  const fam = new Set(familyOf(s, rootId));
  const pos = computePositions(s);
  const mv = s.movements.filter((m) => fam.has(m.lotId));
  const input = sum(mv.filter((m) => m.kind === 'intake' || m.kind === 'opening').map((m) => m.qty));
  const runIds = new Set(s.runs.filter((r) => fam.has(r.inputLotId)).map((r) => r.id));
  const additions = s.movements.filter((m) => m.kind === 'addition' && runIds.has(m.ref)).map((m) => ({ lotId: m.lotId, qty: m.qty }));
  const live = new Map<string, { label: string; qty: Grams }>();
  pos.forEach((q, k) => {
    const [lotId, loc] = k.split('|');
    if (!fam.has(lotId) || q === 0) return;
    const lot = s.lots[lotId];
    const l = s.locations[loc];
    let key: string;
    let label: string;
    if (lot.material === 'HUSK' || lot.material === 'CHURI') {
      key = lot.material;
      label = `${lot.material === 'HUSK' ? 'Husk' : 'Churi'} remaining`;
    } else if (loc === 'SAMPLES') {
      key = 'SAMPLE';
      label = 'Retained QC samples (held)';
    } else if (lot.material === 'REJECT') {
      key = 'REJECT';
      label = 'Cleaning rejects (held, awaiting disposition)';
    } else if (l?.kind === 'distributor' || l?.kind === 'distributor-held') {
      key = 'DIST';
      label = 'Distributor dal';
    } else if (l?.kind === 'transit') {
      key = 'TRANSIT';
      label = 'In transit';
    } else if (l?.kind === 'finished') {
      key = 'FACTORY';
      label = 'Factory finished dal';
    } else {
      key = `WIP:${loc}`;
      label = `${lot.material === 'RAW' ? 'Raw' : 'WIP'} at ${l?.label ?? loc}`;
    }
    const cur = live.get(key) ?? { label, qty: 0 };
    cur.qty += q;
    live.set(key, cur);
  });
  const outs = new Map<string, Grams>();
  mv.forEach((m) => {
    if (m.to || m.kind === 'consume') return;
    const label = SINK_LABEL[m.kind] ?? m.kind;
    outs.set(label, (outs.get(label) ?? 0) + m.qty);
  });
  const buckets = [
    ...[...live.entries()].map(([key, v]) => ({ key, label: v.label, qty: v.qty, kind: 'live' as const })),
    ...[...outs.entries()].map(([label, qty]) => ({ key: label, label, qty, kind: 'out' as const })),
  ];
  const total = sum(buckets.map((b) => b.qty));
  const expected = input + sum(additions.map((a) => a.qty));
  return { rootId, input, additions, buckets, total, expected, balanced: total === expected };
}

// ---------------------------------------------------------------- stock summaries

export type Bucket = 'raw' | 'intake' | 'wip' | 'pending' | 'finished' | 'byproduct' | 'stores' | 'quarantine' | 'transit' | 'distributor';

export function bucketOf(row: StockRow): Bucket {
  const k = row.location?.kind;
  switch (k) {
    case 'intake':
      return 'intake';
    case 'raw':
      return 'raw';
    case 'stage-in':
    case 'stage-out':
    case 'run':
      return 'wip';
    case 'pending':
      return 'pending';
    case 'finished':
      return 'finished';
    case 'byproduct':
      return 'byproduct';
    case 'stores':
      return 'stores';
    case 'quarantine':
      return 'quarantine';
    case 'transit':
      return 'transit';
    default:
      return 'distributor';
  }
}

export function stockSummary(s: RentioState, now: string, filter: (r: StockRow) => boolean = () => true) {
  const rows = stockRows(s, now).filter((r) => r.lot.unit !== 'bag' && filter(r));
  const by = (b: Bucket) => rows.filter((r) => bucketOf(r) === b);
  // dimensions are reported separately — they overlap and must not be added together
  const t = (rs: StockRow[]) => ({
    physical: sum(rs.map((r) => r.qty)),
    held: sum(rs.filter((r) => r.held).map((r) => r.qty)),
    expired: sum(rs.filter((r) => r.expired).map((r) => r.qty)),
    readyToProcess: sum(rs.map((r) => r.readyToProcess)),
    reserved: sum(rs.map((r) => r.reserved)),
    reservedAtRisk: sum(rs.map((r) => r.reservedAtRisk)),
    available: sum(rs.map((r) => r.available)),
    bags: sum(rs.filter((r) => r.lot.bagSize).map((r) => Math.floor(r.qty / r.lot.bagSize!))),
    lots: new Set(rs.map((r) => r.lotId)).size,
  });
  return {
    rows,
    intake: t(by('intake')),
    raw: t(by('raw')),
    wip: t(by('wip')),
    pending: t(by('pending')),
    finished: t(by('finished')),
    byproduct: t(by('byproduct')),
    quarantine: t(by('quarantine')),
    transit: t(by('transit')),
    distributor: t(by('distributor')),
    stores: t(by('stores')),
  };
}

// ---------------------------------------------------------------- production funnel (Control Tower)

export function stageFunnel(s: RentioState, now: string) {
  const pos = computePositions(s);
  return STAGES.map((st) => {
    const q = (loc: string) => {
      let t = 0;
      pos.forEach((v, k) => {
        if (k.endsWith(`|${loc}`)) t += v;
      });
      return t;
    };
    const runs = s.runs.filter((r) => r.stage === st.code && r.status !== 'completed');
    const running = sum(runs.filter((r) => r.status === 'running').map((r) => q(`RUN:${r.id}`)));
    const held = sum(runs.filter((r) => r.status === 'on_hold').map((r) => q(`RUN:${r.id}`)));
    const pendingIn = sum(s.handovers.filter((h) => h.toStage === st.code).map((h) => outstanding(h) - 0));
    const timings = runs.map((r) => ({ run: r, t: runTiming(r, now) }));
    const delayed = timings.filter((x) => x.t.status === 'Delayed' || x.t.status === 'On Hold');
    const nextEta = timings.map((x) => x.t.forecastFinish).filter((x): x is string => !!x).sort()[0];
    const etaUnknown = timings.filter((x) => x.t.etaSource === 'needs_update').length;
    return { ...st, queue: q(`STG:${st.code}:IN`), output: q(`STG:${st.code}:OUT`), running, held, pendingIn, runs: timings, delayed: delayed.length, nextEta, etaUnknown, ownerName: userName(st.owner), backupName: userName(st.backup) };
  });
}

// ---------------------------------------------------------------- distributor overview

export function distributorOverview(db: Db, now: string) {
  const s = R(db);
  const rows = stockRows(s, now);
  return (db.records.distributors ?? DISTRIBUTORS.map((d) => ({ ...d }))).map((d) => {
    const mine = rows.filter((r) => r.location?.distributorId === d.id && (r.location.kind === 'distributor' || r.location.kind === 'distributor-held'));
    const transit = rows.filter((r) => r.location?.kind === 'transit' && r.location.distributorId === d.id);
    const physical = sum(mine.map((r) => r.qty));
    const hrs = Number(d.lastSyncHoursAgo ?? 0);
    return {
      id: String(d.id),
      name: String(d.name),
      city: String(d.city ?? ''),
      physical,
      held: sum(mine.filter((r) => r.held).map((r) => r.qty)),
      reserved: sum(mine.map((r) => r.reserved)),
      available: sum(mine.map((r) => r.available)),
      inTransit: sum(transit.map((r) => r.qty)),
      openDisputes: s.disputes.filter((x) => x.status === 'open' && s.shipments.find((sh) => sh.id === x.shipmentId)?.toDistributor === d.id).length,
      lastSyncHours: hrs,
      stale: hrs > DEMO.staleDistributorHours,
      belowMin: physical < Number(d.minStockKg ?? 0) * 1000,
      nearExpiry: mine.filter((r) => r.lot.expiry && Date.parse(r.lot.expiry) - Date.parse(now) < DEMO.nearExpiryDays * 86_400_000).length,
    };
  });
}

// ---------------------------------------------------------------- alerts & owner brief

/** Named person accountable for a role-level responsibility (from the demo people master). */
export function personFor(roleId: string, ctx: { distributorId?: string; stage?: StageCode } = {}) {
  if (ctx.stage) return STAGES.find((x) => x.code === ctx.stage)!.owner;
  if (ctx.distributorId) return PEOPLE.find((p) => p.scope?.distributors?.includes(ctx.distributorId!) && p.roleId === 'distributor')?.id ?? 'u_kiran';
  return PEOPLE.find((p) => p.roleId === roleId)?.id ?? 'u_owner';
}

export interface Alert {
  key: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  family: 'decision' | 'delivery' | 'production' | 'stock' | 'money' | 'people';
  title: string;
  detail: string;
  qty?: string;
  /** Named accountable person (user id) and the role label. */
  ownerId: string;
  owner: string;
  roles: string[];
  ownerDecision: boolean;
  /** Exact source: page path plus ?focus=<record id>. */
  link: string;
  /** Meaningful action label for the link (the accountable person's action). */
  action: string;
  /** Capability needed to perform that action; viewers without it get a review CTA. */
  actionCap: string;
  /** "Kiran Shah (Back Office): reallocate" — the exact next step shown on the focused record. */
  nextStep: string;
  sourceId: string;
  due?: string;
  /** Timed escalation level (0 = with the accountable person). */
  escalation: 0 | 1 | 2;
  escalatedTo?: string;
  /** Data scope of the underlying record (alerts are filtered by it). */
  scope: { loc?: string; distributorId?: string; stage?: StageCode };
  at: string;
}

const HOUR_MS = 3_600_000;

/**
 * Timed escalation (FR-075): unresolved past due → Factory Head (or Accounts/Back Office lead);
 * past twice the window → Owner. Season mode shortens the window. Acknowledging never stops it.
 */
function escalate(s: RentioState, at: string, now: string, windowHours: number) {
  const win = (s.season.active ? Math.min(windowHours, s.season.escalationHours) : windowHours) * HOUR_MS;
  const due = new Date(Date.parse(at) + win).toISOString();
  const over = Date.parse(now) - Date.parse(due);
  const level: 0 | 1 | 2 = over > win ? 2 : over > 0 ? 1 : 0;
  return { due, level };
}

/** Capability that performs each alert family's action (the service re-checks it). */
const ACTION_CAP: Record<string, string> = {
  ho: 'handover.settle.request',
  run: 'stage.operate',
  risk: 'order.reserve',
  hold: 'quality.release',
  po: 'purchase.create',
  bill: 'bill.match',
  in: 'intake.check',
  sh: 'distributor.operate',
  dsp: 'logistics.manage',
  short: 'order.reserve',
  tly: 'tally.sync',
  off: 'order.create.retail',
  col: 'collection.confirm',
  stale: 'order.create.retail',
  fum: 'location.hold',
  exp: 'godown.operate',
};

/** CTA for a viewer: the action itself when they may do it, otherwise an honest review label. */
export const ctaFor = (a: Alert, actor: RActor) => (hasCap(actor, a.actionCap) ? a.action : 'Review');

const link = (page: string, focus: string, extra = '') =>`${page}?focus=${encodeURIComponent(focus)}${extra}`;

export function alerts(db: Db, now: string): Alert[] {
  const s = R(db);
  const out: Alert[] = [];
  const push = (x: Omit<Alert, 'escalation' | 'escalatedTo' | 'due' | 'owner' | 'actionCap' | 'nextStep'> & { windowHours?: number; escalateTo?: string; actionCap?: string }) => {
    const actionCap = x.actionCap ?? ACTION_CAP[x.key.split(':')[0]] ?? 'ct.view';
    const person = PEOPLE.find((p) => p.id === x.ownerId);
    const a = { ...x, actionCap, nextStep: `${userName(x.ownerId)}${person ? ` (${person.title.split(' ·')[0]})` : ''}: ${x.action.toLowerCase()}` };
    const { due, level } = a.windowHours ? escalate(s, a.at, now, a.windowHours) : { due: undefined, level: 0 as const };
    const escalatedTo = level === 2 ? 'u_owner' : level === 1 ? a.escalateTo ?? 'u_fhead' : undefined;
    const roles = [...a.roles];
    if (level >= 1) roles.push(PEOPLE.find((p) => p.id === (a.escalateTo ?? 'u_fhead'))?.roleId ?? 'factory_head');
    if (level === 2) roles.push('owner');
    const severity = level === 2 && a.severity !== 'critical' ? 'critical' : level === 1 && (a.severity === 'medium' || a.severity === 'low') ? 'high' : a.severity;
    const { windowHours: _w, escalateTo: _e, ...rest } = a;
    out.push({ ...rest, roles: [...new Set(roles)], severity, owner: userName(a.ownerId), due, escalation: level, escalatedTo });
  };
  // approvals — only genuine authority exceptions reach the owner
  for (const a of s.approvals.filter((x) => x.status === 'pending')) {
    const decider = a.ownerOnly ? 'u_owner' : a.type === 'credit_override' || a.type === 'freight_mismatch' || a.type === 'payroll_authorize' ? 'u_neha' : a.type === 'regrade' || a.type === 'disposal' ? 'u_meera' : 'u_fhead';
    push({ key: `apr:${a.id}`, severity: a.ownerOnly ? 'critical' : 'medium', family: a.ownerOnly ? 'decision' : a.type === 'credit_override' ? 'money' : 'stock', title: a.summary, detail: `Requested by ${userName(a.requestedBy)}. ${a.ownerOnly ? 'Beyond the delegated limit — needs the owner.' : 'Within delegated authority — an independent approver decides.'}`, qty: a.exposure, ownerId: decider, roles: a.ownerOnly ? ['owner'] : ['factory_head', 'qc', 'accounts', 'hr'].filter((r) => r !== 'hr' || a.type === 'payroll_authorize'), ownerDecision: !!a.ownerOnly, link: link('home/approvals', a.id), action: a.ownerOnly ? 'Decide' : 'Review request', actionCap: a.requiredCapability, sourceId: a.id, scope: {}, at: a.requestedAt, windowHours: a.ownerOnly ? 0 : 8, escalateTo: 'u_fhead' });
  }
  // handovers waiting for receipt / residuals
  for (const h of s.handovers.filter((x) => outstanding(x) > 0)) {
    const partial = h.received > 0;
    const age = (Date.parse(now) - Date.parse(h.issuedAt)) / HOUR_MS;
    if (!partial && age < DEMO.handoverEscalationHours) continue;
    const stage = h.toStage && h.toStage !== 'F1' && h.toStage !== 'R1' ? (h.toStage as StageCode) : undefined;
    push({ key: `ho:${h.id}`, severity: partial ? 'high' : 'medium', family: 'production', title: partial ? `${fmtKg(outstanding(h))} of ${h.lotId} not received at ${stage ? stageName(stage) : 'the finished godown'}` : `${h.lotId} waiting ${Math.round(age)} h to be received`, detail: `Issued ${fmtKg(h.qty)}, received ${fmtKg(h.received)}. The rest stays in handover custody until it is found, returned or approved as loss.`, qty: fmtKg(outstanding(h)), ownerId: partial ? 'u_fhead' : stage ? personFor('stage_owner', { stage }) : 'u_ravi', roles: ['factory_head', 'stage_owner', 'godown'], ownerDecision: false, link: link('production/handovers', h.id), action: partial ? 'Settle shortfall' : 'Receive', actionCap: partial ? 'handover.settle.request' : stage ? 'stage.operate' : 'godown.operate', sourceId: h.id, scope: { loc: `PEND:${h.id}`, stage }, at: h.issuedAt, windowHours: DEMO.handoverEscalationHours });
  }
  // runs delayed / on hold / ETA unknown
  for (const r of s.runs.filter((x) => x.status !== 'completed')) {
    const t = runTiming(r, now);
    if (t.status === 'On Track') continue;
    const eta = t.forecastFinish ? `revised finish ${istHm(t.forecastFinish)}` : 'no finish estimate — ETA needs update';
    push({ key: `run:${r.id}:${t.status}`, severity: t.status === 'Delayed' ? 'high' : 'medium', family: 'production', title: `${stageName(r.stage)} ${t.status === 'Delayed' ? `late by ${fmtDurationShort(t.delayMs)}` : t.status.toLowerCase()} — ${r.inputLotId}`, detail: `Planned finish ${istHm(t.baselineFinish)}; ${eta}.`, qty: fmtKg(r.inputQty), ownerId: r.ownerId, roles: ['factory_head', 'stage_owner'], ownerDecision: false, link: link('production/stage', r.id, `&stage=${r.stage}`), action: t.forecastFinish ? 'Open run' : 'Update ETA', sourceId: r.id, scope: { loc: `RUN:${r.id}`, stage: r.stage }, at: t.baselineFinish, windowHours: 2 });
  }
  const rows = stockRows(s, now);
  // reservations on held/expired stock
  for (const res of s.reservations.filter((x) => x.status === 'active')) {
    const row = rows.find((r) => r.lotId === res.lotId && r.loc === res.location);
    if (!row || row.sellable) continue;
    const o = s.orders.find((x) => x.id === res.orderId);
    push({ key: `risk:${res.id}`, severity: 'critical', family: 'delivery', title: `${res.orderId} for ${o?.partyId ?? '—'} cannot ship: reserved ${row.lot.grade ?? ''} stock is ${row.expired ? 'expired' : 'on hold'}`, detail: `${row.holds[0] ?? 'Expired'}${o?.promisedDate ? ` · promised ${o.promisedDate}` : ''}. Reallocate eligible stock or resolve the hold.`, qty: fmtKg(res.qty), ownerId: 'u_kiran', roles: ['factory_head', 'qc', 'back_office', 'godown'], ownerDecision: false, link: link('distribution/orders', res.orderId), action: 'Reallocate', sourceId: res.orderId, scope: { loc: res.location }, at: res.createdAt, windowHours: 12 });
  }
  for (const h of s.holds.filter((x) => x.status === 'active')) {
    const affected = h.scope === 'lot' ? [h.target, ...descendants(s, h.target)] : [];
    const hit = rows.filter((r) => (h.scope === 'lot' ? affected.includes(r.lotId) : r.loc === h.target || r.location?.godown === h.target));
    push({ key: `hold:${h.id}`, severity: 'high', family: 'stock', title: `${h.kind === 'quality' ? 'Quality' : h.kind === 'treatment' ? 'Treatment' : h.kind === 'recall' ? 'Recall' : 'Stock'} hold on ${h.scope === 'lot' ? h.target : s.locations[h.target]?.label ?? h.target}`, detail: h.reason, qty: fmtKg(sum(hit.map((r) => r.qty))), ownerId: 'u_meera', roles: ['factory_head', 'qc', 'godown'], ownerDecision: false, link: link('stock/holds', h.id), action: 'Review hold', sourceId: h.id, scope: { loc: hit[0]?.loc ?? (h.scope === 'location' ? h.target : 'F1') }, at: h.createdAt, windowHours: 24 });
  }
  for (const p of s.purchases.filter((x) => x.status === 'partially_received')) {
    const b = purchaseBalances(s, p);
    if (b.open > 0) push({ key: `po:${p.id}`, severity: 'low', family: 'stock', title: `${fmtKg(b.open)} still to arrive on ${p.id}`, detail: `Accepted ${fmtKg(b.accepted)} of ${fmtKg(p.declaredQty)}; promised ${p.promisedDate ?? '—'}.`, qty: fmtKg(b.open), ownerId: 'u_kiran', roles: ['back_office'], ownerDecision: false, link: link('procurement/intake', p.id), action: 'Follow up supplier', sourceId: p.id, scope: { loc: 'R1' }, at: p.createdAt });
  }
  for (const p of s.purchases.filter((x) => x.billMatch?.status === 'disputed')) push({ key: `bill:${p.id}`, severity: 'medium', family: 'money', title: `Supplier bill does not match receipts on ${p.id}`, detail: p.billMatch!.note ?? '', ownerId: 'u_kiran', roles: ['back_office', 'accounts'], ownerDecision: false, link: link('procurement/intake', p.id), action: 'Resolve bill', sourceId: p.id, scope: { loc: 'R1' }, at: p.billMatch!.at, windowHours: 48, escalateTo: 'u_neha' });
  for (const i of s.intakes.filter((x) => x.status === 'under_inspection')) push({ key: `in:${i.id}`, severity: 'medium', family: 'stock', title: `Truck ${i.truck} (${i.lotId}) waiting for intake check`, detail: `${fmtKg(i.net)} held at the gate. ${userName(i.makerId)} recorded it and cannot approve it.`, qty: fmtKg(i.net), ownerId: 'u_meera', roles: ['qc', 'back_office', 'factory_head'], ownerDecision: false, link: link('procurement/intake', i.id), action: 'Check intake', sourceId: i.id, scope: { loc: 'INTAKE' }, at: i.createdAt, windowHours: 2 });
  for (const sh of s.shipments.filter((x) => x.status === 'in_transit' && x.toDistributor)) push({ key: `sh:${sh.id}`, severity: 'low', family: 'delivery', title: `${fmtKg(sum(sh.lines.map((l) => l.qty)))} in transit to ${sh.toDistributor}`, detail: `Dispatched ${istHm(sh.dispatchedAt)}; waiting for the distributor's receipt.`, qty: fmtKg(sum(sh.lines.map((l) => l.qty))), ownerId: personFor('distributor', { distributorId: sh.toDistributor }), roles: ['godown', 'distributor', 'back_office'], ownerDecision: false, link: link('distribution/distributors', sh.id, `&d=${sh.toDistributor}`), action: 'Receive shipment', sourceId: sh.id, scope: { loc: sh.transitLoc, distributorId: sh.toDistributor }, at: sh.dispatchedAt, windowHours: 48, escalateTo: 'u_kiran' });
  for (const d of s.disputes.filter((x) => x.status === 'open')) {
    const sh = s.shipments.find((x) => x.id === d.shipmentId);
    // a refused stop is tracked once, by its stop alert (disposition), not again as a shortage
    if (sh?.receipt?.refused && !sh.receipt.damaged && s.trips.some((t) => t.stops?.some((st) => st.shipmentId === sh.id && st.refusedQty === sh.receipt!.short))) continue;
    push({ key: `dsp:${d.id}`, severity: 'high', family: 'delivery', title: `${sh?.toDistributor ?? ''} receipt short: ${d.reason}`, detail: `${d.shipmentId}: quantity stays in transit custody until it is located or approved as loss.`, qty: fmtKg(d.qty), ownerId: 'u_kiran', roles: ['back_office', 'godown', 'distributor', 'factory_head'], ownerDecision: false, link: link('distribution/logistics', d.id), action: 'Investigate shortfall', sourceId: d.id, scope: { loc: sh?.transitLoc, distributorId: sh?.toDistributor }, at: d.createdAt, windowHours: 24 });
  }
  for (const o of s.orders.filter((x) => x.kind === 'factory' && x.status === 'approved' && !x.advance)) {
    const short = sum(o.lines.map((l) => lineBalance(s, o, l).unallocated));
    if (short > 0 && o.promisedDate) push({ key: `short:${o.id}`, severity: o.promisedDate <= now.slice(0, 10) ? 'high' : 'medium', family: 'delivery', title: `${o.id} for ${o.partyId}: ${fmtKg(short)} ${o.lines.map((l) => l.grade).join('/')} not yet allocated`, detail: `Promised ${o.promisedDate}. Not enough eligible finished stock — check production.`, qty: fmtKg(short), ownerId: 'u_kiran', roles: ['back_office', 'factory_head'], ownerDecision: false, link: link('distribution/orders', o.id), action: 'Allocate stock', sourceId: o.id, scope: { distributorId: o.partyId, loc: 'F1' }, at: o.createdAt });
  }
  for (const t of s.tally.filter((x) => x.status === 'failed' || x.status === 'status_unknown')) push({ key: `tly:${t.id}:${t.attempts.length}`, severity: 'high', family: 'money', title: `Tally ${t.status === 'failed' ? 'sync failed' : 'result unknown'} for ${t.sourceType} ${t.sourceId}`, detail: t.attempts[t.attempts.length - 1]?.message ?? '', ownerId: 'u_neha', roles: ['accounts'], ownerDecision: false, link: link('finance/tally', t.id), action: 'Retry sync', sourceId: t.id, scope: {}, at: t.attempts[t.attempts.length - 1]?.at ?? t.createdAt, windowHours: 24, escalateTo: 'u_neha' });
  for (const q of s.offline.queue.filter((x) => x.status === 'conflict')) push({ key: `off:${q.id}`, severity: 'medium', family: 'delivery', title: `Salesman order ${q.id} for ${q.retailerId} needs a decision`, detail: q.conflict ?? '', ownerId: q.salesmanId, roles: ['salesman', 'back_office'], ownerDecision: false, link: link('sales/salesman', q.id), action: 'Resolve conflict', sourceId: q.id, scope: { distributorId: q.distributorId }, at: q.syncedAt ?? q.capturedAt, windowHours: 24, escalateTo: 'u_kiran' });
  const provisional = s.collections.filter((c) => c.status === 'provisional');
  if (provisional.length) push({ key: 'col:provisional', severity: 'low', family: 'money', title: `${provisional.length} collection(s) waiting for Accounts`, detail: 'Collection evidence does not settle the debt until Accounts confirms it.', ownerId: 'u_neha', roles: ['accounts'], ownerDecision: false, link: link('finance/tally', provisional[0].id), action: 'Confirm collections', sourceId: provisional[0].id, scope: {}, at: provisional[0].at });
  for (const d of distributorOverview(db, now).filter((x) => x.stale)) push({ key: `stale:${d.id}`, severity: 'low', family: 'delivery', title: `${d.id} stock figures are ${d.lastSyncHours} h old`, detail: `${d.name}: last app sync ${d.lastSyncHours} h ago — not live.`, ownerId: 'u_rohit', roles: ['back_office', 'salesman'], ownerDecision: false, link: link('distribution/distributors', d.id, `&d=${d.id}`), action: 'Ask for update', sourceId: d.id, scope: { distributorId: d.id }, at: now });
  for (const l of db.records.locations ?? []) {
    if (!l.lastFumigated) continue;
    const due = Date.parse(String(l.lastFumigated)) + DEMO.fumigationIntervalDays * 86_400_000;
    if (due < Date.parse(now)) push({ key: `fum:${l.id}`, severity: 'medium', family: 'stock', title: `Fumigation overdue at ${l.label}`, detail: `Last fumigation ${l.lastFumigated} (${DEMO.fumigationIntervalDays}-day demo interval).`, ownerId: 'u_ravi', roles: ['godown', 'qc', 'factory_head'], ownerDecision: false, link: link('stock/godowns', String(l.id)), action: 'Schedule treatment', sourceId: String(l.id), scope: { loc: String(l.id) }, at: new Date(due).toISOString() });
  }
  for (const r of rows.filter((x) => x.lot.expiry && x.location && ['finished', 'distributor'].includes(x.location.kind) && Date.parse(x.lot.expiry) - Date.parse(now) < DEMO.nearExpiryDays * 86_400_000))
    push({ key: `exp:${r.lotId}:${r.loc}`, severity: 'medium', family: 'stock', title: `${r.lot.grade ?? ''} ${r.lotId} ${r.expired ? 'expired' : `expires ${r.lot.expiry}`} at ${r.location.label}`, detail: r.expired ? 'Blocked from orders.' : 'Sell first (FEFO) — expired stock is blocked from orders.', qty: fmtKg(r.qty), ownerId: r.location.distributorId ? personFor('distributor', { distributorId: r.location.distributorId }) : 'u_ravi', roles: ['godown', 'distributor', 'salesman'], ownerDecision: false, link: r.location.distributorId ? link('distribution/distributors', r.lotId, `&d=${r.location.distributorId}`) : link('stock/inventory', r.lotId), action: 'See stock', sourceId: r.lotId, scope: { loc: r.loc, distributorId: r.location.distributorId }, at: now });
  // BA closure: repacks waiting for independent QC release (source stays intact until then)
  for (const rp of (s.repacks ?? []).filter((x) => x.status === 'pending_qc'))
    push({ key: `rpk:${rp.id}`, severity: 'medium', family: 'stock', title: `Repack ${rp.id} of ${rp.sourceLotId} waiting for QC release`, detail: `${fmtKg(rp.inputQty)} → ${rp.outputBags} × ${fmtKg(rp.targetBagSize)}${rp.loss ? ` + ${fmtKg(rp.loss)} recorded loss` : ''} at ${s.locations[rp.fromLoc]?.label ?? rp.fromLoc}. Nothing has moved yet.`, qty: fmtKg(rp.inputQty), ownerId: 'u_meera', roles: ['qc', 'godown', 'factory_head'], ownerDecision: false, link: link('stock/godowns', rp.id), action: 'Release repack', actionCap: 'quality.release', sourceId: rp.id, scope: { loc: rp.fromLoc }, at: rp.requestedAt, windowHours: 8 });
  // BA closure: multi-stop stops with refused / unresolved quantity still on the vehicle
  for (const t of s.trips.filter((x) => x.stops?.length))
    for (const st of t.stops!) {
      if (!st.outcome || st.disposition || !st.refusedQty) continue;
      push({ key: `stop:${t.id}#${st.seq}`, severity: 'high', family: 'delivery', title: `${fmtKg(st.refusedQty)} ${st.outcome === 'refused' ? 'refused' : 'part refused'} at stop ${st.seq} (${st.distributorId}) on ${t.id}`, detail: `${st.reason ?? ''} · receiver ${st.receiverName} · ${st.evidence}. Still in transit custody — decide the disposition.`, qty: fmtKg(st.refusedQty), ownerId: 'u_ravi', roles: ['godown', 'back_office', 'factory_head'], ownerDecision: false, link: link('distribution/logistics', t.id), action: 'Return to factory', actionCap: 'dispatch', sourceId: `${t.id}#${st.seq}`, scope: { loc: s.shipments.find((x) => x.id === st.shipmentId)?.transitLoc }, at: st.at!, windowHours: 12 });
    }
  const rank = { critical: 0, high: 1, medium: 2, low: 3 };
  return out.sort((a, b) => Number(b.ownerDecision) - Number(a.ownerDecision) || rank[a.severity] - rank[b.severity] || b.escalation - a.escalation || b.at.localeCompare(a.at));
}

export const isAcked = (s: RentioState, key: string) => s.acks.filter((a) => a.key === key);

/** Alerts an actor is accountable for or has escalated to them — always within their read scope. */
/** The alert read rule (roles + record scope). Also applied to incident children's snapshot scope once the live alert is gone. */
export function alertVisibleTo(s: RentioState, actor: RActor, a: Pick<Alert, 'roles' | 'scope' | 'ownerId'>, sc = readScope(actor)) {
  if (sc.all) return true;
  if (!a.roles.includes(actor.roleId)) return false;
  if (a.scope.distributorId && !(sc.allDistributors || sc.distributors.includes(a.scope.distributorId))) return false;
  if (a.scope.stage && !sc.factory && !sc.stages.includes(a.scope.stage)) return false;
  if (a.scope.loc && !canReadLoc(s, actor, a.scope.loc, sc)) return false;
  if (!a.scope.loc && !a.scope.distributorId && !a.scope.stage) return sc.factory || a.ownerId === actor.id;
  return true;
}

export function alertsFor(db: Db, actor: RActor, now: string) {
  const s = R(db);
  const sc = readScope(actor);
  return alerts(db, now).filter((a) => alertVisibleTo(s, actor, a, sc));
}

// ---------------------------------------------------------------- My Work

export interface WorkItem {
  key: string;
  kind: 'receive' | 'start' | 'output' | 'issue' | 'resume' | 'check' | 'approve' | 'dispatch' | 'reserve' | 'deliver' | 'shipment' | 'sync' | 'conflict' | 'collection' | 'hold' | 'putaway' | 'payroll' | 'disposition' | 'plan' | 'eta';
  title: string;
  detail: string;
  qty?: string;
  /** Exact source record (opens/highlights it). */
  sourceId: string;
  link: string;
  action: string;
  urgent?: boolean;
  stage?: StageCode;
  lotId?: string;
}

export function myWork(db: Db, actor: RActor, now: string): WorkItem[] {
  const s = R(db);
  const items: WorkItem[] = [];
  const stages = (actor.scope.stages ?? []) as StageCode[];
  const pos = computePositions(s);
  const at = (lot: string, loc: string) => pos.get(`${lot}|${loc}`) ?? 0;
  if (hasCap(actor, 'stage.operate') && stages.length) {
    for (const st of stages) {
      const sp = `&stage=${st}`;
      for (const h of s.handovers.filter((x) => outstanding(x) > 0 && x.toStage === st))
        items.push({ key: `rcv:${h.id}`, kind: 'receive', title: `Receive ${h.lotId}`, detail: `${stageName(st)} · issued by ${userName(h.issuedBy)}${h.received ? ` · ${fmtKg(h.received)} already received` : ''}`, qty: fmtKg(outstanding(h)), sourceId: h.id, link: link('production/stage', h.id, sp), action: 'Receive', urgent: h.received > 0, stage: st, lotId: h.lotId });
      for (const run of s.runs.filter((r) => r.stage === st && r.status !== 'completed')) {
        const t = runTiming(run, now);
        items.push({ key: `run:${run.id}`, kind: run.status === 'on_hold' ? 'resume' : 'output', title: `${run.status === 'on_hold' ? 'Resume' : 'Record output for'} ${run.inputLotId}`, detail: `${stageName(st)} · ${t.status}${t.etaSource === 'needs_update' ? ' · ETA needs update' : ''} · planned finish ${istHm(run.baselineFinish)}`, qty: fmtKg(run.inputQty), sourceId: run.id, link: link('production/stage', run.id, sp), action: run.status === 'on_hold' ? 'Resume' : 'Record output', urgent: t.status === 'Delayed', stage: st, lotId: run.inputLotId });
        if (t.etaSource === 'needs_update' && run.status === 'running') items.push({ key: `eta:${run.id}`, kind: 'eta', title: `Give a new finish time for ${run.inputLotId}`, detail: `${stageName(st)} passed its planned finish ${istHm(run.baselineFinish)}`, sourceId: run.id, link: link('production/stage', run.id, sp), action: 'Update ETA', urgent: true, stage: st, lotId: run.inputLotId });
      }
      for (const lot of Object.values(s.lots).filter((l) => at(l.id, `STG:${st}:IN`) > 0 && l.nextStage === st))
        items.push({ key: `start:${lot.id}:${st}`, kind: 'start', title: `Start ${stageName(st).toLowerCase()} for ${lot.id}`, detail: `${lot.label} · received and queued`, qty: fmtKg(at(lot.id, `STG:${st}:IN`)), sourceId: lot.id, link: link('production/stage', lot.id, sp), action: 'Start', stage: st, lotId: lot.id });
      for (const lot of Object.values(s.lots).filter((l) => at(l.id, `STG:${st}:OUT`) > 0 && l.nextStage))
        items.push({ key: `iss:${lot.id}`, kind: 'issue', title: `Issue ${lot.id} to ${lot.nextStage === 'F1' ? 'Finished Godown F1' : lot.nextStage === st ? `${stageName(st)} (rework pass)` : stageName(lot.nextStage as StageCode)}`, detail: lot.label, qty: fmtKg(at(lot.id, `STG:${st}:OUT`)), sourceId: lot.id, link: link('production/stage', lot.id, sp), action: 'Issue', stage: st, lotId: lot.id });
    }
  }
  if (hasCap(actor, 'godown.operate')) {
    for (const lot of Object.values(s.lots).filter((l) => at(l.id, 'R1') > 0 && l.nextStage === 'CLEAN'))
      items.push({ key: `iss:${lot.id}:R1`, kind: 'issue', title: `Issue ${lot.id} from Raw Godown R1 to Cleaning`, detail: lot.label, qty: fmtKg(at(lot.id, 'R1')), sourceId: lot.id, link: link('stock/godowns', lot.id), action: 'Issue to cleaning', lotId: lot.id });
    for (const h of s.handovers.filter((x) => outstanding(x) > 0 && x.toStage === 'F1'))
      items.push({ key: `put:${h.id}`, kind: 'putaway', title: `Put away ${h.lotId} into F1 stacks`, detail: `From packing · ${userName(h.issuedBy)}`, qty: fmtKg(outstanding(h)), sourceId: h.id, link: link('stock/godowns', h.id), action: 'Put away', lotId: h.lotId });
    for (const o of s.orders.filter((x) => x.kind === 'factory' && x.status === 'approved' && s.reservations.some((r) => r.orderId === x.id && r.status === 'active')))
      items.push({ key: `dsp:${o.id}`, kind: 'dispatch', title: `Dispatch ${o.id} to ${o.partyId}`, detail: 'Reserved stock ready to pick (FEFO)', qty: fmtKg(sum(s.reservations.filter((r) => r.orderId === o.id && r.status === 'active').map((r) => r.qty))), sourceId: o.id, link: link('distribution/orders', o.id), action: 'Dispatch' });
  }
  if (hasCap(actor, 'intake.check'))
    for (const i of s.intakes.filter((x) => x.status === 'under_inspection'))
      items.push({ key: `chk:${i.id}`, kind: 'check', title: `Check truck ${i.truck} (${i.lotId})`, detail: i.makerId === actor.id ? 'You recorded this — another checker must decide' : `Recorded by ${userName(i.makerId)}`, qty: fmtKg(i.net), sourceId: i.id, link: link('procurement/intake', i.id), action: i.makerId === actor.id ? 'View' : 'Check intake', urgent: i.makerId !== actor.id });
  if (hasCap(actor, 'order.reserve'))
    for (const o of s.orders.filter((x) => x.kind === 'factory' && x.status === 'approved' && !x.advance && x.lines.some((l) => lineBalance(s, x, l).unallocated > 0)))
      items.push({ key: `res:${o.id}`, kind: 'reserve', title: `Allocate stock for ${o.id} (${o.partyId})`, detail: `${o.lines.map((l) => l.grade).join('/')} · promised ${o.promisedDate ?? '—'}`, qty: fmtKg(sum(o.lines.map((l) => lineBalance(s, o, l).unallocated))), sourceId: o.id, link: link('distribution/orders', o.id), action: 'Reserve stock' });
  if (hasCap(actor, 'distributor.operate')) {
    const mine = actor.scope.distributors ?? [];
    for (const sh of s.shipments.filter((x) => x.status === 'in_transit' && mine.includes(x.toDistributor ?? '')))
      items.push({ key: `shp:${sh.id}`, kind: 'shipment', title: `Receive shipment ${sh.id}`, detail: `Dispatched ${istHm(sh.dispatchedAt)}`, qty: fmtKg(sum(sh.lines.map((l) => l.qty))), sourceId: sh.id, link: link('distribution/distributors', sh.id, `&d=${sh.toDistributor}`), action: 'Receive', urgent: true });
    for (const o of s.orders.filter((x) => x.kind === 'retail' && x.status === 'approved' && mine.includes(x.distributorId ?? '') && !x.advance))
      items.push({ key: `dlv:${o.id}`, kind: 'deliver', title: `Deliver ${o.id} to ${o.partyId}`, detail: 'Reserved at your godown — confirm with the challan on delivery', qty: fmtKg(o.lines[0].qty), sourceId: o.id, link: link('distribution/distributors', o.id, `&d=${o.distributorId}`), action: 'Confirm delivery' });
  }
  if (actor.roleId === 'salesman')
    for (const q of s.offline.queue.filter((x) => x.salesmanId === actor.id && (x.status === 'queued' || x.status === 'conflict')))
      items.push({ key: `off:${q.id}`, kind: q.status === 'queued' ? 'sync' : 'conflict', title: q.status === 'queued' ? `Sync order ${q.id} for ${q.retailerId}` : `Decide on order ${q.id} for ${q.retailerId}`, detail: q.conflict ?? `${q.grade}, captured offline`, qty: fmtKg(q.qty), sourceId: q.id, link: link('sales/salesman', q.id), action: q.status === 'queued' ? 'Sync' : 'Resolve', urgent: q.status === 'conflict' });
  if (hasCap(actor, 'tally.sync'))
    for (const t of s.tally.filter((x) => x.status !== 'acknowledged' && x.status !== 'reconciled'))
      items.push({ key: `tly:${t.id}`, kind: 'sync', title: `${t.status === 'queued' ? 'Send' : 'Retry'} ${t.sourceType} ${t.sourceId} to Tally`, detail: t.attempts[t.attempts.length - 1]?.message ?? `${t.party}`, sourceId: t.id, link: link('finance/tally', t.id), action: t.status === 'queued' ? 'Sync' : 'Retry', urgent: t.status !== 'queued' });
  if (hasCap(actor, 'collection.confirm'))
    for (const c of s.collections.filter((x) => x.status === 'provisional')) items.push({ key: `col:${c.id}`, kind: 'collection', title: `Confirm collection ${c.id}`, detail: `${c.mode} for ${c.orderId}`, sourceId: c.id, link: link('finance/tally', c.id), action: 'Confirm' });
  if (hasCap(actor, 'return.disposition'))
    for (const c of s.complaints.filter((x) => x.status === 'return_received' && !x.disposition)) items.push({ key: `disp:${c.id}`, kind: 'disposition', title: `Decide what to do with return ${c.id}`, detail: `${c.returnLotId} held at ${c.distributorId}`, qty: fmtKg(c.returnQty ?? 0), sourceId: c.id, link: link('sales/returns', c.id), action: 'Decide' });
  for (const a of s.approvals.filter((x) => x.status === 'pending' && hasCap(actor, x.requiredCapability) && (!x.ownerOnly || actor.roleId === 'owner')))
    items.push({ key: `apr:${a.id}`, kind: 'approve', title: a.requestedBy === actor.id ? `Waiting for another approver: ${a.summary}` : a.summary, detail: `Requested by ${userName(a.requestedBy)}`, qty: a.exposure, sourceId: a.id, link: link('home/approvals', a.id), action: a.requestedBy === actor.id ? 'View' : a.ownerOnly ? 'Decide' : 'Review', urgent: !!a.ownerOnly && a.requestedBy !== actor.id });
  if (hasCap(actor, 'hr.payroll')) {
    const imp = s.imports[s.imports.length - 1];
    if (imp && !s.payroll.some((p) => p.period === imp.at.slice(0, 7))) items.push({ key: 'pay:draft', kind: 'payroll', title: `Prepare payroll for ${imp.at.slice(0, 7)}`, detail: `${imp.accepted} punches imported (${imp.duplicates} duplicates ignored)`, sourceId: imp.id, link: link('hr/attendance', imp.id), action: 'Prepare payroll' });
  }
  // BA closure: QC releases of repacks; replenishment suggestions for their named reviewer
  if (hasCap(actor, 'quality.release'))
    for (const rp of (s.repacks ?? []).filter((x) => x.status === 'pending_qc'))
      items.push({ key: `rpk:${rp.id}`, kind: 'check', title: `Release repack ${rp.id} (${rp.sourceLotId})`, detail: rp.requestedBy === actor.id ? 'You recorded this — another checker must release it' : `${rp.outputBags} × ${fmtKg(rp.targetBagSize)} · recorded by ${userName(rp.requestedBy)}`, qty: fmtKg(rp.inputQty), sourceId: rp.id, link: link('stock/godowns', rp.id), action: 'Review & release', urgent: false });
  for (const x of openSuggestions(scopedSuggestions(db, actor, now)).filter((v) => v.reviewerId === actor.id))
    items.push({ key: `rpl:${x.key}`, kind: 'plan', title: `Review replenishment: ${x.title}`, detail: `${x.qtyLabel} suggested${x.needsConfirmation ? ' · stale partner data — confirm stock first' : ''}${x.review?.staleReason === 'qty' ? ' · quantity changed since last review' : x.review?.staleReason === 'data' ? ' · confirmation expired since last review' : ''}`, qty: x.qtyLabel, sourceId: x.key, link: link('planning/replenish', x.key), action: 'Review' });
  return items;
}

// ---------------------------------------------------------------- yield & by-products (M14)

export function yieldReport(s: RentioState, rootId: string) {
  const fam = new Set(familyOf(s, rootId));
  const runs = s.runs.filter((r) => fam.has(r.inputLotId)).sort((a, b) => a.events[0].at.localeCompare(b.events[0].at));
  const acc = lotAccounting(s, rootId);
  const outsOf = (kind: string) => sum(runs.flatMap((r) => r.outputs.filter((o) => o.kind === kind).map((o) => o.qty)));
  const packed = sum(runs.filter((r) => r.stage === 'PACK').flatMap((r) => r.outputs.filter((o) => o.kind === 'forward').map((o) => o.qty)));
  return {
    runs: runs.map((r) => {
      const fwd = sum(r.outputs.filter((o) => o.kind === 'forward').map((o) => o.qty));
      const add = sum(r.additions.map((a) => a.qty));
      return { run: r, forward: fwd, additions: add, passYield: r.inputQty ? fwd / (r.inputQty + add) : 0 };
    }),
    rootInput: acc.input,
    additions: sum(acc.additions.map((a) => a.qty)),
    saleable: packed,
    rework: outsOf('rework'),
    husk: outsOf('husk'),
    churi: outsOf('churi'),
    rejects: outsOf('reject'),
    loss: outsOf('loss'),
    rootYield: acc.input ? packed / acc.input : 0,
  };
}

export function byproductReconciliation(s: RentioState) {
  const types = ['HUSK', 'CHURI'] as const;
  return types.map((t) => {
    const lots = new Set(Object.values(s.lots).filter((l) => l.material === t).map((l) => l.id));
    const mv = s.movements.filter((m) => lots.has(m.lotId));
    const generation = sum(mv.filter((m) => m.kind === 'produce').map((m) => m.qty));
    const opening = sum(mv.filter((m) => m.kind === 'opening').map((m) => m.qty));
    const internal = sum(mv.filter((m) => m.kind === 'internal-use').map((m) => m.qty));
    const external = sum(mv.filter((m) => m.kind === 'external-dispatch').map((m) => m.qty));
    const adjust = sum(mv.filter((m) => m.kind === 'adjust').map((m) => (m.to ? m.qty : -m.qty)));
    const disposal = sum(mv.filter((m) => m.kind === 'dispose').map((m) => m.qty));
    const pos = computePositions(s);
    let closing = 0;
    pos.forEach((q, k) => {
      if (lots.has(k.split('|')[0])) closing += q;
    });
    const equation = opening + generation + adjust - internal - external - disposal;
    return { type: t, opening, generation, internal, external, adjust, disposal, closing, equation, reconciled: equation === closing };
  });
}

/** Lots whose root is not a migration/stores lot, for pickers. */
export const rootLots = (s: RentioState) => Object.values(s.lots).filter((l) => l.rootId === l.id && l.material === 'RAW');
