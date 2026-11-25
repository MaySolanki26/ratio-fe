/**
 * M1 route versions & equipment readiness, M13 decisions/acknowledgements,
 * M15 HR & payroll (restricted), M16 season mode, daily plan and gated forecast.
 */
import { DEMO } from './config';
import { type Ctx, computePositions, fail, nextId, notSelf, requireCap } from './engine';
import { registerApplier, requestApproval } from './ops';
import type { PayrollRun, Punch, StageCode } from './types';
import { fmtKg, kg, rupees, sum } from './units';

// ================================================================ M1 route versions (FR-002, BR-021)

export function activateRoute(ctx: Ctx, r: { stages: StageCode[]; change: string }) {
  requireCap(ctx, 'route.manage', 'activate route versions');
  if (!r.change?.trim()) fail('validation', 'Describe the change');
  if (new Set(r.stages).size !== r.stages.length) fail('validation', 'A normal route cannot repeat a stage (rework loops are configured separately)');
  if (!r.stages.includes('PACK') || r.stages[r.stages.length - 1] !== 'PACK') fail('validation', 'Route must end with Packing');
  const version = ctx.s.route.version + 1;
  ctx.s.route = { version, stages: r.stages, history: [...ctx.s.route.history, { version, at: ctx.at, by: ctx.actor.id, change: r.change }] };
  return version;
}

export function setEquipment(ctx: Ctx, e: { id: string; status: 'released' | 'unavailable'; note?: string }) {
  requireCap(ctx, 'plan.manage', 'change equipment readiness');
  const eq = ctx.s.equipment.find((x) => x.id === e.id) ?? fail('not_found', 'Equipment not found');
  if (e.status === 'unavailable' && !e.note?.trim()) fail('validation', 'Say why the equipment is unavailable');
  eq.status = e.status;
  eq.note = e.note;
  return eq;
}

// ================================================================ M4 loss approval request

export function requestLossApproval(ctx: Ctx, r: { runId: string; lossKg: number; reason: string; evidence: string }) {
  requireCap(ctx, 'stage.operate', 'request loss approval');
  const run = ctx.s.runs.find((x) => x.id === r.runId) ?? fail('not_found', 'Run not found');
  if (!r.reason?.trim() || !r.evidence?.trim()) fail('validation', 'Reason and evidence reference are required');
  return requestApproval(ctx, { type: 'loss_over_tolerance', ref: run.id, summary: `${run.id} ${run.stage}: loss ${fmtKg(kg(r.lossKg))} above tolerance — ${r.reason}`, rule: 'EC-19: above-tolerance loss needs approval with evidence', exposure: fmtKg(kg(r.lossKg)), payload: { runId: run.id, lossKg: r.lossKg, evidence: r.evidence }, requiredCapability: 'approve.residual' });
}

// ================================================================ M13 decisions, alert acknowledgement

export function recordDecision(ctx: Ctx, d: { title: string; answer: string; scope: string; supersedes?: string }) {
  requireCap(ctx, 'decision.record', 'record business decisions');
  if (!d.title?.trim() || !d.answer?.trim()) fail('validation', 'Title and decision are required');
  const dec = { id: nextId(ctx.s, 'DEC'), ...d, by: ctx.actor.id, at: ctx.at };
  ctx.s.decisions.push(dec);
  return dec;
}

/** Acknowledging records who is acting; it never changes stock or resolves the cause. */
export function acknowledgeAlert(ctx: Ctx, key: string, note?: string) {
  if (ctx.s.acks.some((a) => a.key === key && a.by === ctx.actor.id)) fail('duplicate', 'You already acknowledged this alert');
  ctx.s.acks.push({ key, by: ctx.actor.id, at: ctx.at, note });
}

// ================================================================ M15 attendance & payroll

/** Simple 32-bit hash for duplicate file detection. */
export function hashText(t: string) {
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}

