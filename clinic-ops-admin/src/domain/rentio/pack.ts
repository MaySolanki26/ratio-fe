/**
 * Rentio domain pack: M1 master resources (metadata-driven grids/forms/inspector),
 * masters, roles and navigation for all 16 modules.
 */
import type { DomainPack, FieldCapabilities, FieldDefinition, MasterDefinition, ModuleDefinition, ResourceDefinition } from '../../metadata/types';
import { cond, group } from '../clinic/resources';
import { rentioRoles } from './access';

const ALL: FieldCapabilities = { list: true, sort: true, filter: true, search: true, form: true, export: true };
const STD: FieldCapabilities = { list: true, sort: true, filter: true, form: true, export: true };

const f = (res: string, key: string, label: string, type: FieldDefinition['type'], extra: Partial<FieldDefinition> = {}): FieldDefinition => ({ id: `fld_${res}_${key}`, key, label, type, capabilities: STD, ...extra });

function resource(r: {
  key: string;
  module: string;
  label: string;
  plural: string;
  icon: string;
  prefix: string;
  title: string;
  sub: string[];
  description: string;
  fields: FieldDefinition[];
  ownerField?: string;
  person?: boolean;
  extraViews?: ResourceDefinition['views'];
}): ResourceDefinition {
  const keys = r.fields.map((x) => x.key);
  return {
    id: `res_${r.key}`,
    key: r.key,
    module: r.module,
    label: r.label,
    labelPlural: r.plural,
    icon: r.icon,
    version: 1,
    idPrefix: r.prefix,
    titleField: r.title,
    subtitleFields: r.sub,
    description: r.description,
    status: 'published',
    person: r.person,
    ownerField: r.ownerField,
    fields: r.fields,
    relationships: [],
    form: { quickCreate: keys.slice(0, 4), sections: [{ id: 'main', title: r.label, fields: keys, columns: 2 }] },
    views: [
      { id: `v_${r.key}_all`, resource: r.key, name: `All ${r.plural.toLowerCase()}`, type: 'table', scope: 'org', ownerId: 'system', order: 0, density: 'compact', filter: group('and'), sort: [{ field: r.title, dir: 'asc' }], columns: keys.map((key) => ({ key })) },
      ...(r.extraViews ?? []),
    ],
  };
}

const masters: MasterDefinition[] = [
  { id: 'mst_supplierCategory', key: 'supplierCategory', label: 'Supplier category', version: 1, values: [
    { key: 'farmer', label: 'Farmer', tone: 'success', active: true, order: 0 },
    { key: 'vendor', label: 'Vendor / trader', tone: 'info', active: true, order: 1 },
    { key: 'stores_vendor', label: 'Stores vendor', tone: 'neutral', active: true, order: 2 },
  ] },
  { id: 'mst_partyStatus', key: 'partyStatus', label: 'Status', version: 1, values: [
    { key: 'active', label: 'Active', tone: 'success', active: true, order: 0 },
    { key: 'inactive', label: 'Inactive', tone: 'neutral', active: true, order: 1 },
  ] },
  { id: 'mst_grade', key: 'grade', label: 'Grade', version: 1, values: ['A1', 'B1', 'A2', 'B2'].map((g, i) => ({ key: g, label: g, tone: i % 2 ? 'info' : 'success', active: true, order: i })) },
  { id: 'mst_locationKind', key: 'locationKind', label: 'Location type', version: 1, values: [
    { key: 'raw', label: 'Raw godown', tone: 'warning', active: true, order: 0 },
    { key: 'finished', label: 'Finished godown', tone: 'success', active: true, order: 1 },
    { key: 'stack', label: 'Stack / bin', tone: 'info', active: true, order: 2 },
    { key: 'byproduct', label: 'By-product store', tone: 'accent', active: true, order: 3 },
    { key: 'stores', label: 'Stores', tone: 'neutral', active: true, order: 4 },
    { key: 'quarantine', label: 'Quarantine', tone: 'danger', active: true, order: 5 },
  ] },
  { id: 'mst_shift', key: 'shift', label: 'Shift', version: 1, values: [
    { key: 'day', label: 'Day (09:00–17:30)', tone: 'info', active: true, order: 0 },
    { key: 'night', label: 'Night (21:00–06:00, overnight)', tone: 'accent', active: true, order: 1 },
  ] },
  { id: 'mst_byproduct', key: 'byproduct', label: 'By-product type', version: 1, values: [
    { key: 'HUSK', label: 'Husk', tone: 'warning', active: true, order: 0 },
    { key: 'CHURI', label: 'Churi', tone: 'accent', active: true, order: 1 },
  ] },
];

