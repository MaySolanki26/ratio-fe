/**
 * Rentio roles (proposed §20 matrix, OQ-02 pending). Capabilities drive BOTH the
 * shell (navigation, buttons) and the domain services, which re-check every
 * action and data scope. Browser-side enforcement is a demonstration, not a
 * security boundary.
 */
import type { ResourcePermission, RoleDefinition } from '../../metadata/types';
import { PEOPLE, WS } from './data';

const full: ResourcePermission = { read: 'all', create: true, update: 'all', delete: false, export: true, sensitive_data: true };
const read: ResourcePermission = { read: 'all', create: false, update: 'none', delete: false, export: true, sensitive_data: true };
const readNoContact: ResourcePermission = { read: 'all', create: false, update: 'none', delete: false, export: false, sensitive_data: false };
const none: ResourcePermission = { read: 'none', create: false, update: 'none', delete: false, export: false };
const own: ResourcePermission = { read: 'own', create: false, update: 'none', delete: false, export: false, sensitive_data: true };

const MASTER_KEYS = ['suppliers', 'distributors', 'retailers', 'buyers', 'transporters', 'skus', 'locations', 'employees'] as const;
const perms = (p: Partial<Record<(typeof MASTER_KEYS)[number], ResourcePermission>>, fallback = readNoContact) =>
  Object.fromEntries(MASTER_KEYS.map((k) => [k, p[k] ?? fallback])) as Record<string, ResourcePermission>;

const SHELL_ALL = ['views.share.team'];

