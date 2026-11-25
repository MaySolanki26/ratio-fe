/** Empty plant state: locations, stores opening stock, equipment, rates, rate cards. */
import type { Db } from '../../services/types';
import { ractor } from './access';
import { seedRates } from './commerce';
import { DISTRIBUTORS, STAGES } from './data';
import { createLot, execute, move } from './engine';
import type { Location, RentioState } from './types';
import { kg, rupees } from './units';

export const SCHEMA = 1;

export function emptyState(): RentioState {
  const locations: Record<string, Location> = {};
  const add = (l: Location) => (locations[l.id] = l);
  add({ id: 'INTAKE', label: 'Gate intake (awaiting checker)', kind: 'intake' });
  add({ id: 'R1', label: 'Raw Godown R1', kind: 'raw', capacity: kg(60000) });
  add({ id: 'QUAR', label: 'Quarantine / rejects', kind: 'quarantine' });
  add({ id: 'BYP', label: 'By-product store', kind: 'byproduct', capacity: kg(20000) });
  add({ id: 'STORES', label: 'Stores (oil, bags, spares)', kind: 'stores' });
  add({ id: 'F1', label: 'Finished Godown F1', kind: 'finished', capacity: kg(40000) });
  for (let i = 1; i <= 6; i++) add({ id: `F1-S0${i}`, label: `F1 · Stack S0${i}`, kind: 'finished', godown: 'F1', capacity: kg(i <= 2 ? 3000 : 2500) });
  for (const st of STAGES) {
    add({ id: `STG:${st.code}:IN`, label: `${st.label} · queue`, kind: 'stage-in', stage: st.code });
    add({ id: `STG:${st.code}:OUT`, label: `${st.label} · output`, kind: 'stage-out', stage: st.code });
  }
  for (const d of DISTRIBUTORS) {
    add({ id: `DIST:${d.id}`, label: `${d.id} stock`, kind: 'distributor', distributorId: d.id });
    add({ id: `DIST:${d.id}:HELD`, label: `${d.id} held/damaged`, kind: 'distributor-held', distributorId: d.id });
  }
  return {
    version: SCHEMA,
    dataset: 'start',
    scenarioStep: 0,
    seq: {},
    locations,
    lots: {},
    movements: [],
    reservations: [],
    holds: [],
    purchases: [],
    intakes: [],
    handovers: [],
    runs: [],
    orders: [],
    shipments: [],
    disputes: [],
    rates: [],
    offline: { online: true, queue: [] },
    tally: [],
    tallyExternal: {},
    tallySim: { failNext: 0, timeoutNext: 0 },
    complaints: [],
    trips: [],
    rateCards: [],
    approvals: [],
    counts: [],
    punches: [],
    imports: [],
    payroll: [],
    decisions: [],
    acks: [],
    failures: [],
    collections: [],
    plans: [],
    equipment: [
      { id: 'EQ-01', label: 'Destoner / pre-cleaner', stage: 'CLEAN', status: 'released', checkDue: '2026-12-15' },
      { id: 'EQ-02', label: 'G1 sieve grader', stage: 'G1', status: 'released', checkDue: '2026-12-20' },
      { id: 'EQ-03', label: 'Oil mixing screw', stage: 'OIL', status: 'released', checkDue: '2026-12-10' },
      { id: 'EQ-04', label: 'Drying yard & tarpaulins', stage: 'DRY', status: 'released', checkDue: '2026-12-01' },
      { id: 'EQ-05', label: 'Huller / splitter line', stage: 'PEEL', status: 'released', checkDue: '2026-12-05' },
      { id: 'EQ-06', label: 'G2 colour/size grader', stage: 'G2', status: 'released', checkDue: '2026-12-12' },
      { id: 'EQ-07', label: 'Bagging scale (verified)', stage: 'PACK', status: 'released', checkDue: '2026-11-30' },
    ],
    route: { version: 1, stages: ['CLEAN', 'G1', 'OIL', 'COND', 'DRY', 'PEEL', 'G2', 'PACK'], history: [{ version: 1, at: '2026-11-01T04:30:00.000Z', by: 'u_arjun', change: 'Initial demo route from the source template — awaiting factory walkthrough' }] },
    season: { active: false, factor: 1, escalationHours: 4 },
    baseline: { approved: false, lots: [] },
    messages: [],
    idempotency: {},
    txLog: [],
  };
}

/** Opening stores stock and rates (outside the RT-001 manufacturing boundary). */
export function openPlant(db: Db, at: string) {
  execute(db, ractor('u_ravi'), { label: 'Opening stores balances (migration)', at, now: at }, (ctx) => {
    createLot(ctx, { id: 'OIL-B01', rootId: 'OIL-B01', material: 'OIL', label: 'Edible oil for oiling (stores)', parents: [], unit: 'kg' });
    move(ctx, { lotId: 'OIL-B01', qty: kg(500), to: 'STORES', kind: 'opening', basis: 'Actual', ref: 'OPENING' });
    createLot(ctx, { id: 'BAGS-25-B01', rootId: 'BAGS-25-B01', material: 'BAGS', label: 'Empty 25 kg PP bags (stores)', parents: [], unit: 'bag' });
    move(ctx, { lotId: 'BAGS-25-B01', qty: 1200 * 1000, to: 'STORES', kind: 'opening', basis: 'Counted', ref: 'OPENING' });
    ctx.s.rateCards.push({ id: 'RC-0001', transporterId: 'TR-01', route: 'Plant → distributors (demo flat)', perKg: rupees(1.2), validFrom: at });
    ctx.s.rateCards.push({ id: 'RC-0002', transporterId: 'TR-02', route: 'Plant → distributors (demo flat)', perKg: rupees(1.1), validFrom: at });
    ctx.s.seq.RC = 2;
    seedRates(ctx);
  });
}
