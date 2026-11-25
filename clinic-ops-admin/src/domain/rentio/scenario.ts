/**
 * RT-001 — the main illustrative journey, scripted as the SAME service calls a
 * user makes from the screens (each by the responsible role user). The
 * "completed" dataset is produced by replaying these steps; nothing is a
 * dashboard constant. Times are demonstration values, not production recipes.
 */
import type { Db } from '../../services/types';
import { ractor } from './access';
import * as C from './commerce';
import { type Ctx, execute, fail } from './engine';
import * as O from './ops';
import type { StageCode } from './types';

/** Asia/Kolkata wall time → ISO. */
export const ist = (s: string) => new Date(`${s.replace(' ', 'T')}:00+05:30`).toISOString();

type Step = { id: string; title: string; detail: string; actors: string[]; run: (db: Db) => void; done: (db: Db) => boolean };

/**
 * Scripted demonstration time, but never earlier than RT-001's latest recorded event: when someone has
 * already done part of the journey from the screens, the runner continues after their work instead of
 * back-dating (event-time chronology is enforced by the engine).
 */
function fitAt(db: Db, at: string) {
  const fam = new Set(Object.values(db.rentio!.lots).filter((l) => l.rootId === 'RT-001').map((l) => l.id));
  let floor = '';
  for (const m of db.rentio!.movements) if (fam.has(m.lotId) && m.at > floor) floor = m.at;
  for (const r of db.rentio!.runs) if (fam.has(r.inputLotId)) for (const e of r.events) if (e.at > floor) floor = e.at;
  return floor > at ? floor : at;
}

const as = <T,>(db: Db, user: string, label: string, at: string, fn: (ctx: Ctx) => T) => execute(db, ractor(user), { label, at: fitAt(db, at), ref: 'RT-001' }, fn).result;

const s = (db: Db) => db.rentio!;
const lastRun = (db: Db, stage: StageCode, lotId: string) => [...s(db).runs].reverse().find((r) => r.stage === stage && r.inputLotId === lotId) ?? fail('not_found', `No ${stage} run for ${lotId}`);

/** Issue → receive → start → output at one stage (each action by its accountable user). */
function stagePass(
  db: Db,
  o: { lotId: string; from: string; to: StageCode; issuer: string; owner: string; t: [string, string, string, string]; outputs: O.OutputInput[]; additions?: { lotId: string; kg: number }[]; holds?: { at: string; resume: string; reason: string }[]; packing?: Parameters<typeof O.recordOutput>[1]['packing'] },
) {
  // Resumable: each action runs only if a user has not already done it from the screens.
  const lot = s(db).lots[o.lotId] ?? fail('not_found', `Lot ${o.lotId} missing — complete the previous step first`);
  const qtyAt = (loc: string) => (db.rentio!.movements.filter((m) => m.lotId === lot.id && m.to === loc).reduce((a, m) => a + m.qty, 0) - db.rentio!.movements.filter((m) => m.lotId === lot.id && m.from === loc).reduce((a, m) => a + m.qty, 0)) / 1000;
  const issued = s(db).handovers.some((h) => h.lotId === lot.id && h.toStage === o.to);
  if (!issued && qtyAt(o.from) > 0) as(db, o.issuer, `Issue ${lot.id} to ${o.to}`, o.t[0], (ctx) => O.issue(ctx, { lotId: lot.id, fromLoc: o.from, qtyKg: qtyAt(o.from), toStage: o.to }));
  const ho = s(db).handovers.find((h) => h.lotId === lot.id && h.toStage === o.to && O.outstanding(h) > 0 && h.received === 0);
  if (ho) as(db, o.owner, `Receive ${lot.id} at ${o.to}`, o.t[1], (ctx) => O.receive(ctx, { handoverId: ho.id }));
  let run = [...s(db).runs].reverse().find((r) => r.stage === o.to && r.inputLotId === lot.id);
  if (!run) {
    as(db, o.owner, `Start ${o.to} run`, o.t[2], (ctx) => O.startRun(ctx, { stage: o.to, lotId: lot.id }));
    run = lastRun(db, o.to, lot.id);
    for (const h of o.holds ?? []) {
      as(db, o.owner, `Hold ${run.id}`, h.at, (ctx) => O.holdRun(ctx, run!.id, h.reason));
      as(db, o.owner, `Resume ${run.id}`, h.resume, (ctx) => O.resumeRun(ctx, run!.id));
    }
  }
  if (run.status === 'on_hold') as(db, o.owner, `Resume ${run.id}`, o.t[3], (ctx) => O.resumeRun(ctx, run!.id));
  if (run.status !== 'completed') {
    const r = run;
    as(db, o.owner, `Record ${o.to} output`, o.t[3], (ctx) => O.recordOutput(ctx, { runId: r.id, outputs: o.outputs, additions: o.additions, packing: o.packing }));
  }
  return run;
}