export const rentioRoles: RoleDefinition[] = [
  {
    id: 'owner',
    label: 'Owner',
    description: 'Sees the whole network; decides policy, exceptions beyond delegated limits and baselines. No routine stage work; no salary values.',
    resources: perms({ employees: readNoContact, suppliers: read, distributors: read }),
    sensitivity: { identifier: 'view', health: 'hide', financial: 'hide' },
    capabilities: [
      ...SHELL_ALL, 'views.share.org', 'audit.view', 'access.view', 'ct.view', 'intake.check', 'approve.residual', 'approve.adjustment', 'approve.disposal',
      'approve.regrade', 'approve.capacity', 'approve.credit', 'approve.fefo', 'decision.record', 'baseline.approve', 'season.manage', 'reports.view', 'costing.view',
      'period.lock', 'scope.all',
    ],
  },
  {
    id: 'factory_head',
    label: 'Factory Head',
    description: 'Runs production: daily plan, stage backups, holds, loss/residual and adjustment approvals within delegated limits.',
    resources: perms({ employees: readNoContact }),
    sensitivity: { identifier: 'view', health: 'hide', financial: 'hide' },
    capabilities: [
      ...SHELL_ALL, 'audit.view', 'ct.view', 'intake.check', 'stage.operate', 'stage.backup', 'approve.residual', 'approve.adjustment', 'approve.disposal', 'approve.regrade',
      'approve.capacity', 'approve.fefo', 'quality.hold', 'stock.adjust.request', 'handover.settle.request', 'plan.manage', 'season.manage', 'route.manage', 'reports.view', 'scope.factory',
    ],
  },
  {
    id: 'stage_owner',
    label: 'Stage Owner',
    description: 'Receive → Start → Record output → Issue for assigned stages only. Can report holds and request settlements.',
    resources: perms({ suppliers: none, distributors: none, retailers: none, buyers: none, employees: none }),
    sensitivity: { identifier: 'hide', health: 'hide', financial: 'hide' },
    capabilities: ['stage.operate', 'stock.adjust.request', 'handover.settle.request'],
  },
  {
    id: 'back_office',
    label: 'Back Office',
    description: 'Purchases, truck intake, bill matching, factory sales orders and trips. Independent checker for intakes recorded by others.',
    resources: perms({ suppliers: full, transporters: full, distributors: read, retailers: read, buyers: full, employees: none }),
    sensitivity: { identifier: 'view', health: 'hide', financial: 'view' },
    capabilities: [...SHELL_ALL, 'purchase.create', 'intake.record', 'intake.check', 'bill.match', 'order.create.factory', 'order.reserve', 'logistics.manage', 'complaint.create', 'byproduct.sell', 'scope.factory'],
  },
  {
    id: 'qc',
    label: 'QC',
    description: 'Inspects intake, places and releases quality holds, decides return dispositions and packing release.',
    resources: perms({ suppliers: readNoContact, employees: none, distributors: readNoContact }),
    sensitivity: { identifier: 'hide', health: 'hide', financial: 'hide' },
    capabilities: ['intake.check', 'quality.hold', 'quality.release', 'location.hold', 'return.disposition', 'approve.regrade', 'scope.factory'],
  },
  {
    id: 'godown',
    label: 'Godown / Dispatch',
    description: 'Receives into raw/finished godowns and stacks, transfers, counts, picks FEFO, dispatches, issues stores and moves by-products.',
    resources: perms({ employees: none, suppliers: none }),
    sensitivity: { identifier: 'hide', health: 'hide', financial: 'hide' },
    capabilities: ['godown.operate', 'stage.operate', 'order.reserve', 'dispatch', 'byproduct.use', 'byproduct.sell', 'stores.issue', 'location.hold', 'stock.adjust.request', 'handover.settle.request', 'scope.factory'],
  },
  {
    id: 'distributor',
    label: 'Distributor',
    description: 'Own distributor only: receive shipments, record variance, deliver retailer orders, outside-app sales, counts and transfers.',
    resources: perms({ suppliers: none, distributors: none, retailers: none, buyers: none, transporters: none, employees: none, locations: none }),
    sensitivity: { identifier: 'hide', health: 'hide', financial: 'hide' },
    capabilities: ['distributor.operate', 'order.create.retail', 'complaint.create', 'scope.distributor'],
  },
  {
    id: 'salesman',
    label: 'Salesman',
    description: 'Mapped distributors and their retailers only: retailer orders (online/offline), collections evidence and complaints.',
    resources: perms({ suppliers: none, distributors: own, retailers: own, buyers: none, transporters: none, employees: none, locations: none }),
    sensitivity: { identifier: 'hide', health: 'hide', financial: 'hide' },
    capabilities: ['order.create.retail', 'collection.record', 'complaint.create', 'scope.distributor'],
  },
  {
    id: 'accounts',
    label: 'Accounts',
    description: 'Tally sync and reconciliation, IRN ownership, credit and rates, bill/freight matching, collection confirmation, payroll financial handoff.',
    resources: perms({ suppliers: read, distributors: { ...read, update: 'all' }, buyers: read, employees: readNoContact }),
    sensitivity: { identifier: 'view', health: 'hide', financial: 'edit' },
    capabilities: [...SHELL_ALL, 'audit.view', 'tally.sync', 'rates.manage', 'bill.match', 'approve.credit', 'approve.freight', 'collection.confirm', 'payroll.authorize', 'reports.view', 'costing.view', 'period.lock', 'scope.all'],
  },
  {
    id: 'hr',
    label: 'HR',
    description: 'Attendance import and exceptions, payroll drafts and revisions. Payroll data is restricted to HR and the authorized finance hand-off.',
    resources: perms({ employees: full, suppliers: none, distributors: none, retailers: none, buyers: none, transporters: none }),
    sensitivity: { identifier: 'edit', health: 'hide', financial: 'edit' },
    capabilities: ['hr.attendance', 'hr.payroll'],
  },
  {
    id: 'admin',
    label: 'Administrator',
    description: 'Maintains masters, route versions and access. No stock correction and no salary values by default.',
    resources: perms({ suppliers: full, distributors: full, retailers: full, buyers: full, transporters: full, skus: full, locations: full, employees: { ...full, sensitive_data: false } }),
    sensitivity: { identifier: 'view', health: 'hide', financial: 'hide' },
    capabilities: [...SHELL_ALL, 'views.share.org', 'config.publish', 'access.view', 'audit.view', 'events.view', 'route.manage'],
  },
];

/**
 * Operational page access (route guard + navigation). Explicit allow-list per page; a role not
 * listed cannot open the page even by direct URL. Data inside a page is further limited by scope.ts.
 */
