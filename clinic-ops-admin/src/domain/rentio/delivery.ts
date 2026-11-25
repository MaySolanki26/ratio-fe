/**
 * Multi-stop delivery proof (FR-112 / WF-14 / EC-61 / AC-25). One ordered trip carries several INDEPENDENT
 * shipments; each stop records its own outcome (Accepted / Part accepted / Refused) with time, receiver and
 * proof, scoped to that distributor's own user. Physical settlement reuses the shipment receipt mechanics
 * (settleShipmentReceipt, bound to this exact stop — the generic receiveShipment rejects multi-stop
 * shipments) so accepted quantity settles exactly once; refused or unresolved quantity stays in transit custody until an authorized disposition. Payment is NOT part of delivery (Accounts handles it).
 */
import { hasCap } from './access';
import { createTrip, dispatchOrder, settleShipmentReceipt } from './commerce';
import { type Ctx, fail, move, nextId, requireCap, requireScope } from './engine';
import type { RentioState, Shipment, Trip, TripStop } from './types';
import { fmtKg, type Grams, kg, sum } from './units';

/** Dispatch several reserved orders on ONE vehicle as an ordered multi-stop trip. */
export function dispatchMultiStop(ctx: Ctx, d: { orderIds: string[]; transporterId: string; vehicle: string; driver: string }) {
  requireCap(ctx, 'dispatch', 'dispatch shipments');
  const ids = d.orderIds.filter(Boolean);
  if (ids.length < 2) fail('validation', 'A multi-stop trip needs at least two orders (one stop each)');
  if (new Set(ids).size !== ids.length) fail('validation', 'Each order can be on the trip only once');
  const dists = ids.map((id) => ctx.s.orders.find((o) => o.id === id)?.partyId ?? fail('not_found', `Order ${id} not found`));
  if (new Set(dists).size !== dists.length) fail('validation', 'Two stops for the same distributor — combine them into one order or one stop');
  const shipments: Shipment[] = ids.map((orderId) => dispatchOrder(ctx, { orderId, transporterId: d.transporterId, vehicle: d.vehicle, driver: d.driver, noTrip: true }));
  const trip = createTrip(ctx, { transporterId: d.transporterId, vehicle: d.vehicle, driver: d.driver, shipmentIds: shipments.map((s) => s.id) });
  trip.stops = shipments.map((sh, i) => ({ seq: i + 1, shipmentId: sh.id, distributorId: sh.toDistributor! }));
  shipments.forEach((sh) => (sh.tripId = trip.id));
  return trip;
}

const shipQty = (sh: Shipment) => sum(sh.lines.map((l) => l.qty));

/** Quantity of this shipment still physically in transit custody (unsettled). */
export function inTransitOf(s: RentioState, sh: Shipment): Grams {
  let t = 0;
  for (const m of s.movements) {
    if (m.to === sh.transitLoc) t += m.qty;
    if (m.from === sh.transitLoc) t -= m.qty;
  }
  return Math.max(0, t);
}

