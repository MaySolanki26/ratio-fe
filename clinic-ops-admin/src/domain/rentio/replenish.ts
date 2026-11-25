/**
 * Replenishment suggestions (FR-101 / FR-106 / FR-113 / FR-117 / WF-12 / AC-26). Pure DERIVATION from the
 * ledger, approved demand, minimums, lead times and timely open supply — every input is shown with units,
 * its data cutoff and its source. A suggestion never posts stock, a purchase or an order: a named reviewer
 * accepts (and hands off to the existing Purchase / Order form) or defers it, and that review is audited.
 * Stale partner figures cannot be accepted until someone explicitly confirms the current stock.
 * All policy parameters are fictional demo values (config.ts DEMO.replenish, DEMO_ASSUMPTIONS.md).
 */
import type { Db } from '../../services/types';
import { hasCap, type RActor, userName } from './access';
import { DEMO } from './config';
import { lineBalance } from './commerce';
import { computePositions, type Ctx, fail, nextId, stockRows } from './engine';
import { purchaseBalances } from './ops';
import { readScope, visibleDistributorIds } from './scope';
import type { RentioState } from './types';
import { fmtKg, type Grams, kg, sum } from './units';
import { distributorOverview, R } from './views';

export interface Suggestion {
  key: string;
  kind: 'raw' | 'stores' | 'partner';
  title: string;
  /** Recommended quantity in the item's unit (grams for kg items, count×1000 for bags/pouches). */
  qty: Grams;
  unit: 'kg' | 'bags' | 'pouches';
  qtyLabel: string;
  action: 'purchase' | 'stores_purchase' | 'factory_order';
  /** Explicit inputs with units and source. */
  inputs: { label: string; value: string; source: string }[];
  formula: string;
  cutoff: string;
  freshness: 'current' | 'stale';
  /** Date the supply must be arranged by (order-by), and when it is needed. */
  orderBy: string;
  reviewerId: string;
  /** Handoff target page (existing form) with prefill query. */
  handoff: { page: string; label: string; query?: string };
  partyId?: string;
  grade?: string;
  needsConfirmation: boolean;
  confirmed?: { kg: Grams; by: string; at: string; note: string };
  /** `stale` = the review no longer matches: the quantity changed (`staleReason: 'qty'`) or the partner figures it relied on have expired (`'data'`). */
  review?: { decision: 'accepted' | 'deferred'; by: string; at: string; reason: string; qty: Grams; stale: boolean; staleReason?: 'qty' | 'data' };
}

const P = () => DEMO.replenish;
/** Plant-local (IST) calendar date, optionally shifted by whole days. */
const day = (iso: string, plusDays: number) => new Date(Date.parse(iso) + 330 * 60_000 + plusDays * 86_400_000).toISOString().slice(0, 10);
const bags = (n: number, unit: string) => `${n.toLocaleString('en-IN')} ${unit}`;

