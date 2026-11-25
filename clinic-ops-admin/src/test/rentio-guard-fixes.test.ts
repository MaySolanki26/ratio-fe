/**
 * Independent BA retest follow-up — service guards:
 *  1. a released repack never lands in a destination stack (or its parent godown) under a location / treatment hold,
 *     checked at proposal and again at release; a blocked release leaves food, packaging and the request intact.
 *  2. a shipment assigned to a multi-stop trip settles only through stop proof: the generic receipt is rejected,
 *     the stop handler posts exactly one receipt bound to its own shipment, and a normal single-shipment receipt still works.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ractor } from '../domain/rentio/access';
import * as C from '../domain/rentio/commerce';
import { dispatchMultiStop, recordStopOutcome } from '../domain/rentio/delivery';
import { buildRentio } from '../domain/rentio/domain';
import { computePositions, type Ctx, execute, RError } from '../domain/rentio/engine';
import * as O from '../domain/rentio/ops';
import { decideRepack, destinationBlock, requestRepack } from '../domain/rentio/repack';
import { kg } from '../domain/rentio/units';
import type { Db } from '../services/types';

const NOW = new Date().toISOString();
const fresh = () => {
  const r = buildRentio(new Date(NOW), 'demo');
  return { records: r.records, audit: [], session: { userId: 'u_owner', workspaceId: 'plant1' }, ...r.extra } as unknown as Db;
};
function tx<T>(db: Db, user: string, fn: (ctx: Ctx) => T, key?: string): { db: Db; result?: T; code: string; message?: string } {
  const draft = structuredClone(db);
  try {
    const r = execute(draft, ractor(user), { label: 'test', key, now: NOW, at: NOW }, fn);
    return { db: draft, result: r.result, code: r.duplicate ? 'duplicate-key' : 'ok' };
  } catch (e) {
    return { db, code: e instanceof RError ? e.code : String(e), message: e instanceof Error ? e.message : undefined };
  }
}
const at = (db: Db, lot: string, loc: string) => computePositions(db.rentio!).get(`${lot}|${loc}`) ?? 0;
const REPACK = { lotId: 'MIG-0030', fromLoc: 'F1-S04', toLoc: 'F1-S06', inputKg: 200, targetBagKg: 1, outputBags: 199, measuredOutputKg: 199, packagingLotId: 'POUCH-1-B01', lossKg: 1, lossReason: 'Spillage while opening torn bags' };
const treat = (db: Db, target: string) => tx(db, 'u_ravi', (ctx) => O.placeHold(ctx, { scope: 'location', target, kind: 'treatment', reason: 'Fumigation in progress' }));

let db: Db;
beforeEach(() => {
  db = fresh();
});

describe('repack destination under treatment hold', () => {
  it('rejects at release when the destination stack is put under treatment after the proposal — nothing moves', () => {
    const p = tx(db, 'u_ravi', (ctx) => requestRepack(ctx, REPACK));
    expect(p.code).toBe('ok');
    const held = treat(p.db, 'F1-S06');
    expect(held.code).toBe('ok');
    expect(destinationBlock(held.db.rentio!, 'F1-S06')).toMatch(/treatment hold/);
    const rel = tx(held.db, 'u_meera', (ctx) => decideRepack(ctx, { repackId: p.result!.id, release: true }));
    expect(rel.code).toBe('business_rule');
    expect(rel.message).toMatch(/cannot receive released packs/);
    expect(at(rel.db, 'MIG-0030', 'F1-S04')).toBe(kg(250));
    expect(at(rel.db, 'POUCH-1-B01', 'STORES')).toBe(220_000);
    expect(rel.db.rentio!.repacks!.find((x) => x.id === p.result!.id)!.status).toBe('pending_qc');
    expect(rel.db.rentio!.movements.filter((m) => m.ref === p.result!.id)).toHaveLength(0);
  });

  it('rejects the proposal into a held stack and into a stack whose parent godown is held', () => {
    expect(tx(treat(db, 'F1-S06').db, 'u_ravi', (ctx) => requestRepack(ctx, REPACK)).code).toBe('business_rule');
    const godown = db.rentio!.locations['F1-S06'].godown!;
    expect(godown).toBeTruthy();
    const gHeld = treat(db, godown);
    expect(gHeld.code).toBe('ok');
    expect(destinationBlock(gHeld.db.rentio!, 'F1-S06')).toBeTruthy();
    const r = tx(gHeld.db, 'u_ravi', (ctx) => requestRepack(ctx, REPACK));
    expect(r.code).toBe('business_rule');
    expect(r.db.rentio!.repacks ?? []).toHaveLength(0);
  });

  it('still releases normally into an unheld destination', () => {
    const p = tx(db, 'u_ravi', (ctx) => requestRepack(ctx, REPACK));
    const rel = tx(p.db, 'u_meera', (ctx) => decideRepack(ctx, { repackId: p.result!.id, release: true }));
    expect(rel.code).toBe('ok');
    expect(at(rel.db, rel.result!.childLotId!, 'F1-S06')).toBe(kg(199));
    expect(at(rel.db, 'MIG-0030', 'F1-S04')).toBe(kg(50));
  });
});

describe('multi-stop shipments settle only through stop proof', () => {
  const trip = (d: Db) => {
    const ids = d.rentio!.orders.filter((o) => o.lines[0].grade === 'B2' && ['D01', 'D02'].includes(o.partyId)).map((o) => o.id);
    return tx(d, 'u_ravi', (ctx) => dispatchMultiStop(ctx, { orderIds: ids, transporterId: 'TR-01', vehicle: 'MH12-AB-4455', driver: 'Sanjay More (fictional)' }));
  };

  it('rejects the generic receipt for a stop shipment, then the stop proof posts exactly one receipt', () => {
    const t = trip(db);
    expect(t.code).toBe('ok');
    const [s1, s2] = t.result!.stops!;
    const generic = tx(t.db, 'u_dinesh', (ctx) => C.receiveShipment(ctx, { shipmentId: s1.shipmentId, goodKg: 250 }));
    expect(generic.code).toBe('business_rule');
    expect(generic.message).toMatch(/stop 1 of multi-stop trip/);
    expect(at(generic.db, 'MIG-0031', 'DIST:D01')).toBe(0);
    // the stop path cannot be pointed at another stop's shipment
    expect(tx(t.db, 'u_dinesh', (ctx) => C.settleShipmentReceipt(ctx, { shipmentId: s1.shipmentId, goodKg: 250 }, { tripId: t.result!.id, seq: s2.seq })).code).toBe('business_rule');
    const ok = tx(t.db, 'u_dinesh', (ctx) => recordStopOutcome(ctx, { tripId: t.result!.id, seq: s1.seq, outcome: 'accepted', receiverName: 'Dinesh Kulkarni', evidence: 'POD-D01-001.jpg' }));
    expect(ok.code).toBe('ok');
    const s = ok.db.rentio!;
    const receipts = s.movements.filter((m) => m.ref === s1.shipmentId && m.kind === 'transit-receive');
    expect(receipts).toHaveLength(1);
    expect(at(ok.db, 'MIG-0031', 'DIST:D01')).toBe(kg(250));
    expect(s.trips.find((x) => x.id === t.result!.id)!.stops![0].outcome).toBe('accepted');
    // after proof, neither the generic receipt nor a second settlement can post again
    expect(tx(ok.db, 'u_dinesh', (ctx) => C.receiveShipment(ctx, { shipmentId: s1.shipmentId, goodKg: 250 })).code).not.toBe('ok');
    expect(tx(ok.db, 'u_dinesh', (ctx) => C.settleShipmentReceipt(ctx, { shipmentId: s1.shipmentId, goodKg: 250 }, { tripId: t.result!.id, seq: s1.seq })).code).toBe('duplicate');
  });

  it('a legacy generic receipt on a stop shipment is never overwritten by a stop outcome', () => {
    const t = trip(db);
    const [s1] = t.result!.stops!;
    // simulate saved data from before the guard: receipt exists, stop has no proof
    const legacy = structuredClone(t.db);
    legacy.rentio!.shipments.find((x) => x.id === s1.shipmentId)!.receipt = { good: kg(250), damaged: 0, short: 0, excess: 0, by: 'u_dinesh', at: NOW };
    const r = tx(legacy, 'u_dinesh', (ctx) => recordStopOutcome(ctx, { tripId: t.result!.id, seq: s1.seq, outcome: 'refused', receiverName: 'x', evidence: 'y', reason: 'z' }));
    expect(r.code).toBe('business_rule');
    expect(r.db.rentio!.trips.find((x) => x.id === t.result!.id)!.stops![0].outcome).toBeUndefined();
  });

  it('a normal single-shipment receipt still works through the generic receipt', () => {
    const o = db.rentio!.orders.find((x) => x.lines[0].grade === 'B2' && x.partyId === 'D01')!;
    const d = tx(db, 'u_ravi', (ctx) => C.dispatchOrder(ctx, { orderId: o.id, transporterId: 'TR-01', vehicle: 'MH12-AB-4455', driver: 'Sanjay More (fictional)' }));
    expect(d.code).toBe('ok');
    const r = tx(d.db, 'u_dinesh', (ctx) => C.receiveShipment(ctx, { shipmentId: d.result!.id, goodKg: 250 }));
    expect(r.code).toBe('ok');
    expect(r.result!.status).toBe('received');
    expect(at(r.db, 'MIG-0031', 'DIST:D01')).toBe(kg(250));
  });
});