/** Record one stop's outcome — only the receiving distributor's own user (scope-checked). */
export function recordStopOutcome(
  ctx: Ctx,
  r: { tripId: string; seq: number; outcome: 'accepted' | 'part_accepted' | 'refused'; acceptedKg?: number; damagedKg?: number; receiverName: string; evidence: string; reason?: string },
) {
  requireCap(ctx, 'distributor.operate', 'record delivery outcomes');
  const trip = ctx.s.trips.find((t) => t.id === r.tripId) ?? fail('not_found', 'Trip not found');
  const stop = trip.stops?.find((x) => x.seq === r.seq) ?? fail('not_found', `Stop ${r.seq} is not on ${trip.id}`);
  requireScope(ctx, 'distributors', stop.distributorId, `record stop ${stop.seq} (${stop.distributorId})`);
  if (stop.outcome) fail('duplicate', `Stop ${stop.seq} on ${trip.id} was already recorded as ${stop.outcome.replace('_', ' ')} by ${stop.recordedBy} — it is locked`);
  const sh = ctx.s.shipments.find((x) => x.id === stop.shipmentId) ?? fail('not_found', `Shipment ${stop.shipmentId} of stop ${stop.seq} not found`);
  // legacy data: a generic receipt posted before stop proof was enforced — never overwrite it with a stop outcome
  if (sh.receipt) fail('business_rule', `${sh.id} already has a receipt without stop proof (by ${sh.receipt.by}). Stop ${stop.seq} is left unrecorded — resolve it through the shipment's dispute instead.`);
  if (!r.receiverName?.trim()) fail('validation', 'Name the person who received (or refused) the goods at this stop');
  if (!r.evidence?.trim()) fail('validation', 'Record the stop evidence (challan / POD photo reference)');
  const total = shipQty(sh);
  const damaged = kg(r.damagedKg ?? 0);
  let accepted: Grams;
  if (r.outcome === 'accepted') {
    accepted = total - damaged;
    if (damaged && !r.reason?.trim()) fail('validation', 'Say what was damaged');
  } else if (r.outcome === 'part_accepted') {
    accepted = kg(r.acceptedKg ?? 0);
    if (!(accepted > 0) || accepted + damaged >= total) fail('validation', `Part accepted needs an accepted quantity between 0 and ${fmtKg(total)} (the rest is refused)`);
    if (!r.reason?.trim()) fail('validation', 'Give the reason for refusing part of the delivery');
  } else {
    accepted = 0;
    if (damaged) fail('validation', 'A refused stop accepts nothing — record damage on the returned goods at the factory');
    if (!r.reason?.trim()) fail('validation', 'Give the reason the delivery was refused');
  }
  const refused = total - accepted - damaged;
  if (accepted > 0 || damaged > 0) {
    // the same settlement as a single shipment receipt: good into stock, damaged held, the rest stays in transit
    settleShipmentReceipt(ctx, { shipmentId: sh.id, goodKg: accepted / 1000, damagedKg: damaged / 1000, note: `Stop ${stop.seq}: ${r.outcome.replace('_', ' ')} — ${r.reason ?? 'ok'} · receiver ${r.receiverName.trim()} · ${r.evidence.trim()}` }, { tripId: trip.id, seq: stop.seq });
    if (refused > 0) {
      sh.receipt!.refused = refused;
      const dp = ctx.s.disputes.find((x) => x.id === sh.disputeId);
      if (dp) dp.reason = `${fmtKg(refused)} refused at stop ${stop.seq} (${r.reason}) — on the vehicle, awaiting disposition${damaged ? `; ${fmtKg(damaged)} damaged (held)` : ''}`;
    }
  } else {
    // refused: nothing settles — the whole quantity stays in transit custody (never "delivered")
    sh.status = 'refused';
    sh.receipt = { good: 0, damaged: 0, short: total, excess: 0, refused: total, by: ctx.actor.id, at: ctx.at, note: `Stop ${stop.seq} refused: ${r.reason} · ${r.receiverName.trim()} · ${r.evidence.trim()}` };
    const dp = { id: nextId(ctx.s, 'DSP'), shipmentId: sh.id, qty: total, reason: `${fmtKg(total)} refused at stop ${stop.seq} (${r.reason!.trim()}) — on the vehicle, awaiting disposition`, status: 'open' as const, createdAt: ctx.at, createdBy: ctx.actor.id };
    ctx.s.disputes.push(dp);
    sh.disputeId = dp.id;
  }
  Object.assign(stop, { outcome: r.outcome, recordedBy: ctx.actor.id, at: ctx.at, receiverName: r.receiverName.trim(), evidence: r.evidence.trim(), reason: r.reason?.trim() || undefined, acceptedQty: accepted, refusedQty: refused, damagedQty: damaged } satisfies Partial<TripStop>);
  return { trip, stop, shipment: sh };
}

