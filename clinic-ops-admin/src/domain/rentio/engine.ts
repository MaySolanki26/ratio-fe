/**
 * Rentio stock engine (pure). All physical quantities derive from the movement
 * ledger; reservations/holds are overlays. `execute` runs one business command
 * against a draft: it validates, applies, checks invariants and either returns
 * or throws — the caller only persists a draft that came back successfully.
 */
import type { Db } from '../../services/types';
import { hasCap, type RActor } from './access';
import type { Basis, Hold, Location, Lot, Movement, MovementKind, RentioState } from './types';
import { fmtKg, type Grams } from './units';

export type RErrorCode = 'chronology' | 'forbidden' | 'validation' | 'business_rule' | 'negative_stock' | 'self_approval' | 'duplicate' | 'not_found' | 'conflict' | 'scope';

export class RError extends Error {
  code: RErrorCode;
  constructor(code: RErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function fail(code: RErrorCode, message: string): never {
  throw new RError(code, message);
}

export interface Ctx {
  db: Db;
  s: RentioState;
  actor: RActor;
  now: string; // recorded time
  at: string; // physical event time
  txId: string;
  pos: Map<string, Grams>;
  label: string;
}

// ---------------------------------------------------------------- ids

export function nextId(s: RentioState, prefix: string, width = 4) {
  const n = (s.seq[prefix] ?? 0) + 1;
  s.seq[prefix] = n;
  return `${prefix}-${String(n).padStart(width, '0')}`;
}

// ---------------------------------------------------------------- positions (derived)

const pkey = (lot: string, loc: string) => `${lot}|${loc}`;

export function computePositions(s: RentioState): Map<string, Grams> {
  const m = new Map<string, Grams>();
  for (const mv of s.movements) {
    if (mv.from) m.set(pkey(mv.lotId, mv.from), (m.get(pkey(mv.lotId, mv.from)) ?? 0) - mv.qty);
    if (mv.to) m.set(pkey(mv.lotId, mv.to), (m.get(pkey(mv.lotId, mv.to)) ?? 0) + mv.qty);
  }
  return m;
}

export interface Position {
  lotId: string;
  loc: string;
  qty: Grams;
}

/** Non-zero physical positions. */
export function positionList(s: RentioState, pos = computePositions(s)): Position[] {
  const out: Position[] = [];
  pos.forEach((qty, k) => {
    if (qty === 0) return;
    const [lotId, loc] = k.split('|');
    out.push({ lotId, loc, qty });
  });
  return out;
}

export const physical = (s: RentioState, lotId: string, loc: string, pos = computePositions(s)) => pos.get(pkey(lotId, loc)) ?? 0;

// ---------------------------------------------------------------- locations

export function ensureLocation(s: RentioState, l: Location) {
  if (!s.locations[l.id]) s.locations[l.id] = l;
  return s.locations[l.id];
}

export const locOf = (s: RentioState, id: string) => s.locations[id];
export const godownOf = (s: RentioState, id: string) => s.locations[id]?.godown ?? id;

// ---------------------------------------------------------------- genealogy

export function ancestors(s: RentioState, lotId: string): string[] {
  const out: string[] = [];
  const stack = [...(s.lots[lotId]?.parents.map((p) => p.lotId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.includes(id)) continue;
    out.push(id);
    stack.push(...(s.lots[id]?.parents.map((p) => p.lotId) ?? []));
  }
  return out;
}

export function descendants(s: RentioState, lotId: string): string[] {
  const out: string[] = [];
  const stack = [lotId];
  const lots = Object.values(s.lots);
  while (stack.length) {
    const id = stack.pop()!;
    for (const l of lots) {
      if (l.parents.some((p) => p.lotId === id) && !out.includes(l.id)) {
        out.push(l.id);
        stack.push(l.id);
      }
    }
  }
  return out;
}

/** Lots belonging to a root genealogy (root itself + all descendants). */
export const familyOf = (s: RentioState, rootId: string) => [rootId, ...descendants(s, rootId)];

// ---------------------------------------------------------------- holds & eligibility

/** Active holds affecting a lot (own or inherited from an ancestor), honouring per-branch releases. */
export function lotHolds(s: RentioState, lotId: string): Hold[] {
  const chain = [lotId, ...ancestors(s, lotId)];
  return s.holds.filter((h) => {
    if (h.status !== 'active' || h.scope !== 'lot' || !chain.includes(h.target)) return false;
    // a released branch exempts that branch and its descendants
    const released = h.releasedBranches ?? [];
    return !released.some((b) => b === lotId || ancestors(s, lotId).includes(b));
  });
}

export function locationHolds(s: RentioState, loc: string): Hold[] {
  const g = godownOf(s, loc);
  return s.holds.filter((h) => h.status === 'active' && h.scope === 'location' && (h.target === loc || h.target === g));
}

const SELLABLE_LOCS: Location['kind'][] = ['finished', 'distributor', 'byproduct'];

export function isExpired(s: RentioState, lotId: string, now: string) {
  const exp = s.lots[lotId]?.expiry;
  return !!exp && exp <= now.slice(0, 10);
}

/** Why a physical position cannot be used for normal orders (empty = eligible). */
export function ineligibility(s: RentioState, lotId: string, loc: string, now: string): string[] {
  const reasons: string[] = [];
  const l = s.locations[loc];
  if (!l || !SELLABLE_LOCS.includes(l.kind)) reasons.push(`${l?.label ?? loc} is not a sellable location`);
  lotHolds(s, lotId).forEach((h) => reasons.push(`${h.kind} hold ${h.id}${h.target !== lotId ? ` on ancestor ${h.target}` : ''}: ${h.reason}`));
  locationHolds(s, loc).forEach((h) => reasons.push(`location hold ${h.id} on ${h.target}: ${h.reason}`));
  if (isExpired(s, lotId, now)) reasons.push(`expired ${s.lots[lotId].expiry}`);
  return reasons;
}

export const reservedAt = (s: RentioState, lotId: string, loc: string) =>
  s.reservations.filter((r) => r.status === 'active' && r.lotId === lotId && r.location === loc).reduce((a, r) => a + r.qty, 0);

/** Condition holds that come from where the stock physically is (pending a decision). */
const CONDITION_HOLD: Partial<Record<Location['kind'], string>> = {
  intake: 'Awaiting independent intake check',
  quarantine: 'Quarantine — awaiting QC disposition',
  'distributor-held': 'Damaged / returned — held for QC',
};

/** Genuine holds only: active quality/treatment/recall holds plus held-condition locations. Not "not sellable". */
export function holdReasons(s: RentioState, lotId: string, loc: string): string[] {
  const out: string[] = [];
  const c = CONDITION_HOLD[s.locations[loc]?.kind];
  if (c) out.push(c);
  lotHolds(s, lotId).forEach((h) => out.push(`${h.kind} hold ${h.id}${h.target !== lotId ? ` (on parent ${h.target})` : ''}: ${h.reason}`));
  locationHolds(s, loc).forEach((h) => out.push(`${h.kind} hold ${h.id} on ${s.locations[h.target]?.label ?? h.target}: ${h.reason}`));
  return out;
}

const PROCESS_LOCS: Location['kind'][] = ['raw', 'stage-in'];

/**
 * One stock position with INDEPENDENT dimensions (§18): custody (location kind), genuine holds,
 * expiry, reservation, sale eligibility and readiness for processing. Normal raw, WIP and transit are
 * never reported as "held"; they are simply not sellable from that custody point.
 */
export interface StockRow extends Position {
  lot: Lot;
  location: Location;
  /** Genuine quality/treatment/recall holds and held-condition custody. */
  holds: string[];
  held: boolean;
  expired: boolean;
  /** Can fill a normal sales order from here (sellable custody, not held, not expired). */
  sellable: boolean;
  /** Raw/queued material that a stage may start (not held). */
  readyToProcess: Grams;
  reserved: Grams;
  /** Available to reserve/sell = sellable physical − active reservations. */
  available: Grams;
  /** Reserved quantity that can no longer be fulfilled from here (held/expired). */
  reservedAtRisk: Grams;
  /** Every reason the position cannot fill a normal order (includes custody). */
  reasons: string[];
}

/** The single source for every stock view. */
export function stockRows(s: RentioState, now: string, pos = computePositions(s)): StockRow[] {
  return positionList(s, pos).map((p) => {
    const location = s.locations[p.loc];
    const holds = holdReasons(s, p.lotId, p.loc);
    const expired = isExpired(s, p.lotId, now);
    const held = holds.length > 0;
    const sellable = !!location && SELLABLE_LOCS.includes(location.kind) && !held && !expired;
    const reserved = reservedAt(s, p.lotId, p.loc);
    return {
      ...p,
      lot: s.lots[p.lotId],
      location,
      holds,
      held,
      expired,
      sellable,
      readyToProcess: !held && location && PROCESS_LOCS.includes(location.kind) ? p.qty : 0,
      reserved,
      available: sellable ? Math.max(0, p.qty - reserved) : 0,
      reservedAtRisk: sellable ? 0 : reserved,
      reasons: ineligibility(s, p.lotId, p.loc, now),
    };
  });
}

// ---------------------------------------------------------------- chronology (event-time ordering)

/** IST time; seconds are shown when present so two events in one minute never read as "06:43 before 06:43". */
const istFmt = (ms: number) =>
  new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', ...(new Date(ms).getUTCSeconds() ? { second: '2-digit' as const } : {}), hour12: false }) + ' IST';
export const fmtIst = (iso: string) => istFmt(Date.parse(iso));

/** Timeline of one (lot, location) position in event-time order (ties keep posting order). */
function timeline(s: RentioState, lotId: string, loc: string) {
  return s.movements
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.lotId === lotId && (m.from === loc || m.to === loc))
    .map(({ m, i }) => ({ t: Date.parse(m.at), d: (m.to === loc ? m.qty : 0) - (m.from === loc ? m.qty : 0), i }))
    .sort((a, b) => a.t - b.t || a.i - b.i);
}

/**
 * Earliest event time at which `qty` can leave this position without any later recorded movement
 * going negative (undefined = never). Fungible positions: quantity received at different times all counts.
 */
export function earliestAvailable(s: RentioState, lotId: string, loc: string, qty: Grams): string | undefined {
  const ev = timeline(s, lotId, loc);
  const bal: number[] = [];
  ev.reduce((b, e, k) => (bal[k] = b + e.d), 0);
  const suf: number[] = [];
  for (let k = ev.length - 1; k >= 0; k--) suf[k] = Math.min(bal[k], k + 1 < ev.length ? suf[k + 1] : Infinity);
  for (let k = 0; k < ev.length; k++) {
    if (k + 1 < ev.length && ev[k + 1].t === ev[k].t) continue; // state after every event at this instant
    if (suf[k] >= qty) return new Date(ev[k].t).toISOString();
  }
  return undefined;
}

/** Block a removal dated before the quantity was physically there, or one that would break a later record. */
export function checkChronology(s: RentioState, lotId: string, loc: string, qty: Grams, at: string) {
  const t = Date.parse(at);
  let b = 0;
  let ok = true;
  let inserted = false;
  for (const e of timeline(s, lotId, loc)) {
    if (!inserted && e.t > t) {
      b -= qty;
      inserted = true;
      if (b < 0) ok = false;
    }
    b += e.d;
    if (inserted && b < 0) ok = false;
  }
  if (!inserted && b - qty < 0) ok = false;
  if (ok) return;
  const earliest = earliestAvailable(s, lotId, loc, qty);
  const where = s.locations[loc]?.label ?? loc;
  fail(
    'chronology',
    earliest && Date.parse(earliest) > t
      ? `Time not possible: ${fmtKg(qty)} of ${lotId} was not at ${where} at ${istFmt(t)}. Earliest allowed time: ${fmtIst(earliest)}.`
      : `Time not possible: moving ${fmtKg(qty)} of ${lotId} from ${where} at ${istFmt(t)} would contradict a later recorded movement.`,
  );
}

/** Run events must follow each other (start → hold → resume → finish). */
export function checkAfter(prevIso: string, at: string, what: string) {
  if (Date.parse(at) < Date.parse(prevIso)) fail('chronology', `Time not possible: ${what} cannot be before ${fmtIst(prevIso)}. Earliest allowed time: ${fmtIst(prevIso)}.`);
}

// ---------------------------------------------------------------- moves

export interface MoveInput {
  lotId: string;
  qty: Grams;
  from?: string;
  to?: string;
  kind: MovementKind;
  basis?: Basis;
  ref: string;
  note?: string;
  reverses?: string;
}

export function move(ctx: Ctx, m: MoveInput): Movement {
  if (!Number.isInteger(m.qty) || m.qty <= 0) fail('validation', `Quantity must be a positive amount (got ${m.qty} g)`);
  if (!ctx.s.lots[m.lotId]) fail('not_found', `Unknown lot ${m.lotId}`);
  if (m.from) {
    const have = ctx.pos.get(pkey(m.lotId, m.from)) ?? 0;
    if (have < m.qty) fail('negative_stock', `Blocked: ${m.lotId} at ${ctx.s.locations[m.from]?.label ?? m.from} has ${fmtKg(have)}; cannot move ${fmtKg(m.qty)} (negative stock is never allowed).`);
    checkChronology(ctx.s, m.lotId, m.from, m.qty, ctx.at);
    ctx.pos.set(pkey(m.lotId, m.from), have - m.qty);
  }
  if (m.to) {
    if (!ctx.s.locations[m.to]) fail('not_found', `Unknown location ${m.to}`);
    ctx.pos.set(pkey(m.lotId, m.to), (ctx.pos.get(pkey(m.lotId, m.to)) ?? 0) + m.qty);
  }
  const mv: Movement = {
    id: nextId(ctx.s, 'MV', 5),
    txId: ctx.txId,
    at: ctx.at,
    recordedAt: ctx.now,
    lotId: m.lotId,
    qty: m.qty,
    from: m.from,
    to: m.to,
    kind: m.kind,
    basis: m.basis ?? 'Actual',
    ref: m.ref,
    actorId: ctx.actor.id,
    note: m.note,
    reverses: m.reverses,
  };
  ctx.s.movements.push(mv);
  return mv;
}

export function createLot(ctx: Ctx, l: Omit<Lot, 'createdAt' | 'createdBy'>): Lot {
  if (ctx.s.lots[l.id]) fail('conflict', `Lot ${l.id} already exists`);
  const lot: Lot = { ...l, createdAt: ctx.at, createdBy: ctx.actor.id };
  ctx.s.lots[l.id] = lot;
  return lot;
}

// ---------------------------------------------------------------- guards

export function requireCap(ctx: Ctx, cap: string, what: string) {
  if (!hasCap(ctx.actor, cap)) fail('forbidden', `${ctx.actor.roleLabel} cannot ${what}.`);
}

export function requireScope(ctx: Ctx, kind: 'stages' | 'distributors' | 'locations', value: string, what: string) {
  const a = ctx.actor;
  if (hasCap(a, 'scope.all')) return;
  if (kind === 'stages' && hasCap(a, 'stage.backup')) return;
  if (kind === 'locations' && hasCap(a, 'scope.factory') && !value.startsWith('DIST:')) return;
  const allowed = a.scope[kind] ?? [];
  if (!allowed.includes(value)) fail('scope', `${a.name} (${a.roleLabel}) is not assigned to ${value}; cannot ${what}.`);
}

export function notSelf(ctx: Ctx, makerId: string, what: string) {
  if (makerId === ctx.actor.id) fail('self_approval', `Self-approval rejected: ${ctx.actor.name} recorded this ${what} and cannot also approve it. An independent checker is required.`);
}

// ---------------------------------------------------------------- invariants

export function checkInvariants(s: RentioState, pos = computePositions(s)) {
  pos.forEach((q, k) => {
    if (q < 0) fail('negative_stock', `Invariant failed: ${k.replace('|', ' at ')} would be ${fmtKg(q)}`);
  });
  const byPos = new Map<string, Grams>();
  s.reservations.filter((r) => r.status === 'active').forEach((r) => byPos.set(pkey(r.lotId, r.location), (byPos.get(pkey(r.lotId, r.location)) ?? 0) + r.qty));
  byPos.forEach((q, k) => {
    const have = pos.get(k) ?? 0;
    if (q > have) fail('negative_stock', `Invariant failed: reservations at ${k.replace('|', ' / ')} (${fmtKg(q)}) exceed physical ${fmtKg(have)}`);
  });
}

// ---------------------------------------------------------------- execute

export interface ExecResult<T> {
  result: T;
  duplicate: boolean;
  txId: string;
}

/**
 * Run one business command on `db` (already a draft copy). Repeating a command
 * with the same idempotency key returns the original outcome without a second effect.
 */
export function execute<T>(
  db: Db,
  actor: RActor,
  opts: { label: string; key?: string; at?: string; now?: string; ref?: string },
  fn: (ctx: Ctx) => T,
): ExecResult<T> {
  const s = db.rentio as RentioState;
  if (opts.key && s.idempotency[opts.key]) {
    const prior = s.idempotency[opts.key];
    return { result: prior.result as T, duplicate: true, txId: prior.txId };
  }
  const now = opts.now ?? new Date().toISOString();
  if (opts.at && Number.isNaN(Date.parse(opts.at))) fail('validation', 'Enter a valid date and time');
  // a physical event cannot be recorded in the future (5 min allowance for device clock differences)
  if (opts.at && Date.parse(opts.at) > Date.parse(now) + 5 * 60_000) fail('chronology', `Time not possible: ${fmtIst(opts.at)} is in the future. Use the time it actually happened (now or earlier).`);
  // BR-010: a closed period refuses postings dated inside it (corrections go into the current period)
  const period = new Date(Date.parse(opts.at ?? now) + 330 * 60_000).toISOString().slice(0, 7);
  if (s.periodLocks?.some((p) => p.period === period && !p.reopened) && !opts.label.startsWith('Period:'))
    fail('business_rule', `${period} is closed by Accounts. Post a correction dated in the current period, or ask Accounts to reopen ${period} with a reason.`);
  const txId = nextId(s, 'TX', 5);
  const ctx: Ctx = { db, s, actor, now, at: opts.at ?? now, txId, pos: computePositions(s), label: opts.label };
  const result = fn(ctx);
  checkInvariants(s, ctx.pos);
  if (opts.key) s.idempotency[opts.key] = { txId, at: now, result };
  s.txLog.unshift({ id: txId, at: now, actorId: actor.id, label: opts.label, ref: opts.ref });
  if (s.txLog.length > 3000) s.txLog.length = 3000;
  db.audit.unshift({
    id: `aud_${txId}`,
    at: now,
    workspaceId: db.session.workspaceId,
    actorId: actor.id,
    actorRole: actor.roleLabel,
    actorType: 'user',
    action: 'rentio.tx',
    summary: `${opts.label}${opts.ref ? ` · ${opts.ref}` : ''} (${txId})`,
    correlationId: txId,
  });
  if (db.audit.length > 3000) db.audit.length = 3000;
  return { result, duplicate: false, txId };
}
