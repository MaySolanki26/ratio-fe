import { beforeAll, describe, expect, it } from 'vitest';
import { ractor } from '../domain/rentio/access';
import * as C from '../domain/rentio/commerce';
import { buildRentio } from '../domain/rentio/domain';
import { computePositions, type Ctx, execute, RError, stockRows } from '../domain/rentio/engine';
import * as O from '../domain/rentio/ops';
import * as P from '../domain/rentio/people';
import { RT001_STEPS, runScenarioStep } from '../domain/rentio/scenario';
import { SAMPLE_ATTENDANCE_CSV } from '../domain/rentio/fixtures';
import { kg } from '../domain/rentio/units';
import { byproductReconciliation, lotAccounting, myWork, stockSummary } from '../domain/rentio/views';
import type { Db } from '../services/types';

// real "now": physical event times may not be in the future, so a fixed future constant would be rejected
const NOW = new Date().toISOString();
const fresh = (dataset: 'start' | 'completed') => {
  const r = buildRentio(new Date(NOW), dataset);
  return { records: r.records, audit: [], session: { userId: 'u_owner', workspaceId: 'plant1' }, ...r.extra } as unknown as Db;
};
/** All-or-nothing like commitDraft: the original is untouched when fn throws. */
function atomic(db: Db, fn: (draft: Db) => void): Db {
  const draft = structuredClone(db);
  fn(draft);
  return draft;
}
const run = <T,>(db: Db, user: string, fn: (ctx: Ctx) => T, key?: string) => execute(db, ractor(user), { label: 'test', key, now: NOW, at: NOW }, fn);
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof RError ? e.code : String(e);
  }
  return 'ok';
};
const qtyAt = (db: Db, lot: string, loc: string) => computePositions(db.rentio!).get(`${lot}|${loc}`) ?? 0;
const bucket = (db: Db, key: string) => lotAccounting(db.rentio!, 'RT-001').buckets.filter((b) => b.key === key || b.label === key).reduce((a, b) => a + b.qty, 0);

let completed: Db;
beforeAll(() => {
  completed = fresh('completed');
});

describe('RT-001 completed scenario — lot accounting from transactions', () => {
  it('reconciles 10,000 kg raw + 20 kg oil = 10,020 kg accounted', () => {
    const acc = lotAccounting(completed.rentio!, 'RT-001');
    expect(acc.input).toBe(kg(10000));
    expect(acc.additions).toEqual([{ lotId: 'OIL-B01', qty: kg(20) }]);
    expect(acc.total).toBe(kg(10020));
    expect(acc.balanced).toBe(true);
  });

  it('matches every expected bucket', () => {
    expect(bucket(completed, 'FACTORY')).toBe(kg(4500));
    expect(bucket(completed, 'DIST')).toBe(kg(3000));
    expect(bucket(completed, 'Retailer delivered')).toBe(kg(1000));
    expect(bucket(completed, 'HUSK')).toBe(kg(650));
    expect(bucket(completed, 'CHURI')).toBe(kg(175));
    expect(bucket(completed, 'By-product internal use')).toBe(kg(200));
    expect(bucket(completed, 'By-product external dispatch')).toBe(kg(100));
    // cleaning rejects (held) + recorded process losses
    expect(bucket(completed, 'REJECT') + bucket(completed, 'Recorded process / transit loss')).toBe(kg(395));
  });

  it('packs 340 bags of 25 kg with separate ancestry for rework-derived grades', () => {
    const s = completed.rentio!;
    const packed = Object.values(s.lots).filter((l) => l.rootId === 'RT-001' && l.material === 'PACKED');
    expect(packed.reduce((a, l) => a + (l.bags ?? 0), 0)).toBe(340);
    const a2 = s.lots['RT-001/A2'];
    expect(a2.parents.map((p) => p.lotId)).toEqual(['RT-001/PEEL2']);
    expect(s.lots['RT-001/PEEL2'].parents[0].lotId).toBe('RT-001/RW1');
    expect(s.lots['RT-001/A1'].parents[0].lotId).toBe('RT-001/PEEL');
    // rework is existing material: no intake movement for any rework descendant
    expect(s.movements.filter((m) => m.kind === 'intake' && m.lotId.startsWith('RT-001')).map((m) => m.lotId)).toEqual(['RT-001']);
  });

  it('stores oil reduced once and packaging is not food mass', () => {
    expect(qtyAt(completed, 'OIL-B01', 'STORES')).toBe(kg(480));
    // 340 RT-001 bags + 40 bags for the migrated B1 exception, from 1,200 opening bags
    expect(qtyAt(completed, 'BAGS-25-B01', 'STORES') / 1000).toBe(1200 - 340 - 40);
  });

  it('drying run: 6 h active, 2 h held, 2 h delay', () => {
    const dry = completed.rentio!.runs.find((r) => r.stage === 'DRY')!;
    const t = O.runTiming(dry, NOW);
    expect(t.activeMs).toBe(6 * 3_600_000);
    expect(t.heldMs).toBe(2 * 3_600_000);
    expect(t.delayMs).toBe(2 * 3_600_000);
    expect(t.baselineFinish).toBe('2026-11-19T10:30:00.000Z'); // 16:00 IST
  });

  it('by-product stock equation reconciles', () => {
    for (const r of byproductReconciliation(completed.rentio!)) expect(r.reconciled).toBe(true);
  });

  it('replaying the start dataset step by step gives identical balances', () => {
    const db = fresh('start');
    expect(db.rentio!.lots['RT-001']).toBeUndefined();
    for (let i = 0; i < RT001_STEPS.length; i++) runScenarioStep(db);
    expect(lotAccounting(db.rentio!, 'RT-001')).toEqual(lotAccounting(completed.rentio!, 'RT-001'));
    expect(code(() => runScenarioStep(db))).toBe('business_rule');
  });
});

