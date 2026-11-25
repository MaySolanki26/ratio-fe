/**
 * Rentio domain state. Stored on the Db as `rentio` under the versioned
 * `rentio.erp.db.v1` key. Physical stock is NEVER stored as a total: it is
 * derived from the append-only `movements` ledger. Reservations and holds are
 * separate overlays (BR-019, FR-031, FR-038).
 */
import type { Grams, Paise } from './units';

export type Basis = 'Actual' | 'Counted' | 'Carried';

export type Material = 'RAW' | 'WIP' | 'REWORK' | 'DAL' | 'PACKED' | 'HUSK' | 'CHURI' | 'REJECT' | 'OIL' | 'BAGS' | 'SPARES';

export type StageCode = 'CLEAN' | 'G1' | 'OIL' | 'COND' | 'DRY' | 'PEEL' | 'G2' | 'PACK';

export type LocationKind =
  | 'intake' // received, awaiting checker (held)
  | 'raw' // raw godown
  | 'stage-in' // stage queue (received, not in a run)
  | 'run' // material inside an active run
  | 'stage-out' // stage output awaiting issue
  | 'pending' // issued, awaiting receipt (handover custody)
  | 'finished' // finished godown stack
  | 'byproduct'
  | 'stores'
  | 'quarantine' // held / rejected / returned
  | 'transit' // shipment in transit
  | 'distributor'
  | 'distributor-held';

export interface Location {
  id: string;
  label: string;
  kind: LocationKind;
  godown?: string; // parent godown for stacks
  stage?: StageCode;
  distributorId?: string;
  capacity?: Grams;
  dynamic?: boolean; // created by a transaction (pending/transit/run)
}

/** Lot / fragment identity. Genealogy parent is not an additional balance (§18). */
export interface Lot {
  id: string; // e.g. RT-001/A1
  rootId: string; // e.g. RT-001
  material: Material;
  label: string;
  grade?: string; // G1 size or G2 quality×size (A1/B1…)
  sku?: string; // packed SKU
  parents: { lotId: string; qty: Grams }[];
  pass?: number; // process pass for rework
  createdAt: string;
  createdBy: string;
  createdByRun?: string;
  routeVersion?: number;
  /** next stage per route (for WIP lots). */
  nextStage?: StageCode | 'F1' | 'R1';
  mfgDate?: string;
  expiry?: string;
  bags?: number;
  bagSize?: Grams;
  /** Display unit: 'bag' lots store count × 1000 so integer maths still applies. */
  unit?: 'kg' | 'bag' | 'L';
  supplierId?: string;
  purchaseId?: string;
  ratePerKg?: Paise;
}

export type MovementKind =
  | 'intake' // source: physical receipt at gate
  | 'accept' // intake → raw godown
  | 'reject'
  | 'putaway'
  | 'issue' // to pending handover
  | 'receive' // pending → destination
  | 'take' // stage-in → run
  | 'consume' // run input consumed into outputs (internal conversion)
  | 'produce' // run output created
  | 'residual' // unprocessed residual returned to queue
  | 'addition' // stores item consumed into a run (oil)
  | 'loss' // recorded process / transit loss (sink)
  | 'pack-material' // packaging consumed (stores, not food mass)
  | 'transfer'
  | 'dispatch' // to transit
  | 'transit-receive'
  | 'deliver-retail' // sink: retailer delivered
  | 'outside-sale' // sink: distributor outside-app sale
  | 'internal-use' // sink: by-product internal consumption
  | 'external-dispatch' // sink: by-product sold out
  | 'return-receive'
  | 'release'
  | 'dispose' // sink
  | 'adjust' // approved count/stock adjustment
  | 'opening'
  | 'excess-receive' // unidentified excess found at receipt (held pending investigation)
  | 'sample' // retained QC sample moved to held sample custody
  | 'reversal';

/** One leg of stock movement. `from`/`to` absent = crosses the tracked boundary. */
export interface Movement {
  id: string;
  txId: string;
  at: string; // physical event time
  recordedAt: string;
  lotId: string;
  qty: Grams; // always > 0
  from?: string;
  to?: string;
  kind: MovementKind;
  basis: Basis;
  ref: string; // business document
  actorId: string;
  note?: string;
  reverses?: string;
}