/** CSV: employeeId,ISO time,in|out — biometric export or fallback file (FR-083). */
export function importPunches(ctx: Ctx, f: { fileName: string; text: string }) {
  requireCap(ctx, 'hr.attendance', 'import attendance');
  const fileHash = hashText(f.text.trim());
  const prior = ctx.s.imports.find((i) => i.fileHash === fileHash);
  if (prior) fail('duplicate', `This file was already imported as ${prior.id} (${prior.fileName}); hours are counted once`);
  const id = nextId(ctx.s, 'IMP');
  const emps = new Set((ctx.db.records.employees ?? []).map((e) => e.id));
  let accepted = 0;
  let duplicates = 0;
  let invalid = 0;
  const rows = f.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).filter((l) => !/^employee/i.test(l));
  for (const row of rows) {
    const [emp, at, dir] = row.split(',').map((x) => x.trim());
    if (!emps.has(emp) || Number.isNaN(Date.parse(at)) || !['in', 'out'].includes(dir)) {
      invalid++;
      continue;
    }
    const iso = new Date(at).toISOString();
    if (ctx.s.punches.some((p) => p.employeeId === emp && p.at === iso && p.dir === dir)) {
      duplicates++;
      continue;
    }
    ctx.s.punches.push({ id: nextId(ctx.s, 'PCH', 5), employeeId: emp, at: iso, dir: dir as 'in' | 'out', importId: id });
    accepted++;
  }
  const imp = { id, fileName: f.fileName, fileHash, rows: rows.length, accepted, duplicates, invalid, importedBy: ctx.actor.id, at: ctx.at };
  ctx.s.imports.push(imp);
  return imp;
}

/** Pair in/out punches; an overnight shift belongs to the day it started (FR-084, EC-43). */
export function attendanceFor(punches: Punch[], period: string) {
  const byEmp = new Map<string, Punch[]>();
  punches.filter((p) => p.at.slice(0, 7) === period || p.at.slice(0, 7) === nextMonth(period)).forEach((p) => byEmp.set(p.employeeId, [...(byEmp.get(p.employeeId) ?? []), p]));
  const out: Record<string, { days: Set<string>; hours: number; otHours: number; exceptions: string[] }> = {};
  byEmp.forEach((list, emp) => {
    const sorted = [...list].sort((a, b) => a.at.localeCompare(b.at));
    const rec = (out[emp] = { days: new Set<string>(), hours: 0, otHours: 0, exceptions: [] as string[] });
    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i];
      if (p.dir !== 'in') {
        rec.exceptions.push(`Out without in at ${p.at.slice(0, 16)}`);
        continue;
      }
      const o = sorted[i + 1];
      if (!o || o.dir !== 'out') {
        rec.exceptions.push(`Missing out-punch after ${p.at.slice(0, 16)}`);
        continue;
      }
      if (p.at.slice(0, 7) !== period) {
        i++;
        continue;
      }
      const h = (Date.parse(o.at) - Date.parse(p.at)) / 3_600_000;
      rec.days.add(p.at.slice(0, 10));
      rec.hours += h;
      rec.otHours += Math.max(0, h - DEMO.otAfterHours);
      i++;
    }
  });
  return out;
}

