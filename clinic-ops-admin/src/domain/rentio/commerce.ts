/**
 * M7 Dispatch & In-Transit, M8 Distributor inventory, M9 Salesman & CRM,
 * M10 Tally & compliance (simulated), M11 Returns & complaints, M12 Logistics.
 */
import { hasCap } from './access';
import { DEMO } from './config';
import { DEMO_RATES, RETAIL_RATES } from './data';
import { type Ctx, createLot, ensureLocation, fail, ineligibility, move, nextId, notSelf, requireCap, requireScope, stockRows } from './engine';
import { applyResidual, enqueueTally, rec, registerApplier, requestApproval } from './ops';
import type { Complaint, OfflineOrder, Order, OrderLine, RApproval, Reservation, Shipment, TallyDoc, Trip } from './types';
import { fmtINR, fmtKg, type Grams, kg, rupees, sum, valueOf } from './units';

export const distLoc = (d: string) => `DIST:${d}`;
export const distHeld = (d: string) => `DIST:${d}:HELD`;

// ================================================================ rates (FR-051)

export function currentRate(ctx: Pick<Ctx, 's'>, grade: string, kind: 'factory' | 'retail' = 'factory') {
  const key = kind === 'retail' ? `R:${grade}` : grade;
  const r = [...ctx.s.rates].reverse().find((x) => x.grade === key && !x.validTo);
  if (!r) fail('business_rule', `No active ${kind} rate for ${grade}`);
  return r!;
}

export function publishRate(ctx: Ctx, p: { grade: string; kind: 'factory' | 'retail'; ratePerKg: number }) {
  requireCap(ctx, 'rates.manage', 'publish rates');
  const key = p.kind === 'retail' ? `R:${p.grade}` : p.grade;
  ctx.s.rates.filter((x) => x.grade === key && !x.validTo).forEach((x) => (x.validTo = ctx.at));
  const r = { id: nextId(ctx.s, 'RATE'), grade: key, ratePerKg: rupees(p.ratePerKg), validFrom: ctx.at, createdBy: ctx.actor.id };
  ctx.s.rates.push(r);
  return r;
}

export const seedRates = (ctx: Ctx) => {
  Object.entries(DEMO_RATES).forEach(([g, r]) => ctx.s.rates.push({ id: nextId(ctx.s, 'RATE'), grade: g, ratePerKg: rupees(r), validFrom: ctx.at, createdBy: 'u_neha' }));
  Object.entries(RETAIL_RATES).forEach(([g, r]) => ctx.s.rates.push({ id: nextId(ctx.s, 'RATE'), grade: `R:${g}`, ratePerKg: rupees(r), validFrom: ctx.at, createdBy: 'u_neha' }));
};

// ================================================================ order balances (§14 order-balance check)

export function lineBalance(s: Ctx['s'], o: Order, l: OrderLine) {
  const res = s.reservations.filter((r) => r.orderId === o.id && r.lineId === l.id);
  const reserved = sum(res.filter((r) => r.status === 'active').map((r) => r.qty));
  const ships = s.shipments.filter((sh) => sh.orderId === o.id);
  const dispatched = sum(ships.flatMap((sh) => sh.lines.filter((x) => x.orderLineId === l.id).map((x) => x.qty)));
  const receivedGood = sum(ships.map((sh) => (sh.receipt ? lineShare(sh, l.id, sh.receipt.good + sh.receipt.damaged) : 0)));
  // still physically in transit custody (unsettled), allocated to lines in shipment order after receipts
  const unsettled = sum(ships.map((sh) => lineShareAfter(sh, l.id, sh.receipt ? sh.receipt.good + sh.receipt.damaged : 0, transitLeftOf(s, sh))));
  // refused at a delivery stop and returned to the factory: the order quantity is open again (not "delivered")
  const returned = sum(ships.map((sh) => lineShareAfter(sh, l.id, sh.receipt ? sh.receipt.good + sh.receipt.damaged : 0, returnedOf(s, sh))));
  const delivered = o.kind === 'retail' ? sum(s.movements.filter((m) => m.kind === 'deliver-retail' && m.ref === `${o.id}:${l.id}`).map((m) => m.qty)) : o.kind === 'byproduct' ? dispatched : receivedGood;
  const inTransit = o.kind === 'factory' ? unsettled : 0;
  /** dispatched but neither received nor still in transit: settled by approval (found elsewhere / loss) */
  const settledOther = o.kind === 'factory' ? Math.max(0, dispatched - receivedGood - unsettled - returned) : 0;
  const fulfilled = o.kind === 'retail' ? delivered : dispatched - returned;
  const unallocated = Math.max(0, l.qty - l.cancelled - reserved - fulfilled);
  return { ordered: l.qty, cancelled: l.cancelled, reserved, dispatched, inTransit, settledOther, returned, delivered, unallocated, value: valueOf(l.qty - l.cancelled, l.ratePerKg) };
}

/** Quantity taken back from a shipment's transit custody to the factory (refused-stop disposition). */
function returnedOf(s: Ctx['s'], sh: Shipment) {
  return sum(s.movements.filter((m) => m.kind === 'return-receive' && m.from === sh.transitLoc).map((m) => m.qty));
}

/** Quantity of `settled` that belongs to one order line; a line may be split over several shipment lines (stacks). */
function lineShare(sh: Shipment, lineId: string, settled: Grams) {
  let left = settled;
  let mine = 0;
  for (const ln of sh.lines) {
    const take = Math.min(left, ln.qty);
    if (ln.orderLineId === lineId) mine += take;
    left -= take;
  }
  return mine;
}

/** Of `amount` remaining after the first `skip` grams, how much belongs to this order line. */
function lineShareAfter(sh: Shipment, lineId: string, skip: Grams, amount: Grams) {
  let toSkip = skip;
  let left = amount;
  let mine = 0;
  for (const ln of sh.lines) {
    let cap = ln.qty;
    const sk = Math.min(toSkip, cap);
    toSkip -= sk;
    cap -= sk;
    const take = Math.min(left, cap);
    if (ln.orderLineId === lineId) mine += take;
    left -= take;
  }
  return mine;
}

function transitLeftOf(s: Ctx['s'], sh: Shipment) {
  if (!sh.transitLoc) return 0;
  let t = 0;
  for (const m of s.movements) {
    if (m.to === sh.transitLoc) t += m.qty;
    if (m.from === sh.transitLoc) t -= m.qty;
  }
  return Math.max(0, t);
}

export type OrderStatusCode = 'cancelled' | 'credit_hold' | 'advance' | 'at_risk' | 'awaiting_stock' | 'partly_allocated' | 'ready_to_dispatch' | 'in_transit' | 'disputed' | 'partially_delivered' | 'delivered';

/**
 * ONE physical fulfilment status per order, derived from reservations, shipment outcomes and remaining
 * quantities (owner overview, Orders & dispatch and distributor views all use it). It says nothing about
 * payment: financial settlement is tracked separately by Accounts.
 */
