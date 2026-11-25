/**
 * BA closure round — domain scenarios that POST real transactions on the demo snapshot and prove the
 * failure, duplicate, scope and atomicity paths: controlled repacking, multi-stop delivery proof,
 * grouped incidents and replenishment suggestions.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ractor } from '../domain/rentio/access';
import { buildRentio } from '../domain/rentio/domain';
import { recordStopOutcome, returnRefused, dispatchMultiStop, tripProgress, inTransitOf } from '../domain/rentio/delivery';
import { computePositions, type Ctx, execute, ineligibility, RError } from '../domain/rentio/engine';
import { closeIncident, createIncident, childRef, detachChild, incidentChildren, incidentFor, noteIncident } from '../domain/rentio/incidents';
import * as C from '../domain/rentio/commerce';
import * as O from '../domain/rentio/ops';
import { decideRepack, requestRepack } from '../domain/rentio/repack';
import { confirmPartnerStock, openSuggestions, reviewSuggestion, suggestions } from '../domain/rentio/replenish';
import { kg } from '../domain/rentio/units';
import { alerts, alertsFor, lotAccounting } from '../domain/rentio/views';
import type { Db } from '../services/types';

const NOW = new Date().toISOString();
const fresh = () => {
  const r = buildRentio(new Date(NOW), 'demo');
  return { records: r.records, audit: [], session: { userId: 'u_owner', workspaceId: 'plant1' }, ...r.extra } as unknown as Db;
};
/** All-or-nothing like commitDraft: returns the draft only when fn succeeds. */
function tx<T>(db: Db, user: string, fn: (ctx: Ctx) => T, key?: string): { db: Db; result?: T; code: string } {
  const draft = structuredClone(db);
  try {
    const r = execute(draft, ractor(user), { label: 'test', key, now: NOW, at: NOW }, fn);
    return { db: draft, result: r.result, code: r.duplicate ? 'duplicate-key' : 'ok' };
  } catch (e) {
    return { db, code: e instanceof RError ? e.code : String(e) };
  }
}
const at = (db: Db, lot: string, loc: string) => computePositions(db.rentio!).get(`${lot}|${loc}`) ?? 0;

let db: Db;
beforeEach(() => {
  db = fresh();
});

const REPACK = { lotId: 'MIG-0030', fromLoc: 'F1-S04', inputKg: 200, targetBagKg: 1, outputBags: 199, measuredOutputKg: 199, packagingLotId: 'POUCH-1-B01', lossKg: 1, lossReason: 'Spillage while opening torn bags (swept, not food-safe)' };