const nextMonth = (p: string) => {
  const [y, m] = p.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

export function draftPayroll(ctx: Ctx, period: string) {
  requireCap(ctx, 'hr.payroll', 'prepare payroll');
  const existing = ctx.s.payroll.filter((p) => p.period === period);
  const authorized = existing.find((p) => p.status === 'authorized');
  if (existing.some((p) => p.status === 'draft')) fail('business_rule', 'A draft already exists for this period — review or authorize it');
  const att = attendanceFor(ctx.s.punches, period);
  const lines = (ctx.db.records.employees ?? []).map((e) => {
    const a = att[e.id];
    const days = a?.days.size ?? 0;
    const daily = rupees(Number(e.dailyRate ?? 0));
    const hourly = Math.round(daily / 8);
    const ot = Math.round((a?.otHours ?? 0) * 10) / 10;
    return { employeeId: e.id, days, hours: Math.round((a?.hours ?? 0) * 10) / 10, otHours: ot, gross: days * daily + Math.round(ot * hourly * 1.5), ruleVersion: DEMO.payrollRule };
  });
  const run: PayrollRun = { id: nextId(ctx.s, 'PAY'), period, version: existing.length + 1, status: 'draft', lines, createdBy: ctx.actor.id, createdAt: ctx.at, supersedes: authorized?.id };
  ctx.s.payroll.push(run);
  return run;
}

export function requestPayrollAuthorization(ctx: Ctx, runId: string) {
  requireCap(ctx, 'hr.payroll', 'submit payroll');
  const run = ctx.s.payroll.find((p) => p.id === runId) ?? fail('not_found', 'Payroll run not found');
  if (run.status !== 'draft') fail('business_rule', 'Only a draft can be submitted');
  if (ctx.s.approvals.some((a) => a.ref === run.id && a.status === 'pending')) fail('duplicate', 'Already submitted for authorization');
  return requestApproval(ctx, { type: 'payroll_authorize', ref: run.id, summary: `Payroll ${run.period} v${run.version}: ${run.lines.length} employees`, rule: 'WF-10: payroll requires authorized hand-off by a different user', payload: { runId: run.id, total: sum(run.lines.map((l) => l.gross)) }, requiredCapability: 'payroll.authorize' });
}

registerApplier('payroll_authorize', (ctx, a) => {
  const run = ctx.s.payroll.find((p) => p.id === a.payload.runId)!;
  notSelf(ctx, run.createdBy, `payroll ${run.id}`);
  run.status = 'authorized';
  run.authorizedBy = ctx.actor.id;
});

// ================================================================ M16 season, plan, baseline

export function setSeason(ctx: Ctx, s: { active: boolean; factor: number; escalationHours: number }) {
  requireCap(ctx, 'season.manage', 'change season mode');
  if (!(s.factor > 0) || !(s.escalationHours > 0)) fail('validation', 'Factor and escalation hours must be positive');
  ctx.s.season = { ...s, changedBy: ctx.actor.id, changedAt: ctx.at };
}

export function createPlan(ctx: Ctx, p: { date: string; items: { stage: StageCode; lotId?: string; targetKg: number }[] }) {
  requireCap(ctx, 'plan.manage', 'prepare the daily plan');
  if (!p.items.length) fail('validation', 'Add at least one planned item');
  const blockers = planBlockers(ctx, p.items.map((i) => ({ ...i, targetQty: kg(i.targetKg) })));
  const plan = { id: nextId(ctx.s, 'PLN'), date: p.date, items: p.items.map((i) => ({ stage: i.stage, lotId: i.lotId, targetQty: kg(i.targetKg) })), status: blockers.length ? ('blocked' as const) : ('ready' as const), blockers, createdBy: ctx.actor.id };
  ctx.s.plans.push(plan);
  return plan;
}

/** FR-118: check bags, equipment and available material before a plan is released. */
export function planBlockers(ctx: Pick<Ctx, 's'>, items: { stage: StageCode; lotId?: string; targetQty: number }[]) {
  const pos = computePositions(ctx.s);
  const blockers: string[] = [];
  for (const it of items) {
    ctx.s.equipment.filter((e) => e.stage === it.stage && e.status !== 'released').forEach((e) => blockers.push(`${it.stage}: ${e.label} unavailable${e.note ? ` (${e.note})` : ''} — Factory Head to release`));
    if (it.stage === 'PACK') {
      let bags = 0;
      pos.forEach((q, k) => {
        const [lot, loc] = k.split('|');
        if (loc === 'STORES' && ctx.s.lots[lot]?.material === 'BAGS') bags += q / 1000;
      });
      const need = Math.ceil(it.targetQty / 25000);
      if (bags < need) blockers.push(`PACK: needs ${need} empty 25 kg bags, stores have ${bags} — Godown to replenish`);
    }
  }
  return blockers;
}

export function releasePlan(ctx: Ctx, planId: string) {
  requireCap(ctx, 'plan.manage', 'release the daily plan');
  const plan = ctx.s.plans.find((p) => p.id === planId) ?? fail('not_found', 'Plan not found');
  const blockers = planBlockers(ctx, plan.items);
  plan.blockers = blockers;
  if (blockers.length) {
    plan.status = 'blocked';
    fail('business_rule', `Plan blocked: ${blockers.join('; ')}`);
  }
  plan.status = 'released';
  plan.releasedBy = ctx.actor.id;
  return plan;
}

export function approveBaseline(ctx: Ctx, b: { lots: string[]; yieldPct: number; demoOverride?: boolean }) {
  requireCap(ctx, 'baseline.approve', 'approve the yield baseline');
  if (b.lots.length < DEMO.baselineLotsRequired && !b.demoOverride) fail('business_rule', `Baseline needs ${DEMO.baselineLotsRequired}–30 suitable lots; ${b.lots.length} available (FR-090). Forecast stays “Baseline pending”.`);
  ctx.s.baseline = { approved: true, lots: b.lots, yieldPct: b.yieldPct, approvedBy: ctx.actor.id, approvedAt: ctx.at };
}

export function sendMessage(ctx: Ctx, m: { to: string; text: string; channel: 'WhatsApp' | 'SMS'; fail?: boolean }) {
  ctx.s.messages.unshift({ id: nextId(ctx.s, 'MSG'), at: ctx.at, channel: m.channel, to: m.to, text: m.text, status: m.fail ? 'failed' : 'delivered' });
}