export function orderStatus(s: Ctx['s'], o: Order, eligible?: (lotId: string, loc: string) => boolean): { code: OrderStatusCode; label: string; detail: string } {
  const bal = o.lines.map((l) => lineBalance(s, o, l));
  const tot = (k: keyof ReturnType<typeof lineBalance>) => sum(bal.map((b) => b[k] as number));
  const net = sum(o.lines.map((l) => l.qty - l.cancelled));
  if (o.status === 'cancelled' || net === 0) return { code: 'cancelled', label: 'Cancelled', detail: 'No open quantity' };
  if (o.status === 'credit_hold') return { code: 'credit_hold', label: 'Credit hold', detail: 'Waiting for a credit decision before stock is allocated' };
  if (o.advance) return { code: 'advance', label: 'Advance booking', detail: 'Planned demand — no stock reserved' };
  const ships = s.shipments.filter((sh) => sh.orderId === o.id);
  const delivered = tot('delivered');
  const inTransit = tot('inTransit');
  const openDispute = ships.some((sh) => s.disputes.some((d) => d.id === sh.disputeId && d.status === 'open'));
  const risky = s.reservations.filter((r) => r.orderId === o.id && r.status === 'active' && eligible && !eligible(r.lotId, r.location));
  const remaining = tot('unallocated') + tot('reserved');
  if (risky.length) return { code: 'at_risk', label: 'At risk — reserved stock on hold', detail: `${fmtKg(sum(risky.map((r) => r.qty)))} reserved on stock that cannot ship; reallocate eligible stock` };
  const refused = ships.filter((sh) => sh.receipt?.refused && transitLeftOf(s, sh) > 0);
  if (refused.length && inTransit > 0)
    return { code: 'disputed', label: `Refused at delivery — ${fmtKg(sum(refused.map((sh) => transitLeftOf(s, sh))))} on the vehicle`, detail: `${fmtKg(delivered)} accepted; refused quantity stays in transit custody until Godown/Dispatch returns it to the factory` };
  if (openDispute && inTransit > 0) return { code: 'disputed', label: `Disputed — ${fmtKg(inTransit)} short`, detail: `${fmtKg(delivered)} received; ${fmtKg(inTransit)} unresolved in transit under investigation` };
  if (inTransit > 0) return { code: 'in_transit', label: `In transit — ${fmtKg(inTransit)}`, detail: `${fmtKg(delivered)} received so far` };
  if (delivered >= net) return { code: 'delivered', label: 'Delivered (receipt confirmed)', detail: 'Physical delivery complete; payment is followed up separately in Accounts' };
  if (delivered > 0 && delivered + tot('settledOther') >= net && remaining === 0)
    return { code: 'delivered', label: `Delivered — ${fmtKg(tot('settledOther'))} shortfall settled`, detail: `${fmtKg(delivered)} received; the rest was settled by an approved decision. Payment is followed up separately in Accounts` };
  if (delivered > 0 || tot('settledOther') > 0) return { code: 'partially_delivered', label: `Partly delivered — ${fmtKg(remaining)} open`, detail: `${fmtKg(delivered)} received${tot('settledOther') ? `, ${fmtKg(tot('settledOther'))} settled by approval` : ''}` };
  if (tot('reserved') > 0 && tot('unallocated') > 0) return { code: 'partly_allocated', label: `Partly allocated — ${fmtKg(tot('unallocated'))} short`, detail: `${fmtKg(tot('reserved'))} reserved and ready` };
  if (tot('reserved') > 0) return { code: 'ready_to_dispatch', label: 'Ready to dispatch', detail: `${fmtKg(tot('reserved'))} reserved (FEFO)` };
  return { code: 'awaiting_stock', label: `Awaiting stock — ${fmtKg(tot('unallocated'))}`, detail: 'Nothing reserved yet' };
}

// ================================================================ M7 factory → distributor orders

function creditExposure(ctx: Ctx, distributorId: string, excludeOrder?: string) {
  const open = ctx.s.orders.filter((o) => o.kind === 'factory' && o.partyId === distributorId && o.id !== excludeOrder && !['cancelled'].includes(o.status));
  const orderValue = sum(open.flatMap((o) => o.lines.map((l) => valueOf(l.qty - l.cancelled, l.ratePerKg))));
  const paid = sum(ctx.s.collections.filter((c) => c.creditor === 'Rentio' && c.debtor === distributorId && c.status === 'confirmed').map((c) => c.amount));
  return orderValue - paid;
}

export function createFactoryOrder(ctx: Ctx, o: { distributorId: string; lines: { grade: string; kg: number }[]; promisedDate?: string; advance?: boolean }) {
  requireCap(ctx, 'order.create.factory', 'create factory sales orders');
  const dist = rec(ctx, 'distributors', o.distributorId) ?? fail('validation', 'Choose a distributor');
  if (!o.lines.length || o.lines.some((l) => !(l.kg > 0))) fail('validation', 'Each order line needs a quantity');
  const lines: OrderLine[] = o.lines.map((l, i) => {
    const sku = ctx.db.records.skus?.find((s) => s.grade === l.grade && s.active !== false);
    if (!sku) fail('business_rule', `No active SKU for grade ${l.grade} (FR-001)`);
    if (kg(l.kg) % kg(Number(sku!.packKg)) !== 0) fail('validation', `${l.grade}: order in whole ${sku!.packKg} kg bags`);
    const r = currentRate(ctx, l.grade);
    return { id: `L${i + 1}`, grade: l.grade, sku: String(sku!.id), qty: kg(l.kg), ratePerKg: r.ratePerKg, rateVersion: r.id, cancelled: 0 };
  });
  const order: Order = { id: nextId(ctx.s, 'SO'), kind: 'factory', partyId: o.distributorId, lines, status: 'approved', source: 'office', promisedDate: o.promisedDate, createdAt: ctx.at, createdBy: ctx.actor.id, advance: o.advance, revisions: [] };
  const value = sum(lines.map((l) => valueOf(l.qty, l.ratePerKg)));
  const limit = rupees(Number(dist.creditLimit ?? 0));
  const exposure = creditExposure(ctx, o.distributorId) + value;
  if (exposure > limit) {
    order.status = 'credit_hold';
    requestApproval(ctx, { type: 'credit_override', ref: order.id, summary: `${order.id} for ${dist.name}: exposure ${fmtINR(exposure, true)} exceeds limit ${fmtINR(limit, true)}`, rule: 'BR-009: credit limit enforced; override needs authorized approval', exposure: fmtINR(exposure - limit, true), payload: { orderId: order.id }, requiredCapability: 'approve.credit', ownerOnly: exposure - limit > rupees(DEMO.ownerExposureRupees) });
  } else order.approvedBy = 'delegated: within credit limit';
  ctx.s.orders.push(order);
  return order;
}

/** FEFO allocation over ELIGIBLE stock only (held/expired excluded first — EC-25). */
export function eligibleFor(ctx: Pick<Ctx, 's' | 'at'>, grade: string, locFilter: (loc: string) => boolean) {
  return stockRows(ctx.s, ctx.at)
    .filter((r) => locFilter(r.loc) && r.lot.grade === grade && r.lot.material === 'PACKED' && r.available > 0)
    .sort((a, b) => (a.lot.expiry ?? '').localeCompare(b.lot.expiry ?? '') || a.loc.localeCompare(b.loc));
}

function reserveLine(ctx: Ctx, o: Order, l: OrderLine, rows: ReturnType<typeof eligibleFor>, limit?: Grams) {
  const bal = lineBalance(ctx.s, o, l);
  let need = Math.min(bal.unallocated, limit ?? Infinity);
  const made: Reservation[] = [];
  for (const r of rows) {
    if (need <= 0) break;
    const bag = r.lot.bagSize ?? 1000;
    const avail = r.available - (r.available % bag);
    const take = Math.min(need - (need % bag), avail);
    if (take <= 0) continue;
    const res: Reservation = { id: nextId(ctx.s, 'RES'), lotId: r.lotId, location: r.loc, qty: take, orderId: o.id, lineId: l.id, status: 'active', createdAt: ctx.at, createdBy: ctx.actor.id };
    ctx.s.reservations.push(res);
    r.available -= take;
    need -= take;
    made.push(res);
  }
  return made;
}