describe('BA-1 controlled repacking (FR-103 / BR-029 / WF-13)', () => {
  it('posts 200 kg → 199 × 1 kg packs + 1 kg recorded loss only after independent QC release', () => {
    const before = { src: at(db, 'MIG-0030', 'F1-S04'), pouches: at(db, 'POUCH-1-B01', 'STORES') };
    expect(before).toEqual({ src: kg(250), pouches: 220_000 });
    const req = tx(db, 'u_ravi', (ctx) => requestRepack(ctx, REPACK));
    expect(req.code).toBe('ok');
    const rp = req.result!;
    // proposal moves nothing: source intact
    expect(at(req.db, 'MIG-0030', 'F1-S04')).toBe(kg(250));
    expect(at(req.db, 'POUCH-1-B01', 'STORES')).toBe(220_000);
    expect(rp.residualAtRequest).toBe(kg(50));
    // maker cannot release own repack; godown has no release right either way
    expect(tx(req.db, 'u_ravi', (ctx) => decideRepack(ctx, { repackId: rp.id, release: true })).code).toBe('forbidden');
    const rel = tx(req.db, 'u_meera', (ctx) => decideRepack(ctx, { repackId: rp.id, release: true, note: 'Seal, label, net weight checked' }), 'rel-1');
    expect(rel.code).toBe('ok');
    const child = rel.result!.childLotId!;
    const s = rel.db.rentio!;
    expect(at(rel.db, 'MIG-0030', 'F1-S04')).toBe(kg(50)); // residual stays in the stack
    expect(at(rel.db, child, 'F1-S04')).toBe(kg(199));
    expect(at(rel.db, 'POUCH-1-B01', 'STORES')).toBe(21_000); // 199 pouches deducted once
    expect(s.lots[child]).toMatchObject({ grade: 'A2', mfgDate: '2026-10-01', expiry: '2027-03-30', bags: 199, bagSize: kg(1), parents: [{ lotId: 'MIG-0030', qty: kg(199) }] });
    const loss = s.movements.filter((m) => m.ref === rp.id && m.kind === 'loss');
    expect(loss.map((m) => m.qty)).toEqual([kg(1)]);
    // closed boundary for the root: 250 = 50 + 199 live + 1 loss; packaging never in food mass
    const acc = lotAccounting(s, 'MIG-0030');
    expect(acc.total).toBe(kg(250));
    expect(acc.balanced).toBe(true);
    // duplicate release: same key → no second effect; new attempt → refused
    const again = tx(rel.db, 'u_meera', (ctx) => decideRepack(ctx, { repackId: rp.id, release: true }), 'rel-1');
    expect(again.code).toBe('duplicate-key');
    expect(at(again.db, 'POUCH-1-B01', 'STORES')).toBe(21_000);
    expect(tx(rel.db, 'u_meera', (ctx) => decideRepack(ctx, { repackId: rp.id, release: true })).code).toBe('duplicate');
    // a later hold on the PARENT reaches the repacked child
    const held = tx(rel.db, 'u_meera', (ctx) => O.placeHold(ctx, { scope: 'lot', target: 'MIG-0030', kind: 'quality', reason: 'Recall check (demo)' }));
    expect(ineligibility(held.db.rentio!, child, 'F1-S04', NOW).join(' ')).toMatch(/hold .* on ancestor MIG-0030/);
  });

  it('rejects unbalanced, fabricated-fit, insufficient-packaging, reserved and held inputs — source unchanged', () => {
    expect(tx(db, 'u_ravi', (ctx) => requestRepack(ctx, { ...REPACK, lossKg: 0 })).code).toBe('business_rule'); // 200 ≠ 199
    expect(tx(db, 'u_ravi', (ctx) => requestRepack(ctx, { ...REPACK, measuredOutputKg: 198 })).code).toBe('business_rule'); // re-weigh
    expect(tx(db, 'u_ravi', (ctx) => requestRepack(ctx, { ...REPACK, lossReason: '' })).code).toBe('validation');
    expect(tx(db, 'u_ravi', (ctx) => requestRepack(ctx, { ...REPACK, inputKg: 250, outputBags: 249, measuredOutputKg: 249 })).code).toBe('negative_stock'); // 220 pouches
    expect(tx(db, 'u_ravi', (ctx) => requestRepack(ctx, { ...REPACK, packagingLotId: 'BAGS-25-B01' })).code).toBe('business_rule');
    expect(tx(db, 'u_ravi', (ctx) => requestRepack(ctx, { ...REPACK, targetBagKg: 5, outputBags: 39, measuredOutputKg: 195, lossKg: 5 })).code).toBe('business_rule'); // no active 5 kg SKU
    expect(tx(db, 'u_anil', (ctx) => requestRepack(ctx, REPACK)).code).toBe('forbidden');
    // reserved stock cannot be repacked (MIG-0031 is fully reserved for the multi-stop orders)
    expect(tx(db, 'u_ravi', (ctx) => requestRepack(ctx, { ...REPACK, lotId: 'MIG-0031', fromLoc: 'F1-S06' })).code).toBe('business_rule');
    // stack treatment hold blocks it
    const th = tx(db, 'u_ravi', (ctx) => O.placeHold(ctx, { scope: 'location', target: 'F1-S04', kind: 'treatment', reason: 'Fumigation in progress' }));
    expect(tx(th.db, 'u_ravi', (ctx) => requestRepack(ctx, REPACK)).code).toBe('business_rule');
    expect(at(db, 'MIG-0030', 'F1-S04')).toBe(kg(250));
  });

  it('a hold placed after the proposal makes release fail atomically and the source stays intact', () => {
    const req = tx(db, 'u_ravi', (ctx) => requestRepack(ctx, REPACK));
    const held = tx(req.db, 'u_meera', (ctx) => O.placeHold(ctx, { scope: 'lot', target: 'MIG-0030', kind: 'quality', reason: 'Insects seen' }));
    const rel = tx(held.db, 'u_fhead', (ctx) => decideRepack(ctx, { repackId: req.result!.id, release: true }));
    expect(rel.code).toBe('forbidden'); // Factory Head has no QC release right
    const rel2 = tx(held.db, 'u_meera', (ctx) => decideRepack(ctx, { repackId: req.result!.id, release: true }));
    expect(rel2.code).toBe('business_rule');
    expect(at(rel2.db, 'MIG-0030', 'F1-S04')).toBe(kg(250));
    expect(at(rel2.db, 'POUCH-1-B01', 'STORES')).toBe(220_000);
    expect(rel2.db.rentio!.repacks![0].status).toBe('pending_qc');
  });
});