describe('scenario runner resumes work done from the screens', () => {
  it('counts a manually executed step and finishes a partly done one', async () => {
    const { currentStep } = await import('../domain/rentio/scenario');
    const db = fresh('start');
    run(db, 'u_kiran', (ctx) => O.createPurchase(ctx, { supplierId: 'SUP-001', declaredKg: 10000, ratePerKg: 80, lotCode: 'RT-001' }));
    expect(currentStep(db)).toBe(0);
    runScenarioStep(db); // completes step 1 using the existing purchase
    expect(db.rentio!.purchases.filter((p) => p.id === 'PO-RT-001').length).toBe(1);
    expect(currentStep(db)).toBe(1);
    // user issues and receives cleaning manually, runner starts and posts output
    run(db, 'u_ravi', (ctx) => O.issue(ctx, { lotId: 'RT-001', fromLoc: 'R1', qtyKg: 10000, toStage: 'CLEAN' }));
    const ho = db.rentio!.handovers[db.rentio!.handovers.length - 1];
    run(db, 'u_suresh', (ctx) => O.receive(ctx, { handoverId: ho.id }));
    runScenarioStep(db);
    expect(currentStep(db)).toBe(2);
    while (currentStep(db) < RT001_STEPS.length) runScenarioStep(db);
    expect(lotAccounting(db.rentio!, 'RT-001').total).toBe(kg(10020));
  });
});