/** Reservation protects stock; physical quantity is unchanged (BR-019). */
export function reserveOrder(ctx: Ctx, orderId: string) {
  requireCap(ctx, 'order.reserve', 'reserve stock');
  const o = ctx.s.orders.find((x) => x.id === orderId) ?? fail('not_found', 'Order not found');
  if (o.kind !== 'factory') fail('business_rule', 'Use distributor reservation for retail orders');
  if (o.status !== 'approved') fail('business_rule', `Order is ${o.status.replace('_', ' ')} — it cannot be reserved`);
  if (o.advance) fail('business_rule', 'Advance bookings are planned demand; they never hard-reserve physical stock (FR-054)');
  const made: Reservation[] = [];
  for (const l of o.lines) made.push(...reserveLine(ctx, o, l, eligibleFor(ctx, l.grade, (loc) => ctx.s.locations[loc]?.kind === 'finished')));
  if (!made.length) fail('business_rule', 'No eligible released stock is available for this order (held/expired stock is excluded)');
  const short = o.lines.map((l) => lineBalance(ctx.s, o, l).unallocated).reduce((a, b) => a + b, 0);
  return { reservations: made, short };
}

/**
 * Atomic replacement of reservations that sit on held/expired stock: release them and re-reserve eligible
 * stock (FEFO) in ONE transaction. Fails, changing nothing, if eligible stock cannot cover the released quantity.
 * The held lot itself stays blocked (holds are untouched).
 */
export function reallocateAtRisk(ctx: Ctx, orderId: string) {
  requireCap(ctx, 'order.reserve', 'reallocate reservations');
  const o = ctx.s.orders.find((x) => x.id === orderId) ?? fail('not_found', 'Order not found');
  const rows = stockRows(ctx.s, ctx.at);
  const atRisk = ctx.s.reservations.filter((r) => r.orderId === o.id && r.status === 'active' && !rows.find((x) => x.lotId === r.lotId && x.loc === r.location)?.sellable);
  if (!atRisk.length) fail('business_rule', `${o.id} has no reservations on held or expired stock`);
  const freed = sum(atRisk.map((r) => r.qty));
  atRisk.forEach((r) => (r.status = 'released'));
  const made: Reservation[] = [];
  for (const l of o.lines) made.push(...reserveLine(ctx, o, l, eligibleFor(ctx, l.grade, (loc) => ctx.s.locations[loc]?.kind === 'finished')));
  const got = sum(made.map((r) => r.qty));
  if (got < freed) fail('business_rule', `Only ${fmtKg(got)} of eligible ${o.lines.map((l) => l.grade).join('/')} is free; ${fmtKg(freed)} is needed. Nothing was changed — the order stays at risk until stock is released or produced.`);
  o.revisions.push({ at: ctx.at, by: ctx.actor.id, change: `Reallocated ${fmtKg(freed)} from held stock to ${made.map((r) => `${r.lotId} @ ${r.location}`).join(', ')}` });
  return { released: atRisk.length, reserved: made };
}

export function releaseReservations(ctx: Ctx, orderId: string, reason: string) {
  requireCap(ctx, 'order.reserve', 'release reservations');
  if (!reason?.trim()) fail('validation', 'Give a reason for releasing the reservation');
  const res = ctx.s.reservations.filter((r) => r.orderId === orderId && r.status === 'active');
  if (!res.length) fail('business_rule', 'No active reservations');
  res.forEach((r) => (r.status = 'released'));
  return res.length;
}

export function cancelOrderLine(ctx: Ctx, c: { orderId: string; lineId: string; kg: number; reason: string }) {
  const o = ctx.s.orders.find((x) => x.id === c.orderId) ?? fail('not_found', 'Order not found');
  requireCap(ctx, o.kind === 'factory' ? 'order.create.factory' : 'order.create.retail', 'amend this order');
  const l = o.lines.find((x) => x.id === c.lineId) ?? fail('not_found', 'Line not found');
  const b = lineBalance(ctx.s, o, l);
  const q = kg(c.kg);
  const cancellable = l.qty - l.cancelled - b.dispatched - (o.kind === 'retail' ? b.delivered : 0);
  if (q > cancellable) fail('business_rule', `Only ${fmtKg(cancellable)} is not yet dispatched/delivered. Shipped quantity follows the return/credit workflow (FR-056, EC-26).`);
  l.cancelled += q;
  // release only reservations no longer needed
  let excess = b.reserved - Math.max(0, l.qty - l.cancelled - b.dispatched);
  for (const r of ctx.s.reservations.filter((x) => x.orderId === o.id && x.lineId === l.id && x.status === 'active')) {
    if (excess <= 0) break;
    if (r.qty <= excess) {
      r.status = 'released';
      excess -= r.qty;
    } else {
      r.qty -= excess;
      excess = 0;
    }
  }
  o.revisions.push({ at: ctx.at, by: ctx.actor.id, change: `${l.id}: cancelled ${fmtKg(q)} — ${c.reason}` });
  return o;
}

export function dispatchOrder(
  ctx: Ctx,
  d: { orderId: string; transporterId: string; vehicle: string; driver: string; vehicleGrossKg?: number; vehicleTareKg?: number; /** multi-stop: the caller creates one trip for all shipments */ noTrip?: boolean },
): Shipment {
  requireCap(ctx, 'dispatch', 'dispatch shipments');
  const o = ctx.s.orders.find((x) => x.id === d.orderId) ?? fail('not_found', 'Order not found');
  if (o.status !== 'approved') fail('business_rule', `Order is ${o.status}; credit/approval gate not cleared`);
  const res = ctx.s.reservations.filter((r) => r.orderId === o.id && r.status === 'active');
  if (!res.length) fail('business_rule', 'Nothing reserved to dispatch');
  // a reservation on stock that became held/expired is Supply At Risk and cannot be picked (EC-24)
  for (const r of res) {
    const why = ineligibility(ctx.s, r.lotId, r.location, ctx.at);
    if (why.length) fail('business_rule', `Reservation ${r.id} (${r.lotId}) is at risk: ${why[0]}. Pick blocked; reallocate eligible stock.`);
  }
  const net = sum(res.map((r) => r.qty));
  const bags = sum(res.map((r) => r.qty / (ctx.s.lots[r.lotId].bagSize ?? r.qty)));
  const packagingTare = bags * DEMO.bagTareG;
  if (d.vehicleGrossKg !== undefined && d.vehicleTareKg !== undefined) {
    const cargo = kg(d.vehicleGrossKg) - kg(d.vehicleTareKg);
    const expected = net + packagingTare;
    const diff = Math.abs(cargo - expected);
    if (diff > (net * DEMO.dispatchTolerancePct) / 100)
      fail('business_rule', `Dispatch weight check failed: cargo ${fmtKg(cargo)} vs expected ${fmtKg(expected)} (net dal ${fmtKg(net)} + packaging ${fmtKg(packagingTare)}). Difference ${fmtKg(diff)} exceeds ${DEMO.dispatchTolerancePct}% — vehicle stays on hold pending supervisor approval (FR-040, FR-104).`);
  }
  const id = nextId(ctx.s, 'SH');
  const transit = ensureLocation(ctx.s, { id: `TRN:${id}`, label: `In transit ${id} → ${o.partyId}`, kind: 'transit', distributorId: o.partyId, dynamic: true });
  const lines = res.map((r) => {
    move(ctx, { lotId: r.lotId, qty: r.qty, from: r.location, to: transit.id, kind: 'dispatch', basis: 'Counted', ref: id, note: `Order ${o.id}` });
    r.status = 'consumed';
    return { lotId: r.lotId, fromLoc: r.location, qty: r.qty, bags: r.qty / (ctx.s.lots[r.lotId].bagSize ?? r.qty), reservationId: r.id, orderLineId: r.lineId };
  });
  const sh: Shipment = { id, orderId: o.id, toDistributor: o.partyId, lines, transitLoc: transit.id, dispatchedAt: ctx.at, dispatchedBy: ctx.actor.id, status: 'in_transit' };
  if (d.vehicleGrossKg !== undefined && d.vehicleTareKg !== undefined) sh.weights = { vehicleGross: kg(d.vehicleGrossKg), vehicleTare: kg(d.vehicleTareKg), packagingTare };
  ctx.s.shipments.push(sh);
  if (!d.noTrip) {
    const trip = createTrip(ctx, { transporterId: d.transporterId, vehicle: d.vehicle, driver: d.driver, shipmentIds: [id] });
    sh.tripId = trip.id;
  }
  const value = sum(lines.map((ln) => valueOf(ln.qty, o.lines.find((l) => l.id === ln.orderLineId)!.ratePerKg)));
  enqueueTally(ctx, 'sale', id, String(rec(ctx, 'distributors', o.partyId)?.name ?? o.partyId), value);
  return sh;
}