const resources: ResourceDefinition[] = [
  resource({
    key: 'skus', module: 'masters', label: 'SKU', plural: 'SKUs', icon: 'blocks', prefix: 'SKU', title: 'label', sub: ['grade'],
    description: 'Active quality × size × pack combinations (FR-001). Inactive SKUs cannot be ordered or packed.',
    fields: [
      f('skus', 'label', 'SKU', 'text', { required: true, capabilities: ALL, width: 240 }),
      f('skus', 'grade', 'Grade', 'master', { master: 'grade', required: true }),
      f('skus', 'packKg', 'Pack size', 'number', { unit: 'kg', min: 1, required: true }),
      f('skus', 'shelfLifeDays', 'Shelf life', 'number', { unit: 'days', min: 1, help: 'Demo default (OQ-07)' }),
      f('skus', 'active', 'Active', 'boolean', { defaultValue: true }),
    ],
  }),
  resource({
    key: 'suppliers', module: 'masters', label: 'Supplier / farmer', plural: 'Suppliers & farmers', icon: 'users', prefix: 'SUP', title: 'name', sub: ['category'],
    description: 'Fictional farmers, vendors and stores vendors with optional broker (FR-003).',
    fields: [
      f('suppliers', 'name', 'Name', 'text', { required: true, capabilities: ALL, width: 240 }),
      f('suppliers', 'category', 'Category', 'master', { master: 'supplierCategory', required: true }),
      f('suppliers', 'village', 'Village / town', 'text'),
      f('suppliers', 'phone', 'Phone', 'phone', { sensitivity: 'contact' }),
      f('suppliers', 'brokerId', 'Broker', 'text', { help: 'Optional broker link' }),
    ],
  }),
  resource({
    key: 'distributors', module: 'masters', label: 'Distributor', plural: 'Distributors (17)', icon: 'building', prefix: 'D', title: 'name', sub: ['id', 'city'], ownerField: 'salesmanId',
    description: 'The 17 initial distributor partners (fictional). Salesmen see only mapped distributors (BR-015).',
    fields: [
      f('distributors', 'name', 'Name', 'text', { required: true, capabilities: ALL, width: 260 }),
      f('distributors', 'city', 'City', 'text', { capabilities: ALL }),
      f('distributors', 'creditLimit', 'Credit limit', 'money', { currency: 'INR', sensitivity: 'financial', min: 0, help: 'Demo default (OQ-13)' }),
      f('distributors', 'salesmanId', 'Mapped salesman', 'text'),
      f('distributors', 'minStockKg', 'Min stock', 'number', { unit: 'kg' }),
      f('distributors', 'maxStockKg', 'Max stock', 'number', { unit: 'kg' }),
      f('distributors', 'lastSyncHoursAgo', 'Last app sync', 'number', { unit: 'h ago', help: 'Simulated device freshness' }),
      f('distributors', 'status', 'Status', 'master', { master: 'partyStatus', defaultValue: 'active' }),
    ],
  }),
  resource({
    key: 'retailers', module: 'masters', label: 'Retailer', plural: 'Retailers', icon: 'home', prefix: 'RET', title: 'name', sub: ['distributorId'], ownerField: 'salesmanId',
    description: 'Retailers are order destinations, not app users (S1 exclusion).',
    fields: [
      f('retailers', 'name', 'Name', 'text', { required: true, capabilities: ALL, width: 240 }),
      f('retailers', 'distributorId', 'Served by', 'relation', { relation: { resource: 'distributors' }, required: true }),
      f('retailers', 'city', 'City', 'text'),
      f('retailers', 'salesmanId', 'Salesman', 'text'),
    ],
  }),
  resource({
    key: 'buyers', module: 'masters', label: 'By-product buyer', plural: 'By-product buyers', icon: 'receipt', prefix: 'BUY', title: 'name', sub: ['type'],
    description: 'External Husk/Churi buyers (FR-043).',
    fields: [f('buyers', 'name', 'Name', 'text', { required: true, capabilities: ALL, width: 240 }), f('buyers', 'type', 'Buys', 'master', { master: 'byproduct' })],
  }),
  resource({
    key: 'transporters', module: 'masters', label: 'Transporter', plural: 'Transporters', icon: 'send', prefix: 'TR', title: 'name', sub: ['phone'],
    description: 'Transporters; rate cards are versioned in Logistics (FR-068).',
    fields: [f('transporters', 'name', 'Name', 'text', { required: true, capabilities: ALL, width: 240 }), f('transporters', 'phone', 'Phone', 'phone', { sensitivity: 'contact' })],
  }),
  resource({
    key: 'locations', module: 'masters', label: 'Godown / location', plural: 'Godowns & stacks', icon: 'archive', prefix: 'LOC', title: 'label', sub: ['kind'],
    description: 'Godowns and stacks with capacity and fumigation schedule. Capacity here is enforced at put-away (FR-028).',
    fields: [
      f('locations', 'label', 'Location', 'text', { required: true, capabilities: ALL, width: 220 }),
      f('locations', 'kind', 'Type', 'master', { master: 'locationKind', required: true }),
      f('locations', 'godown', 'Godown', 'text'),
      f('locations', 'capacityKg', 'Capacity', 'number', { unit: 'kg', min: 0 }),
      f('locations', 'lastFumigated', 'Last fumigation', 'date'),
      f('locations', 'owner', 'Responsible', 'text'),
    ],
  }),
  resource({
    key: 'employees', module: 'hr', label: 'Employee', plural: 'Employees', icon: 'id-card', prefix: 'EMP', title: 'name', sub: ['dept'], person: true,
    description: 'Employees for attendance and payroll. Daily rate is restricted payroll data (financial sensitivity).',
    fields: [
      f('employees', 'name', 'Name', 'text', { required: true, capabilities: ALL, width: 200 }),
      f('employees', 'dept', 'Department', 'text'),
      f('employees', 'shift', 'Shift', 'master', { master: 'shift' }),
      f('employees', 'dailyRate', 'Daily rate', 'money', { currency: 'INR', sensitivity: 'financial', help: 'Demo pay rule — no statutory formulas' }),
      f('employees', 'userId', 'App user', 'text'),
    ],
  }),
];