/** Authorized disposition: bring refused / unresolved stop quantity back to factory quarantine for QC. */
export function returnRefused(ctx: Ctx, r: { tripId: string; seq: number; reason: string }) {
  if (!hasCap(ctx.actor, 'dispatch') && !hasCap(ctx.actor, 'logistics.manage')) fail('forbidden', `${ctx.actor.roleLabel} cannot decide refused-goods disposition`);
  const trip = ctx.s.trips.find((t) => t.id === r.tripId) ?? fail('not_found', 'Trip not found');
  const stop = trip.stops?.find((x) => x.seq === r.seq) ?? fail('not_found', 'Stop not found');
  if (!stop.outcome || stop.outcome === 'accepted') fail('business_rule', `Stop ${stop.seq} has no refused quantity`);
  if (stop.disposition) fail('duplicate', `Refused goods of stop ${stop.seq} were already returned by ${stop.disposition.by}`);
  if (!r.reason?.trim()) fail('validation', 'Give the disposition reason');
  const sh = ctx.s.shipments.find((x) => x.id === stop.shipmentId)!;
  let left = inTransitOf(ctx.s, sh);
  if (!left) fail('business_rule', 'Nothing of this stop is left in transit');
  const qty = left;
  for (const ln of sh.lines) {
    const here = ctx.pos.get(`${ln.lotId}|${sh.transitLoc}`) ?? 0;
    const take = Math.min(here, left);
    if (take) move(ctx, { lotId: ln.lotId, qty: take, from: sh.transitLoc, to: 'QUAR', kind: 'return-receive', basis: 'Counted', ref: `${trip.id}#${stop.seq}`, note: `Refused at ${stop.distributorId}: returned to factory quarantine for QC` });
    left -= take;
  }
  stop.disposition = { action: 'return_to_factory', qty, by: ctx.actor.id, at: ctx.at, reason: r.reason.trim() };
  const dp = ctx.s.disputes.find((x) => x.id === sh.disputeId);
  if (dp && !sh.receipt?.damaged) {
    dp.status = 'resolved';
    dp.resolution = `Refused ${fmtKg(qty)} returned to factory quarantine (${trip.id} stop ${stop.seq})`;
  }
  return stop;
}

export type StopStatus = 'pending' | 'accepted' | 'part_accepted' | 'refused' | 'returned';

/** Per-stop and trip status, derived from stop outcomes and live transit custody. */
export function tripProgress(s: RentioState, trip: Trip) {
  const stops = (trip.stops ?? []).map((st) => {
    const sh = s.shipments.find((x) => x.id === st.shipmentId)!;
    const open = inTransitOf(s, sh);
    const status: StopStatus = !st.outcome ? 'pending' : st.disposition ? 'returned' : st.outcome;
    const next = !st.outcome
      ? `${st.distributorId} records the outcome on arrival`
      : open > 0
        ? `${fmtKg(open)} still on the vehicle / in transit — Godown/Dispatch decides disposition`
        : st.damagedQty
          ? `${fmtKg(st.damagedQty)} damaged held at ${st.distributorId} — QC decides`
          : 'Settled';
    return { ...st, shipment: sh, total: shipQty(sh), openInTransit: open, status, next };
  });
  const pending = stops.filter((x) => x.status === 'pending').length;
  const unresolved = sum(stops.map((x) => x.openInTransit));
  const code = !stops.length ? 'single' : pending === stops.length ? 'in_transit' : pending ? 'partly_delivered' : unresolved > 0 ? 'exceptions_open' : 'completed';
  const label =
    code === 'single'
      ? 'Single shipment'
      : code === 'in_transit'
        ? `In transit — ${stops.length} stops pending`
        : code === 'partly_delivered'
          ? `${stops.length - pending} of ${stops.length} stops recorded`
          : code === 'exceptions_open'
            ? `All stops recorded — ${fmtKg(unresolved)} unresolved`
            : 'All stops settled';
  return { stops, pending, unresolved, code, label };
}
