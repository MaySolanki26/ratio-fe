/**
 * Separate EXCEPTION scenarios (all fictional), built with the same services
 * as user actions. They never touch the RT-001 genealogy.
 */
import type { Db } from '../../services/types';
import { ractor } from './access';
import * as C from './commerce';
import { type Ctx, createLot, execute, move } from './engine';
import * as O from './ops';
import * as P from './people';
import { ist } from './scenario';
import { EMPLOYEES } from './data';
import { kg } from './units';

const as = <T,>(db: Db, user: string, label: string, at: string, fn: (ctx: Ctx) => T) => execute(db, ractor(user), { label, at, now: at, ref: 'EXCEPTION' }, fn).result;

export const EXCEPTIONS = [
  { id: 'EX-1', title: 'Partial receipt with unresolved balance (RT-002)', where: 'Procurement · Stage handovers', detail: 'PO 6,000 kg, first truck 3,000 kg (2,950 accepted, 50 rejected); open purchase balance 3,000 kg. Cleaning received 2,900 of 2,950 issued → 50 kg residual stays pending until an approved settlement.' },
  { id: 'EX-2', title: 'Quality-held stock with an at-risk reservation (MIG-0001)', where: 'Inventory · Orders', detail: 'Migrated bulk B1 (origin unknown) was packed into MIG-0001/B1-PK and 500 kg reserved for D02. QC then held the PARENT lot: the packed child is held and the reservation is Supply At Risk; dispatch is blocked.' },
  { id: 'EX-3', title: 'Offline salesman orders with conflicts (D02)', where: 'Sales · Offline queue', detail: 'Rohit captured three orders offline. Two compete for 750 kg A1; the B1 rate changed after capture. Sync shows one accepted, one stock conflict, one rate conflict — nothing silently repriced.' },
  { id: 'EX-4', title: 'Simulated Tally failure and retry', where: 'Tally & compliance', detail: 'The simulator will refuse the next sync. Retry with the same source identity; a timeout variant shows lookup-before-retry with no duplicate voucher.' },
  { id: 'EX-5', title: 'Shipment short at distributor D02', where: 'Distributor inventory · Logistics', detail: '500 kg A2 dispatched, D02 received 475 kg good: 25 kg stays in transit under dispute until an approved settlement.' },
  { id: 'EX-6', title: 'Self-approval rejection', where: 'Approvals', detail: 'Sunita requested a re-grade and also holds approval rights — her own approval is rejected; Meera (QC) or the Owner must decide. Kiran cannot accept his own intake.' },
  { id: 'EX-7', title: 'Credit hold beyond delegated limit (D04)', where: 'Orders · Owner decisions', detail: 'A 6,000 kg order exceeds D04 credit by more than the owner threshold; it is the only kind of item that reaches the Owner.' },
  { id: 'EX-8', title: 'Running stage now delayed (RT-002 cleaning)', where: 'Production · Control Tower', detail: 'RT-002 cleaning started 5 h before the data set was built, with a 4 h plan: it shows Delayed with the original baseline retained.' },
  { id: 'EX-9', title: 'Complaint with unknown lot', where: 'Returns & complaints', detail: 'Retailer reports stones in a bag but the lot is unknown: the case stays flagged for identification rather than guessing a lot.' },
];

function punchesCsv() {
  const rows = ['employee,time,dir'];
  const staff = EMPLOYEES.filter((e) => e.userId !== 'u_owner');
  for (let d = 1; d <= 24; d++) {
    const date = new Date(Date.UTC(2026, 10, d));
    if (date.getUTCDay() === 0) continue;
    const day = `2026-11-${String(d).padStart(2, '0')}`;
    staff.forEach((e, i) => {
      if ((d + i) % 11 === 0) return; // absent
      if (e.shift === 'night') {
        const next = `2026-11-${String(d + 1).padStart(2, '0')}`;
        rows.push(`${e.id},${day}T21:00:00+05:30,in`, `${e.id},${next}T06:${i % 2 ? '30' : '00'}:00+05:30,out`);
      } else {
        rows.push(`${e.id},${day}T09:0${i % 5}:00+05:30,in`);
        if (!(e.id === 'EMP-015' && d === 12)) rows.push(`${e.id},${day}T${i % 3 === 0 ? '19' : '17'}:30:00+05:30,out`);
      }
    });
  }
  return rows.join('\n');
}

