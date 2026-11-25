/** Rentio domain registration: storage namespace, users, workspace and dataset seeding. */
import type { AppDomain, SeedResult } from '../active';
import type { RecordData } from '../../metadata/types';
import type { Db } from '../../services/types';
import { rentioUsers } from './access';
import { BUYERS, DISTRIBUTORS, EMPLOYEES, RETAILERS, SKUS, SUPPLIERS, TRANSPORTERS, WS } from './data';
import { buildDemoExtras, buildExceptions } from './fixtures';
import { rentioPack } from './pack';
import { RT001_STEPS, runScenarioStep } from './scenario';
import { emptyState, openPlant, SCHEMA } from './state';

export const RENTIO_STORAGE_KEY = 'rentio.erp.db.v1';
export type Dataset = 'start' | 'completed' | 'demo';

function records(now: string): Record<string, RecordData[]> {
  const base = (id: string) => ({ id, workspaceId: WS, version: 1, createdAt: now, updatedAt: now, createdBy: 'u_arjun' });
  const loc = (id: string, label: string, kind: string, capacityKg: number, lastFumigated?: string, godown?: string) => ({ ...base(id), label, kind, capacityKg, lastFumigated, godown: godown ?? '', owner: 'Ravi Patil' });
  return {
    skus: SKUS.map((s) => ({ ...base(s.id), ...s })),
    suppliers: SUPPLIERS.map((s) => ({ ...base(s.id), ...s })),
    distributors: DISTRIBUTORS.map((d) => ({ ...base(d.id), ...d })),
    retailers: RETAILERS.map((r) => ({ ...base(r.id), ...r, salesmanId: ['D01', 'D02', 'D03'].includes(r.distributorId) ? 'u_rohit' : '' })),
    buyers: BUYERS.map((b) => ({ ...base(b.id), ...b })),
    transporters: TRANSPORTERS.map((t) => ({ ...base(t.id), ...t })),
    employees: EMPLOYEES.map((e) => ({ ...base(e.id), ...e })),
    locations: [
      loc('R1', 'Raw Godown R1', 'raw', 60000, '2026-10-20'),
      loc('F1', 'Finished Godown F1', 'finished', 40000, '2026-11-05'),
      ...[1, 2, 3, 4, 5, 6].map((i) => loc(`F1-S0${i}`, `F1 · Stack S0${i}`, 'stack', i <= 2 ? 3000 : 2500, undefined, 'F1')),
      loc('BYP', 'By-product store', 'byproduct', 20000, '2026-10-01'),
      loc('STORES', 'Stores', 'stores', 0),
      loc('QUAR', 'Quarantine / rejects', 'quarantine', 5000),
    ],
  };
}

/** Build a dataset by replaying real transactions (exception fixtures, then optionally all RT-001 steps). */
export function buildRentio(now: Date, dataset: Dataset): SeedResult {
  const iso = now.toISOString();
  const db = { records: records(iso), audit: [], session: { userId: 'u_owner', workspaceId: WS }, rentio: emptyState() } as unknown as Db;
  openPlant(db, '2026-11-01T03:30:00.000Z');
  buildExceptions(db, now);
  if (dataset === 'completed' || dataset === 'demo') {
    for (let i = 0; i < RT001_STEPS.length; i++) runScenarioStep(db);
  }
  if (dataset === 'demo') buildDemoExtras(db, now);
  db.rentio!.dataset = dataset;
  const counters: Record<string, number> = {};
  Object.entries(db.records).forEach(([k, rows]) => (counters[k] = rows.length + 100));
  return { records: db.records, counters, comments: [], approvals: [], notifications: [], extra: { rentio: db.rentio, audit: db.audit } };
}

export const rentioDomain: AppDomain = {
  id: 'rentio',
  productName: 'Rentio Smart ERP',
  pack: rentioPack,
  users: rentioUsers,
  organization: { id: 'org_rentio', slug: 'rentio', name: 'Rentio Pulses (fictional demo)' },
  workspaces: [{ id: WS, slug: WS, name: 'Plant 1 · Dal mill', timezoneLabel: 'Asia/Kolkata' }],
  storageKey: RENTIO_STORAGE_KEY,
  schemaVersion: 101 + SCHEMA, // 102: review round 1 (scope, stock dimensions, ETA revisions, demo snapshot)
  seedNumber: 1,
  currency: 'INR',
  locale: 'en-IN',
  defaultSession: { userId: 'u_owner', workspaceId: WS },
  bannerShort: 'Demo · fictional local data',
  banner: 'Fictional data stored only in this browser · Roles are simulated (no real sign-in) · Tally, e-invoice, messaging, biometric and offline sync are SIMULATED · No real money moves.',
  // first load = the client demo snapshot; presenter can reset to 'start' (execute RT-001) or 'completed'
  seed: (now, opts) => buildRentio(now, (opts?.dataset as Dataset) ?? 'demo'),
};