// ================================================================ M8 distributor receipt / variance

type ReceiptInput = { shipmentId: string; goodKg: number; damagedKg?: number; excessKg?: number; note?: string };

/** The multi-stop trip stop a shipment is assigned to, if any (searched over all trips, not only sh.tripId). */
export function stopOfShipment(s: { trips: Trip[] }, shipmentId: string) {
  for (const trip of s.trips) {
    const stop = trip.stops?.find((x) => x.shipmentId === shipmentId);
    if (stop) return { trip, stop };
  }
  return undefined;
}

/** Generic single-shipment receipt. A shipment on a multi-stop trip is rejected: it settles only through stop proof. */
export function receiveShipment(ctx: Ctx, r: ReceiptInput) {
  return settleShipmentReceipt(ctx, r);
}

/**
 * Common receipt settlement. `viaStop` is passed only by the stop-proof handler (recordStopOutcome) and must
 * name the exact, still-unrecorded stop this shipment is assigned to — so a stop can never settle another
 * stop's shipment and a multi-stop shipment never settles through the generic receipt.
 */
export function settleShipmentReceipt(ctx: Ctx, r: ReceiptInput, viaStop?: { tripId: string; seq: number }) {
  requireCap(ctx, 'distributor.operate', 'receive distributor shipments');
  const sh = ctx.s.shipments.find((x) => x.id === r.shipmentId) ?? fail('not_found', 'Shipment not found');
  const assigned = stopOfShipment(ctx.s, sh.id);
  if (assigned && !viaStop) fail('business_rule', `${sh.id} is stop ${assigned.stop.seq} of multi-stop trip ${assigned.trip.id}. Record the stop outcome (Accepted / Part accepted / Refused) with the receiver and proof instead.`);
  if (viaStop && (!assigned || assigned.trip.id !== viaStop.tripId || assigned.stop.seq !== viaStop.seq))
    fail('business_rule', `${sh.id} is not the shipment of stop ${viaStop.seq} on ${viaStop.tripId} — a stop settles only its own shipment`);
  if (assigned?.stop.outcome) fail('duplicate', `Stop ${assigned.stop.seq} on ${assigned.trip.id} was already recorded as ${assigned.stop.outcome.replace('_', ' ')}`);
  const dist = sh.toDistributor ?? fail('business_rule', 'Not a distributor shipment');
  requireScope(ctx, 'distributors', dist, 'receive this shipment');
  if (sh.receipt) fail('duplicate', `Receipt for ${sh.id} was already submitted and locked`);
  const total = sum(sh.lines.map((l) => l.qty));
  const good = kg(r.goodKg);
  const damaged = kg(r.damagedKg ?? 0);
  if (good < 0 || damaged < 0) fail('validation', 'Quantities cannot be negative');
  const excess = kg(r.excessKg ?? 0);
  if (excess < 0) fail('validation', 'Excess cannot be negative');
  if (good + damaged > total) fail('business_rule', `Good + damaged (${fmtKg(good + damaged)}) is more than the ${fmtKg(total)} shipped. Enter only the shipped bags here and put the extra in "Excess found" — it is held for investigation, not added to this lot.`);
  ensureLocation(ctx.s, { id: distLoc(dist), label: `${dist} stock`, kind: 'distributor', distributorId: dist });
  ensureLocation(ctx.s, { id: distHeld(dist), label: `${dist} held/damaged`, kind: 'distributor-held', distributorId: dist });
  let g = good;
  let dmg = damaged;
  for (const ln of sh.lines) {
    let left = ln.qty;
    const tg = Math.min(g, left);
    if (tg) move(ctx, { lotId: ln.lotId, qty: tg, from: sh.transitLoc, to: distLoc(dist), kind: 'transit-receive', basis: 'Counted', ref: sh.id });
    g -= tg;
    left -= tg;
    const td = Math.min(dmg, left);
    if (td) move(ctx, { lotId: ln.lotId, qty: td, from: sh.transitLoc, to: distHeld(dist), kind: 'transit-receive', basis: 'Counted', ref: sh.id, note: 'Physically damaged — held' });
    dmg -= td;
  }
  const short = total - good - damaged;
  if (excess > 0) {
    // §18: unidentified excess is physically received into held custody once; its true source is resolved later
    const unid = `UNID-EXC-${sh.id}`;
    createLot(ctx, { id: unid, rootId: unid, material: 'PACKED', label: `Unidentified excess found on ${sh.id}`, parents: [] });
    move(ctx, { lotId: unid, qty: excess, to: distHeld(dist), kind: 'excess-receive', basis: 'Counted', ref: sh.id, note: 'Excess over shipped quantity — held pending investigation' });
  }
  sh.receipt = { good, damaged, short, excess, by: ctx.actor.id, at: ctx.at, note: r.note };
  sh.status = short > 0 || damaged > 0 || excess > 0 ? 'disputed' : 'received';
  if (short > 0 || damaged > 0 || excess > 0) {
    const parts = [short && `${fmtKg(short)} short`, damaged && `${fmtKg(damaged)} damaged (held)`, excess && `${fmtKg(excess)} unidentified excess (held)`].filter(Boolean);
    const dp = { id: nextId(ctx.s, 'DSP'), shipmentId: sh.id, qty: short, reason: parts.join(', '), status: 'open' as const, createdAt: ctx.at, createdBy: ctx.actor.id };
    ctx.s.disputes.push(dp);
    sh.disputeId = dp.id;
  }
  return sh;
}

/** Transit shortage settlement (loss / located) via approval. */
export function requestTransitSettlement(ctx: Ctx, s: { shipmentId: string; how: 'loss' | 'located'; reason: string }) {
  if (!hasCap(ctx.actor, 'logistics.manage') && !hasCap(ctx.actor, 'handover.settle.request')) fail('forbidden', `${ctx.actor.roleLabel} cannot request transit settlement`);
  const sh = ctx.s.shipments.find((x) => x.id === s.shipmentId) ?? fail('not_found', 'Shipment not found');
  const left = transitLeft(ctx, sh);
  if (left <= 0) fail('business_rule', 'Nothing unresolved in transit');
  return requestApproval(ctx, { type: 'residual_loss', ref: sh.id, summary: `Settle ${fmtKg(left)} unresolved transit on ${sh.id} as ${s.how}`, rule: 'FR-070: out-of-tolerance delivery variance needs supervisor resolution', exposure: fmtKg(left), payload: { shipmentId: sh.id, how: s.how, qty: left, reason: s.reason }, requiredCapability: 'approve.residual' });
}

const transitLeft = (ctx: Ctx, sh: Shipment) => sum(sh.lines.map((l) => ctx.pos.get(`${l.lotId}|${sh.transitLoc}`) ?? 0));