export const SAMPLE_ATTENDANCE_CSV = punchesCsv();

export function buildExceptions(db: Db, now = new Date()) {
  /** Recent events are placed relative to the build time so they are never in the future. */
  const ago = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
  // ---- EX-2 / migration: bulk B1 with unknown origin → packed child, reserved, then parent held
  as(db, 'u_ravi', 'Opening WIP migration (unknown origin)', ist('2026-11-10 09:00'), (ctx) => {
    createLot(ctx, { id: 'MIG-0001', rootId: 'MIG-0001', material: 'DAL', grade: 'B1', label: 'Migrated opening bulk dal B1 — origin unknown (controlled migration ID)', parents: [], nextStage: 'PACK', routeVersion: 1 });
    move(ctx, { lotId: 'MIG-0001', qty: kg(1000), to: 'STG:PACK:IN', kind: 'opening', basis: 'Counted', ref: 'MIGRATION', note: 'Controlled migration identifier; no fabricated history' });
    createLot(ctx, { id: 'MIG-0002', rootId: 'MIG-0002', material: 'PACKED', grade: 'A1', sku: 'SKU-A1-25', bags: 30, bagSize: kg(25), mfgDate: '2026-09-01', expiry: '2027-02-28', label: 'Migrated D02 opening stock A1', parents: [] });
    move(ctx, { lotId: 'MIG-0002', qty: kg(750), to: 'DIST:D02', kind: 'opening', basis: 'Counted', ref: 'MIGRATION' });
    createLot(ctx, { id: 'MIG-0003', rootId: 'MIG-0003', material: 'PACKED', grade: 'B1', sku: 'SKU-B1-25', bags: 10, bagSize: kg(25), mfgDate: '2026-09-01', expiry: '2027-02-28', label: 'Migrated D02 opening stock B1', parents: [] });
    move(ctx, { lotId: 'MIG-0003', qty: kg(250), to: 'DIST:D02', kind: 'opening', basis: 'Counted', ref: 'MIGRATION' });
    createLot(ctx, { id: 'MIG-0004', rootId: 'MIG-0004', material: 'PACKED', grade: 'A2', sku: 'SKU-A2-25', bags: 20, bagSize: kg(25), mfgDate: '2026-08-20', expiry: '2027-02-16', label: 'Migrated factory opening stock A2', parents: [] });
    move(ctx, { lotId: 'MIG-0004', qty: kg(500), to: 'F1-S06', kind: 'opening', basis: 'Counted', ref: 'MIGRATION' });
    createLot(ctx, { id: 'MIG-0005', rootId: 'MIG-0005', material: 'PACKED', grade: 'B1', sku: 'SKU-B1-25', bags: 48, bagSize: kg(25), mfgDate: '2026-09-15', expiry: '2027-03-14', label: 'Migrated D01 opening stock B1', parents: [] });
    move(ctx, { lotId: 'MIG-0005', qty: kg(1200), to: 'DIST:D01', kind: 'opening', basis: 'Counted', ref: 'MIGRATION' });
    ['D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09', 'D10', 'D11', 'D12', 'D13', 'D14', 'D15', 'D16', 'D17'].forEach((d, i) => {
      const id = `MIG-${String(10 + i).padStart(4, '0')}`;
      const g = i % 2 ? 'B1' : 'A1';
      const q = [900, 300, 1500, 600, 2400, 150, 800, 1100, 450, 2000, 700, 350, 1300, 950, 500][i];
      createLot(ctx, { id, rootId: id, material: 'PACKED', grade: g, sku: `SKU-${g}-25`, bags: q / 25, bagSize: kg(25), mfgDate: '2026-09-10', expiry: i === 5 ? '2026-12-10' : '2027-03-09', label: `Migrated ${d} opening stock ${g}`, parents: [] });
      move(ctx, { lotId: id, qty: kg(q), to: `DIST:${d}`, kind: 'opening', basis: 'Counted', ref: 'MIGRATION' });
    });
  });
  const pack = as(db, 'u_deepa', 'Start packing migrated bulk', ist('2026-11-12 09:00'), (ctx) => O.startRun(ctx, { stage: 'PACK', lotId: 'MIG-0001' }));
  as(db, 'u_deepa', 'Record packing output', ist('2026-11-12 12:00'), (ctx) => O.recordOutput(ctx, { runId: pack.id, outputs: [{ kind: 'forward', kg: 1000 }], packing: { bagSizeKg: 25, bagsLotId: 'BAGS-25-B01', checks: { netWeight: true, seal: true, label: true } } }));
  const ho = as(db, 'u_deepa', 'Issue packed B1 to F1', ist('2026-11-12 13:00'), (ctx) => O.issue(ctx, { lotId: 'MIG-0001/B1-PK', fromLoc: 'STG:PACK:OUT', qtyKg: 1000, toStage: 'F1', basis: 'Counted' }));
  as(db, 'u_ravi', 'Receive into F1-S05', ist('2026-11-12 13:30'), (ctx) => O.receive(ctx, { handoverId: ho.id, stacks: [{ loc: 'F1-S05', kg: 1000 }] }));
  const so2 = as(db, 'u_kiran', 'Order for D02 (B1)', ago(30), (ctx) => C.createFactoryOrder(ctx, { distributorId: 'D02', lines: [{ grade: 'B1', kg: 500 }], promisedDate: '2026-11-26' }));
  as(db, 'u_kiran', 'Reserve D02 B1', ago(29.9), (ctx) => C.reserveOrder(ctx, so2.id));
  as(db, 'u_meera', 'Quality hold on parent bulk', ago(9), (ctx) => O.placeHold(ctx, { scope: 'lot', target: 'MIG-0001', kind: 'quality', reason: 'Suspected insect activity reported in migrated bulk (demo) — affects all descendants' }));

  // ---- EX-5: short shipment at D02
  const so5 = as(db, 'u_kiran', 'Order for D02 (A2)', ago(40), (ctx) => C.createFactoryOrder(ctx, { distributorId: 'D02', lines: [{ grade: 'A2', kg: 500 }] }));
  as(db, 'u_kiran', 'Reserve D02 A2', ago(39.9), (ctx) => C.reserveOrder(ctx, so5.id));
  as(db, 'u_ravi', 'Dispatch to D02', ago(34), (ctx) => C.dispatchOrder(ctx, { orderId: so5.id, transporterId: 'TR-02', vehicle: 'MH08-KL-3310', driver: 'Iqbal Shaikh (fictional)', vehicleGrossKg: 6502, vehicleTareKg: 6000 }));
  const sh5 = db.rentio!.shipments.find((x) => x.orderId === so5.id)!;
  as(db, 'u_farah', 'D02 receipt — short', ago(14), (ctx) => C.receiveShipment(ctx, { shipmentId: sh5.id, goodKg: 475, damagedKg: 0, note: 'One bag missing on arrival' }));

  // ---- EX-6: re-grade requested by the Factory Head (she may not approve it herself)
  as(db, 'u_fhead', 'Request downgrade', ago(5), (ctx) => O.requestRegrade(ctx, { lotId: 'MIG-0001/B1-PK', newGrade: 'B2', reason: 'Visual sample shows more broken grains than B1 allows (demo)' }));

  // ---- EX-7: credit hold beyond limit, plus an advance booking (no reservation)
  as(db, 'u_kiran', 'Large order for D04', ist('2026-11-24 10:00'), (ctx) => C.createFactoryOrder(ctx, { distributorId: 'D04', lines: [{ grade: 'A1', kg: 6000 }], promisedDate: '2026-11-30' }));
  as(db, 'u_kiran', 'Advance booking D03', ist('2026-11-24 10:30'), (ctx) => C.createFactoryOrder(ctx, { distributorId: 'D03', lines: [{ grade: 'B1', kg: 2000 }], promisedDate: '2026-12-05', advance: true }));

  // ---- EX-1: partial receipt + partial handover receipt + running delayed stage
  as(db, 'u_kiran', 'Purchase RT-002', ago(20), (ctx) => O.createPurchase(ctx, { supplierId: 'SUP-003', declaredKg: 6000, ratePerKg: 78, billRef: 'SAT-2211', lotCode: 'RT-002', promisedDate: '2026-11-26' }));
  const in2 = as(db, 'u_kiran', 'Truck 1 for RT-002', ago(18), (ctx) => O.recordIntake(ctx, { purchaseId: 'PO-RT-002', truck: 'MH13-CD-1100', slip: 'WB-55101', grossKg: 9000, tareKg: 6000, moisturePct: 11.5, foreignMatterPct: 2, damagePct: 1, evidence: ['slip-WB-55101.jpg (demo)'] }));
  as(db, 'u_meera', 'Partially accept RT-002', ago(17), (ctx) => O.checkIntake(ctx, { intakeId: in2.id, acceptKg: 2950, rejectKg: 50, godown: 'R1' }));
  const ho2 = as(db, 'u_ravi', 'Issue RT-002 to cleaning', ago(6), (ctx) => O.issue(ctx, { lotId: 'RT-002', fromLoc: 'R1', qtyKg: 2950, toStage: 'CLEAN' }));
  as(db, 'u_suresh', 'Receive RT-002 (short)', ago(5.5), (ctx) => O.receive(ctx, { handoverId: ho2.id, qtyKg: 2900, note: 'Two bags not found at the cleaning bay' }));
  as(db, 'u_suresh', 'Start RT-002 cleaning', ago(5), (ctx) => O.startRun(ctx, { stage: 'CLEAN', lotId: 'RT-002' }));

  // ---- EX-3: offline queue with competing stock and a rate change
  as(db, 'u_rohit', 'Device goes offline', ago(4), (ctx) => C.setDeviceOnline(ctx, false));
  as(db, 'u_rohit', 'Offline order 1', ago(3.8), (ctx) => C.queueOfflineOrder(ctx, { distributorId: 'D02', retailerId: 'RET-004', grade: 'A1', kg: 500 }));
  as(db, 'u_rohit', 'Offline order 2', ago(3.4), (ctx) => C.queueOfflineOrder(ctx, { distributorId: 'D02', retailerId: 'RET-005', grade: 'A1', kg: 500 }));
  as(db, 'u_rohit', 'Offline order 3', ago(3.1), (ctx) => C.queueOfflineOrder(ctx, { distributorId: 'D02', retailerId: 'RET-004', grade: 'B1', kg: 250 }));
  as(db, 'u_neha', 'Revise B1 retail rate', ago(2.5), (ctx) => C.publishRate(ctx, { grade: 'B1', kind: 'retail', ratePerKg: 128 }));

  // ---- EX-9 complaint with unknown lot; EX-4 Tally simulator primed to fail once
  as(db, 'u_rohit', 'Complaint (unknown lot)', ago(8), (ctx) => C.createComplaint(ctx, { distributorId: 'D02', retailerId: 'RET-004', category: 'quality', description: 'Retailer found small stones in one 25 kg bag; bag label torn, lot unknown.' }));
  as(db, 'u_neha', 'Prime Tally simulator', ago(7), (ctx) => C.setTallySimulation(ctx, { failNext: 1, timeoutNext: 0 }));

  // ---- HR attendance file (already imported once) & owner decision register
  as(db, 'u_pooja', 'Import biometric file', ago(1), (ctx) => P.importPunches(ctx, { fileName: 'biometric-2026-11-01_24.csv', text: SAMPLE_ATTENDANCE_CSV }));
  as(db, 'u_owner', 'Record decision', ist('2026-11-10 10:00'), (ctx) =>
    P.recordDecision(ctx, { title: 'Cleaning rejects handling (demo)', answer: 'Hold cleaning rejects in quarantine; QC decides disposal weekly. Never sell as Husk/Churi.', scope: 'All lots · M4/M6' }),
  );
  as(db, 'u_owner', 'Record decision', ist('2026-11-11 10:00'), (ctx) => P.recordDecision(ctx, { title: 'Delegated intake checker (demo)', answer: 'QC or a Back Office checker who did not record the intake may accept within ±2% of the purchase; Owner not required.', scope: 'M2 intake' }));
  as(db, 'u_owner', 'Notify', ago(6), (ctx) => {
    P.sendMessage(ctx, { channel: 'WhatsApp', to: 'Sunita Rao', text: 'RT-002 handover HO short by 50 kg at cleaning — settlement needed (simulated)' });
    P.sendMessage(ctx, { channel: 'SMS', to: 'Farah Khan', text: 'Shipment to D02 short 25 kg — dispute open (simulated)', fail: true });
  });
}