describe('stock invariants', () => {
  it('blocks negative stock and leaves no partial change', () => {
    const before = completed.rentio!.movements.length;
    const err = code(() => atomic(completed, (d) => run(d, 'u_ravi', (ctx) => O.transferStock(ctx, { lotId: 'RT-001/A1-PK', from: 'F1-S02', to: 'F1-S06', kg: 99999 }))));
    expect(err).toBe('negative_stock');
    expect(completed.rentio!.movements.length).toBe(before);
  });

  it('reservation does not change physical stock; dispatch moves it into transit', () => {
    const db = fresh('start');
    while (db.rentio!.scenarioStep < RT001_STEPS.findIndex((s) => s.id === '13a')) runScenarioStep(db);
    const factoryA1 = () => stockRows(db.rentio!, NOW).filter((r) => r.lotId === 'RT-001/A1-PK' && r.location.kind === 'finished');
    expect(factoryA1().reduce((a, r) => a + r.qty, 0)).toBe(kg(5500));
    runScenarioStep(db); // 13a reserve
    expect(factoryA1().reduce((a, r) => a + r.qty, 0)).toBe(kg(5500));
    expect(factoryA1().reduce((a, r) => a + r.available, 0)).toBe(kg(1500));
    // FEFO + stack: S01 fully reserved, S02 partly — S01 3,000 and S02 1,000
    expect(db.rentio!.reservations.filter((r) => r.status === 'active' && r.lotId === 'RT-001/A1-PK').map((r) => [r.location, r.qty])).toEqual([
      ['F1-S01', kg(3000)],
      ['F1-S02', kg(1000)],
    ]);
    runScenarioStep(db); // 13b dispatch
    expect(factoryA1().reduce((a, r) => a + r.qty, 0)).toBe(kg(1500));
    expect(stockSummary(db.rentio!, NOW, (r) => r.lot.rootId === 'RT-001').transit.physical).toBe(kg(4000));
  });

  it('retailer order reserves at D01 and deducts only on delivery, once', () => {
    const db = fresh('start');
    while (db.rentio!.scenarioStep < RT001_STEPS.findIndex((s) => s.id === '15a')) runScenarioStep(db);
    runScenarioStep(db);
    expect(qtyAt(db, 'RT-001/A1-PK', 'DIST:D01')).toBe(kg(4000));
    runScenarioStep(db);
    expect(qtyAt(db, 'RT-001/A1-PK', 'DIST:D01')).toBe(kg(3000));
    const ro = db.rentio!.orders.find((o) => o.kind === 'retail' && o.partyId === 'RET-001')!;
    expect(code(() => run(db, 'u_dinesh', (ctx) => C.deliverRetail(ctx, { orderId: ro.id, challanRef: 'D01-CH-0001' })))).toBe('duplicate');
    // outside-app sale with the same reference is blocked (EC-30)
    expect(code(() => run(db, 'u_dinesh', (ctx) => C.outsideSale(ctx, { distributorId: 'D01', lotId: 'MIG-0005', kg: 25, externalRef: 'd01-ch-0001' })))).toBe('duplicate');
  });

  it('repeated submission with the same key has no second effect', () => {
    const db = fresh('completed');
    const first = run(db, 'u_ravi', (ctx) => O.internalUse(ctx, { lotId: 'RT-001/HUSK-PEEL', loc: 'BYP', kg: 10, purpose: 'Boiler fuel (demo)' }), 'use-once');
    const n = db.rentio!.movements.length;
    const second = run(db, 'u_ravi', (ctx) => O.internalUse(ctx, { lotId: 'RT-001/HUSK-PEEL', loc: 'BYP', kg: 10, purpose: 'Boiler fuel (demo)' }), 'use-once');
    expect(second.duplicate).toBe(true);
    expect(second.txId).toBe(first.txId);
    expect(db.rentio!.movements.length).toBe(n);
    expect(qtyAt(db, 'RT-001/HUSK-PEEL', 'BYP')).toBe(kg(490));
  });

  it('partial receipt leaves an accountable residual until an approved settlement', () => {
    const db = fresh('start');
    const ho = db.rentio!.handovers.find((h) => h.lotId === 'RT-002')!;
    expect(O.outstanding(ho)).toBe(kg(50));
    expect(qtyAt(db, 'RT-002', `PEND:${ho.id}`)).toBe(kg(50));
    const ap = run(db, 'u_suresh', (ctx) => O.requestResidualSettlement(ctx, { handoverId: ho.id, how: 'loss', reason: 'Spillage confirmed by CCTV (demo)' })).result;
    expect(code(() => run(db, 'u_suresh', (ctx) => O.decideApproval(ctx, { approvalId: ap.id, approve: true })))).toBe('forbidden');
    run(db, 'u_fhead', (ctx) => O.decideApproval(ctx, { approvalId: ap.id, approve: true }));
    expect(qtyAt(db, 'RT-002', `PEND:${ho.id}`)).toBe(0);
    expect(db.rentio!.handovers.find((h) => h.id === ho.id)!.status).toBe('settled');
    // RT-002 accounting still closes: accepted 2,950 + rejected 50 = 3,000 net intake
    expect(lotAccounting(db.rentio!, 'RT-002').balanced).toBe(true);
  });

  it('unbalanced output is rejected atomically (no auto-balancing loss)', () => {
    const db = fresh('start');
    const runRec = db.rentio!.runs.find((r) => r.inputLotId === 'RT-002')!;
    const before = JSON.stringify(db.rentio);
    expect(code(() => atomic(db, (d) => run(d, 'u_suresh', (ctx) => O.recordOutput(ctx, { runId: runRec.id, outputs: [{ kind: 'forward', kg: 2800 }, { kind: 'reject', kg: 50 }] }))))).toBe('business_rule');
    expect(JSON.stringify(db.rentio)).toBe(before);
  });

  it('a multi-line command that fails part-way changes nothing', () => {
    const db = fresh('start');
    const before = JSON.stringify(db.rentio);
    // second addition lot does not exist → whole output posting fails after the first moves were prepared
    const runRec = db.rentio!.runs.find((r) => r.inputLotId === 'RT-002')!;
    expect(code(() => atomic(db, (d) => run(d, 'u_suresh', (ctx) => O.recordOutput(ctx, { runId: runRec.id, outputs: [{ kind: 'forward', kg: 2805 }, { kind: 'reject', kg: 100 }], additions: [{ lotId: 'OIL-B01', kg: 5 }, { lotId: 'NOPE', kg: 0.001 }] }))))).not.toBe('ok');
    expect(JSON.stringify(db.rentio)).toBe(before);
  });
});