const pg = (module: string, id: string, label: string, icon: string) => ({ id, label, icon, path: id, capability: `page:${module}/${id}` });

/** Navigation in business language; module numbers (M1–M16) are listed in Help › Module map. */
export const rentioModules: ModuleDefinition[] = [
  {
    id: 'home', label: 'Home', icon: 'layout-grid', resources: [], pages: [
      { id: 'dashboard', label: 'Owner overview', icon: 'layout-dashboard', path: 'dashboard', capability: 'ct.view' },
      pg('home', 'my-work', 'My work', 'inbox'),
      pg('home', 'inbox', 'Inbox', 'bell'),
      pg('home', 'approvals', 'Approvals', 'check-square'),
      pg('home', 'alerts', 'Alerts & exceptions', 'alert'),
      pg('home', 'incidents', 'Incidents', 'clipboard-list'),
      pg('home', 'decisions', 'Decision register', 'scroll-text'),
    ],
  },
  { id: 'masters', label: 'Masters & setup', icon: 'blocks', resources: ['skus', 'suppliers', 'distributors', 'retailers', 'buyers', 'transporters', 'locations'], pages: [pg('masters', 'route', 'Process route & machines', 'list')] },
  { id: 'procurement', label: 'Buying & intake', icon: 'download', resources: [], pages: [pg('procurement', 'intake', 'Purchases & truck intake', 'download')] },
  {
    id: 'production', label: 'Production', icon: 'activity', resources: [], pages: [
      pg('production', 'stages', 'Stage board', 'board'),
      pg('production', 'stage', 'My stage', 'play'),
      pg('production', 'grading', 'Grading', 'tags'),
      pg('production', 'handovers', 'Handovers', 'send'),
      pg('production', 'close', 'Daily close', 'check-circle'),
    ],
  },
  {
    id: 'stock', label: 'Godowns & stock', icon: 'archive', resources: [], pages: [
      pg('stock', 'godowns', 'Godowns & stacks', 'archive'),
      pg('stock', 'inventory', 'Stock by lot', 'table'),
      pg('stock', 'byproducts', 'Husk & Churi', 'f-tags'),
      pg('stock', 'holds', 'Holds & counts', 'lock'),
    ],
  },
  {
    id: 'distribution', label: 'Dispatch & distributors', icon: 'send', resources: [], pages: [
      pg('distribution', 'orders', 'Orders & dispatch', 'send'),
      pg('distribution', 'distributors', 'Distributor stock', 'building'),
      pg('distribution', 'logistics', 'Trips & freight', 'calendar-clock'),
    ],
  },
  {
    id: 'sales', label: 'Sales & returns', icon: 'users', resources: [], pages: [
      pg('sales', 'salesman', 'Salesman app', 'phone'),
      pg('sales', 'returns', 'Returns & complaints', 'reset'),
    ],
  },
  {
    id: 'finance', label: 'Accounts & reports', icon: 'receipt', resources: [], pages: [
      pg('finance', 'tally', 'Tally & e-invoice', 'receipt'),
      pg('finance', 'reports', 'Yield, costing & trace', 'f-progress'),
      pg('finance', 'close', 'Period close & audit export', 'lock'),
    ],
  },
  { id: 'hr', label: 'HR & payroll', icon: 'id-card', resources: ['employees'], pages: [pg('hr', 'attendance', 'Attendance & payroll', 'calendar-days')] },
  { id: 'planning', label: 'Season & planning', icon: 'calendar', resources: [], pages: [pg('planning', 'season', 'Season, plan & forecast', 'calendar'), pg('planning', 'replenish', 'Replenishment suggestions', 'reset')] },
  { id: 'presenter', label: 'Presenter tools', icon: 'sparkles', resources: [], pages: [pg('presenter', 'journey', 'Demo script & RT-001 trace', 'activity')] },
  {
    id: 'admin', label: 'Administration', icon: 'settings', resources: [], pages: [
      { id: 'studio', label: 'Configuration studio', icon: 'blocks', path: 'studio', capability: 'config.publish' },
      { id: 'access', label: 'Roles & access', icon: 'shield', path: 'access', capability: 'access.view' },
      { id: 'audit', label: 'Audit log', icon: 'scroll-text', path: 'audit', capability: 'audit.view' },
      { id: 'events', label: 'Event trace', icon: 'activity', path: 'events', capability: 'events.view' },
      { id: 'settings', label: 'Settings', icon: 'sliders', path: 'settings' },
    ],
  },
];