export const PAGE_ACCESS: Record<string, string[]> = {
  'home/my-work': ['owner', 'factory_head', 'stage_owner', 'back_office', 'qc', 'godown', 'distributor', 'salesman', 'accounts', 'hr', 'admin'],
  'home/approvals': ['owner', 'factory_head', 'stage_owner', 'back_office', 'qc', 'godown', 'accounts', 'hr'],
  'home/alerts': ['owner', 'factory_head', 'stage_owner', 'back_office', 'qc', 'godown', 'distributor', 'salesman', 'accounts'],
  'home/decisions': ['owner', 'factory_head', 'accounts', 'admin'],
  'presenter/journey': ['owner', 'admin'],
  'masters/route': ['owner', 'factory_head', 'admin'],
  'procurement/intake': ['owner', 'factory_head', 'back_office', 'qc', 'accounts'],
  'production/stages': ['owner', 'factory_head', 'back_office', 'qc', 'godown'],
  'production/stage': ['owner', 'factory_head', 'stage_owner'],
  'production/grading': ['owner', 'factory_head', 'stage_owner', 'qc'],
  'production/handovers': ['owner', 'factory_head', 'stage_owner', 'godown', 'qc'],
  'production/close': ['owner', 'factory_head', 'stage_owner'],
  'stock/godowns': ['owner', 'factory_head', 'godown', 'qc', 'back_office'],
  'stock/inventory': ['owner', 'factory_head', 'godown', 'qc', 'back_office', 'accounts'],
  'stock/byproducts': ['owner', 'factory_head', 'godown', 'back_office', 'accounts'],
  'stock/holds': ['owner', 'factory_head', 'godown', 'qc'],
  'distribution/orders': ['owner', 'factory_head', 'back_office', 'godown', 'accounts'],
  'distribution/distributors': ['owner', 'back_office', 'qc', 'accounts', 'distributor', 'salesman'],
  'distribution/logistics': ['owner', 'factory_head', 'back_office', 'godown', 'accounts'],
  'sales/salesman': ['owner', 'back_office', 'salesman'],
  'sales/returns': ['owner', 'back_office', 'qc', 'accounts', 'distributor', 'salesman'],
  'finance/tally': ['owner', 'accounts'],
  'finance/reports': ['owner', 'factory_head', 'accounts'],
  'finance/close': ['owner', 'accounts', 'factory_head', 'qc', 'back_office', 'godown'],
  'hr/attendance': ['hr', 'accounts'],
  'planning/season': ['owner', 'factory_head'],
};

export const pageCap = (key: string) => `page:${key}`;
for (const role of rentioRoles) for (const [key, roles] of Object.entries(PAGE_ACCESS)) if (roles.includes(role.id)) role.capabilities.push(pageCap(key));

export const rentioUsers = PEOPLE.map((p) => ({
  id: p.id,
  name: p.name,
  roleId: p.roleId,
  title: p.title,
  // staffIds link the user to "own" rows (salesman → mapped distributors/retailers)
  staffIds: { [WS]: p.id },
  initials: p.name
    .split(' ')
    .map((x) => x[0])
    .slice(0, 2)
    .join(''),
  scope: p.scope ?? {},
}));

/** Lightweight actor used by the domain services (pure; no store access). */
export interface RActor {
  id: string;
  name: string;
  roleId: string;
  roleLabel: string;
  caps: string[];
  scope: Record<string, string[]>;
}

export function ractor(userId: string): RActor {
  const u = rentioUsers.find((x) => x.id === userId);
  if (!u) throw new Error(`Unknown user ${userId}`);
  const role = rentioRoles.find((r) => r.id === u.roleId)!;
  return { id: u.id, name: u.name, roleId: role.id, roleLabel: role.label, caps: role.capabilities, scope: u.scope };
}

export const hasCap = (a: RActor, cap: string) => a.caps.includes(cap);
export const userName = (id: string | undefined) => (id ? rentioUsers.find((u) => u.id === id)?.name ?? id : '—');