// handover residual applier is in ops; extend for shipments
registerApplier('residual_loss', (ctx: Ctx, a: RApproval) => {
  if (a.payload.handoverId) return applyResidual(ctx, a);
  const sh = ctx.s.shipments.find((x) => x.id === a.payload.shipmentId)!;
  for (const ln of sh.lines) {
    const left = ctx.pos.get(`${ln.lotId}|${sh.transitLoc}`) ?? 0;
    if (!left) continue;
    if (a.payload.how === 'loss') move(ctx, { lotId: ln.lotId, qty: left, from: sh.transitLoc, kind: 'loss', ref: a.id, note: `Approved transit loss: ${a.payload.reason}` });
    else move(ctx, { lotId: ln.lotId, qty: left, from: sh.transitLoc, to: distLoc(sh.toDistributor!), kind: 'transit-receive', ref: a.id, note: 'Located after investigation' });
  }
  const dp = ctx.s.disputes.find((x) => x.id === sh.disputeId);
  if (dp && !sh.receipt?.damaged) {
    dp.status = 'resolved';
    dp.resolution = `${a.payload.how} approved (${a.id})`;
  }
  if (dp) dp.resolution = `Transit ${a.payload.how} approved (${a.id})`;
});

// ================================================================ M8/M9 retail orders (distributor leg)

export function createRetailOrder(ctx: Ctx, o: { distributorId: string; retailerId: string; grade: string; kg: number; source?: 'app' | 'offline'; advance?: boolean; rateVersion?: string; key?: string }) {
  requireCap(ctx, 'order.create.retail', 'create retailer orders');
  requireScope(ctx, 'distributors', o.distributorId, 'order for this distributor (BR-015)');
  const ret = rec(ctx, 'retailers', o.retailerId) ?? fail('validation', 'Choose a retailer');
  if (ret.distributorId !== o.distributorId) fail('business_rule', `${ret.name} is served by ${ret.distributorId}, not ${o.distributorId}`);
  if (!(o.kg > 0)) fail('validation', 'Quantity must be more than 0 kg');
  const r = currentRate(ctx, o.grade, 'retail');
  const order: Order = {
    id: nextId(ctx.s, 'RO'),
    kind: 'retail',
    partyId: o.retailerId,
    distributorId: o.distributorId,
    salesmanId: ctx.actor.roleId === 'salesman' ? ctx.actor.id : undefined,
    lines: [{ id: 'L1', grade: o.grade, qty: kg(o.kg), ratePerKg: r.ratePerKg, rateVersion: r.id, cancelled: 0 }],
    status: 'approved',
    source: o.source ?? 'app',
    createdAt: ctx.at,
    createdBy: ctx.actor.id,
    advance: o.advance,
    revisions: [],
  };
  ctx.s.orders.push(order);
  if (!o.advance) {
    const rows = eligibleFor(ctx, o.grade, (loc) => loc === distLoc(o.distributorId));
    const made = reserveLine(ctx, order, order.lines[0], rows);
    const got = sum(made.map((m) => m.qty));
    if (got < order.lines[0].qty) fail('business_rule', `Only ${fmtKg(got)} of eligible ${o.grade} is available at ${o.distributorId}; order not accepted. Reduce the quantity or record an advance booking.`);
  }
  return order;
}

/** Distributor stock deducts once, on confirmed delivery (FR-047). */
export function deliverRetail(ctx: Ctx, d: { orderId: string; challanRef: string }) {
  requireCap(ctx, 'distributor.operate', 'confirm retailer delivery');
  const o = ctx.s.orders.find((x) => x.id === d.orderId) ?? fail('not_found', 'Order not found');
  requireScope(ctx, 'distributors', o.distributorId!, 'deliver this order');
  if (!d.challanRef?.trim()) fail('validation', 'Delivery challan / proof reference is required');
  if (usedSaleRefs(ctx).has(d.challanRef.trim().toUpperCase())) fail('duplicate', `Reference ${d.challanRef} already deducted stock — no second deduction (FR-047, EC-30)`);
  const res = ctx.s.reservations.filter((r) => r.orderId === o.id && r.status === 'active');
  if (!res.length) fail('business_rule', 'Nothing reserved to deliver (already delivered or not reserved)');
  for (const r of res) {
    move(ctx, { lotId: r.lotId, qty: r.qty, from: r.location, kind: 'deliver-retail', basis: 'Counted', ref: `${o.id}:${r.lineId}`, note: `Challan ${d.challanRef.trim().toUpperCase()}` });
    r.status = 'consumed';
  }
  o.status = 'closed';
  return o;
}

function usedSaleRefs(ctx: Ctx) {
  return new Set(ctx.s.movements.filter((m) => m.kind === 'deliver-retail' || m.kind === 'outside-sale').map((m) => (m.note ?? '').replace(/^(Challan|Ext ref) /, '').toUpperCase()));
}

export function outsideSale(ctx: Ctx, s: { distributorId: string; lotId: string; kg: number; externalRef: string }) {
  requireCap(ctx, 'distributor.operate', 'record outside-app sales');
  requireScope(ctx, 'distributors', s.distributorId, 'record sales for this distributor');
  if (!s.externalRef?.trim()) fail('validation', 'External bill reference is required');
  if (usedSaleRefs(ctx).has(s.externalRef.trim().toUpperCase())) fail('duplicate', `Reference ${s.externalRef} already deducted stock (app delivery or earlier entry) — blocked (EC-30)`);
  const loc = distLoc(s.distributorId);
  const row = stockRows(ctx.s, ctx.at).find((r) => r.lotId === s.lotId && r.loc === loc) ?? fail('not_found', 'Lot not in this distributor stock');
  if (kg(s.kg) > row.available) fail('negative_stock', `Only ${fmtKg(row.available)} available (reserved/held excluded)`);
  move(ctx, { lotId: s.lotId, qty: kg(s.kg), from: loc, kind: 'outside-sale', basis: 'Counted', ref: nextId(ctx.s, 'OS'), note: `Ext ref ${s.externalRef.trim().toUpperCase()}` });
}

/** Distributor → distributor transfer through transit (FR-048). */
export function distributorTransfer(ctx: Ctx, t: { from: string; to: string; lotId: string; kg: number }) {
  requireCap(ctx, 'distributor.operate', 'transfer stock');
  requireScope(ctx, 'distributors', t.from, 'transfer from this distributor');
  if (t.from === t.to) fail('validation', 'Choose a different distributor');
  const row = stockRows(ctx.s, ctx.at).find((r) => r.lotId === t.lotId && r.loc === distLoc(t.from)) ?? fail('not_found', 'Lot not at this distributor');
  if (kg(t.kg) > row.available) fail('negative_stock', `Only ${fmtKg(row.available)} available`);
  const order: Order = { id: nextId(ctx.s, 'TO'), kind: 'factory', partyId: t.to, lines: [{ id: 'L1', grade: row.lot.grade ?? '', qty: kg(t.kg), ratePerKg: 0, rateVersion: 'transfer', cancelled: 0 }], status: 'approved', source: 'app', createdAt: ctx.at, createdBy: ctx.actor.id, revisions: [{ at: ctx.at, by: ctx.actor.id, change: `Inter-distributor transfer ${t.from} → ${t.to}` }] };
  ctx.s.orders.push(order);
  const id = nextId(ctx.s, 'SH');
  const transit = ensureLocation(ctx.s, { id: `TRN:${id}`, label: `In transit ${id} ${t.from} → ${t.to}`, kind: 'transit', distributorId: t.to, dynamic: true });
  move(ctx, { lotId: t.lotId, qty: kg(t.kg), from: distLoc(t.from), to: transit.id, kind: 'dispatch', basis: 'Counted', ref: id });
  const sh: Shipment = { id, orderId: order.id, toDistributor: t.to, fromDistributor: t.from, lines: [{ lotId: t.lotId, fromLoc: distLoc(t.from), qty: kg(t.kg), orderLineId: 'L1' }], transitLoc: transit.id, dispatchedAt: ctx.at, dispatchedBy: ctx.actor.id, status: 'in_transit' };
  ctx.s.shipments.push(sh);
  return sh;
}