describe('quality holds', () => {
  it('a parent hold makes packed descendants unavailable and blocks the reserved dispatch', () => {
    const db = fresh('start');
    const row = stockRows(db.rentio!, NOW).find((r) => r.lotId === 'MIG-0001/B1-PK')!;
    expect(row.qty).toBe(kg(1000)); // physical unchanged
    expect(row.held).toBe(true);
    expect(row.available).toBe(0);
    const so = db.rentio!.orders.find((o) => o.partyId === 'D02' && o.lines[0].grade === 'B1')!;
    expect(code(() => run(db, 'u_ravi', (ctx) => C.dispatchOrder(ctx, { orderId: so.id, transporterId: 'TR-01', vehicle: 'X', driver: 'Y' })))).toBe('business_rule');
    // FEFO excludes held stock
    expect(C.eligibleFor({ s: db.rentio!, at: NOW }, 'B1', (l) => l.startsWith('F1')).length).toBe(0);
    const hold = db.rentio!.holds.find((h) => h.target === 'MIG-0001')!;
    expect(code(() => run(db, 'u_ravi', (ctx) => O.releaseHold(ctx, { holdId: hold.id })))).toBe('forbidden');
    expect(code(() => run(db, 'u_meera', (ctx) => O.releaseHold(ctx, { holdId: hold.id })))).toBe('self_approval');
  });

  it('a location treatment hold blocks normal movement from that godown only', () => {
    const db = fresh('start');
    runScenarioStep(db); // RT-001 accepted into R1
    run(db, 'u_ravi', (ctx) => O.placeHold(ctx, { scope: 'location', target: 'R1', kind: 'treatment', reason: 'Fumigation in progress (demo)' }));
    expect(code(() => run(db, 'u_ravi', (ctx) => O.issue(ctx, { lotId: 'RT-001', fromLoc: 'R1', qtyKg: 100, toStage: 'CLEAN' })))).toBe('business_rule');
    const hold = db.rentio!.holds.find((h) => h.target === 'R1')!;
    expect(code(() => run(db, 'u_ravi', (ctx) => O.releaseHold(ctx, { holdId: hold.id })))).toBe('forbidden'); // treatment needs QC release
    run(db, 'u_meera', (ctx) => O.releaseHold(ctx, { holdId: hold.id, note: 'Clearance certificate (demo)' }));
    expect(code(() => run(db, 'u_ravi', (ctx) => O.issue(ctx, { lotId: 'RT-001', fromLoc: 'R1', qtyKg: 100, toStage: 'CLEAN' })))).toBe('ok');
  });

  it('held or expired stock cannot fulfil a normal order', () => {
    const db = fresh('completed');
    run(db, 'u_meera', (ctx) => O.placeHold(ctx, { scope: 'lot', target: 'RT-001/B1', kind: 'quality', reason: 'test' }));
    const so = run(db, 'u_kiran', (ctx) => C.createFactoryOrder(ctx, { distributorId: 'D02', lines: [{ grade: 'B1', kg: 250 }] })).result;
    expect(code(() => run(db, 'u_kiran', (ctx) => C.reserveOrder(ctx, so.id)))).toBe('business_rule');
  });
});