export interface Reservation {
  id: string;
  lotId: string;
  location: string;
  qty: Grams;
  orderId: string;
  lineId: string;
  status: 'active' | 'consumed' | 'released';
  createdAt: string;
  createdBy: string;
}

export interface Hold {
  id: string;
  scope: 'lot' | 'location';
  target: string;
  reason: string;
  kind: 'quality' | 'treatment' | 'recall' | 'pest' | 'other';
  status: 'active' | 'released';
  createdAt: string;
  createdBy: string;
  releasedAt?: string;
  releasedBy?: string;
  releaseNote?: string;
  /** descendant branches released individually (FR-110). */
  releasedBranches?: string[];
}

export interface Purchase {
  id: string;
  supplierId: string;
  brokerId?: string;
  rawType: string;
  declaredQty: Grams;
  ratePerKg: Paise;
  billRef?: string;
  billedQty?: Grams;
  billAmount?: Paise;
  promisedDate?: string;
  status: 'open' | 'partially_received' | 'received' | 'closed' | 'cancelled';
  createdAt: string;
  createdBy: string;
  billMatch?: { status: 'matched' | 'disputed' | 'accepted_difference'; note?: string; by: string; at: string };
}

export interface Intake {
  id: string;
  purchaseId: string;
  lotId: string;
  truck: string;
  slip: string;
  gross: Grams;
  tare: Grams;
  net: Grams;
  moisturePct: number;
  foreignMatterPct: number;
  damagePct: number;
  evidence: string[];
  status: 'under_inspection' | 'accepted' | 'partially_accepted' | 'rejected';
  accepted?: Grams;
  rejected?: Grams;
  godown?: string;
  valueDeduction?: Paise;
  makerId: string;
  checkerId?: string;
  createdAt: string;
  decidedAt?: string;
}

export interface Handover {
  id: string;
  lotId: string;
  fromLoc: string;
  toLoc: string;
  toStage?: StageCode | 'F1' | 'R1';
  qty: Grams;
  basis: Basis;
  issuedBy: string;
  issuedAt: string;
  received: Grams;
  receipts: { qty: Grams; by: string; at: string; to: string; note?: string }[];
  settled: { qty: Grams; how: 'loss' | 'located' | 'returned'; approvalId?: string; by: string; at: string }[];
  status: 'awaiting' | 'received' | 'partial' | 'settled';
  /** stacks for finished-goods receipt */
}

export interface RunEvent {
  type: 'start' | 'hold' | 'resume' | 'complete';
  at: string;
  by: string;
  reason?: string;
}

export interface RunOutput {
  kind: 'forward' | 'rework' | 'husk' | 'churi' | 'reject' | 'loss' | 'residual';
  qty: Grams;
  grade?: string;
  lotId?: string;
  basis: Basis;
  reason?: string;
}

export interface StageRun {
  id: string;
  stage: StageCode;
  pass: number;
  inputLotId: string;
  inputQty: Grams;
  takenFrom: string;
  routeVersion: number;
  ownerId: string;
  backupId: string;
  plannedMinutes: number;
  seasonFactor: number;
  baselineFinish: string;
  events: RunEvent[];
  status: 'running' | 'on_hold' | 'completed';
  additions: { lotId: string; qty: Grams; material: Material }[];
  outputs: RunOutput[];
  packing?: { bags: number; bagSize: Grams; packagingLotId: string; sku: string };
  completedAt?: string;
  /** Revised finish estimates by named staff (baseline never changes). */
  etaRevisions?: { at: string; by: string; eta: string; reason: string }[];
}

export interface OrderLine {
  id: string;
  grade: string; // A1, B1 … or HUSK/CHURI
  sku?: string;
  qty: Grams;
  ratePerKg: Paise;
  rateVersion: string;
  cancelled: Grams;
}

export type OrderKind = 'factory' | 'retail' | 'byproduct';

export interface Order {
  id: string;
  kind: OrderKind;
  partyId: string; // distributor (factory), retailer (retail), buyer (byproduct)
  distributorId?: string; // retail: fulfilling distributor
  salesmanId?: string;
  lines: OrderLine[];
  status: 'pending_approval' | 'approved' | 'credit_hold' | 'cancelled' | 'closed';
  source: 'app' | 'offline' | 'office';
  promisedDate?: string;
  createdAt: string;
  createdBy: string;
  approvedBy?: string;
  notes?: string;
  advance?: boolean; // advance booking (no physical reservation, FR-054)
  revisions: { at: string; by: string; change: string }[];
}