// ================================================================ M9 offline salesman queue (FR-052, AC-09)

export function setDeviceOnline(ctx: Ctx, online: boolean) {
  requireCap(ctx, 'order.create.retail', 'change device connectivity');
  ctx.s.offline.online = online;
}

export function queueOfflineOrder(ctx: Ctx, o: { distributorId: string; retailerId: string; grade: string; kg: number }) {
  requireCap(ctx, 'order.create.retail', 'capture orders');
  requireScope(ctx, 'distributors', o.distributorId, 'capture orders for this distributor');
  if (ctx.s.offline.online) fail('business_rule', 'Device is online — submit the order directly');
  if (!(o.kg > 0)) fail('validation', 'Quantity must be more than 0 kg');
  const rate = currentRate(ctx, o.grade, 'retail');
  const seen = sum(eligibleFor(ctx, o.grade, (l) => l === distLoc(o.distributorId)).map((r) => r.available));
  const q: OfflineOrder = { id: nextId(ctx.s, 'OFF'), deviceRef: `DEV-${ctx.actor.id}-${ctx.s.offline.queue.length + 1}`, salesmanId: ctx.actor.id, distributorId: o.distributorId, retailerId: o.retailerId, grade: o.grade, qty: kg(o.kg), rateSeen: rate.ratePerKg, rateVersionSeen: rate.id, stockSeen: seen, capturedAt: ctx.at, status: 'queued' };
  ctx.s.offline.queue.push(q);
  return q;
}

/** Sync revalidates every queued request in capture order; one visible outcome each. */
export function syncOffline(ctx: Ctx) {
  requireCap(ctx, 'order.create.retail', 'synchronize orders');
  if (!ctx.s.offline.online) fail('business_rule', 'Device is offline — reconnect to synchronize');
  const results: { id: string; status: string; message: string }[] = [];
  for (const q of ctx.s.offline.queue.filter((x) => x.status === 'queued').sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))) {
    q.syncedAt = ctx.at;
    const dist = rec(ctx, 'distributors', q.distributorId);
    if (!dist || dist.salesmanId !== q.salesmanId) {
      q.status = 'conflict';
      q.conflict = `Mapping revoked: ${q.distributorId} is no longer mapped to this salesman`;
    } else {
      const rate = currentRate(ctx, q.grade, 'retail');
      const avail = sum(eligibleFor(ctx, q.grade, (l) => l === distLoc(q.distributorId)).map((r) => r.available));
      if (rate.id !== q.rateVersionSeen) {
        q.status = 'conflict';
        q.conflict = `Rate changed since capture: seen ${fmtINR(q.rateSeen)}/kg, current ${fmtINR(rate.ratePerKg)}/kg. Not silently repriced.`;
      } else if (avail < q.qty) {
        q.status = 'conflict';
        q.conflict = `Stock conflict: only ${fmtKg(avail)} eligible ${q.grade} remains at ${q.distributorId} (device saw ${fmtKg(q.stockSeen)}).`;
      } else {
        const o = createRetailOrder(ctx, { distributorId: q.distributorId, retailerId: q.retailerId, grade: q.grade, kg: q.qty / 1000, source: 'offline' });
        q.status = 'accepted';
        q.orderId = o.id;
      }
    }
    results.push({ id: q.id, status: q.status, message: q.conflict ?? `Accepted as ${q.orderId}` });
  }
  return results;
}

export function resolveOffline(ctx: Ctx, r: { id: string; action: 'accept_current_rate' | 'reduce_to_available' | 'cancel' }) {
  requireCap(ctx, 'order.create.retail', 'resolve sync conflicts');
  const q = ctx.s.offline.queue.find((x) => x.id === r.id) ?? fail('not_found', 'Queued order not found');
  if (q.status !== 'conflict') fail('business_rule', 'Only conflicts need resolution');
  if (r.action === 'cancel') {
    q.status = 'rejected';
    q.conflict = `${q.conflict} → Cancelled by ${ctx.actor.name}`;
    return q;
  }
  const avail = sum(eligibleFor(ctx, q.grade, (l) => l === distLoc(q.distributorId)).map((x) => x.available));
  const qty = r.action === 'reduce_to_available' ? Math.min(q.qty, avail - (avail % 25000)) : q.qty;
  if (qty <= 0) fail('business_rule', 'No eligible stock to accept');
  const o = createRetailOrder(ctx, { distributorId: q.distributorId, retailerId: q.retailerId, grade: q.grade, kg: qty / 1000, source: 'offline' });
  q.status = 'resolved';
  q.orderId = o.id;
  q.conflict = `${q.conflict} → Resolved: ${r.action === 'reduce_to_available' ? `reduced to ${fmtKg(qty)}` : 'accepted at current rate'} (${o.id})`;
  return q;
}

// ================================================================ collections (FR-108, BR-030)

export function recordCollection(ctx: Ctx, c: { orderId: string; amount: number; mode: 'cash' | 'cheque' | 'upi' }) {
  requireCap(ctx, 'collection.record', 'record collections');
  const o = ctx.s.orders.find((x) => x.id === c.orderId) ?? fail('not_found', 'Order not found');
  if (o.distributorId) requireScope(ctx, 'distributors', o.distributorId, 'collect for this order');
  const col = { id: nextId(ctx.s, 'COL'), orderId: o.id, debtor: o.partyId, creditor: o.kind === 'retail' ? o.distributorId! : 'Rentio', amount: rupees(c.amount), mode: c.mode, status: 'provisional' as const, recordedBy: ctx.actor.id, at: ctx.at };
  ctx.s.collections.push(col);
  return col;
}

export function confirmCollection(ctx: Ctx, id: string, ok: boolean) {
  requireCap(ctx, 'collection.confirm', 'confirm financial settlement');
  const c = ctx.s.collections.find((x) => x.id === id) ?? fail('not_found', 'Collection not found');
  if (c.status !== 'provisional') fail('duplicate', 'Already decided');
  (c as { status: string }).status = ok ? 'confirmed' : 'rejected';
  c.confirmedBy = ctx.actor.id;
  if (ok && c.creditor === 'Rentio') enqueueTally(ctx, 'receipt', c.id, c.debtor, c.amount);
  return c;
}

// ================================================================ by-product external sale (FR-043)

export function byproductDispatch(ctx: Ctx, b: { buyerId: string; lotId: string; loc: string; kg: number; ratePerKg: number; key?: string }) {
  requireCap(ctx, 'byproduct.sell', 'dispatch by-products');
  const buyer = rec(ctx, 'buyers', b.buyerId) ?? fail('validation', 'Choose a by-product buyer');
  const lot = ctx.s.lots[b.lotId] ?? fail('not_found', 'Lot not found');
  if (!['HUSK', 'CHURI'].includes(lot.material)) fail('validation', 'Only Husk/Churi lots can be sold here');
  const why = ineligibility(ctx.s, b.lotId, b.loc, ctx.at);
  if (why.length) fail('business_rule', `Not saleable: ${why[0]}`);
  const order: Order = { id: nextId(ctx.s, 'BO'), kind: 'byproduct', partyId: b.buyerId, lines: [{ id: 'L1', grade: lot.material, qty: kg(b.kg), ratePerKg: rupees(b.ratePerKg), rateVersion: 'agreed', cancelled: 0 }], status: 'closed', source: 'office', createdAt: ctx.at, createdBy: ctx.actor.id, revisions: [] };
  ctx.s.orders.push(order);
  const id = nextId(ctx.s, 'SH');
  move(ctx, { lotId: b.lotId, qty: kg(b.kg), from: b.loc, kind: 'external-dispatch', basis: 'Actual', ref: id, note: `To ${buyer.name}` });
  ctx.s.shipments.push({ id, orderId: order.id, toBuyer: b.buyerId, lines: [{ lotId: b.lotId, fromLoc: b.loc, qty: kg(b.kg), orderLineId: 'L1' }], transitLoc: '', dispatchedAt: ctx.at, dispatchedBy: ctx.actor.id, status: 'received' });
  enqueueTally(ctx, 'byproduct-sale', id, String(buyer.name), valueOf(kg(b.kg), rupees(b.ratePerKg)));
  return order;
}