const tripFor = (d: Db) => {
  const ids = d.rentio!.orders.filter((o) => o.lines[0].grade === 'B2' && ['D01', 'D02'].includes(o.partyId)).map((o) => o.id);
  return tx(d, 'u_ravi', (ctx) => dispatchMultiStop(ctx, { orderIds: ids, transporterId: 'TR-01', vehicle: 'MH12-AB-4455', driver: 'Sanjay More (fictional)' }));
};

describe('BA-2 multi-stop delivery proof (FR-112 / WF-14 / EC-61)', () => {
  it('two independent stops: D01 accepted, D02 part accepted, residual stays in custody until returned', () => {
    const t = tripFor(db);
    expect(t.code).toBe('ok');
    const trip = t.result!;
    expect(trip.stops!.map((x) => x.distributorId)).toEqual(['D01', 'D02']);
    expect(tripProgress(t.db.rentio!, trip).code).toBe('in_transit');
    // Farah (D02) cannot record D01's stop; Dinesh cannot record D02's
    expect(tx(t.db, 'u_farah', (ctx) => recordStopOutcome(ctx, { tripId: trip.id, seq: 1, outcome: 'accepted', receiverName: 'x', evidence: 'y' })).code).toBe('scope');
    const s1 = tx(t.db, 'u_dinesh', (ctx) => recordStopOutcome(ctx, { tripId: trip.id, seq: 1, outcome: 'accepted', receiverName: 'Dinesh Kulkarni', evidence: 'POD-D01-001.jpg' }), 'stop-1');
    expect(s1.code).toBe('ok');
    expect(at(s1.db, 'MIG-0031', 'DIST:D01')).toBe(kg(250));
    // one stop recorded never completes the trip
    expect(tripProgress(s1.db.rentio!, s1.db.rentio!.trips.find((x) => x.id === trip.id)!).code).toBe('partly_delivered');
    // duplicate: same key no effect; second attempt locked
    expect(tx(s1.db, 'u_dinesh', (ctx) => recordStopOutcome(ctx, { tripId: trip.id, seq: 1, outcome: 'accepted', receiverName: 'a', evidence: 'b' }), 'stop-1').code).toBe('duplicate-key');
    expect(tx(s1.db, 'u_dinesh', (ctx) => recordStopOutcome(ctx, { tripId: trip.id, seq: 1, outcome: 'accepted', receiverName: 'a', evidence: 'b' })).code).toBe('duplicate');
    expect(tx(s1.db, 'u_farah', (ctx) => recordStopOutcome(ctx, { tripId: trip.id, seq: 2, outcome: 'part_accepted', acceptedKg: 150, receiverName: 'Farah Khan', evidence: 'POD-D02-001.jpg' })).code).toBe('validation'); // reason needed
    const s2 = tx(s1.db, 'u_farah', (ctx) => recordStopOutcome(ctx, { tripId: trip.id, seq: 2, outcome: 'part_accepted', acceptedKg: 150, receiverName: 'Farah Khan', evidence: 'POD-D02-001.jpg', reason: '4 bags wet from rain — refused' }));
    expect(s2.code).toBe('ok');
    const s = s2.db.rentio!;
    const tr = s.trips.find((x) => x.id === trip.id)!;
    const sh2 = s.shipments.find((x) => x.id === tr.stops![1].shipmentId)!;
    expect(at(s2.db, 'MIG-0031', 'DIST:D02')).toBe(kg(150));
    expect(inTransitOf(s, sh2)).toBe(kg(100));
    const prog = tripProgress(s, tr);
    expect(prog.code).toBe('exceptions_open');
    expect(prog.stops.map((x) => x.status)).toEqual(['accepted', 'part_accepted']);
    const o2 = s.orders.find((o) => o.id === sh2.orderId)!;
    expect(C.orderStatus(s, o2).label).toMatch(/Refused at delivery — 100 kg on the vehicle/);
    // payment untouched: no collection created by delivery
    expect(s.collections.filter((c) => c.orderId === o2.id)).toHaveLength(0);
    // owner sees both outcomes; D01 user never sees D02's dispute
    const stopAlert = alertsFor(s2.db, ractor('u_owner'), NOW).find((a) => a.sourceId === `${trip.id}#2`)!;
    expect(stopAlert.title).toMatch(/100 kg part refused at stop 2 \(D02\)/);
    expect(stopAlert.ownerId).toBe('u_ravi');
    expect(alertsFor(s2.db, ractor('u_ravi'), NOW).some((a) => a.sourceId === `${trip.id}#2`)).toBe(true);
    expect(alertsFor(s2.db, ractor('u_dinesh'), NOW).some((a) => a.sourceId === `${trip.id}#2` || a.sourceId === sh2.disputeId)).toBe(false);
    // distributor cannot decide disposition; Godown returns it to factory quarantine
    expect(tx(s2.db, 'u_farah', (ctx) => returnRefused(ctx, { tripId: trip.id, seq: 2, reason: 'r' })).code).toBe('forbidden');
    const ret = tx(s2.db, 'u_ravi', (ctx) => returnRefused(ctx, { tripId: trip.id, seq: 2, reason: 'Wet bags back for QC inspection' }));
    expect(ret.code).toBe('ok');
    expect(at(ret.db, 'MIG-0031', 'QUAR')).toBe(kg(100));
    expect(inTransitOf(ret.db.rentio!, sh2)).toBe(0);
    expect(tripProgress(ret.db.rentio!, ret.db.rentio!.trips.find((x) => x.id === trip.id)!).code).toBe('completed');
    // the returned 100 kg is open on the order again, not "delivered"
    const st = C.orderStatus(ret.db.rentio!, ret.db.rentio!.orders.find((o) => o.id === o2.id)!);
    expect(st.code).toBe('partially_delivered');
    expect(tx(ret.db, 'u_ravi', (ctx) => returnRefused(ctx, { tripId: trip.id, seq: 2, reason: 'again' })).code).toBe('duplicate');
    expect(lotAccounting(ret.db.rentio!, 'MIG-0031').total).toBe(kg(500));
  });

  it('a fully refused stop settles nothing and keeps the whole quantity in transit custody', () => {
    const t = tripFor(db);
    const trip = t.result!;
    const r = tx(t.db, 'u_farah', (ctx) => recordStopOutcome(ctx, { tripId: trip.id, seq: 2, outcome: 'refused', receiverName: 'Farah Khan', evidence: 'Refusal note RN-17', reason: 'Godown full — no space' }));
    expect(r.code).toBe('ok');
    const s = r.db.rentio!;
    const tr = s.trips.find((x) => x.id === trip.id)!;
    const sh = s.shipments.find((x) => x.id === tr.stops![1].shipmentId)!;
    expect(sh.status).toBe('refused');
    expect(inTransitOf(s, sh)).toBe(kg(250));
    expect(at(r.db, 'MIG-0031', 'DIST:D02')).toBe(0);
    expect(tripProgress(s, tr).stops.map((x) => x.status)).toEqual(['pending', 'refused']);
    expect(tripProgress(s, tr).code).toBe('partly_delivered');
  });
});