export function suggestions(db: Db, now: string): Suggestion[] {
  const s = R(db);
  const rows = stockRows(s, now);
  const pos = computePositions(s);
  const out: Suggestion[] = [];
  const cutoff = now;
  const p = P();

  // ---------------- plant raw (toor) — demand + minimum vs eligible raw + timely open supply
  const orders = s.orders.filter((o) => o.kind === 'factory' && o.status === 'approved');
  const demand = sum(orders.flatMap((o) => o.lines.map((l) => lineBalance(s, o, l).unallocated)));
  const finishedAvail = sum(rows.filter((r) => r.location?.kind === 'finished' && r.lot.material === 'PACKED').map((r) => r.available));
  const finishedGap = Math.max(0, demand + kg(p.finishedMinKg) - finishedAvail);
  const rawForDemand = Math.round((finishedGap * 100) / p.yieldPct);
  const rawReady = sum(rows.filter((r) => r.location?.kind === 'raw' && r.lot.material === 'RAW').map((r) => r.readyToProcess));
  const today = day(now, 0);
  const horizon = day(now, p.rawLeadDays);
  const openPOs = s.purchases.filter((x) => x.status === 'open' || x.status === 'partially_received').map((x) => ({ p: x, open: purchaseBalances(s, x).open })).filter((x) => x.open > 0);
  // only supply promised from today up to the lead-time horizon is timely; an already-passed promise is late, not incoming
  const timely = openPOs.filter((x) => x.p.promisedDate && x.p.promisedDate >= today && x.p.promisedDate <= horizon);
  const overdue = openPOs.filter((x) => x.p.promisedDate && x.p.promisedDate < today);
  const beyond = openPOs.filter((x) => x.p.promisedDate && x.p.promisedDate > horizon);
  const undated = openPOs.filter((x) => !x.p.promisedDate);
  const notCounted = (label: string, list: typeof openPOs) =>
    list.length ? [{ label: `Open purchases NOT counted — ${label}`, value: fmtKg(sum(list.map((x) => x.open))), source: list.map((x) => `${x.p.id} ${fmtKg(x.open)} promised ${x.p.promisedDate ?? '—'}`).join(', ') }] : [];
  const incoming = sum(timely.map((x) => x.open));
  const rawNeed = Math.max(0, kg(p.rawMinKg) + rawForDemand - rawReady - incoming);
  const rawQty = rawNeed - (rawNeed % 1000); // quantities are grams: drop the part below 1 kg
  out.push({
    key: 'raw:TOOR',
    kind: 'raw',
    title: 'Raw toor for Plant 1 (R1)',
    qty: rawQty,
    unit: 'kg',
    qtyLabel: fmtKg(rawQty),
    action: 'purchase',
    inputs: [
      { label: 'Approved open demand not yet allocated', value: fmtKg(demand), source: `${orders.length} approved factory orders incl. advance bookings (credit-hold orders excluded)` },
      { label: 'Finished minimum (F1)', value: fmtKg(kg(p.finishedMinKg)), source: 'Demo policy' },
      { label: 'Eligible finished stock available', value: fmtKg(finishedAvail), source: 'Ledger: released, unreserved packed dal in F1' },
      { label: `Raw needed for the finished gap at ${p.yieldPct}% demo yield`, value: fmtKg(rawForDemand), source: `${fmtKg(finishedGap)} ÷ ${p.yieldPct}%` },
      { label: 'Raw cover minimum', value: fmtKg(kg(p.rawMinKg)), source: 'Demo policy' },
      { label: 'Raw ready to process in R1', value: fmtKg(rawReady), source: 'Ledger: accepted, not held' },
      { label: `Open purchases arriving ${today} to ${horizon} (counted)`, value: fmtKg(incoming), source: timely.map((x) => `${x.p.id} ${fmtKg(x.open)} promised ${x.p.promisedDate}`).join(', ') || 'none' },
      ...notCounted(`promised date already passed (late, follow up supplier)`, overdue),
      ...notCounted(`promised after the ${p.rawLeadDays}-day lead time (${horizon})`, beyond),
      ...notCounted('no promised date', undated),
    ],
    formula: 'need = raw minimum + raw for finished gap − raw ready − timely open purchases (rounded down to whole kg)',
    cutoff,
    freshness: 'current',
    orderBy: today,
    reviewerId: 'u_kiran',
    handoff: { page: 'procurement/intake', label: 'Open Purchases & truck intake', query: `new=purchase&kg=${rawQty / 1000}` },
    needsConfirmation: false,
  });

  // ---------------- critical stores incl. packaging
  for (const it of p.stores) {
    const lot = s.lots[it.lotId];
    if (!lot) continue;
    const onHand = pos.get(`${it.lotId}|STORES`) ?? 0;
    const unitG = it.unit === 'kg' ? 1000 : 1000; // bags/pouches are stored as count × 1000
    const have = onHand / unitG;
    const pendingRepack = it.unit !== 'kg' ? sum((s.repacks ?? []).filter((x) => x.status === 'pending_qc' && x.packagingLotId === it.lotId).map((x) => x.outputBags)) : 0;
    const projected = have - pendingRepack;
    const need = projected < it.min ? Math.ceil(it.max - projected) : 0;
    out.push({
      key: `stores:${it.lotId}`,
      kind: 'stores',
      title: `${it.label} (${it.lotId})`,
      qty: need * 1000,
      unit: it.unit,
      qtyLabel: bags(need, it.unit),
      action: 'stores_purchase',
      inputs: [
        { label: 'On hand in stores', value: bags(have, it.unit), source: 'Ledger: stores movements (counted)' },
        ...(pendingRepack ? [{ label: 'Committed to repacks awaiting QC release', value: bags(pendingRepack, it.unit), source: (s.repacks ?? []).filter((x) => x.status === 'pending_qc' && x.packagingLotId === it.lotId).map((x) => x.id).join(', ') }] : []),
        { label: 'Minimum / reorder-to level', value: `${bags(it.min, it.unit)} / ${bags(it.max, it.unit)}`, source: 'Demo policy' },
        { label: 'Vendor lead time', value: `${it.leadDays} days`, source: 'Demo policy' },
        { label: 'Open stores purchases', value: '0', source: 'No stores purchase orders are recorded in this prototype' },
      ],
      formula: 'if projected < minimum: order up to the reorder-to level',
      cutoff,
      freshness: 'current',
      orderBy: today,
      reviewerId: 'u_ravi',
      handoff: { page: 'procurement/intake', label: 'Open Purchases (stores buying is recorded outside this prototype)' },
      needsConfirmation: false,
    });
  }

  // ---------------- partner (distributor) recommendations
  const conf = s.partnerConfirmations ?? [];
  const lvl = (min: number) => kg(min + p.partnerLeadDays * p.partnerDailyOfftakeKg);
  for (const d of distributorOverview(db, now)) {
    const rec = db.records.distributors?.find((x) => x.id === d.id);
    const min = Number(rec?.minStockKg ?? 0);
    const max = Number(rec?.maxStockKg ?? 0);
    const c = [...conf].reverse().find((x) => x.distributorId === d.id && Date.parse(x.at) > Date.parse(now) - DEMO.staleDistributorHours * 3_600_000);
    const stockUsed = c ? c.kg : d.available;
    const projected = stockUsed + d.inTransit;
    if (projected >= lvl(min)) continue;
    let need = kg(max) - projected;
    need -= need % kg(25);
    const g = rows.filter((r) => r.location?.distributorId === d.id && r.lot.grade).sort((a, b) => b.qty - a.qty)[0]?.lot.grade ?? 'A1';
    const synced = new Date(Date.parse(now) - d.lastSyncHours * 3_600_000).toISOString();
    out.push({
      key: `partner:${d.id}`,
      kind: 'partner',
      title: `${d.id} · ${d.name}`,
      qty: need,
      unit: 'kg',
      qtyLabel: `${fmtKg(need)} ${g}`,
      action: 'factory_order',
      partyId: d.id,
      grade: g,
      inputs: [
        { label: c ? 'Confirmed stock (explicit)' : 'App-reported available stock', value: fmtKg(stockUsed), source: c ? `Confirmed by ${userName(c.by)}: ${c.note}` : `Distributor app, last sync ${d.lastSyncHours} h ago` },
        { label: 'In transit to the distributor', value: fmtKg(d.inTransit), source: 'Ledger: dispatched shipments not yet received' },
        { label: 'Reorder level', value: fmtKg(lvl(min)), source: `min ${min} kg + ${p.partnerLeadDays} days × ${p.partnerDailyOfftakeKg} kg/day (demo)` },
        { label: 'Refill-to (maximum)', value: fmtKg(kg(max)), source: 'Distributor master' },
      ],
      formula: 'if available + in transit < reorder level: suggest maximum − (available + in transit), whole 25 kg bags',
      cutoff: c?.at ?? synced,
      freshness: d.stale && !c ? 'stale' : 'current',
      orderBy: today,
      reviewerId: 'u_kiran',
      handoff: { page: 'distribution/orders', label: 'Open Orders & dispatch (new factory order prefilled)', query: `new=order&d=${d.id}&grade=${g}&kg=${need / 1000}` },
      needsConfirmation: d.stale && !c,
      confirmed: c ? { kg: c.kg, by: c.by, at: c.at, note: c.note } : undefined,
    });
  }

  const reviews = s.replenishReviews ?? [];
  return out.map((x) => {
    const r = [...reviews].reverse().find((v) => v.key === x.key);
    if (!r) return x;
    // A review made on fresh / confirmed figures no longer stands once those figures expire — even if the
    // stale app value happens to equal the reviewed quantity. History is kept; the hand-off is withheld.
    const staleReason = r.qty !== x.qty ? 'qty' : x.needsConfirmation && r.basis !== 'stale' ? 'data' : undefined;
    return { ...x, review: { decision: r.decision, by: r.by, at: r.at, reason: r.reason, qty: r.qty, stale: !!staleReason, staleReason } };
  });
}