// ================================================================ M10 Tally & e-invoice (SIMULATED)

const extKey = (d: TallyDoc) => `${d.sourceType}:${d.sourceId}`;

export function syncTally(ctx: Ctx, docId: string) {
  requireCap(ctx, 'tally.sync', 'synchronize with Tally');
  const d = ctx.s.tally.find((x) => x.id === docId) ?? fail('not_found', 'Document not found');
  if (d.status === 'acknowledged' || d.status === 'reconciled') fail('duplicate', `${d.id} is already acknowledged (${d.tallyRef}); no second entry is sent`);
  // status lookup before any retry (FR-058, EC-37)
  const existing = ctx.s.tallyExternal[extKey(d)];
  if (existing) {
    d.status = 'acknowledged';
    d.tallyRef = existing.ref;
    d.attempts.push({ at: ctx.at, by: ctx.actor.id, outcome: 'found_existing', message: `Lookup found existing Tally voucher ${existing.ref}; linked without re-posting` });
    return d;
  }
  if (ctx.s.tallySim.failNext > 0) {
    ctx.s.tallySim.failNext--;
    d.status = 'failed';
    d.attempts.push({ at: ctx.at, by: ctx.actor.id, outcome: 'failed', message: 'SIMULATED: Tally on Cloud refused the connection (gateway 503). Nothing was created.' });
    return d;
  }
  const ref = `TV-${String(Object.keys(ctx.s.tallyExternal).length + 1001)}`;
  ctx.s.tallyExternal[extKey(d)] = { ref };
  if (ctx.s.tallySim.timeoutNext > 0) {
    ctx.s.tallySim.timeoutNext--;
    d.status = 'status_unknown';
    d.attempts.push({ at: ctx.at, by: ctx.actor.id, outcome: 'timeout', message: 'SIMULATED: request timed out after Tally created the voucher. Outcome unknown — retry will look it up first.' });
    return d;
  }
  d.status = 'acknowledged';
  d.tallyRef = ref;
  d.attempts.push({ at: ctx.at, by: ctx.actor.id, outcome: 'acknowledged', message: `SIMULATED: Tally acknowledged voucher ${ref}` });
  return d;
}

export function setTallySimulation(ctx: Ctx, s: { failNext?: number; timeoutNext?: number }) {
  requireCap(ctx, 'tally.sync', 'configure the Tally simulator');
  ctx.s.tallySim = { failNext: s.failNext ?? ctx.s.tallySim.failNext, timeoutNext: s.timeoutNext ?? ctx.s.tallySim.timeoutNext };
}

/** One IRN per invoice; lookup before generation; source lock (FR-059, EC-38). */
export function generateIrn(ctx: Ctx, docId: string) {
  requireCap(ctx, 'tally.sync', 'generate e-invoices');
  const d = ctx.s.tally.find((x) => x.id === docId) ?? fail('not_found', 'Document not found');
  if (!['sale', 'byproduct-sale'].includes(d.sourceType)) fail('business_rule', 'IRN applies to outward sales invoices only');
  if (d.irn) fail('duplicate', `${d.id} already has IRN ${d.irn} (source ${d.irnSource}); second generation blocked`);
  const ext = ctx.s.tallyExternal[extKey(d)];
  if (ext?.irn) {
    d.irn = ext.irn;
    d.irnSource = 'Tally';
    return d;
  }
  d.irn = `IRN-SIM-${String(ctx.s.tally.filter((x) => x.irn).length + 1).padStart(5, '0')}`;
  d.irnSource = 'ERP';
  ctx.s.tallyExternal[extKey(d)] = { ...(ext ?? { ref: d.tallyRef ?? '' }), irn: d.irn };
  return d;
}

/** Simulate Accounts generating the IRN directly in Tally while the ERP request is pending. */
export function simulateIrnInTally(ctx: Ctx, docId: string) {
  requireCap(ctx, 'tally.sync', 'use the simulator');
  const d = ctx.s.tally.find((x) => x.id === docId) ?? fail('not_found', 'Document not found');
  const k = extKey(d);
  ctx.s.tallyExternal[k] = { ref: ctx.s.tallyExternal[k]?.ref ?? '', irn: `IRN-TALLY-${d.id}` };
}

// ================================================================ M11 complaints & returns

export function createComplaint(ctx: Ctx, c: { distributorId?: string; retailerId?: string; orderId?: string; lotId?: string; category: Complaint['category']; description: string }) {
  requireCap(ctx, 'complaint.create', 'record complaints');
  if (c.distributorId) requireScope(ctx, 'distributors', c.distributorId, 'log complaints for this distributor');
  if (!c.description?.trim()) fail('validation', 'Describe the complaint');
  if (c.lotId && !ctx.s.lots[c.lotId]) fail('validation', `Lot ${c.lotId} not found — leave it blank to flag the case for identification (FR-063)`);
  const cp: Complaint = { id: nextId(ctx.s, 'CMP'), ...c, status: 'open', creditStatus: 'none', createdAt: ctx.at, createdBy: ctx.actor.id };
  ctx.s.complaints.push(cp);
  return cp;
}

export function receiveReturn(ctx: Ctx, r: { complaintId: string; kg: number }) {
  const c = ctx.s.complaints.find((x) => x.id === r.complaintId) ?? fail('not_found', 'Complaint not found');
  requireCap(ctx, 'distributor.operate', 'receive returned goods');
  if (!c.distributorId) fail('business_rule', 'Return needs a receiving distributor');
  requireScope(ctx, 'distributors', c.distributorId, 'receive this return');
  if (c.returnLotId) fail('duplicate', 'Return already received');
  let lotId = c.lotId;
  if (!lotId) {
    // unknown lot → controlled unidentified identity, held (EC-35)
    lotId = `UNID-${c.id}`;
    createLot(ctx, { id: lotId, rootId: lotId, material: 'PACKED', label: 'Unidentified returned dal', parents: [] });
  }
  ensureLocation(ctx.s, { id: distHeld(c.distributorId), label: `${c.distributorId} held/damaged`, kind: 'distributor-held', distributorId: c.distributorId });
  move(ctx, { lotId, qty: kg(r.kg), to: distHeld(c.distributorId), kind: 'return-receive', basis: 'Counted', ref: c.id, note: 'Returned from retailer — held pending QC' });
  c.returnQty = kg(r.kg);
  c.returnLoc = distHeld(c.distributorId);
  c.returnLotId = lotId;
  c.status = 'return_received';
  return c;
}