/**
 * Demo snapshot extras (dataset "demo"): a second lot RT-003 part-way through production, waiting for
 * Anil (Oiling) to RECEIVE it — the manual staff handover for the client walkthrough — and RT-004 raw
 * toor accepted in R1, ready to process. Separate roots: RT-001 totals are unaffected.
 */
export function buildDemoExtras(db: Db, now = new Date()) {
  const ago = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
  as(db, 'u_kiran', 'Purchase RT-003', ago(30), (ctx) => O.createPurchase(ctx, { supplierId: 'SUP-002', declaredKg: 3000, ratePerKg: 79, billRef: 'GB-118', lotCode: 'RT-003' }));
  const i3 = as(db, 'u_kiran', 'Truck for RT-003', ago(29), (ctx) => O.recordIntake(ctx, { purchaseId: 'PO-RT-003', truck: 'MH24-CD-7810', slip: 'WB-55190', grossKg: 7600, tareKg: 4600, moisturePct: 9.8, foreignMatterPct: 1, damagePct: 0.5, evidence: ['slip-WB-55190.jpg (demo)'] }));
  as(db, 'u_meera', 'Accept RT-003', ago(28), (ctx) => O.checkIntake(ctx, { intakeId: i3.id, acceptKg: 3000, godown: 'R1' }));
  const h1 = as(db, 'u_ravi', 'Issue RT-003 to cleaning', ago(12), (ctx) => O.issue(ctx, { lotId: 'RT-003', fromLoc: 'R1', qtyKg: 3000, toStage: 'CLEAN' }));
  as(db, 'u_suresh', 'Receive RT-003', ago(11.8), (ctx) => O.receive(ctx, { handoverId: h1.id }));
  const r1 = as(db, 'u_suresh', 'Start RT-003 cleaning', ago(11.5), (ctx) => O.startRun(ctx, { stage: 'CLEAN', lotId: 'RT-003' }));
  as(db, 'u_suresh', 'RT-003 cleaning output', ago(7.6), (ctx) => O.recordOutput(ctx, { runId: r1.id, outputs: [{ kind: 'forward', kg: 2970 }, { kind: 'reject', kg: 30, reason: 'Stones and mud' }] }));
  const h2 = as(db, 'u_suresh', 'Issue RT-003/CLEAN to G1', ago(7.4), (ctx) => O.issue(ctx, { lotId: 'RT-003/CLEAN', fromLoc: 'STG:CLEAN:OUT', qtyKg: 2970, toStage: 'G1' }));
  as(db, 'u_suresh', 'Receive at G1', ago(7.3), (ctx) => O.receive(ctx, { handoverId: h2.id }));
  const r2 = as(db, 'u_suresh', 'Start G1', ago(7.2), (ctx) => O.startRun(ctx, { stage: 'G1', lotId: 'RT-003/CLEAN' }));
  as(db, 'u_suresh', 'G1 output', ago(4.2), (ctx) => O.recordOutput(ctx, { runId: r2.id, outputs: [{ kind: 'forward', kg: 2970, grade: 'Bold' }] }));
  as(db, 'u_suresh', 'Issue RT-003/G1 to oiling', ago(1.5), (ctx) => O.issue(ctx, { lotId: 'RT-003/G1', fromLoc: 'STG:G1:OUT', qtyKg: 2970, toStage: 'OIL' }));
  // RT-004: raw toor accepted and waiting in R1 (ready to process — NOT "held")
  as(db, 'u_kiran', 'Purchase RT-004', ago(26), (ctx) => O.createPurchase(ctx, { supplierId: 'SUP-004', declaredKg: 5000, ratePerKg: 81, billRef: 'KP-5521', lotCode: 'RT-004', brokerId: 'BRK-01' }));
  const i4 = as(db, 'u_kiran', 'Truck for RT-004', ago(25), (ctx) => O.recordIntake(ctx, { purchaseId: 'PO-RT-004', truck: 'MH30-EF-2290', slip: 'WB-55201', grossKg: 11000, tareKg: 6000, moisturePct: 10.4, foreignMatterPct: 1.5, damagePct: 0.5, evidence: ['slip-WB-55201.jpg (demo)'] }));
  as(db, 'u_meera', 'Accept RT-004', ago(24), (ctx) => O.checkIntake(ctx, { intakeId: i4.id, acceptKg: 5000, godown: 'R1' }));
}