/** The one read-scoped suggestion list for every surface (dashboard, page, My work): partner items only for
 * distributors the actor may read, plant items only with plant scope. */
export function scopedSuggestions(db: Db, actor: RActor, now: string, all = suggestions(db, now)): Suggestion[] {
  const sc = readScope(actor);
  const vis = visibleDistributorIds((db.records.distributors ?? []).map((d) => String(d.id)), actor);
  return all.filter((x) => (x.kind === 'partner' ? vis.includes(x.partyId!) : sc.factory));
}

/** Actionable now: a positive quantity and no review that still matches the current derivation. */
export const openSuggestions = (list: Suggestion[]) => list.filter((x) => x.qty > 0 && (!x.review || x.review.stale));

const reviewsOf = (s: RentioState) => s.replenishReviews ?? (s.replenishReviews = []);

/** Named reviewer (or Owner / Factory Head) accepts or defers. Records the inputs; posts nothing else. */
export function reviewSuggestion(ctx: Ctx, r: { key: string; decision: 'accepted' | 'deferred'; reason: string }) {
  const all = suggestions(ctx.db, ctx.now);
  const sug = scopedSuggestions(ctx.db, ctx.actor, ctx.now, all).find((x) => x.key === r.key) ?? (all.some((x) => x.key === r.key) ? fail('forbidden', `${ctx.actor.roleLabel} cannot read this suggestion`) : fail('not_found', 'Suggestion no longer applies'));
  if (ctx.actor.id !== sug.reviewerId && !hasCap(ctx.actor, 'scope.all') && !hasCap(ctx.actor, 'plan.manage')) fail('forbidden', `${userName(sug.reviewerId)} is the named reviewer for this suggestion`);
  if (sug.qty <= 0) fail('business_rule', 'Nothing to replenish — the derived quantity is zero');
  if (sug.review && !sug.review.stale) fail('duplicate', `Already ${sug.review.decision} by ${userName(sug.review.by)} for the same quantity`);
  if (r.decision === 'accepted' && sug.needsConfirmation) fail('business_rule', `${sug.partyId} stock data is stale (${sug.inputs[0].source}). Confirm the current stock first — stale figures never turn into an order automatically.`);
  if (!r.reason?.trim()) fail('validation', r.decision === 'deferred' ? 'Say why it is deferred and until when' : 'Add a short note (e.g. supplier / quantity agreed)');
  const basis = sug.needsConfirmation ? 'stale' : sug.confirmed ? 'confirmed' : 'feed';
  const rev = { id: nextId(ctx.s, 'RPL'), key: sug.key, decision: r.decision, qty: sug.qty, reason: r.reason.trim(), by: ctx.actor.id, at: ctx.at, inputs: sug.inputs.map((i) => `${i.label}: ${i.value}`).join(' | '), handoff: r.decision === 'accepted' ? sug.handoff.page : undefined, basis } as const;
  reviewsOf(ctx.s).push(rev);
  return rev;
}

/** Explicit, attributed confirmation of a partner's current stock (phone/visit) — required before acting on stale data. */
export function confirmPartnerStock(ctx: Ctx, c: { distributorId: string; kg: number; note: string }) {
  if (!hasCap(ctx.actor, 'order.create.factory') && !hasCap(ctx.actor, 'scope.all')) fail('forbidden', `${ctx.actor.roleLabel} cannot confirm partner stock`);
  if (!visibleDistributorIds([c.distributorId], ctx.actor).length) fail('forbidden', `${c.distributorId} is outside your area of work`);
  if (!(c.kg >= 0)) fail('validation', 'Enter the confirmed available stock in kg');
  if (!c.note?.trim()) fail('validation', 'Say how the stock was confirmed (call / visit, with whom)');
  const list = ctx.s.partnerConfirmations ?? (ctx.s.partnerConfirmations = []);
  const rec = { distributorId: c.distributorId, kg: kg(c.kg), by: ctx.actor.id, at: ctx.at, note: c.note.trim() };
  list.push(rec);
  return rec;
}