/** Module map for Help / implementation details (keeps all 16 agreed modules traceable). */
export const MODULE_MAP: [string, string, string][] = [
  ['M1', 'Masters and Setup', 'Masters & setup'],
  ['M2', 'Procurement and Intake', 'Buying & intake'],
  ['M3', 'Grading', 'Production › Grading'],
  ['M4', 'Production and Stage Tracking', 'Production'],
  ['M5', 'Factory Godown Stock', 'Godowns & stock › Godowns & stacks'],
  ['M6', 'Inventory', 'Godowns & stock'],
  ['M7', 'Dispatch and In-Transit', 'Dispatch & distributors › Orders & dispatch'],
  ['M8', 'Distributor Inventory (17)', 'Dispatch & distributors › Distributor stock'],
  ['M9', 'Salesman and CRM', 'Sales & returns › Salesman app'],
  ['M10', 'Tally and Compliance', 'Accounts & reports › Tally & e-invoice'],
  ['M11', 'Returns and Complaints', 'Sales & returns › Returns & complaints'],
  ['M12', 'Logistics', 'Dispatch & distributors › Trips & freight'],
  ['M13', 'Control Tower and Alerts', 'Home'],
  ['M14', 'Costing and Reports', 'Accounts & reports › Yield, costing & trace'],
  ['M15', 'HR and Payroll', 'HR & payroll'],
  ['M16', 'Season Mode and Forecast', 'Season & planning'],
];

export const rentioPack: DomainPack = {
  id: 'rentio-smart-erp',
  version: '0.1.0',
  label: 'Rentio Smart ERP',
  description: 'Toor dal mill: procurement → stages → godowns → distributors → retailers, with by-products, Tally, HR and planning. Prototype with fictional data.',
  modules: rentioModules,
  resources,
  masters,
  roles: rentioRoles,
  capabilityRows: [
    { id: 'intake', module: 'procurement', label: 'Intake checker', cells: { add: { capability: 'intake.record', label: 'Record truck intake' }, verify: { capability: 'intake.check', label: 'Accept/reject intake (not own)' } } },
    { id: 'stage', module: 'production', label: 'Stage operations', cells: { update: { capability: 'stage.operate', label: 'Receive / start / output / issue (assigned stages)' } } },
    { id: 'approvals', module: 'stock', label: 'Stock approvals', cells: { approve: { capability: 'approve.adjustment', label: 'Approve count/stock adjustments' } } },
    { id: 'dispatch', module: 'distribution', label: 'Dispatch', cells: { update: { capability: 'dispatch', label: 'Dispatch reserved stock' } } },
    { id: 'credit', module: 'distribution', label: 'Credit override', cells: { approve: { capability: 'approve.credit', label: 'Approve credit overrides' } } },
    { id: 'tally', module: 'finance', label: 'Tally sync', cells: { update: { capability: 'tally.sync', label: 'Sync / IRN (simulated)' } } },
    { id: 'payroll', module: 'hr', label: 'Payroll', cells: { add: { capability: 'hr.payroll', label: 'Prepare payroll' }, approve: { capability: 'payroll.authorize', label: 'Authorize payroll hand-off' } } },
    { id: 'access', module: 'admin', label: 'Roles & access', cells: { view: { capability: 'access.view', label: 'See roles and permissions' } } },
    { id: 'audit', module: 'admin', label: 'Audit log', cells: { view: { capability: 'audit.view', label: 'See the audit log' } } },
  ],
};

export { cond };