const runDone = (db: Db, stage: StageCode, lotId: string) => s(db).runs.some((r) => r.stage === stage && r.inputLotId === lotId && r.status === 'completed');
const d01Order = (db: Db) => s(db).orders.find((o) => o.kind === 'factory' && o.partyId === 'D01' && o.lines[0]?.grade === 'A1' && !o.advance);
const retailOrder = (db: Db) => s(db).orders.find((o) => o.kind === 'retail' && o.partyId === 'RET-001' && o.distributorId === 'D01');

const PACK_CHECKS = { netWeight: true, seal: true, label: true };

export const RT001_STEPS: Step[] = [
  {
    id: '1',
    title: 'Purchase & receive 10,000 kg whole toor',
    detail: 'Kiran (Back Office) records PO-RT-001 from fictional Farmer Ramesh at ₹80/kg and the truck intake (gross 15,000 − tare 5,000). Intake is HELD until Meera (QC, independent checker) accepts it into Raw Godown R1. Bill is matched to the accepted receipt.',
    actors: ['u_kiran', 'u_meera'],
    run: (db) => {
      if (!s(db).purchases.some((p) => p.id === 'PO-RT-001')) as(db, 'u_kiran', 'Create purchase PO-RT-001', ist('2026-11-16 09:00'), (ctx) => O.createPurchase(ctx, { supplierId: 'SUP-001', declaredKg: 10000, ratePerKg: 80, billRef: 'RP-BILL-7781', lotCode: 'RT-001', promisedDate: '2026-11-16' }));
      let it = s(db).intakes.find((i) => i.purchaseId === 'PO-RT-001');
      if (!it) it = as(db, 'u_kiran', 'Record truck intake', ist('2026-11-16 11:00'), (ctx) => O.recordIntake(ctx, { purchaseId: 'PO-RT-001', truck: 'MH24-AB-4521', slip: 'WB-55012', grossKg: 15000, tareKg: 5000, moisturePct: 9.5, foreignMatterPct: 1, damagePct: 0.5, evidence: ['slip-WB-55012.jpg (demo)', 'truck-front.jpg (demo)'] }));
      const intake = it;
      if (intake.status === 'under_inspection') as(db, 'u_meera', 'Accept intake into R1', ist('2026-11-16 12:00'), (ctx) => O.checkIntake(ctx, { intakeId: intake.id, acceptKg: intake.net / 1000, godown: 'R1' }));
      if (!s(db).purchases.find((p) => p.id === 'PO-RT-001')?.billMatch) as(db, 'u_kiran', 'Match supplier bill', ist('2026-11-16 15:00'), (ctx) => O.matchBill(ctx, { purchaseId: 'PO-RT-001', billedKg: 10000, billAmount: 800000 }));
    },
    done: (db) => s(db).intakes.some((i) => i.lotId === 'RT-001' && i.status !== 'under_inspection'),
  },
  {
    id: '2',
    title: 'Cleaning: 9,900 kg forward + 100 kg rejects',
    detail: 'Ravi issues RT-001 from R1; Suresh receives, starts and records 9,900 kg forward and 100 kg cleaning rejects (held in quarantine, never auto-saleable).',
    actors: ['u_ravi', 'u_suresh'],
    run: (db) =>
      void stagePass(db, { lotId: 'RT-001', from: 'R1', to: 'CLEAN', issuer: 'u_ravi', owner: 'u_suresh', t: [ist('2026-11-17 08:00'), ist('2026-11-17 08:15'), ist('2026-11-17 08:30'), ist('2026-11-17 12:30')], outputs: [{ kind: 'forward', kg: 9900 }, { kind: 'reject', kg: 100, reason: 'Stones, mud, foreign seeds' }] }),
    done: (db) => runDone(db, 'CLEAN', 'RT-001'),
  },
  {
    id: '3',
    title: 'G1 size grading: 9,900 kg without loss',
    detail: 'Suresh issues the cleaned lot to G1 and classifies all 9,900 kg as G1 “Bold”.',
    actors: ['u_suresh'],
    run: (db) => void stagePass(db, { lotId: 'RT-001/CLEAN', from: 'STG:CLEAN:OUT', to: 'G1', issuer: 'u_suresh', owner: 'u_suresh', t: [ist('2026-11-17 13:00'), ist('2026-11-17 13:05'), ist('2026-11-17 13:15'), ist('2026-11-17 16:15')], outputs: [{ kind: 'forward', kg: 9900, grade: 'Bold' }] }),
    done: (db) => runDone(db, 'G1', 'RT-001/CLEAN'),
  },
  {
    id: '4',
    title: 'Oiling: add 20 kg oil from stores → 9,920 kg',
    detail: 'Anil records 20 kg oil from stores lot OIL-B01 as a measured addition; stores oil reduces once.',
    actors: ['u_suresh', 'u_anil'],
    run: (db) => void stagePass(db, { lotId: 'RT-001/G1', from: 'STG:G1:OUT', to: 'OIL', issuer: 'u_suresh', owner: 'u_anil', t: [ist('2026-11-18 08:00'), ist('2026-11-18 08:10'), ist('2026-11-18 08:20'), ist('2026-11-18 10:20')], additions: [{ lotId: 'OIL-B01', kg: 20 }], outputs: [{ kind: 'forward', kg: 9920 }] }),
    done: (db) => runDone(db, 'OIL', 'RT-001/G1'),
  },
  {
    id: '5',
    title: 'Conditioning: no material added',
    detail: 'Anil runs seeping/conditioning; 9,920 kg carried forward.',
    actors: ['u_anil'],
    run: (db) => void stagePass(db, { lotId: 'RT-001/OIL', from: 'STG:OIL:OUT', to: 'COND', issuer: 'u_anil', owner: 'u_anil', t: [ist('2026-11-18 10:30'), ist('2026-11-18 10:35'), ist('2026-11-18 11:00'), ist('2026-11-18 19:00')], outputs: [{ kind: 'forward', kg: 9920 }] }),
    done: (db) => runDone(db, 'COND', 'RT-001/OIL'),
  },
  {
    id: '6',
    title: 'Drying: 9,800 kg + 120 kg moisture loss (with 2 h hold)',
    detail: 'Start 10:00, planned 6 h → baseline 16:00. Weather hold 14:00–16:00, finish 18:00: 6 h active, 2 h held, 2 h delay (demonstration values).',
    actors: ['u_anil'],
    run: (db) =>
      void stagePass(db, {
        lotId: 'RT-001/COND',
        from: 'STG:COND:OUT',
        to: 'DRY',
        issuer: 'u_anil',
        owner: 'u_anil',
        t: [ist('2026-11-19 09:30'), ist('2026-11-19 09:45'), ist('2026-11-19 10:00'), ist('2026-11-19 18:00')],
        holds: [{ at: ist('2026-11-19 14:00'), resume: ist('2026-11-19 16:00'), reason: 'Weather hold — rain, yard covered (demo)' }],
        outputs: [{ kind: 'forward', kg: 9800 }, { kind: 'loss', kg: 120, reason: 'Recorded moisture loss (measured)' }],
      }),
    done: (db) => runDone(db, 'DRY', 'RT-001/COND'),
  },
  {
    id: '7',
    title: 'Peeling pass 1: 7,800 main + 1,000 rework + 700 Husk + 200 Churi + 100 loss',
    detail: 'Prakash classifies every kilogram once; rework becomes linked child RT-001/RW1 (pass 2), not new procurement.',
    actors: ['u_anil', 'u_prakash'],
    run: (db) =>
      void stagePass(db, {
        lotId: 'RT-001/DRY',
        from: 'STG:DRY:OUT',
        to: 'PEEL',
        issuer: 'u_anil',
        owner: 'u_prakash',
        t: [ist('2026-11-20 08:00'), ist('2026-11-20 08:10'), ist('2026-11-20 08:30'), ist('2026-11-20 13:30')],
        outputs: [
          { kind: 'forward', kg: 7800 },
          { kind: 'rework', kg: 1000 },
          { kind: 'husk', kg: 700 },
          { kind: 'churi', kg: 200 },
          { kind: 'loss', kg: 100, reason: 'Peeling dust / unrecoverable' },
        ],
      }),
    done: (db) => runDone(db, 'PEEL', 'RT-001/DRY'),
  },
  {
    id: '8',
    title: 'Reprocess 1,000 kg rework: 750 main + 150 Husk + 75 Churi + 25 loss',
    detail: 'Prakash runs pass 2 on RT-001/RW1. Root input is counted once.',
    actors: ['u_prakash'],
    run: (db) =>
      void stagePass(db, {
        lotId: 'RT-001/RW1',
        from: 'STG:PEEL:OUT',
        to: 'PEEL',
        issuer: 'u_prakash',
        owner: 'u_prakash',
        t: [ist('2026-11-20 14:00'), ist('2026-11-20 14:05'), ist('2026-11-20 14:15'), ist('2026-11-20 16:15')],
        outputs: [{ kind: 'forward', kg: 750 }, { kind: 'husk', kg: 150 }, { kind: 'churi', kg: 75 }, { kind: 'loss', kg: 25, reason: 'Rework pass dust' }],
      }),
    done: (db) => runDone(db, 'PEEL', 'RT-001/RW1'),
  },
  {
    id: '9',
    title: 'G2 first pass: A1 5,500 + B1 2,250 + 50 loss',
    detail: 'Deepa grades the first-pass 7,800 kg.',
    actors: ['u_prakash', 'u_deepa'],
    run: (db) => void stagePass(db, { lotId: 'RT-001/PEEL', from: 'STG:PEEL:OUT', to: 'G2', issuer: 'u_prakash', owner: 'u_deepa', t: [ist('2026-11-21 08:00'), ist('2026-11-21 08:10'), ist('2026-11-21 08:30'), ist('2026-11-21 12:30')], outputs: [{ kind: 'forward', kg: 5500, grade: 'A1' }, { kind: 'forward', kg: 2250, grade: 'B1' }, { kind: 'loss', kg: 50, reason: 'Grading fines' }] }),
    done: (db) => runDone(db, 'G2', 'RT-001/PEEL'),
  },
  {
    id: '10',
    title: 'G2 rework-derived: A2 500 + B2 250 (separate ancestry)',
    detail: 'Deepa grades the 750 kg from the rework pass in its own run — no blending.',
    actors: ['u_prakash', 'u_deepa'],
    run: (db) => void stagePass(db, { lotId: 'RT-001/PEEL2', from: 'STG:PEEL:OUT', to: 'G2', issuer: 'u_prakash', owner: 'u_deepa', t: [ist('2026-11-21 13:00'), ist('2026-11-21 13:05'), ist('2026-11-21 13:15'), ist('2026-11-21 15:15')], outputs: [{ kind: 'forward', kg: 500, grade: 'A2' }, { kind: 'forward', kg: 250, grade: 'B2' }] }),
    done: (db) => runDone(db, 'G2', 'RT-001/PEEL2'),
  },
  {
    id: '11',
    title: 'Pack 8,500 kg into 340 × 25 kg bags; receive into F1 stacks',
    detail: 'Deepa packs each grade (bags issued from stores separately from food weight). Ravi receives into identified stacks: A1 across S01/S02, B1 S03, A2+B2 S04.',
    actors: ['u_deepa', 'u_ravi'],
    run: (db) => {
      const grades: [string, number, string][] = [
        ['A1', 5500, '09:00'],
        ['B1', 2250, '11:00'],
        ['A2', 500, '13:00'],
        ['B2', 250, '14:00'],
      ];
      for (const [g, q, t] of grades)
        if (!runDone(db, 'PACK', `RT-001/${g}`)) stagePass(db, { lotId: `RT-001/${g}`, from: 'STG:G2:OUT', to: 'PACK', issuer: 'u_deepa', owner: 'u_deepa', t: [ist(`2026-11-22 ${t}`), ist(`2026-11-22 ${t.replace(':00', ':05')}`), ist(`2026-11-22 ${t.replace(':00', ':10')}`), ist(`2026-11-22 ${t.replace(':00', ':50')}`)], outputs: [{ kind: 'forward', kg: q }], packing: { bagSizeKg: 25, bagsLotId: 'BAGS-25-B01', checks: PACK_CHECKS } });
      const stacks: Record<string, { loc: string; kg: number }[]> = {
        A1: [{ loc: 'F1-S01', kg: 3000 }, { loc: 'F1-S02', kg: 2500 }],
        B1: [{ loc: 'F1-S03', kg: 2250 }],
        A2: [{ loc: 'F1-S04', kg: 500 }],
        B2: [{ loc: 'F1-S04', kg: 250 }],
      };
      for (const [g, q] of grades) {
        const lotId = `RT-001/${g}-PK`;
        if (!s(db).handovers.some((h) => h.lotId === lotId && h.toStage === 'F1')) as(db, 'u_deepa', `Issue ${lotId} to F1`, ist('2026-11-22 15:30'), (ctx) => O.issue(ctx, { lotId, fromLoc: 'STG:PACK:OUT', qtyKg: q, toStage: 'F1', basis: 'Counted' }));
        const ho = s(db).handovers.find((h) => h.lotId === lotId && h.toStage === 'F1' && O.outstanding(h) > 0 && h.received === 0);
        if (ho) as(db, 'u_ravi', `Receive ${lotId} into stacks`, ist('2026-11-22 16:00'), (ctx) => O.receive(ctx, { handoverId: ho.id, stacks: stacks[g] }));
      }
    },
    done: (db) => ['A1', 'B1', 'A2', 'B2'].every((g) => s(db).handovers.some((h) => h.lotId === `RT-001/${g}-PK` && h.toStage === 'F1' && O.outstanding(h) === 0)),
  },
  {
    id: '12',
    title: 'By-products: 200 kg Husk internal use, 100 kg Churi external dispatch',
    detail: 'Ravi records authorized internal use (configured purpose) and dispatches Churi to a fictional buyer at an agreed rate (Tally document queued).',
    actors: ['u_ravi'],
    run: (db) => {
      if (!s(db).movements.some((m) => m.kind === 'internal-use' && m.lotId.startsWith('RT-001/HUSK'))) as(db, 'u_ravi', 'Husk internal use', ist('2026-11-23 09:00'), (ctx) => O.internalUse(ctx, { lotId: 'RT-001/HUSK-PEEL', loc: 'BYP', kg: 200, purpose: 'Boiler fuel (demo)' }));
      if (!s(db).movements.some((m) => m.kind === 'external-dispatch' && m.lotId.startsWith('RT-001/CHURI'))) as(db, 'u_ravi', 'Churi external dispatch', ist('2026-11-23 10:00'), (ctx) => C.byproductDispatch(ctx, { buyerId: 'BUY-02', lotId: 'RT-001/CHURI-PEEL', loc: 'BYP', kg: 100, ratePerKg: 22 }));
    },
    done: (db) => s(db).movements.some((m) => m.kind === 'internal-use' && m.lotId.startsWith('RT-001/HUSK')) && s(db).movements.some((m) => m.kind === 'external-dispatch' && m.lotId.startsWith('RT-001/CHURI')),
  },
  {
    id: '13a',
    title: 'Reserve 4,000 kg A1 for Distributor D01',
    detail: 'Kiran creates SO for D01 (credit checked, delegated approval). FEFO reserves eligible A1 — physical stock unchanged; available drops.',
    actors: ['u_kiran'],
    run: (db) => {
      const so = d01Order(db) ?? as(db, 'u_kiran', 'Create factory order for D01', ist('2026-11-23 11:00'), (ctx) => C.createFactoryOrder(ctx, { distributorId: 'D01', lines: [{ grade: 'A1', kg: 4000 }], promisedDate: '2026-11-25' }));
      as(db, 'u_kiran', 'Reserve FEFO', ist('2026-11-23 11:05'), (ctx) => C.reserveOrder(ctx, so.id));
    },
    done: (db) => !!d01Order(db) && s(db).reservations.some((r) => r.orderId === d01Order(db)!.id),
  },
  {
    id: '13b',
    title: 'Dispatch 4,000 kg to D01 (moves into transit)',
    detail: 'Ravi dispatches against the reservation: net dal 4,000 kg + 160 bags × 0.1 kg tare checked against the weighbridge.',
    actors: ['u_ravi'],
    run: (db) => {
      const so = d01Order(db) ?? fail('not_found', 'D01 order missing');
      as(db, 'u_ravi', 'Dispatch to D01', ist('2026-11-23 14:00'), (ctx) => C.dispatchOrder(ctx, { orderId: so.id, transporterId: 'TR-01', vehicle: 'MH12-XY-9087', driver: 'Baban Shinde (fictional)', vehicleGrossKg: 10516, vehicleTareKg: 6500 }));
    },
    done: (db) => !!d01Order(db) && s(db).shipments.some((x) => x.orderId === d01Order(db)!.id),
  },
  {
    id: '14',
    title: 'D01 accepts all 4,000 kg',
    detail: 'Dinesh (Distributor D01) records 4,000 kg good, 0 damaged — receipt locks; transit settles.',
    actors: ['u_dinesh'],
    run: (db) => {
      const sh = s(db).shipments.find((x) => x.orderId === d01Order(db)?.id && x.status === 'in_transit') ?? fail('not_found', 'No shipment in transit to D01');
      as(db, 'u_dinesh', 'Receive shipment at D01', ist('2026-11-24 10:00'), (ctx) => C.receiveShipment(ctx, { shipmentId: sh.id, goodKg: 4000, damagedKg: 0 }));
    },
    done: (db) => !!d01Order(db) && s(db).shipments.some((x) => x.orderId === d01Order(db)!.id && !!x.receipt),
  },
  {
    id: '15a',
    title: 'Salesman records a 1,000 kg retailer order (reserved at D01)',
    detail: 'Rohit (mapped to D01) orders for Annapurna Kirana at the current retail rate snapshot; D01 stock is reserved, not deducted.',
    actors: ['u_rohit'],
    run: (db) => void as(db, 'u_rohit', 'Retailer order at D01', ist('2026-11-24 12:00'), (ctx) => C.createRetailOrder(ctx, { distributorId: 'D01', retailerId: 'RET-001', grade: 'A1', kg: 1000 })),
    done: (db) => !!retailOrder(db),
  },
  {
    id: '15b',
    title: 'D01 confirms retailer delivery (deducts once)',
    detail: 'Dinesh confirms delivery with challan D01-CH-0001; distributor physical stock reduces only now.',
    actors: ['u_dinesh'],
    run: (db) => {
      const ro = retailOrder(db) ?? fail('not_found', 'Retailer order missing');
      as(db, 'u_dinesh', 'Confirm retailer delivery', ist('2026-11-24 17:00'), (ctx) => C.deliverRetail(ctx, { orderId: ro.id, challanRef: 'D01-CH-0001' }));
    },
    done: (db) => retailOrder(db)?.status === 'closed',
  },
];

/** First step not yet done — derived from the ledger, so steps done from the screens count. */
export function currentStep(db: Db) {
  const i = RT001_STEPS.findIndex((st) => !st.done(db));
  return i < 0 ? RT001_STEPS.length : i;
}

/** Run the next scripted step on a draft db (resumes a partly done step). */
export function runScenarioStep(db: Db) {
  const st = db.rentio!;
  const idx = currentStep(db);
  const step = RT001_STEPS[idx] ?? fail('business_rule', 'RT-001 is already complete');
  step.run(db);
  st.scenarioStep = currentStep(db);
  if (st.scenarioStep === RT001_STEPS.length) st.dataset = 'completed';
  return step;
}
