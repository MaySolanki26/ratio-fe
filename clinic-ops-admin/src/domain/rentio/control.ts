/**
 * Controls added in review round 1: period close (BR-010), retained QC samples (FR-102)
 * and scoped audit export (FR-082 / NFR-10).
 */
import { type RActor, userName } from './access';
import { type Ctx, createLot, ensureLocation, fail, move, nextId, requireCap } from './engine';
import { canReadLoc, readScope } from './scope';
import type { RentioState } from './types';
import { fmtKg, kg } from './units';

const istMonth = (iso: string) => new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 7);

export function lockPeriod(ctx: Ctx, period: string) {
  requireCap(ctx, 'period.lock', 'close accounting periods');
  if (!/^\d{4}-\d{2}$/.test(period)) fail('validation', 'Choose a month (YYYY-MM)');
  if (period >= istMonth(ctx.now)) fail('business_rule', 'Only a past month can be closed');
  const locks = (ctx.s.periodLocks ??= []);
  if (locks.some((p) => p.period === period && !p.reopened)) fail('duplicate', `${period} is already closed`);
  locks.push({ period, by: ctx.actor.id, at: ctx.now });
}

export function reopenPeriod(ctx: Ctx, period: string, reason: string) {
  requireCap(ctx, 'period.lock', 'reopen accounting periods');
  if (!reason?.trim()) fail('validation', 'Reopening needs a reason');
  const lock = ctx.s.periodLocks?.find((p) => p.period === period && !p.reopened) ?? fail('not_found', `${period} is not closed`);
  if (lock.by === ctx.actor.id) fail('self_approval', 'Another authorized user must reopen a month you closed');
  lock.reopened = { by: ctx.actor.id, at: ctx.now, reason: reason.trim() };
}

/** Retained sample: removed from production-available stock into held sample custody (FR-102). */
export function takeSample(ctx: Ctx, r: { lotId: string; loc: string; kg: number; purpose: string }) {
  requireCap(ctx, 'quality.hold', 'take retained samples');
  if (!ctx.s.lots[r.lotId]) fail('not_found', 'Lot not found');
  if (!r.purpose?.trim()) fail('validation', 'Say what the sample is for');
  if (!(r.kg > 0)) fail('validation', 'Sample quantity must be more than 0 kg');
  ensureLocation(ctx.s, { id: 'SAMPLES', label: 'QC retained samples', kind: 'quarantine' });
  const ref = nextId(ctx.s, 'SMP');
  move(ctx, { lotId: r.lotId, qty: kg(r.kg), from: r.loc, to: 'SAMPLES', kind: 'sample', basis: 'Actual', ref, note: r.purpose });
  return { ref, qty: fmtKg(kg(r.kg)) };
}

/** Destructive test / disposal of a retained sample — deducted once. */
export function disposeSample(ctx: Ctx, r: { lotId: string; kg: number; reason: string }) {
  requireCap(ctx, 'quality.release', 'dispose retained samples');
  if (!r.reason?.trim()) fail('validation', 'Give the test or disposal reason');
  move(ctx, { lotId: r.lotId, qty: kg(r.kg), from: 'SAMPLES', kind: 'dispose', basis: 'Actual', ref: nextId(ctx.s, 'SMP'), note: r.reason });
}

export { createLot };

/** Audit rows the actor may export: everything for whole-network roles; otherwise own actions and in-scope movements. */
export function auditRows(s: RentioState, a: RActor) {
  const sc = readScope(a);
  const tx = s.txLog.filter((t) => sc.all || t.actorId === a.id).map((t) => ({ at: t.at, who: userName(t.actorId), what: t.label, ref: t.ref ?? '', id: t.id, outcome: 'posted' }));
  const denied = s.failures.filter((f) => sc.all || f.actorId === a.id).map((f) => ({ at: f.at, who: userName(f.actorId), what: f.action, ref: f.reason, id: f.id, outcome: `blocked (${f.code})` }));
  const moves = s.movements
    .filter((m) => sc.all || (m.from && canReadLoc(s, a, m.from, sc)) || (m.to && canReadLoc(s, a, m.to, sc)))
    .map((m) => ({ at: m.at, who: userName(m.actorId), what: `${m.kind} ${m.lotId} ${fmtKg(m.qty)} ${m.from ?? 'in'} → ${m.to ?? 'out'}`, ref: m.ref, id: m.id, outcome: m.basis }));
  return [...tx, ...denied, ...moves].sort((x, y) => y.at.localeCompare(x.at));
}

export function toCsv(rows: Record<string, string>[], asOf: string) {
  const cols = Object.keys(rows[0] ?? { at: '', who: '', what: '', ref: '', id: '', outcome: '' });
  const cell = (v: string) => {
    const t = /^[=+\-@]/.test(v) ? `'${v}` : v; // spreadsheet formula guard
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [`# Rentio audit export · as of ${asOf} · quantities in kg · local prototype (not tamper-evident)`, cols.join(','), ...rows.map((r) => cols.map((c) => cell(String(r[c] ?? ''))).join(','))].join('\n');
}