describe('BA-3 grouped incidents (FR-115)', () => {
  const pick = (d: Db) => {
    const live = alerts(d, NOW);
    const delay = live.find((a) => a.key.startsWith('run:') && a.title.includes('RT-002'))!;
    const risk = live.find((a) => a.key.startsWith('risk:'))!;
    return { delay, risk };
  };

  it('owner/Factory Head group ≥2 live alerts; children keep owners; close refused until handled', () => {
    const { delay, risk } = pick(db);
    expect(delay && risk).toBeTruthy();
    expect(tx(db, 'u_kiran', (ctx) => createIncident(ctx, { title: 'x', leadId: 'u_fhead', alertRefs: [childRef(delay), childRef(risk)] })).code).toBe('forbidden');
    expect(tx(db, 'u_fhead', (ctx) => createIncident(ctx, { title: 'x', leadId: 'u_fhead', alertRefs: [childRef(delay)] })).code).toBe('validation');
    const c = tx(db, 'u_fhead', (ctx) => createIncident(ctx, { title: 'RT-002 cleaning delay & D02 supply', leadId: 'u_fhead', alertRefs: [childRef(delay), childRef(risk)], note: 'Suresh to give ETA; Kiran to reallocate D02' }));
    expect(c.code).toBe('ok');
    const inc = c.result!;
    // children remain in their owners' own queues, now showing the incident
    const kiran = alertsFor(c.db, ractor('u_kiran'), NOW).find((a) => childRef(a) === childRef(risk))!;
    expect(kiran).toBeTruthy();
    expect(incidentFor(c.db.rentio!, kiran)?.id).toBe(inc.id);
    const suresh = alertsFor(c.db, ractor('u_suresh'), NOW).find((a) => childRef(a) === childRef(delay));
    expect(suresh?.ownerId).toBe('u_suresh');
    // the same alert cannot be in two open incidents
    expect(tx(c.db, 'u_owner', (ctx) => createIncident(ctx, { title: 'dup', leadId: 'u_owner', alertRefs: [childRef(delay), childRef(risk)] })).code).toBe('conflict');
    // close refused while children open — nothing cleared
    const cl = tx(c.db, 'u_fhead', (ctx) => closeIncident(ctx, { incidentId: inc.id, note: 'done' }));
    expect(cl.code).toBe('business_rule');
    expect(alerts(cl.db, NOW).some((a) => childRef(a) === childRef(risk))).toBe(true);
    expect(tx(c.db, 'u_fhead', (ctx) => noteIncident(ctx, { incidentId: inc.id, text: 'Called Suresh' })).code).toBe('ok');
    // resolve the order risk for real (reallocate eligible B1), detach the delay with a reason → close allowed
    const re = tx(c.db, 'u_kiran', (ctx) => C.reallocateAtRisk(ctx, risk.sourceId));
    expect(re.code).toBe('ok');
    const kids = incidentChildren(re.db, NOW, re.db.rentio!.incidents![0]);
    expect(kids.map((k) => k.state)).toEqual(['open', 'resolved']);
    expect(tx(re.db, 'u_fhead', (ctx) => detachChild(ctx, { incidentId: inc.id, ref: childRef(delay), reason: '' })).code).toBe('validation');
    const de = tx(re.db, 'u_fhead', (ctx) => detachChild(ctx, { incidentId: inc.id, ref: childRef(delay), reason: 'Cleaning delay tracked by Suresh separately' }));
    // detaching never resolves: the delay alert is still live with its owner
    expect(alerts(de.db, NOW).some((a) => childRef(a) === childRef(delay))).toBe(true);
    const done = tx(de.db, 'u_fhead', (ctx) => closeIncident(ctx, { incidentId: inc.id, note: 'D02 reallocated; cleaning delay left with Suresh' }));
    expect(done.code).toBe('ok');
    expect(tx(done.db, 'u_fhead', (ctx) => closeIncident(ctx, { incidentId: inc.id, note: 'again' })).code).toBe('duplicate');
    expect(done.db.audit.some((a) => a.actorId === 'u_fhead')).toBe(true);
  });
});

