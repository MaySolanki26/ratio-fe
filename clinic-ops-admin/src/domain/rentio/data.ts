/**
 * FICTIONAL demonstration master data for Rentio. Every person, farmer,
 * distributor, retailer, buyer and transporter here is invented.
 * Numbers (credit limits, rates, capacities) are demo defaults recorded in
 * docs/rentio/DEMO_ASSUMPTIONS.md — not approved Rentio policy.
 */
import type { StageCode } from './types';

export const WS = 'plant1';

export interface PersonSeed {
  id: string;
  name: string;
  roleId: string;
  title: string;
  scope?: Record<string, string[]>;
}

export const PEOPLE: PersonSeed[] = [
  { id: 'u_owner', name: 'Vikram Mehta', roleId: 'owner', title: 'Owner' },
  { id: 'u_fhead', name: 'Sunita Rao', roleId: 'factory_head', title: 'Factory Head', scope: { stages: ['CLEAN', 'G1', 'OIL', 'COND', 'DRY', 'PEEL', 'G2', 'PACK'] } },
  { id: 'u_suresh', name: 'Suresh Yadav', roleId: 'stage_owner', title: 'Stage owner · Cleaning & G1', scope: { stages: ['CLEAN', 'G1'] } },
  { id: 'u_anil', name: 'Anil Kumar', roleId: 'stage_owner', title: 'Stage owner · Oiling, Conditioning, Drying', scope: { stages: ['OIL', 'COND', 'DRY'] } },
  { id: 'u_prakash', name: 'Prakash Jadhav', roleId: 'stage_owner', title: 'Stage owner · Peeling', scope: { stages: ['PEEL'] } },
  { id: 'u_deepa', name: 'Deepa Nair', roleId: 'stage_owner', title: 'Stage owner · G2 & Packing', scope: { stages: ['G2', 'PACK'] } },
  { id: 'u_kiran', name: 'Kiran Shah', roleId: 'back_office', title: 'Back Office · Procurement & intake' },
  { id: 'u_meera', name: 'Meera Iyer', roleId: 'qc', title: 'QC · Independent checker' },
  { id: 'u_ravi', name: 'Ravi Patil', roleId: 'godown', title: 'Godown & dispatch keeper', scope: { locations: ['R1', 'F1', 'BYP', 'STORES', 'QUAR'] } },
  { id: 'u_dinesh', name: 'Dinesh Agarwal', roleId: 'distributor', title: 'Distributor · D01 Shree Ganesh Traders', scope: { distributors: ['D01'] } },
  { id: 'u_farah', name: 'Farah Khan', roleId: 'distributor', title: 'Distributor · D02 Konkan Foods', scope: { distributors: ['D02'] } },
  { id: 'u_rohit', name: 'Rohit Verma', roleId: 'salesman', title: 'Salesman · mapped D01–D03', scope: { distributors: ['D01', 'D02', 'D03'] } },
  { id: 'u_neha', name: 'Neha Joshi', roleId: 'accounts', title: 'Accounts' },
  { id: 'u_pooja', name: 'Pooja Desai', roleId: 'hr', title: 'HR' },
  { id: 'u_arjun', name: 'Arjun Menon', roleId: 'admin', title: 'Setup administrator' },
];