export function returnDisposition(ctx: Ctx, d: { complaintId: string; action: 'release' | 'dispose'; evidence?: string }) {
  requireCap(ctx, 'return.disposition', 'decide return disposition');
  const c = ctx.s.complaints.find((x) => x.id === d.complaintId) ?? fail('not_found', 'Complaint not found');
  if (!c.returnLotId || !c.returnQty) fail('business_rule', 'No returned goods received yet');
  if (c.disposition) fail('duplicate', `Disposition already ${c.disposition}`);
  if (d.action === 'release') {
    if (c.returnLotId.startsWith('UNID-')) fail('business_rule', 'Unidentified returned stock cannot be released for sale; identify the lot first (EC-35)');
    move(ctx, { lotId: c.returnLotId, qty: c.returnQty, from: c.returnLoc!, to: distLoc(c.distributorId!), kind: 'release', basis: 'Counted', ref: c.id, note: 'QC released returned goods' });
    c.disposition = 'release';
    c.status = 'resolved';
    return c;
  }
  if (!d.evidence?.trim()) fail('validation', 'Disposal needs photo/video evidence reference (FR-066)');
  requestApproval(ctx, { type: 'disposal', ref: c.id, summary: `Dispose ${fmtKg(c.returnQty)} returned ${c.returnLotId} at ${c.distributorId}`, rule: 'FR-066 / BR-003: disposal needs evidence and approval', exposure: fmtKg(c.returnQty), payload: { complaintId: c.id, evidence: d.evidence }, requiredCapability: 'approve.disposal' });
  c.disposition = 'dispose';
  return c;
}

registerApplier('disposal', (ctx, a) => {
  const c = ctx.s.complaints.find((x) => x.id === a.payload.complaintId)!;
  move(ctx, { lotId: c.returnLotId!, qty: c.returnQty!, from: c.returnLoc!, kind: 'dispose', basis: 'Counted', ref: a.id, note: `Disposed with evidence ${a.payload.evidence}` });
  c.status = 'resolved';
});

export function requestCredit(ctx: Ctx, complaintId: string) {
  requireCap(ctx, 'complaint.create', 'request a credit note');
  const c = ctx.s.complaints.find((x) => x.id === complaintId) ?? fail('not_found', 'Complaint not found');
  if (c.creditStatus !== 'none') fail('duplicate', 'Credit already requested');
  c.creditStatus = 'requested';
  return c;
}

export function confirmCredit(ctx: Ctx, complaintId: string) {
  requireCap(ctx, 'tally.sync', 'confirm credit notes');
  const c = ctx.s.complaints.find((x) => x.id === complaintId) ?? fail('not_found', 'Complaint not found');
  if (c.creditStatus !== 'requested') fail('business_rule', 'No credit request pending');
  c.creditStatus = 'confirmed';
  return c;
}

export function linkReplacement(ctx: Ctx, complaintId: string, orderId: string) {
  const c = ctx.s.complaints.find((x) => x.id === complaintId) ?? fail('not_found', 'Complaint not found');
  if (!ctx.s.orders.some((o) => o.id === orderId)) fail('not_found', 'Order not found');
  c.replacementOrderId = orderId;
  if (c.status === 'open') c.status = 'replacement';
  return c;
}

export function closeComplaint(ctx: Ctx, complaintId: string) {
  requireCap(ctx, 'complaint.create', 'close complaints');
  const c = ctx.s.complaints.find((x) => x.id === complaintId) ?? fail('not_found', 'Complaint not found');
  if (c.returnLotId && !['resolved'].includes(c.status)) fail('business_rule', 'Returned goods still need a disposition');
  c.status = 'closed';
  return c;
}

// ================================================================ M12 logistics

export function createTrip(ctx: Ctx, t: { transporterId: string; vehicle: string; driver: string; shipmentIds: string[] }) {
  if (!rec(ctx, 'transporters', t.transporterId)) fail('validation', 'Choose a transporter');
  if (!t.vehicle?.trim()) fail('validation', 'Vehicle number is required');
  const card = [...ctx.s.rateCards].reverse().find((r) => r.transporterId === t.transporterId && !r.validTo) ?? fail('business_rule', 'No active rate card for this transporter');
  const trip: Trip = { id: nextId(ctx.s, 'TRP'), transporterId: t.transporterId, vehicle: t.vehicle.trim().toUpperCase(), driver: t.driver || '—', shipmentIds: t.shipmentIds, rateCardId: card.id, vehicleChanges: [], status: 'open', createdAt: ctx.at };
  ctx.s.trips.push(trip);
  return trip;
}

export function changeVehicle(ctx: Ctx, c: { tripId: string; to: string; reason: string }) {
  if (!hasCap(ctx.actor, 'logistics.manage') && !hasCap(ctx.actor, 'dispatch')) fail('forbidden', `${ctx.actor.roleLabel} cannot change trip vehicles`);
  const t = ctx.s.trips.find((x) => x.id === c.tripId) ?? fail('not_found', 'Trip not found');
  if (!c.reason?.trim()) fail('validation', 'A vehicle change needs a reason (FR-069)');
  t.vehicleChanges.push({ at: ctx.at, from: t.vehicle, to: c.to.trim().toUpperCase(), reason: c.reason, by: ctx.actor.id });
  t.vehicle = c.to.trim().toUpperCase();
  return t;
}

export function tripFreight(ctx: Pick<Ctx, 's'>, tripId: string) {
  const t = ctx.s.trips.find((x) => x.id === tripId)!;
  const card = ctx.s.rateCards.find((r) => r.id === t.rateCardId)!;
  const shipped = sum(ctx.s.shipments.filter((s) => t.shipmentIds.includes(s.id)).flatMap((s) => s.lines.map((l) => l.qty)));
  return { shipped, card, calculated: valueOf(shipped, card.perKg) };
}

export function recordFreightBill(ctx: Ctx, b: { tripId: string; amount: number; ref: string }) {
  requireCap(ctx, 'logistics.manage', 'record freight bills');
  const t = ctx.s.trips.find((x) => x.id === b.tripId) ?? fail('not_found', 'Trip not found');
  if (t.freightBill) fail('duplicate', 'Freight bill already recorded for this trip');
  const f = tripFreight(ctx, t.id);
  const amount = rupees(b.amount);
  const matched = Math.abs(amount - f.calculated) <= 100;
  t.freightBill = { amount, ref: b.ref, status: matched ? 'matched' : 'mismatch', by: ctx.actor.id };
  if (matched) enqueueTally(ctx, 'freight', t.id, String(rec(ctx, 'transporters', t.transporterId)?.name), amount);
  else requestApproval(ctx, { type: 'freight_mismatch', ref: t.id, summary: `Freight bill ${b.ref} ${fmtINR(amount)} vs calculated ${fmtINR(f.calculated)} (${fmtKg(f.shipped)} × ${fmtINR(f.card.perKg)}/kg)`, rule: 'FR-071: freight bill must reconcile to trip/rate before Accounts export', exposure: fmtINR(amount - f.calculated), payload: { tripId: t.id }, requiredCapability: 'approve.freight' });
  return t;
}

registerApplier('freight_mismatch', (ctx, a) => {
  const t = ctx.s.trips.find((x) => x.id === a.payload.tripId)!;
  t.freightBill!.status = 'approved';
  enqueueTally(ctx, 'freight', t.id, String(rec(ctx, 'transporters', t.transporterId)?.name), t.freightBill!.amount);
});

export function reviseRateCard(ctx: Ctx, r: { transporterId: string; perKg: number }) {
  requireCap(ctx, 'logistics.manage', 'revise rate cards');
  ctx.s.rateCards.filter((x) => x.transporterId === r.transporterId && !x.validTo).forEach((x) => (x.validTo = ctx.at));
  const card = { id: nextId(ctx.s, 'RC'), transporterId: r.transporterId, route: 'Plant → distributors (demo flat)', perKg: rupees(r.perKg), validFrom: ctx.at };
  ctx.s.rateCards.push(card);
  return card;
}

export { notSelf };