describe('maker-checker and scope', () => {
  it('rejects self-approval of intake and of a re-grade', () => {
    const db = fresh('start');
    runScenarioStep(db); // creates and accepts RT-001 — build a second intake to test
    run(db, 'u_kiran', (ctx) => O.createPurchase(ctx, { supplierId: 'SUP-002', declaredKg: 1000, ratePerKg: 79 }));
    const po = db.rentio!.purchases[db.rentio!.purchases.length - 1];
    const it = run(db, 'u_kiran', (ctx) => O.recordIntake(ctx, { purchaseId: po.id, truck: 'T1', slip: 'S1', grossKg: 3000, tareKg: 2000, evidence: ['x'] })).result;
    expect(code(() => run(db, 'u_kiran', (ctx) => O.checkIntake(ctx, { intakeId: it.id, acceptKg: 1000 })))).toBe('self_approval');
    // stock stays held at the gate
    expect(stockRows(db.rentio!, NOW).find((r) => r.lotId === it.lotId)!.loc).toBe('INTAKE');
    const regrade = db.rentio!.approvals.find((a) => a.type === 'regrade')!;
    expect(code(() => run(db, 'u_fhead', (ctx) => O.decideApproval(ctx, { approvalId: regrade.id, approve: true })))).toBe('self_approval');
    run(db, 'u_meera', (ctx) => O.decideApproval(ctx, { approvalId: regrade.id, approve: true }));
    expect(db.rentio!.lots['MIG-0001/B1-PK'].grade).toBe('B2');
  });

  it('duplicate weighbridge slip is blocked', () => {
    const db = fresh('completed');
    run(db, 'u_kiran', (ctx) => O.createPurchase(ctx, { supplierId: 'SUP-001', declaredKg: 500, ratePerKg: 80 }));
    const po = db.rentio!.purchases[db.rentio!.purchases.length - 1];
    expect(code(() => run(db, 'u_kiran', (ctx) => O.recordIntake(ctx, { purchaseId: po.id, truck: 'T', slip: 'wb-55012', grossKg: 1500, tareKg: 1000, evidence: ['x'] })))).toBe('duplicate');
  });

  it('enforces stage, distributor and salesman scope in the services', () => {
    const db = fresh('start');
    runScenarioStep(db);
    run(db, 'u_ravi', (ctx) => O.issue(ctx, { lotId: 'RT-001', fromLoc: 'R1', qtyKg: 10000, toStage: 'CLEAN' }));
    const ho = db.rentio!.handovers[db.rentio!.handovers.length - 1];
    expect(code(() => run(db, 'u_prakash', (ctx) => O.receive(ctx, { handoverId: ho.id })))).toBe('scope');
    expect(code(() => run(db, 'u_owner', (ctx) => O.receive(ctx, { handoverId: ho.id })))).toBe('forbidden');
    const sh = db.rentio!.shipments.find((x) => x.toDistributor === 'D02')!;
    expect(code(() => run(db, 'u_dinesh', (ctx) => C.receiveShipment(ctx, { shipmentId: sh.id, goodKg: 1 })))).not.toBe('ok');
    expect(code(() => run(db, 'u_rohit', (ctx) => C.createRetailOrder(ctx, { distributorId: 'D05', retailerId: 'RET-008', grade: 'A1', kg: 25 })))).toBe('scope');
    // route skipping is blocked (FR-025)
    expect(code(() => run(db, 'u_suresh', (ctx) => O.receive(ctx, { handoverId: ho.id })))).toBe('ok');
    expect(code(() => run(db, 'u_suresh', (ctx) => O.startRun(ctx, { stage: 'G1', lotId: 'RT-001' })))).toBe('business_rule');
  });

  it('My Work is role-scoped and prefilled from source records', () => {
    const db = fresh('start');
    const suresh = myWork(db, ractor('u_suresh'), NOW).map((w) => w.kind);
    expect(suresh).toContain('output'); // RT-002 cleaning run
    expect(myWork(db, ractor('u_prakash'), NOW).some((w) => w.title.includes('RT-002'))).toBe(false);
    const owner = myWork(db, ractor('u_owner'), NOW);
    // owner only sees decisions/approvals — no routine stage work
    expect(owner.every((w) => w.kind === 'approve' || w.kind === 'check')).toBe(true);
    expect(owner.some((w) => w.kind === 'approve' && w.urgent)).toBe(true); // credit override beyond threshold
  });
});