export const STAGES: { code: StageCode; label: string; owner: string; backup: string; plannedMinutes: number; tolerancePct: number; basis: 'Actual' | 'Carried' }[] = [
  { code: 'CLEAN', label: 'Cleaning / destoning', owner: 'u_suresh', backup: 'u_prakash', plannedMinutes: 240, tolerancePct: 2, basis: 'Actual' },
  { code: 'G1', label: 'G1 size grading', owner: 'u_suresh', backup: 'u_fhead', plannedMinutes: 180, tolerancePct: 1, basis: 'Carried' },
  { code: 'OIL', label: 'Oiling', owner: 'u_anil', backup: 'u_fhead', plannedMinutes: 120, tolerancePct: 1, basis: 'Carried' },
  { code: 'COND', label: 'Seeping / conditioning', owner: 'u_anil', backup: 'u_fhead', plannedMinutes: 480, tolerancePct: 1, basis: 'Carried' },
  { code: 'DRY', label: 'Drying', owner: 'u_anil', backup: 'u_fhead', plannedMinutes: 360, tolerancePct: 2, basis: 'Actual' },
  { code: 'PEEL', label: 'Peeling / splitting', owner: 'u_prakash', backup: 'u_suresh', plannedMinutes: 300, tolerancePct: 3, basis: 'Actual' },
  { code: 'G2', label: 'G2 quality × size grading', owner: 'u_deepa', backup: 'u_fhead', plannedMinutes: 240, tolerancePct: 1, basis: 'Actual' },
  { code: 'PACK', label: 'Packing', owner: 'u_deepa', backup: 'u_ravi', plannedMinutes: 240, tolerancePct: 0.5, basis: 'Actual' },
];

export const stageInfo = (c: StageCode) => STAGES.find((s) => s.code === c)!;

export const SUPPLIERS = [
  { id: 'SUP-001', name: 'Farmer Ramesh Patil', category: 'farmer', village: 'Ausa, Latur (fictional)', phone: '98220 10001', brokerId: '' },
  { id: 'SUP-002', name: 'Farmer Gita Bai Shinde', category: 'farmer', village: 'Nilanga (fictional)', phone: '98220 10002', brokerId: 'BRK-01' },
  { id: 'SUP-003', name: 'Sai Agro Traders', category: 'vendor', village: 'Solapur (fictional)', phone: '98220 10003', brokerId: '' },
  { id: 'SUP-004', name: 'Krishna Pulses Pvt (fictional)', category: 'vendor', village: 'Akola (fictional)', phone: '98220 10004', brokerId: 'BRK-01' },
  { id: 'STORE-01', name: 'Mahalaxmi Oil & Packaging Stores', category: 'stores_vendor', village: 'MIDC (fictional)', phone: '98220 10005', brokerId: '' },
];

export const BROKERS = [{ id: 'BRK-01', name: 'Mahesh Kulkarni (broker)' }];

const DIST_NAMES = [
  'Shree Ganesh Traders', 'Konkan Foods', 'Vidarbha Distributors', 'Sahyadri Agencies', 'Godavari Wholesale', 'Narmada Supply Co',
  'Malwa Trading', 'Deccan Staples', 'Krishna Valley Mart', 'Tapi Distributors', 'Bhima Foods', 'Satpura Agencies',
  'Western Ghats Supply', 'Marathwada Traders', 'Khandesh Foods', 'Nashik Grain House', 'Pune Pulse Point',
];
const CITIES = ['Pune', 'Ratnagiri', 'Nagpur', 'Satara', 'Nanded', 'Jabalpur', 'Indore', 'Aurangabad', 'Sangli', 'Surat', 'Solapur', 'Betul', 'Kolhapur', 'Latur', 'Jalgaon', 'Nashik', 'Pune East'];

export const DISTRIBUTORS = DIST_NAMES.map((name, i) => {
  const id = `D${String(i + 1).padStart(2, '0')}`;
  return {
    id,
    name: `${name} (fictional)`,
    city: CITIES[i],
    creditLimit: [1500000, 900000, 800000][i] ?? 600000, // ₹
    salesmanId: i < 3 ? 'u_rohit' : '',
    minStockKg: 500,
    maxStockKg: 6000,
    lastSyncHoursAgo: [0.2, 3, 30][i] ?? (i % 4 === 0 ? 52 : 6 + i),
    status: 'active',
  };
});

