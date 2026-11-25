/**
 * Read scope — which stock, documents and pages an actor may SEE. Every screen,
 * drawer, search, export and alert must read through these selectors; write
 * permission (disabled buttons) is never treated as read protection.
 *
 * Explicit allow rules per role (§20 "View operational network", OQ-02 demo values).
 * Missing or empty scope never means "all". This runs in the browser: it
 * demonstrates the rule, it is not a security boundary.
 */
import type { RActor } from './access';
import { computePositions, type StockRow, stockRows } from './engine';
import type { Lot, Movement, Order, RentioState, Shipment, StageCode } from './types';

export interface ReadScope {
  /** Every location and document (Owner, Accounts). */
  all: boolean;
  /** Plant locations: intake, raw, stages, pending handovers, godowns, stores, quarantine. */
  factory: boolean;
  /** In-transit custody. */
  transit: boolean;
  /** Distributor locations readable (explicit ids, or every distributor when `allDistributors`). */
  distributors: string[];
  allDistributors: boolean;
  /** Stage-scoped staff see only their stages' queues, runs, outputs and handovers. */
  stages: StageCode[];
  /** Plain-language description shown in the UI. */
  label: string;
}

const NONE: ReadScope = { all: false, factory: false, transit: false, distributors: [], allDistributors: false, stages: [], label: 'No stock visibility' };

export function readScope(a: RActor): ReadScope {
  const ids = (k: string) => (a.scope?.[k] ?? []).filter(Boolean);
  switch (a.roleId) {
    case 'owner':
    case 'accounts':
      return { ...NONE, all: true, factory: true, transit: true, allDistributors: true, label: 'Whole network' };
    case 'back_office':
    case 'qc':
      // sales desk / logistics and quality-recall work span the network (explicit grant)
      return { ...NONE, factory: true, transit: true, allDistributors: true, label: 'Plant, transit and distributors' };
    case 'factory_head':
    case 'godown':
      return { ...NONE, factory: true, transit: true, label: 'Plant and outbound transit' };
    case 'stage_owner': {
      const stages = ids('stages') as StageCode[];
      return stages.length ? { ...NONE, stages, label: `Own stages: ${stages.join(', ')}` } : NONE;
    }
    case 'distributor':
    case 'salesman': {
      const d = ids('distributors');
      return d.length ? { ...NONE, distributors: d, label: `${a.roleId === 'salesman' ? 'Mapped' : 'Own'} distributor${d.length > 1 ? 's' : ''}: ${d.join(', ')}` } : NONE;
    }
    default:
      return NONE; // HR, Administrator and unknown roles: no stock data
  }
}

const shipmentOfTransit = (s: RentioState, loc: string): Shipment | undefined => s.shipments.find((x) => x.transitLoc === loc);

/** Can the actor see quantities held at this location? */
export function canReadLoc(s: RentioState, a: RActor, loc: string, sc = readScope(a)): boolean {
  if (sc.all) return true;
  const l = s.locations[loc];
  if (!l) return false;
  const distOk = (d?: string) => !!d && (sc.allDistributors || sc.distributors.includes(d));
  switch (l.kind) {
    case 'distributor':
    case 'distributor-held':
      return distOk(l.distributorId);
    case 'transit': {
      if (sc.transit) return true;
      const sh = shipmentOfTransit(s, loc);
      return distOk(sh?.toDistributor ?? l.distributorId) || distOk(sh?.fromDistributor);
    }
    case 'pending': {
      if (sc.factory) return true;
      const h = s.handovers.find((x) => `PEND:${x.id}` === loc);
      return !!h && (sc.stages.includes(h.toStage as StageCode) || sc.stages.includes(s.locations[h.fromLoc]?.stage as StageCode));
    }
    case 'stage-in':
    case 'stage-out':
    case 'run':
      return sc.factory || (!!l.stage && sc.stages.includes(l.stage));
    default:
      return sc.factory;
  }
}

export const scopedStockRows = (s: RentioState, a: RActor, now: string): StockRow[] => {
  const sc = readScope(a);
  return stockRows(s, now).filter((r) => canReadLoc(s, a, r.loc, sc));
};

/** Movements with at least one readable leg (the unreadable leg's location is not revealed by the UI). */
export const scopedMovements = (s: RentioState, a: RActor, lotId?: string): Movement[] => {
  const sc = readScope(a);
  return s.movements.filter((m) => (!lotId || m.lotId === lotId) && ((m.from && canReadLoc(s, a, m.from, sc)) || (m.to && canReadLoc(s, a, m.to, sc))));
};

export function canReadLot(s: RentioState, a: RActor, lotId: string) {
  if (!s.lots[lotId]) return false;
  if (readScope(a).all) return true;
  return scopedMovements(s, a, lotId).length > 0;
}

export const scopedLots = (s: RentioState, a: RActor): Lot[] => {
  if (readScope(a).all) return Object.values(s.lots);
  const ids = new Set(scopedMovements(s, a).map((m) => m.lotId));
  return Object.values(s.lots).filter((l) => ids.has(l.id));
};

/** Live positions of a lot the actor may see. */
export function scopedPositions(s: RentioState, a: RActor, lotId: string) {
  const sc = readScope(a);
  const out: { loc: string; qty: number }[] = [];
  computePositions(s).forEach((q, k) => {
    const [l, loc] = k.split('|');
    if (l === lotId && q !== 0 && canReadLoc(s, a, loc, sc)) out.push({ loc, qty: q });
  });
  return out;
}

export function scopedOrders(s: RentioState, a: RActor): Order[] {
  const sc = readScope(a);
  if (sc.all) return s.orders;
  const dist = (d?: string) => !!d && (sc.allDistributors || sc.distributors.includes(d));
  return s.orders.filter((o) => {
    if (o.kind === 'retail') return dist(o.distributorId);
    if (o.kind === 'byproduct') return sc.factory;
    // factory orders: plant roles see all; distributors see orders addressed to them
    return (sc.factory && (sc.transit || sc.allDistributors)) || dist(o.partyId);
  });
}

export function scopedShipments(s: RentioState, a: RActor): Shipment[] {
  const sc = readScope(a);
  if (sc.all || sc.transit) return s.shipments;
  return s.shipments.filter((x) => sc.distributors.includes(x.toDistributor ?? '') || sc.distributors.includes(x.fromDistributor ?? ''));
}

export const scopedHandovers = (s: RentioState, a: RActor) => {
  const sc = readScope(a);
  return s.handovers.filter((h) => sc.factory || canReadLoc(s, a, `PEND:${h.id}`, sc));
};

export const scopedRuns = (s: RentioState, a: RActor) => {
  const sc = readScope(a);
  return s.runs.filter((r) => sc.factory || sc.stages.includes(r.stage));
};

export const scopedComplaints = (s: RentioState, a: RActor) => {
  const sc = readScope(a);
  if (sc.all || sc.allDistributors) return s.complaints;
  return s.complaints.filter((c) => sc.distributors.includes(c.distributorId ?? ''));
};

/** Approvals you asked for, or that you are entitled to decide. */
export const scopedApprovals = (s: RentioState, a: RActor) => s.approvals.filter((x) => x.requestedBy === a.id || a.caps.includes(x.requiredCapability));

/** Distributor ids whose figures the actor may see. */
export const visibleDistributorIds = (all: string[], a: RActor) => {
  const sc = readScope(a);
  return sc.all || sc.allDistributors ? all : all.filter((d) => sc.distributors.includes(d));
};