describe('BA-4 replenishment suggestions (FR-101/106/113/117, WF-12)', () => {
  it('derives raw, stores and partner suggestions with inputs; timely supply counted, late excluded', () => {
    const list = suggestions(db, NOW);
    const raw = list.find((x) => x.key === 'raw:TOOR')!;
    expect(raw.inputs.find((i) => i.label.startsWith('Open purchases arriving'))!.source).toMatch(/PO-RT-002 3,000 kg/);
    expect(raw.inputs.find((i) => i.label.includes('NOT counted'))!.source).toMatch(/PO-RT-005/);
    const pouch = list.find((x) => x.key === 'stores:POUCH-1-B01')!;
    expect(pouch.qty).toBe((1000 - 220) * 1000); // below 400 minimum → up to 1,000
    expect(list.find((x) => x.key === 'stores:BAGS-25-B01')!.qty).toBe(0);
    const d17 = list.find((x) => x.key === 'partner:D17')!;
    const d04 = list.find((x) => x.key === 'partner:D04')!;
    expect(d17.freshness).toBe('stale');
    expect(d17.needsConfirmation).toBe(true);
    expect(d04.freshness).toBe('current');
    expect(d04.qty % kg(25)).toBe(0);
  });

  it('review never posts stock or orders; stale data needs explicit confirmation; duplicates refused', () => {
    const movesBefore = db.rentio!.movements.length;
    const ordersBefore = db.rentio!.orders.length;
    expect(tx(db, 'u_anil', (ctx) => reviewSuggestion(ctx, { key: 'partner:D04', decision: 'accepted', reason: 'ok' })).code).toBe('forbidden');
    const a = tx(db, 'u_kiran', (ctx) => reviewSuggestion(ctx, { key: 'partner:D04', decision: 'accepted', reason: 'Agreed by phone with D04' }));
    expect(a.code).toBe('ok');
    expect(a.db.rentio!.movements.length).toBe(movesBefore);
    expect(a.db.rentio!.orders.length).toBe(ordersBefore);
    expect(tx(a.db, 'u_kiran', (ctx) => reviewSuggestion(ctx, { key: 'partner:D04', decision: 'accepted', reason: 'again' })).code).toBe('duplicate');
    expect(openSuggestions(suggestions(a.db, NOW)).some((x) => x.key === 'partner:D04')).toBe(false);
    expect(tx(a.db, 'u_kiran', (ctx) => reviewSuggestion(ctx, { key: 'partner:D17', decision: 'accepted', reason: 'x' })).code).toBe('business_rule');
    const def = tx(a.db, 'u_kiran', (ctx) => reviewSuggestion(ctx, { key: 'partner:D17', decision: 'deferred', reason: 'Waiting for D17 to sync — revisit tomorrow' }));
    expect(def.code).toBe('ok');
    const conf = tx(a.db, 'u_kiran', (ctx) => confirmPartnerStock(ctx, { distributorId: 'D17', kg: 300, note: 'Phoned D17 owner, counted 12 bags' }));
    const d17 = suggestions(conf.db, NOW).find((x) => x.key === 'partner:D17')!;
    expect(d17.needsConfirmation).toBe(false);
    expect(d17.inputs[0].value).toBe('300 kg');
    expect(tx(conf.db, 'u_kiran', (ctx) => reviewSuggestion(ctx, { key: 'partner:D17', decision: 'accepted', reason: 'Confirmed stock' })).code).toBe('ok');
    // stores: named reviewer is Ravi
    expect(tx(db, 'u_ravi', (ctx) => reviewSuggestion(ctx, { key: 'stores:POUCH-1-B01', decision: 'accepted', reason: 'Raise stores purchase with vendor' })).code).toBe('ok');
  });

  it('a repack awaiting QC reduces projected pouch stock in the stores suggestion', () => {
    const req = tx(db, 'u_ravi', (ctx) => requestRepack(ctx, REPACK));
    const p = suggestions(req.db, NOW).find((x) => x.key === 'stores:POUCH-1-B01')!;
    expect(p.qty).toBe((1000 - 21) * 1000);
  });
});