export const RETAILERS = [
  { id: 'RET-001', name: 'Annapurna Kirana', distributorId: 'D01', city: 'Pune' },
  { id: 'RET-002', name: 'Balaji Provision Store', distributorId: 'D01', city: 'Pune' },
  { id: 'RET-003', name: 'Om Sai Supermart', distributorId: 'D01', city: 'Pimpri' },
  { id: 'RET-004', name: 'Coastal Grocers', distributorId: 'D02', city: 'Ratnagiri' },
  { id: 'RET-005', name: 'Sea View Stores', distributorId: 'D02', city: 'Chiplun' },
  { id: 'RET-006', name: 'Orange City Mart', distributorId: 'D03', city: 'Nagpur' },
  { id: 'RET-007', name: 'Fort Provisions', distributorId: 'D04', city: 'Satara' },
  { id: 'RET-008', name: 'Riverbank Kirana', distributorId: 'D05', city: 'Nanded' },
].map((r) => ({ ...r, name: `${r.name} (fictional)` }));

export const BUYERS = [
  { id: 'BUY-01', name: 'Gokul Cattle Feed (fictional)', type: 'HUSK' },
  { id: 'BUY-02', name: 'Sagar Poultry Feeds (fictional)', type: 'CHURI' },
];

export const TRANSPORTERS = [
  { id: 'TR-01', name: 'Sahyadri Roadlines (fictional)', phone: '98220 20001' },
  { id: 'TR-02', name: 'Deccan Carriers (fictional)', phone: '98220 20002' },
];

export const SKUS = [
  { id: 'SKU-A1-25', grade: 'A1', label: 'Toor dal A1 · 25 kg bag', packKg: 25, shelfLifeDays: 180, active: true },
  { id: 'SKU-B1-25', grade: 'B1', label: 'Toor dal B1 · 25 kg bag', packKg: 25, shelfLifeDays: 180, active: true },
  { id: 'SKU-A2-25', grade: 'A2', label: 'Toor dal A2 · 25 kg bag', packKg: 25, shelfLifeDays: 180, active: true },
  { id: 'SKU-B2-25', grade: 'B2', label: 'Toor dal B2 · 25 kg bag', packKg: 25, shelfLifeDays: 180, active: true },
  { id: 'SKU-A1-50', grade: 'A1', label: 'Toor dal A1 · 50 kg bag', packKg: 50, shelfLifeDays: 180, active: false },
  { id: 'SKU-A2-1', grade: 'A2', label: 'Toor dal A2 · 1 kg retail pouch (repack target)', packKg: 1, shelfLifeDays: 180, active: true },
];

export const EMPLOYEES = [
  ...PEOPLE.filter((p) => !['distributor', 'salesman'].includes(p.roleId)).map((p, i) => ({ id: `EMP-${String(i + 1).padStart(3, '0')}`, name: p.name, userId: p.id, dept: p.title.split(' ·')[0], shift: i % 3 === 0 ? 'night' : 'day', dailyRate: 900 + i * 50 })),
  { id: 'EMP-014', name: 'Ganesh Pawar', userId: '', dept: 'Peeling line', shift: 'day', dailyRate: 750 },
  { id: 'EMP-015', name: 'Lata More', userId: '', dept: 'Packing line', shift: 'day', dailyRate: 720 },
  { id: 'EMP-016', name: 'Sanjay Gaikwad', userId: '', dept: 'Drying yard', shift: 'night', dailyRate: 760 },
  { id: 'EMP-017', name: 'Asha Kamble', userId: '', dept: 'Cleaning line', shift: 'day', dailyRate: 720 },
];

/** Demo grade rates (₹/kg) for factory → distributor sales. */
export const DEMO_RATES: Record<string, number> = { A1: 132, B1: 118, A2: 126, B2: 112, HUSK: 14, CHURI: 22 };
/** Distributor → retailer demo rates (₹/kg). */
export const RETAIL_RATES: Record<string, number> = { A1: 140, B1: 126, A2: 134, B2: 120 };