describe('simulated integrations', () => {
  it('offline orders: one accepted, stock conflict and rate conflict — nothing repriced', () => {
    const db = fresh('start');
    expect(code(() => run(db, 'u_rohit', (ctx) => C.syncOffline(ctx)))).toBe('business_rule'); // still offline
    run(db, 'u_rohit', (ctx) => C.setDeviceOnline(ctx, true));
    const res = run(db, 'u_rohit', (ctx) => C.syncOffline(ctx)).result;
    expect(res.map((r) => r.status)).toEqual(['accepted', 'conflict', 'conflict']);
    expect(res[1].message).toMatch(/Stock conflict/);
    expect(res[2].message).toMatch(/Rate changed/);
    const q = db.rentio!.offline.queue[1];
    run(db, 'u_rohit', (ctx) => C.resolveOffline(ctx, { id: q.id, action: 'reduce_to_available' }));
    expect(db.rentio!.offline.queue[1].status).toBe('resolved');
  });

  it('Tally failure, retry and timeout never duplicate a voucher', () => {
    const db = fresh('completed');
    const doc = db.rentio!.tally[0];
    run(db, 'u_neha', (ctx) => C.syncTally(ctx, doc.id));
    expect(db.rentio!.tally[0].status).toBe('failed');
    run(db, 'u_neha', (ctx) => C.syncTally(ctx, doc.id));
    expect(db.rentio!.tally[0].status).toBe('acknowledged');
    expect(code(() => run(db, 'u_neha', (ctx) => C.syncTally(ctx, doc.id)))).toBe('duplicate');
    const doc2 = db.rentio!.tally[1];
    run(db, 'u_neha', (ctx) => C.setTallySimulation(ctx, { timeoutNext: 1 }));
    run(db, 'u_neha', (ctx) => C.syncTally(ctx, doc2.id));
    expect(db.rentio!.tally[1].status).toBe('status_unknown');
    const vouchers = Object.keys(db.rentio!.tallyExternal).length;
    run(db, 'u_neha', (ctx) => C.syncTally(ctx, doc2.id));
    expect(db.rentio!.tally[1].attempts[db.rentio!.tally[1].attempts.length - 1].outcome).toBe('found_existing');
    expect(Object.keys(db.rentio!.tallyExternal).length).toBe(vouchers);
    expect(code(() => run(db, 'u_kiran', (ctx) => C.syncTally(ctx, doc2.id)))).toBe('forbidden');
  });

  it('one IRN per invoice even when Tally generated it first', () => {
    const db = fresh('completed');
    const sale = db.rentio!.tally.find((t) => t.sourceType === 'sale')!;
    run(db, 'u_neha', (ctx) => C.simulateIrnInTally(ctx, sale.id));
    run(db, 'u_neha', (ctx) => C.generateIrn(ctx, sale.id));
    expect(db.rentio!.tally.find((t) => t.id === sale.id)!.irnSource).toBe('Tally');
    expect(code(() => run(db, 'u_neha', (ctx) => C.generateIrn(ctx, sale.id)))).toBe('duplicate');
  });

  it('attendance import is deduplicated and payroll needs a different authorizer', () => {
    const db = fresh('start');
    expect(code(() => run(db, 'u_pooja', (ctx) => P.importPunches(ctx, { fileName: 'again.csv', text: SAMPLE_ATTENDANCE_CSV })))).toBe('duplicate');
    const att = P.attendanceFor(db.rentio!.punches, '2026-11');
    const night = att['EMP-004']; // night shift crosses midnight
    expect(night.days.size).toBeGreaterThan(15);
    expect(Math.round(night.hours / night.days.size)).toBe(9); // one shift, not two
    const pay = run(db, 'u_pooja', (ctx) => P.draftPayroll(ctx, '2026-11')).result;
    const ap = run(db, 'u_pooja', (ctx) => P.requestPayrollAuthorization(ctx, pay.id)).result;
    expect(code(() => run(db, 'u_owner', (ctx) => O.decideApproval(ctx, { approvalId: ap.id, approve: true })))).toBe('forbidden');
    run(db, 'u_neha', (ctx) => O.decideApproval(ctx, { approvalId: ap.id, approve: true }));
    expect(db.rentio!.payroll[0].status).toBe('authorized');
  });

  it('forecast stays gated until an owner-approved baseline', () => {
    const db = fresh('completed');
    expect(code(() => run(db, 'u_owner', (ctx) => P.approveBaseline(ctx, { lots: ['RT-001'], yieldPct: 85 })))).toBe('business_rule');
    expect(code(() => run(db, 'u_fhead', (ctx) => P.approveBaseline(ctx, { lots: ['RT-001'], yieldPct: 85, demoOverride: true })))).toBe('forbidden');
  });
});
