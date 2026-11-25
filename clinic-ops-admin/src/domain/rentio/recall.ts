/**
 * Recall trace recipients (AC-11, FR-062/FR-110): ONE row per physical destination event.
 * A dispatch is represented by its canonical shipment line (with its shipment/order reference);
 * the matching stock movement (same lot, ref = shipment id) is evidence of that same event, not a
 * second recipient. A raw outbound movement is listed only when no matching scoped shipment line
 * exists (e.g. a confirmed retailer delivery or an outside-app sale — their own custody hops).
 * Shipped-to and confirmed-receipt are reported separately; nothing implies a recipient accepted.
 */
import type { RActor } from './access';
import { scopedMovements, scopedShipments } from './scope';
import type { Movement, RentioState, Shipment } from './types';
import type { Grams } from './units';

export interface RecallRecipient {
  /** Stable row id: `${shipmentId}#${lineIndex}` or the movement id. */
  id: string;
  kind: 'shipment' | 'retail-delivery' | 'outside-sale' | 'external-dispatch';
  /** Recipient identity (distributor / buyer / retailer reference). */
  recipientId: string;
  recipient: string;
  lotId: string;
  qty: Grams;
  at: string;
  /** Canonical business reference shown as evidence (shipment + order, or challan / external ref). */
  ref: string;
  /** Matching ledger movement ids (evidence of the same event, never extra rows). */
  movementIds: string[];
  /** Custody state at this hop. */
  state: 'shipped' | 'receipt-confirmed' | 'receipt-with-exceptions' | 'dispatched-no-receipt' | 'delivery-confirmed' | 'sold-outside-app';
  stateLabel: string;
}

const OUTBOUND: Movement['kind'][] = ['dispatch', 'deliver-retail', 'outside-sale', 'external-dispatch'];

export function recallRecipients(s: RentioState, actor: RActor, family: string[], nameOf: (kind: 'distributor' | 'buyer' | 'retailer', id: string) => string = (_k, id) => id): RecallRecipient[] {
  const fam = new Set(family);
  const ships = scopedShipments(s, actor).filter((sh) => sh.lines.some((l) => fam.has(l.lotId)));
  const moves = scopedMovements(s, actor).filter((m) => fam.has(m.lotId) && OUTBOUND.includes(m.kind));
  const claimed = new Set<string>();
  const out: RecallRecipient[] = [];

  const shipState = (sh: Shipment): Pick<RecallRecipient, 'state' | 'stateLabel'> => {
    if (sh.toBuyer) return { state: 'dispatched-no-receipt', stateLabel: 'Dispatched to buyer — no receipt confirmation recorded' };
    if (!sh.receipt) return { state: 'shipped', stateLabel: 'Shipped — receipt pending' };
    if (sh.status === 'received') return { state: 'receipt-confirmed', stateLabel: 'Receipt confirmed' };
    return { state: 'receipt-with-exceptions', stateLabel: 'Receipt with exceptions (short / damaged / excess)' };
  };

  for (const sh of ships) {
    sh.lines.forEach((l, idx) => {
      if (!fam.has(l.lotId)) return;
      // the ledger leg(s) of this line: same shipment ref, same lot, leaving this line's source custody
      const ev = moves.filter((m) => m.ref === sh.id && m.lotId === l.lotId && !claimed.has(m.id) && (!m.from || m.from === l.fromLoc));
      const leg = ev.find((m) => m.qty === l.qty) ?? ev[0];
      if (leg) claimed.add(leg.id);
      const toDist = sh.toDistributor;
      out.push({
        id: `${sh.id}#${idx}`,
        kind: toDist ? 'shipment' : 'external-dispatch',
        recipientId: toDist ?? sh.toBuyer ?? '—',
        recipient: toDist ? nameOf('distributor', toDist) : sh.toBuyer ? nameOf('buyer', sh.toBuyer) : '—',
        lotId: l.lotId,
        qty: l.qty,
        at: sh.dispatchedAt,
        ref: `${sh.id} · order ${sh.orderId}${l.fromLoc ? ` · from ${l.fromLoc}` : ''}`,
        movementIds: leg ? [leg.id] : [],
        ...shipState(sh),
      });
    });
  }

  // remaining movements: own custody hops (retail delivery / outside sale), or a dispatch with no scoped shipment
  for (const m of moves) {
    if (claimed.has(m.id)) continue;
    if (m.kind === 'dispatch') continue; // a dispatch without a visible shipment is in-network transit, not a recipient
    if (m.kind === 'external-dispatch' && ships.some((sh) => sh.id === m.ref && sh.lines.some((l) => l.lotId === m.lotId))) continue;
    if (m.kind === 'deliver-retail') {
      const orderId = m.ref.split(':')[0];
      const o = s.orders.find((x) => x.id === orderId);
      out.push({ id: m.id, kind: 'retail-delivery', recipientId: o?.partyId ?? '—', recipient: o ? nameOf('retailer', o.partyId) : '—', lotId: m.lotId, qty: m.qty, at: m.at, ref: `${orderId}${m.note ? ` · ${m.note}` : ''}${m.from ? ` · from ${m.from}` : ''}`, movementIds: [m.id], state: 'delivery-confirmed', stateLabel: 'Delivery confirmed (challan recorded)' });
    } else if (m.kind === 'outside-sale') {
      out.push({ id: m.id, kind: 'outside-sale', recipientId: '—', recipient: 'Outside-app customer', lotId: m.lotId, qty: m.qty, at: m.at, ref: `${m.ref}${m.note ? ` · ${m.note}` : ''}`, movementIds: [m.id], state: 'sold-outside-app', stateLabel: 'Sold outside the app (reported by distributor)' });
    } else {
      out.push({ id: m.id, kind: 'external-dispatch', recipientId: '—', recipient: m.note?.replace(/^To /, '') ?? 'External buyer', lotId: m.lotId, qty: m.qty, at: m.at, ref: m.ref, movementIds: [m.id], state: 'dispatched-no-receipt', stateLabel: 'Dispatched — no receipt confirmation recorded' });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}