export interface ShipmentLine {
  lotId: string;
  fromLoc: string;
  qty: Grams;
  bags?: number;
  reservationId?: string;
  orderLineId?: string;
}

export interface Shipment {
  id: string;
  orderId: string;
  toDistributor?: string;
  toBuyer?: string;
  fromDistributor?: string; // inter-distributor transfer
  lines: ShipmentLine[];
  transitLoc: string;
  tripId?: string;
  dispatchedAt: string;
  dispatchedBy: string;
  weights?: { vehicleGross: Grams; vehicleTare: Grams; packagingTare: Grams };
  status: 'in_transit' | 'received' | 'partially_received' | 'disputed';
  receipt?: { good: Grams; damaged: Grams; short: Grams; excess: Grams; by: string; at: string; note?: string };
  disputeId?: string;
}

export interface Dispute {
  id: string;
  shipmentId?: string;
  handoverId?: string;
  qty: Grams;
  reason: string;
  status: 'open' | 'resolved';
  resolution?: string;
  createdAt: string;
  createdBy: string;
}

export interface RateVersion {
  id: string;
  grade: string;
  ratePerKg: Paise;
  validFrom: string;
  validTo?: string;
  createdBy: string;
}

export interface OfflineOrder {
  id: string;
  deviceRef: string;
  salesmanId: string;
  distributorId: string;
  retailerId: string;
  grade: string;
  qty: Grams;
  rateSeen: Paise;
  rateVersionSeen: string;
  stockSeen: Grams;
  capturedAt: string;
  status: 'queued' | 'accepted' | 'conflict' | 'rejected' | 'resolved';
  orderId?: string;
  conflict?: string;
  syncedAt?: string;
}

export interface TallyAttempt {
  at: string;
  by: string;
  outcome: 'acknowledged' | 'failed' | 'timeout' | 'found_existing';
  message: string;
}

export interface TallyDoc {
  id: string;
  sourceType: 'purchase' | 'sale' | 'byproduct-sale' | 'freight' | 'receipt';
  sourceId: string;
  party: string;
  amount: Paise;
  status: 'queued' | 'acknowledged' | 'failed' | 'status_unknown' | 'reconciled';
  attempts: TallyAttempt[];
  tallyRef?: string;
  irn?: string;
  irnSource?: 'ERP' | 'Tally';
  createdAt: string;
}

export interface Complaint {
  id: string;
  retailerId?: string;
  distributorId?: string;
  orderId?: string;
  lotId?: string;
  category: 'quality' | 'short' | 'damage' | 'wrong_grade' | 'other';
  description: string;
  status: 'open' | 'return_authorized' | 'return_received' | 'replacement' | 'resolved' | 'closed';
  returnQty?: Grams;
  returnLoc?: string;
  returnLotId?: string;
  disposition?: 'release' | 'dispose' | 'reprocess';
  replacementOrderId?: string;
  creditStatus: 'none' | 'requested' | 'confirmed';
  createdAt: string;
  createdBy: string;
}

export interface Trip {
  id: string;
  transporterId: string;
  vehicle: string;
  driver: string;
  shipmentIds: string[];
  rateCardId: string;
  vehicleChanges: { at: string; from: string; to: string; reason: string; by: string }[];
  freightBill?: { amount: Paise; ref: string; status: 'matched' | 'mismatch' | 'approved'; by: string };
  status: 'open' | 'closed';
  createdAt: string;
}

export interface RateCard {
  id: string;
  transporterId: string;
  route: string;
  perKg: Paise;
  validFrom: string;
  validTo?: string;
}

export type ApprovalType = 'residual_loss' | 'loss_over_tolerance' | 'stock_adjustment' | 'disposal' | 'regrade' | 'capacity_override' | 'credit_override' | 'payroll_authorize' | 'freight_mismatch' | 'fefo_override';

export interface RApproval {
  id: string;
  type: ApprovalType;
  ref: string;
  summary: string;
  exposure?: string;
  rule: string;
  payload: Record<string, unknown>;
  requestedBy: string;
  requestedAt: string;
  requiredCapability: string;
  status: 'pending' | 'approved' | 'rejected';
  decidedBy?: string;
  decidedAt?: string;
  reason?: string;
  ownerOnly?: boolean;
}

export interface StockCount {
  id: string;
  location: string;
  lotId: string;
  snapshot: Grams;
  snapshotAt: string;
  counted: Grams;
  movementsAfter: Grams;
  difference: Grams;
  status: 'pending_approval' | 'posted' | 'rejected';
  approvalId?: string;
  countedBy: string;
}

export interface Punch {
  id: string;
  employeeId: string;
  at: string;
  dir: 'in' | 'out';
  importId: string;
}

export interface AttendanceImport {
  id: string;
  fileName: string;
  fileHash: string;
  rows: number;
  accepted: number;
  duplicates: number;
  invalid: number;
  importedBy: string;
  at: string;
}

export interface PayrollRun {
  id: string;
  period: string;
  version: number;
  status: 'draft' | 'authorized';
  lines: { employeeId: string; days: number; hours: number; otHours: number; gross: Paise; ruleVersion: string }[];
  createdBy: string;
  createdAt: string;
  authorizedBy?: string;
  supersedes?: string;
}

export interface Decision {
  id: string;
  title: string;
  answer: string;
  scope: string;
  by: string;
  at: string;
  supersedes?: string;
}

export interface AlertAck {
  key: string;
  by: string;
  at: string;
  note?: string;
}

export interface FailedAttempt {
  id: string;
  at: string;
  actorId: string;
  action: string;
  reason: string;
  code: string;
}

export interface Collection {
  id: string;
  orderId: string;
  debtor: string;
  creditor: string;
  amount: Paise;
  mode: 'cash' | 'cheque' | 'upi';
  status: 'provisional' | 'confirmed' | 'rejected';
  recordedBy: string;
  at: string;
  confirmedBy?: string;
}

export interface DailyPlan {
  id: string;
  date: string;
  items: { stage: StageCode; lotId?: string; targetQty: Grams; note?: string }[];
  status: 'draft' | 'ready' | 'blocked' | 'released';
  blockers: string[];
  createdBy: string;
  releasedBy?: string;
}

export interface Equipment {
  id: string;
  label: string;
  stage: StageCode;
  status: 'released' | 'unavailable';
  checkDue: string;
  note?: string;
}

export interface RentioState {
  version: number;
  dataset: 'start' | 'completed' | 'demo';
  scenarioStep: number;
  seq: Record<string, number>;
  locations: Record<string, Location>;
  lots: Record<string, Lot>;
  movements: Movement[];
  reservations: Reservation[];
  holds: Hold[];
  purchases: Purchase[];
  intakes: Intake[];
  handovers: Handover[];
  runs: StageRun[];
  orders: Order[];
  shipments: Shipment[];
  disputes: Dispute[];
  rates: RateVersion[];
  offline: { online: boolean; queue: OfflineOrder[] };
  tally: TallyDoc[];
  tallyExternal: Record<string, { ref: string; irn?: string }>;
  tallySim: { failNext: number; timeoutNext: number };
  complaints: Complaint[];
  trips: Trip[];
  rateCards: RateCard[];
  approvals: RApproval[];
  counts: StockCount[];
  punches: Punch[];
  imports: AttendanceImport[];
  payroll: PayrollRun[];
  decisions: Decision[];
  acks: AlertAck[];
  failures: FailedAttempt[];
  collections: Collection[];
  plans: DailyPlan[];
  equipment: Equipment[];
  route: { version: number; stages: StageCode[]; history: { version: number; at: string; by: string; change: string }[] };
  season: { active: boolean; factor: number; escalationHours: number; changedBy?: string; changedAt?: string };
  baseline: { approved: boolean; lots: string[]; yieldPct?: number; approvedBy?: string; approvedAt?: string };
  messages: { id: string; at: string; channel: 'WhatsApp' | 'SMS'; to: string; text: string; status: 'delivered' | 'failed' }[];
  /** Daily close confirmations (FR-116): carried-forward items are recorded, never auto-resolved. */
  /** Closed accounting periods (YYYY-MM, IST); postings dated inside are refused. */
  periodLocks?: { period: string; by: string; at: string; reopened?: { by: string; at: string; reason: string } }[];
  closes?: { id: string; date: string; stage: string; by: string; at: string; carried: string[]; note?: string }[];
  idempotency: Record<string, { txId: string; at: string; result: unknown }>;
  txLog: { id: string; at: string; actorId: string; label: string; ref?: string }[];
}
