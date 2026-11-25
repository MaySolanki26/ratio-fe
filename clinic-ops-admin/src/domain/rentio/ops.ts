/**
 * M2 Procurement & Intake, M3 Grading, M4 Production & stage tracking,
 * M5 Godown, M6 Inventory and the shared approval inbox.
 * Every function runs inside `execute` (one atomic transaction).
 */
import type { RecordData } from '../../metadata/types';
import { hasCap } from './access';
import { DEMO } from './config';
import { stageInfo } from './data';
import {
  checkAfter,
  type Ctx,
  createLot,
  ensureLocation,
  fail,
  ineligibility,
  move,
  nextId,
  notSelf,
  requireCap,
  requireScope,
} from './engine';
import type { ApprovalType, Basis, EvidencePhoto, Handover, Hold, Intake, Lot, Material, Purchase, RApproval, RunOutput, StageCode, StageRun } from './types';
import { fmtKg, type Grams, kg, rupees, sum, valueOf } from './units';

// ---------------------------------------------------------------- helpers

export const rec = (ctx: Pick<Ctx, 'db'>, resource: string, id: string): RecordData | undefined => ctx.db.records[resource]?.find((r) => r.id === id);

export const stageIn = (st: StageCode) => `STG:${st}:IN`;
export const stageOut = (st: StageCode) => `STG:${st}:OUT`;

export function routeNext(ctx: Ctx, st: StageCode): StageCode | 'F1' {
  const stages = ctx.s.route.stages;
  const i = stages.indexOf(st);
  return i >= 0 && i < stages.length - 1 ? stages[i + 1] : 'F1';
}

function uniqueLotId(ctx: Ctx, base: string) {
  let id = base;
  let n = 2;
  while (ctx.s.lots[id]) id = `${base}-${n++}`;
  return id;
}

const pos = (ctx: Ctx, lotId: string, loc: string) => ctx.pos.get(`${lotId}|${loc}`) ?? 0;

// ================================================================ M2 Procurement & intake

export function createPurchase(
  ctx: Ctx,
  p: { supplierId: string; brokerId?: string; rawType?: string; declaredKg: number; ratePerKg: number; billRef?: string; promisedDate?: string; lotCode?: string },
): Purchase {
  requireCap(ctx, 'purchase.create', 'create purchases');
  if (!rec(ctx, 'suppliers', p.supplierId)) fail('validation', 'Choose a supplier/farmer from the master list');
  if (!(p.declaredKg > 0)) fail('validation', 'Declared quantity must be more than 0 kg');
  if (!(p.ratePerKg > 0)) fail('validation', 'Rate must be more than ₹0/kg');
  let lotCode = p.lotCode?.trim();
  if (lotCode) {
    if (ctx.s.purchases.some((x) => (x as Purchase & { lotCode?: string }).lotCode === lotCode) || ctx.s.lots[lotCode]) fail('conflict', `Lot code ${lotCode} is already used`);
  } else {
    do lotCode = nextId(ctx.s, 'RT', 3);
    while (ctx.s.lots[lotCode] || ctx.s.purchases.some((x) => (x as Purchase & { lotCode?: string }).lotCode === lotCode));
  }
  const purchase: Purchase & { lotCode: string } = {
    id: `PO-${lotCode}`,
    supplierId: p.supplierId,
    brokerId: p.brokerId || undefined,
    rawType: p.rawType ?? 'Whole toor (raw)',
    declaredQty: kg(p.declaredKg),
    ratePerKg: rupees(p.ratePerKg),
    billRef: p.billRef,
    promisedDate: p.promisedDate,
    status: 'open',
    createdAt: ctx.at,
    createdBy: ctx.actor.id,
    lotCode,
  };
  ctx.s.purchases.push(purchase);
  return purchase;
}

export const purchaseLotCode = (p: Purchase) => (p as Purchase & { lotCode?: string }).lotCode ?? p.id.replace(/^PO-/, '');

export function purchaseBalances(s: Ctx['s'], p: Purchase) {
  const intakes = s.intakes.filter((i) => i.purchaseId === p.id);
  const accepted = sum(intakes.map((i) => i.accepted ?? 0));
  const rejected = sum(intakes.map((i) => i.rejected ?? 0));
  const inspecting = sum(intakes.filter((i) => i.status === 'under_inspection').map((i) => i.net));
  const received = sum(intakes.map((i) => i.net));
  return { intakes, accepted, rejected, inspecting, received, open: Math.max(0, p.declaredQty - received) };
}

export function recordIntake(
  ctx: Ctx,
  i: { purchaseId: string; truck: string; slip: string; grossKg: number; tareKg: number; moisturePct?: number; foreignMatterPct?: number; damagePct?: number; evidence?: string[]; photos?: EvidencePhoto[] },
): Intake {
  requireCap(ctx, 'intake.record', 'record truck intake');
  const p = ctx.s.purchases.find((x) => x.id === i.purchaseId) ?? fail('not_found', `Purchase ${i.purchaseId} not found`);
  if (p.status === 'closed' || p.status === 'cancelled') fail('business_rule', `Purchase ${p.id} is ${p.status}; it cannot receive more trucks`);
  if (!i.truck?.trim() || !i.slip?.trim()) fail('validation', 'Truck number and weighbridge slip number are required');
  const gross = kg(i.grossKg);
  const tare = kg(i.tareKg);
  if (gross <= 0 || tare <= 0) fail('validation', 'Gross and tare must both be more than 0 kg (EC-02)');
  if (tare >= gross) fail('validation', 'Tare must be less than gross (EC-02)');
  const slipKey = `${p.supplierId}:${i.slip.trim().toUpperCase()}`;
  const dupe = ctx.s.intakes.find((x) => `${ctx.s.purchases.find((pp) => pp.id === x.purchaseId)?.supplierId}:${x.slip.toUpperCase()}` === slipKey);
  if (dupe) fail('duplicate', `Duplicate weighbridge slip ${i.slip} for this supplier — already used on ${dupe.id} (FR-009). No second receipt was posted.`);
  const photos = (i.photos ?? []).filter((ph) => ph.dataUrl?.startsWith('data:image/'));
  const evidence = i.evidence?.length ? i.evidence : photos.map((ph) => ph.name);
  if (!evidence.length) fail('validation', 'Attach the weighbridge slip photo (BR-004)');
  const net = gross - tare;
  const bal = purchaseBalances(ctx.s, p);
  const allowance = Math.round((p.declaredQty * DEMO.overReceiptPct) / 100);
  if (net > bal.open + allowance) fail('business_rule', `Net ${fmtKg(net)} exceeds the open purchase balance ${fmtKg(bal.open)} (+${DEMO.overReceiptPct}% demo tolerance). Raise a purchase amendment first.`);
  const n = bal.intakes.length + 1;
  const code = purchaseLotCode(p);
  const lotId = n === 1 ? code : `${code}-T${n}`;
  const intake: Intake = {
    id: nextId(ctx.s, 'IN'),
    purchaseId: p.id,
    lotId,
    truck: i.truck.trim().toUpperCase(),
    slip: i.slip.trim().toUpperCase(),
    gross,
    tare,
    net,
    moisturePct: i.moisturePct ?? 0,
    foreignMatterPct: i.foreignMatterPct ?? 0,
    damagePct: i.damagePct ?? 0,
    evidence,
    ...(photos.length ? { photos } : {}),
    status: 'under_inspection',
    makerId: ctx.actor.id,
    createdAt: ctx.at,
  };
  createLot(ctx, {
    id: lotId,
    rootId: lotId,
    material: 'RAW',
    label: `${p.rawType} · ${rec(ctx, 'suppliers', p.supplierId)?.name ?? p.supplierId}`,
    parents: [],
    supplierId: p.supplierId,
    purchaseId: p.id,
    ratePerKg: p.ratePerKg,
    routeVersion: ctx.s.route.version,
    nextStage: 'R1',
  });
  // physical custody starts at the gate, held until an independent checker decides (FR-011, EC-62)
  move(ctx, { lotId, qty: net, to: 'INTAKE', kind: 'intake', basis: 'Actual', ref: intake.id, note: `Slip ${intake.slip}, truck ${intake.truck}` });
  ctx.s.intakes.push(intake);
  p.status = 'partially_received';
  return intake;
}

export function checkIntake(ctx: Ctx, c: { intakeId: string; acceptKg: number; rejectKg?: number; godown?: string; capacityApprovalId?: string }) {
  requireCap(ctx, 'intake.check', 'accept or reject intake');
  const it = ctx.s.intakes.find((x) => x.id === c.intakeId) ?? fail('not_found', `Intake ${c.intakeId} not found`);
  if (it.status !== 'under_inspection') fail('business_rule', `Intake ${it.id} was already decided (${it.status})`);
  notSelf(ctx, it.makerId, `intake ${it.id}`);
  const accept = kg(c.acceptKg);
  const reject = kg(c.rejectKg ?? 0);
  if (accept < 0 || reject < 0) fail('validation', 'Quantities cannot be negative');
  if (accept + reject !== it.net) fail('validation', `Accepted ${fmtKg(accept)} + rejected ${fmtKg(reject)} must equal the net intake ${fmtKg(it.net)} — no quantity can disappear`);
  const godown = c.godown ?? 'R1';
  if (accept > 0) {
    capacityCheck(ctx, godown, accept, c.capacityApprovalId);
    move(ctx, { lotId: it.lotId, qty: accept, from: 'INTAKE', to: godown, kind: 'accept', basis: 'Actual', ref: it.id, note: 'Accepted by independent checker' });
  }
  if (reject > 0) move(ctx, { lotId: it.lotId, qty: reject, from: 'INTAKE', to: 'QUAR', kind: 'reject', basis: 'Actual', ref: it.id, note: 'Rejected at intake — pending disposition' });
  it.accepted = accept;
  it.rejected = reject;
  it.godown = godown;
  it.checkerId = ctx.actor.id;
  it.decidedAt = ctx.at;
  it.status = accept === 0 ? 'rejected' : reject > 0 ? 'partially_accepted' : 'accepted';
  // commercial deduction stays separate from kilograms (EC-04)
  const over = Math.max(0, it.moisturePct - DEMO.moistureDeductionAbovePct);
  const p = ctx.s.purchases.find((x) => x.id === it.purchaseId)!;
  it.valueDeduction = Math.round((valueOf(accept, p.ratePerKg) * over * DEMO.moistureDeductionPerPointPct) / 100);
  ctx.s.lots[it.lotId].nextStage = 'CLEAN';
  const bal = purchaseBalances(ctx.s, p);
  p.status = bal.open === 0 && bal.inspecting === 0 ? 'received' : 'partially_received';
  if (accept > 0) enqueueTally(ctx, 'purchase', it.id, rec(ctx, 'suppliers', p.supplierId)?.name as string, valueOf(accept, p.ratePerKg) - it.valueDeduction);
  return it;
}

export function closePurchase(ctx: Ctx, purchaseId: string, reason: string) {
  requireCap(ctx, 'purchase.create', 'close purchases');
  const p = ctx.s.purchases.find((x) => x.id === purchaseId) ?? fail('not_found', 'Purchase not found');
  if (!reason?.trim()) fail('validation', 'A reason is required to close the open balance');
  const bal = purchaseBalances(ctx.s, p);
  if (bal.inspecting > 0) fail('business_rule', 'An intake is still under inspection');
  p.status = 'closed';
  p.billMatch = p.billMatch;
  return { cancelledOpen: bal.open };
}

/** FR-094: purchase ↔ accepted receipt ↔ bill matching. Stock never changes here. */
export function matchBill(ctx: Ctx, b: { purchaseId: string; billedKg: number; billAmount: number; acceptDifference?: boolean; note?: string }) {
  requireCap(ctx, 'bill.match', 'match supplier bills');
  const p = ctx.s.purchases.find((x) => x.id === b.purchaseId) ?? fail('not_found', 'Purchase not found');
  const bal = purchaseBalances(ctx.s, p);
  p.billedQty = kg(b.billedKg);
  p.billAmount = rupees(b.billAmount);
  const expected = valueOf(bal.accepted, p.ratePerKg);
  const qtyDiff = p.billedQty - bal.accepted;
  const amtDiff = p.billAmount - expected;
  const matched = qtyDiff === 0 && Math.abs(amtDiff) <= 100;
  p.billMatch = { status: matched ? 'matched' : b.acceptDifference ? 'accepted_difference' : 'disputed', note: b.note ?? (matched ? 'Bill matches accepted receipts' : `Billed ${fmtKg(p.billedQty)} vs accepted ${fmtKg(bal.accepted)}`), by: ctx.actor.id, at: ctx.at };
  return { qtyDiff, amtDiff, status: p.billMatch.status };
}

// ================================================================ capacity (FR-028, BR-013)

export function capacityUsed(ctx: Ctx, loc: string) {
  let total = 0;
  ctx.pos.forEach((q, k) => {
    const l = k.split('|')[1];
    if (l === loc || ctx.s.locations[l]?.godown === loc) total += q;
  });
  return total;
}

export function capacityCheck(ctx: Ctx, loc: string, add: Grams, approvalId?: string) {
  const l = ctx.s.locations[loc];
  // capacity is maintained on the Godowns & stacks master (M1); the plant template is the fallback
  const master = rec(ctx, 'locations', loc);
  const capacity = master ? kg(Number(master.capacityKg ?? 0)) : l?.capacity ?? 0;
  if (!capacity) return;
  const used = capacityUsed(ctx, loc);
  if (used + add <= capacity) return;
  const ok = approvalId && ctx.s.approvals.some((a) => a.id === approvalId && a.type === 'capacity_override' && a.status === 'approved' && a.payload.location === loc);
  if (!ok) fail('business_rule', `${l?.label ?? loc} capacity ${fmtKg(capacity)} would be exceeded (${fmtKg(used)} + ${fmtKg(add)}). Request a capacity approval before placement (FR-028).`);
}

// ================================================================ M4 Handover (issue / receive)

function stageOwnerCheck(ctx: Ctx, st: StageCode, what: string) {
  requireCap(ctx, 'stage.operate', what);
  requireScope(ctx, 'stages', st, what);
}

/** Who may issue from a location. */
function issueGuard(ctx: Ctx, fromLoc: string) {
  const l = ctx.s.locations[fromLoc] ?? fail('not_found', `Unknown location ${fromLoc}`);
  if (l.kind === 'stage-out' && l.stage) return stageOwnerCheck(ctx, l.stage, `issue from ${l.label}`);
  if (['raw', 'finished', 'stores', 'byproduct', 'quarantine'].includes(l.kind) || l.godown) {
    requireCap(ctx, 'godown.operate', `issue from ${l.label}`);
    return;
  }
  fail('business_rule', `Material cannot be issued from ${l.label}`);
}

export function issue(ctx: Ctx, h: { lotId: string; fromLoc: string; qtyKg: number; toStage: StageCode | 'F1'; basis?: Basis; toLoc?: string }): Handover {
  issueGuard(ctx, h.fromLoc);
  const lot = ctx.s.lots[h.lotId] ?? fail('not_found', `Lot ${h.lotId} not found`);
  if (ctx.s.lots[h.lotId].nextStage !== h.toStage) fail('business_rule', `Route ${lot.routeVersion ? `v${lot.routeVersion}` : ''} sends ${lot.id} to ${lot.nextStage ?? '—'} next; issuing to ${h.toStage} would skip or reverse the approved route (FR-025).`);
  const held = ineligibility(ctx.s, h.lotId, 'F1', ctx.at).filter((r) => r.includes('hold'));
  if (held.length && h.toStage !== 'F1') fail('business_rule', `${lot.id} is on hold — ${held[0]}`);
  const locHold = ctx.s.holds.find((x) => x.status === 'active' && x.scope === 'location' && (x.target === h.fromLoc || x.target === ctx.s.locations[h.fromLoc]?.godown));
  if (locHold) fail('business_rule', `${ctx.s.locations[h.fromLoc]?.label ?? h.fromLoc} is under ${locHold.kind} hold ${locHold.id} (${locHold.reason}); normal movement is blocked until authorized release (FR-100).`);
  const qty = kg(h.qtyKg);
  const id = nextId(ctx.s, 'HO');
  const pend = ensureLocation(ctx.s, { id: `PEND:${id}`, label: `Pending handover ${id}`, kind: 'pending', dynamic: true });
  const toLoc = h.toStage === 'F1' ? h.toLoc ?? 'F1' : stageIn(h.toStage);
  move(ctx, { lotId: h.lotId, qty, from: h.fromLoc, to: pend.id, kind: 'issue', basis: h.basis ?? 'Carried', ref: id });
  const ho: Handover = { id, lotId: h.lotId, fromLoc: h.fromLoc, toLoc, toStage: h.toStage, qty, basis: h.basis ?? 'Carried', issuedBy: ctx.actor.id, issuedAt: ctx.at, received: 0, receipts: [], settled: [], status: 'awaiting' };
  ctx.s.handovers.push(ho);
  return ho;
}

export const outstanding = (h: Handover) => h.qty - h.received - sum(h.settled.map((x) => x.qty));

/** Receiver confirms independently; finished-goods receipt can split across stacks (FR-099). */
export function receive(ctx: Ctx, r: { handoverId: string; qtyKg?: number; stacks?: { loc: string; kg: number; bags?: number }[]; note?: string; capacityApprovalId?: string }) {
  const h = ctx.s.handovers.find((x) => x.id === r.handoverId) ?? fail('not_found', `Handover ${r.handoverId} not found`);
  if (h.toStage === 'F1') requireCap(ctx, 'godown.operate', 'receive into the finished godown');
  else stageOwnerCheck(ctx, h.toStage as StageCode, `receive at ${stageInfo(h.toStage as StageCode).label}`);
  const out = outstanding(h);
  if (out <= 0) fail('duplicate', `Handover ${h.id} is already fully received — nothing outstanding`);
  const targets = h.toStage === 'F1' ? (r.stacks?.length ? r.stacks : [{ loc: h.toLoc, kg: r.qtyKg ?? out / 1000 }]) : [{ loc: h.toLoc, kg: r.qtyKg ?? out / 1000 }];
  const total = sum(targets.map((t) => kg(t.kg)));
  if (total <= 0) fail('validation', 'Enter the quantity actually received');
  if (total > out) fail('business_rule', `Received ${fmtKg(total)} exceeds the outstanding ${fmtKg(out)}. Excess must be recorded as unidentified stock for investigation, not added to this handover.`);
  for (const t of targets) {
    const q = kg(t.kg);
    if (q <= 0) continue;
    if (h.toStage === 'F1') {
      const l = ctx.s.locations[t.loc];
      if (!l || l.kind !== 'finished') fail('validation', `${t.loc} is not a finished-goods stack`);
      capacityCheck(ctx, t.loc, q, r.capacityApprovalId);
    }
    move(ctx, { lotId: h.lotId, qty: q, from: `PEND:${h.id}`, to: t.loc, kind: 'receive', basis: h.basis, ref: h.id, note: r.note });
    h.receipts.push({ qty: q, by: ctx.actor.id, at: ctx.at, to: t.loc, note: r.note });
  }
  h.received += total;
  h.status = outstanding(h) === 0 ? 'received' : 'partial';
  if (h.toStage === 'F1') ctx.s.lots[h.lotId].nextStage = undefined;
  return { received: total, residual: outstanding(h) };
}

/** Residual handover settlement needs an approved decision (WF-04). */
export function requestResidualSettlement(ctx: Ctx, r: { handoverId: string; how: 'loss' | 'located' | 'returned'; reason: string }) {
  requireCap(ctx, 'handover.settle.request', 'request residual settlement');
  const h = ctx.s.handovers.find((x) => x.id === r.handoverId) ?? fail('not_found', 'Handover not found');
  const out = outstanding(h);
  if (out <= 0) fail('business_rule', 'Nothing outstanding on this handover');
  if (!r.reason?.trim()) fail('validation', 'Give the evidence-based reason');
  if (ctx.s.approvals.some((a) => a.type === 'residual_loss' && a.ref === h.id && a.status === 'pending')) fail('duplicate', 'A settlement request for this handover is already pending');
  return requestApproval(ctx, {
    type: 'residual_loss',
    ref: h.id,
    summary: `Settle ${fmtKg(out)} residual on ${h.id} (${h.lotId}) as ${r.how}`,
    rule: 'WF-04: unresolved handover residual requires an approved settlement',
    exposure: fmtKg(out),
    payload: { handoverId: h.id, how: r.how, qty: out, reason: r.reason },
    requiredCapability: 'approve.residual',
  });
}

export function applyResidual(ctx: Ctx, a: RApproval) {
  const h = ctx.s.handovers.find((x) => x.id === a.payload.handoverId)!;
  const qty = Math.min(Number(a.payload.qty), outstanding(h));
  if (qty <= 0) fail('business_rule', 'Residual already settled');
  const how = a.payload.how as 'loss' | 'located' | 'returned';
  if (how === 'loss') move(ctx, { lotId: h.lotId, qty, from: `PEND:${h.id}`, kind: 'loss', basis: 'Actual', ref: a.id, note: `Approved handover loss: ${a.payload.reason}` });
  else if (how === 'located') move(ctx, { lotId: h.lotId, qty, from: `PEND:${h.id}`, to: h.toLoc, kind: 'receive', basis: 'Actual', ref: a.id, note: 'Located and received after investigation' });
  else move(ctx, { lotId: h.lotId, qty, from: `PEND:${h.id}`, to: h.fromLoc, kind: 'reversal', basis: 'Actual', ref: a.id, note: 'Returned to sender (verified not moved)' });
  h.settled.push({ qty, how, approvalId: a.id, by: ctx.actor.id, at: ctx.at });
  h.status = outstanding(h) === 0 ? 'settled' : h.status;
}

// ================================================================ M4 Stage runs

export function startRun(ctx: Ctx, r: { stage: StageCode; lotId: string; qtyKg?: number }): StageRun {
  stageOwnerCheck(ctx, r.stage, `start a ${stageInfo(r.stage).label} run`);
  const lot = ctx.s.lots[r.lotId] ?? fail('not_found', `Lot ${r.lotId} not found`);
  if (lot.nextStage !== r.stage) fail('business_rule', `${lot.id} is routed to ${lot.nextStage}, not ${r.stage} (FR-025)`);
  const inLoc = stageIn(r.stage);
  const have = pos(ctx, r.lotId, inLoc);
  if (have <= 0) fail('business_rule', `${lot.id} has not been received at ${stageInfo(r.stage).label}. Receive the handover first.`);
  const qty = r.qtyKg ? kg(r.qtyKg) : have;
  if (qty > have) fail('negative_stock', `Only ${fmtKg(have)} of ${lot.id} is queued at this stage`);
  const holds = ineligibility(ctx.s, r.lotId, 'F1', ctx.at).filter((x) => x.includes('hold'));
  if (holds.length) fail('business_rule', `Cannot start: ${holds[0]}`);
  // FR-096: readiness — required equipment must be released
  const blocked = ctx.s.equipment.filter((e) => e.stage === r.stage && e.status !== 'released');
  if (blocked.length) fail('business_rule', `Readiness check failed: ${blocked.map((e) => `${e.label} is ${e.status}${e.note ? ` (${e.note})` : ''}`).join('; ')}. Factory Head must release it before this run starts.`);
  const info = stageInfo(r.stage);
  const factor = ctx.s.season.active ? ctx.s.season.factor : 1;
  const planned = Math.round(info.plannedMinutes * factor);
  const id = nextId(ctx.s, 'RUN');
  ensureLocation(ctx.s, { id: `RUN:${id}`, label: `${info.label} run ${id}`, kind: 'run', stage: r.stage, dynamic: true });
  move(ctx, { lotId: r.lotId, qty, from: inLoc, to: `RUN:${id}`, kind: 'take', basis: 'Carried', ref: id });
  const run: StageRun = {
    id,
    stage: r.stage,
    pass: lot.pass ?? 1,
    inputLotId: r.lotId,
    inputQty: qty,
    takenFrom: inLoc,
    routeVersion: lot.routeVersion ?? ctx.s.route.version,
    ownerId: info.owner,
    backupId: info.backup,
    plannedMinutes: planned,
    seasonFactor: factor,
    baselineFinish: new Date(Date.parse(ctx.at) + planned * 60_000).toISOString(),
    events: [{ type: 'start', at: ctx.at, by: ctx.actor.id }],
    status: 'running',
    additions: [],
    outputs: [],
  };
  ctx.s.runs.push(run);
  return run;
}

export function holdRun(ctx: Ctx, runId: string, reason: string) {
  const run = ctx.s.runs.find((x) => x.id === runId) ?? fail('not_found', 'Run not found');
  stageOwnerCheck(ctx, run.stage, 'hold this run');
  if (run.status !== 'running') fail('business_rule', `Run is ${run.status}`);
  if (!reason?.trim()) fail('validation', 'A hold needs a reason (weather, machine, quality…)');
  checkAfter(run.events[run.events.length - 1].at, ctx.at, 'the hold');
  run.events.push({ type: 'hold', at: ctx.at, by: ctx.actor.id, reason });
  run.status = 'on_hold';
  return run;
}

export function resumeRun(ctx: Ctx, runId: string) {
  const run = ctx.s.runs.find((x) => x.id === runId) ?? fail('not_found', 'Run not found');
  stageOwnerCheck(ctx, run.stage, 'resume this run');
  if (run.status !== 'on_hold') fail('business_rule', 'Run is not on hold');
  checkAfter(run.events[run.events.length - 1].at, ctx.at, 'resuming');
  run.events.push({ type: 'resume', at: ctx.at, by: ctx.actor.id });
  run.status = 'running';
  return run;
}

export interface OutputInput {
  kind: RunOutput['kind'];
  kg: number;
  grade?: string;
  reason?: string;
}

const MATERIAL: Record<string, Material> = { forward: 'WIP', rework: 'REWORK', husk: 'HUSK', churi: 'CHURI', reject: 'REJECT' };

/** Balance preview used by the UI and enforced here (BR-005, FR-016/020). */
export function runBalance(run: Pick<StageRun, 'inputQty'>, outputs: { kind: string; qty: Grams }[], additions: Grams) {
  const accounted = sum(outputs.map((o) => o.qty));
  return { input: run.inputQty + additions, accounted, difference: run.inputQty + additions - accounted };
}

export function recordOutput(
  ctx: Ctx,
  o: {
    runId: string;
    outputs: OutputInput[];
    additions?: { lotId: string; kg: number }[];
    packing?: { bagSizeKg: number; bagsLotId: string; checks: { netWeight: boolean; seal: boolean; label: boolean } };
    lossApprovalId?: string;
  },
) {
  const run = ctx.s.runs.find((x) => x.id === o.runId) ?? fail('not_found', 'Run not found');
  stageOwnerCheck(ctx, run.stage, 'record output');
  if (run.status === 'completed') fail('duplicate', `Run ${run.id} output was already posted`);
  if (run.status === 'on_hold') fail('business_rule', 'Resume the run before posting output');
  checkAfter(run.events[run.events.length - 1].at, ctx.at, 'finishing the run');
  const info = stageInfo(run.stage);
  const input = ctx.s.lots[run.inputLotId];
  const outs: RunOutput[] = o.outputs.filter((x) => x.kg > 0).map((x) => ({ kind: x.kind, qty: kg(x.kg), grade: x.grade?.trim() || undefined, basis: x.kind === 'loss' ? 'Actual' : info.basis, reason: x.reason }));
  const adds = (o.additions ?? []).filter((a) => a.kg > 0).map((a) => ({ lotId: a.lotId, qty: kg(a.kg) }));
  const addTotal = sum(adds.map((a) => a.qty));
  const bal = runBalance(run, outs, addTotal);
  if (bal.difference !== 0)
    fail('business_rule', `Unbalanced: input ${fmtKg(run.inputQty)}${addTotal ? ` + additions ${fmtKg(addTotal)}` : ''} = ${fmtKg(bal.input)}, but outputs account for ${fmtKg(bal.accounted)} (difference ${fmtKg(bal.difference)}). Classify every kilogram as product, rework, by-product, reject, loss or residual — no automatic balancing loss (BR-005).`);
  if (!outs.some((x) => x.kind === 'forward' || x.kind === 'rework' || x.kind === 'residual')) fail('validation', 'Record at least one forward, rework or residual quantity');
  const loss = sum(outs.filter((x) => x.kind === 'loss').map((x) => x.qty));
  const lossPct = (loss * 100) / bal.input;
  if (loss > 0 && lossPct > info.tolerancePct) {
    const ok = o.lossApprovalId && ctx.s.approvals.some((a) => a.id === o.lossApprovalId && a.type === 'loss_over_tolerance' && a.status === 'approved' && a.payload.runId === run.id);
    if (!ok) fail('business_rule', `Loss ${fmtKg(loss)} (${lossPct.toFixed(2)}%) exceeds the ${info.label} tolerance of ${info.tolerancePct}% (demo). Request loss approval with evidence (EC-19).`);
  }
  if (outs.some((x) => x.kind === 'loss' && !x.reason?.trim()) && run.stage !== 'DRY') {
    // reason optional for drying where the category is "moisture loss"
  }
  // consume input (residual goes back to the queue)
  const residual = sum(outs.filter((x) => x.kind === 'residual').map((x) => x.qty));
  const runLoc = `RUN:${run.id}`;
  if (residual) move(ctx, { lotId: input.id, qty: residual, from: runLoc, to: run.takenFrom, kind: 'residual', basis: 'Carried', ref: run.id, note: 'Unprocessed residual returned to queue' });
  if (loss) move(ctx, { lotId: input.id, qty: loss, from: runLoc, kind: 'loss', basis: 'Actual', ref: run.id, note: outs.find((x) => x.kind === 'loss')?.reason ?? `${info.label} loss` });
  const consumed = run.inputQty - residual - loss;
  if (consumed > 0) move(ctx, { lotId: input.id, qty: consumed, from: runLoc, kind: 'consume', basis: 'Carried', ref: run.id });
  for (const a of adds) {
    const al = ctx.s.lots[a.lotId] ?? fail('not_found', `Addition lot ${a.lotId} not found`);
    if (al.material !== 'OIL') fail('validation', `${al.id} is not an approved process addition`);
    move(ctx, { lotId: a.lotId, qty: a.qty, from: 'STORES', kind: 'addition', basis: 'Actual', ref: run.id, note: `Issued from stores into ${input.id}` });
    run.additions.push({ lotId: a.lotId, qty: a.qty, material: al.material });
  }
  const parents = [{ lotId: input.id, qty: consumed }, ...adds.map((a) => ({ lotId: a.lotId, qty: a.qty }))].filter((p) => p.qty > 0);
  const forwards = outs.filter((x) => x.kind === 'forward');
  const isPack = run.stage === 'PACK';
  for (const out of outs) {
    if (out.kind === 'loss' || out.kind === 'residual') continue;
    const mat: Material = isPack && out.kind === 'forward' ? 'PACKED' : out.kind === 'forward' && (run.stage === 'G2' || run.stage === 'PEEL') ? 'DAL' : MATERIAL[out.kind];
    const grade = out.grade ?? input.grade;
    let base: string;
    if (out.kind === 'forward') base = isPack ? `${input.rootId}/${grade}-PK` : run.stage === 'G2' || (run.stage === 'G1' && forwards.length > 1) ? `${input.rootId}/${grade}` : `${input.rootId}/${run.stage}${run.pass > 1 ? run.pass : ''}`;
    else if (out.kind === 'rework') base = `${input.rootId}/RW${run.pass}`;
    else base = `${input.rootId}/${out.kind.toUpperCase()}-${run.stage}${run.pass > 1 ? run.pass : ''}`;
    const id = uniqueLotId(ctx, base);
    const dest = out.kind === 'forward' || out.kind === 'rework' ? stageOut(run.stage) : out.kind === 'reject' ? 'QUAR' : 'BYP';
    const lot: Omit<Lot, 'createdAt' | 'createdBy'> = {
      id,
      rootId: input.rootId,
      material: mat,
      label: `${mat === 'PACKED' ? 'Packed dal' : mat === 'DAL' ? 'Dal' : mat === 'REWORK' ? 'Unpeeled rework' : mat === 'WIP' ? `${info.label} output` : mat.charAt(0) + mat.slice(1).toLowerCase()}${grade ? ` ${grade}` : ''}`,
      grade,
      parents: parents.map((p) => ({ ...p, qty: Math.round((p.qty * out.qty) / (consumed + addTotal || 1)) })),
      pass: out.kind === 'rework' ? run.pass + 1 : run.pass,
      createdByRun: run.id,
      routeVersion: run.routeVersion,
      nextStage: out.kind === 'forward' ? routeNext(ctx, run.stage) : out.kind === 'rework' ? run.stage : undefined,
    };
    if (isPack && out.kind === 'forward') {
      const pk = o.packing ?? fail('validation', 'Packing details are required');
      const bagSize = kg(pk.bagSizeKg);
      if (out.qty % bagSize !== 0) fail('validation', `${fmtKg(out.qty)} is not a whole number of ${fmtKg(bagSize)} bags`);
      const bags = out.qty / bagSize;
      lot.bags = bags;
      lot.bagSize = bagSize;
      lot.sku = `SKU-${grade}-${pk.bagSizeKg}`;
      lot.mfgDate = ctx.at.slice(0, 10);
      lot.expiry = new Date(Date.parse(ctx.at) + DEMO.shelfLifeDays * 86_400_000).toISOString().slice(0, 10);
      const sku = rec(ctx, 'skus', lot.sku);
      if (!sku || sku.active === false) fail('business_rule', `SKU ${lot.sku} is not an active combination (FR-001)`);
      // packaging is stores consumption — never added to food mass (BR-028)
      move(ctx, { lotId: pk.bagsLotId, qty: bags * 1000, from: 'STORES', kind: 'pack-material', basis: 'Counted', ref: run.id, note: `${bags} empty bags (count ×1000 g units)` });
      run.packing = { bags, bagSize, packagingLotId: pk.bagsLotId, sku: lot.sku };
    }
    createLot(ctx, lot);
    move(ctx, { lotId: id, qty: out.qty, to: dest, kind: 'produce', basis: out.basis, ref: run.id });
    out.lotId = id;
    if (isPack && out.kind === 'forward' && o.packing && !(o.packing.checks.netWeight && o.packing.checks.seal && o.packing.checks.label)) {
      const failed = Object.entries(o.packing.checks).filter(([, v]) => !v).map(([k]) => k).join(', ');
      ctx.s.holds.push({ id: nextId(ctx.s, 'HLD'), scope: 'lot', target: id, reason: `Packing release check failed: ${failed}`, kind: 'quality', status: 'active', createdAt: ctx.at, createdBy: ctx.actor.id });
    }
  }
  run.outputs = outs;
  run.events.push({ type: 'complete', at: ctx.at, by: ctx.actor.id });
  run.status = 'completed';
  run.completedAt = ctx.at;
  return run;
}

/** Timing per §16 timing contract. */
export function runTiming(run: StageRun, nowIso: string) {
  let active = 0;
  let held = 0;
  let last: { type: string; at: string } | null = null;
  for (const e of run.events) {
    if (last) {
      const d = Date.parse(e.at) - Date.parse(last.at);
      if (last.type === 'start' || last.type === 'resume') active += d;
      if (last.type === 'hold') held += d;
    }
    last = e;
  }
  const open = run.status !== 'completed';
  if (open && last) {
    const d = Date.parse(nowIso) - Date.parse(last.at);
    if (run.status === 'running') active += d;
    else held += d;
  }
  const finish = run.completedAt ?? nowIso;
  const start = run.events[0].at;
  const now = Date.parse(nowIso);
  const base = Date.parse(run.baselineFinish);
  // Forecast is only shown when someone can stand behind it: a named revised ETA, or the baseline
  // moved by recorded hold time while that is still in the future. An overdue run has NO forecast
  // ("ETA needs update") — never "now", which would look like a promise.
  const revision = run.etaRevisions?.[run.etaRevisions.length - 1];
  let forecast: string | undefined;
  let etaSource: 'actual' | 'baseline' | 'hold-adjusted' | 'revised' | 'needs_update';
  if (!open) {
    forecast = finish;
    etaSource = 'actual';
  } else if (revision && Date.parse(revision.eta) > now) {
    forecast = revision.eta;
    etaSource = 'revised';
  } else if (base + held > now) {
    forecast = new Date(base + held).toISOString();
    etaSource = held > 0 ? 'hold-adjusted' : 'baseline';
  } else {
    forecast = undefined;
    etaSource = 'needs_update';
  }
  /** Measured lateness: completed → finish − baseline; open → time already past baseline. */
  const delayMs = Math.max(0, (open ? now : Date.parse(finish)) - base);
  const projectedDelayMs = forecast ? Math.max(0, Date.parse(forecast) - base) : undefined;
  const status = run.status === 'on_hold' ? 'On Hold' : !open ? (delayMs > 0 ? 'Completed late' : 'Completed') : now > base ? 'Delayed' : forecast && Date.parse(forecast) > base ? 'At Risk' : 'On Track';
  return { start, baselineFinish: run.baselineFinish, forecastFinish: forecast, etaSource, etaRevision: etaSource === 'revised' ? revision : undefined, actualFinish: run.completedAt, activeMs: active, heldMs: held, elapsedMs: Date.parse(finish) - Date.parse(start), delayMs, projectedDelayMs, status };
}

/** A named person supplies a revised ETA with a reason; history is kept and the baseline is never changed (FR-073). */
export function reviseEta(ctx: Ctx, r: { runId: string; eta: string; reason: string }) {
  const run = ctx.s.runs.find((x) => x.id === r.runId) ?? fail('not_found', 'Run not found');
  if (!hasCap(ctx.actor, 'plan.manage')) stageOwnerCheck(ctx, run.stage, 'revise the ETA for this run');
  if (run.status === 'completed') fail('business_rule', 'The run is already completed — its actual finish is recorded');
  if (!r.reason?.trim()) fail('validation', 'Say why the finish time changed and what it depends on');
  if (Number.isNaN(Date.parse(r.eta)) || Date.parse(r.eta) <= Date.parse(ctx.now)) fail('validation', 'The revised finish must be in the future');
  run.etaRevisions = [...(run.etaRevisions ?? []), { at: ctx.now, by: ctx.actor.id, eta: new Date(r.eta).toISOString(), reason: r.reason.trim() }];
  return run;
}

// ================================================================ M3 re-grade

export function requestRegrade(ctx: Ctx, r: { lotId: string; newGrade: string; reason: string }) {
  if (!hasCap(ctx.actor, 'quality.hold') && !hasCap(ctx.actor, 'stage.operate')) fail('forbidden', `${ctx.actor.roleLabel} cannot request a re-grade`);
  const lot = ctx.s.lots[r.lotId] ?? fail('not_found', 'Lot not found');
  if (!r.reason?.trim()) fail('validation', 'A re-grade needs a reason (FR-015)');
  return requestApproval(ctx, { type: 'regrade', ref: lot.id, summary: `Re-grade ${lot.id} from ${lot.grade} to ${r.newGrade}`, rule: 'FR-015 / BR-003: grade change requires maker-checker', payload: { lotId: lot.id, from: lot.grade, to: r.newGrade, reason: r.reason }, requiredCapability: 'approve.regrade' });
}

// ================================================================ M5/M6 holds, transfers, counts, by-products

export function placeHold(ctx: Ctx, h: { scope: 'lot' | 'location'; target: string; reason: string; kind: Hold['kind'] }) {
  if (h.scope === 'lot') requireCap(ctx, 'quality.hold', 'place a quality hold');
  else requireCap(ctx, 'location.hold', 'place a location hold');
  if (!h.reason?.trim()) fail('validation', 'A hold needs a reason');
  if (h.scope === 'lot' && !ctx.s.lots[h.target]) fail('not_found', 'Lot not found');
  if (h.scope === 'location' && !ctx.s.locations[h.target]) fail('not_found', 'Location not found');
  const hold: Hold = { id: nextId(ctx.s, 'HLD'), scope: h.scope, target: h.target, reason: h.reason, kind: h.kind, status: 'active', createdAt: ctx.at, createdBy: ctx.actor.id };
  ctx.s.holds.push(hold);
  return hold;
}

export function releaseHold(ctx: Ctx, r: { holdId: string; branchLotId?: string; note?: string }) {
  const h = ctx.s.holds.find((x) => x.id === r.holdId) ?? fail('not_found', 'Hold not found');
  if (h.status !== 'active') fail('business_rule', 'Hold already released');
  requireCap(ctx, h.scope === 'lot' ? 'quality.release' : 'location.hold', 'release this hold');
  if (h.scope === 'location' && !hasCap(ctx.actor, 'quality.release') && h.kind === 'treatment') fail('forbidden', 'A treatment hold needs QC release after the treatment evidence is recorded (WF-13)');
  notSelf(ctx, h.createdBy, `hold ${h.id}`);
  if (r.branchLotId) {
    h.releasedBranches = [...(h.releasedBranches ?? []), r.branchLotId];
    h.releaseNote = [h.releaseNote, `${r.branchLotId} released by ${ctx.actor.name}${r.note ? `: ${r.note}` : ''}`].filter(Boolean).join(' · ');
  } else {
    h.status = 'released';
    h.releasedAt = ctx.at;
    h.releasedBy = ctx.actor.id;
    h.releaseNote = r.note;
  }
  return h;
}

/** Direct stack-to-stack / godown move inside the factory (same custodian). */
export function transferStock(ctx: Ctx, t: { lotId: string; from: string; to: string; kg: number; capacityApprovalId?: string }) {
  requireCap(ctx, 'godown.operate', 'transfer stock between locations');
  const q = kg(t.kg);
  const reserved = ctx.s.reservations.filter((r) => r.status === 'active' && r.lotId === t.lotId && r.location === t.from).reduce((a, r) => a + r.qty, 0);
  if (pos(ctx, t.lotId, t.from) - reserved < q) fail('negative_stock', `Only ${fmtKg(pos(ctx, t.lotId, t.from) - reserved)} unreserved at ${t.from}`);
  capacityCheck(ctx, t.to, q, t.capacityApprovalId);
  move(ctx, { lotId: t.lotId, qty: q, from: t.from, to: t.to, kind: 'transfer', basis: 'Counted', ref: nextId(ctx.s, 'TRF') });
}

export function internalUse(ctx: Ctx, u: { lotId: string; loc: string; kg: number; purpose: string }) {
  requireCap(ctx, 'byproduct.use', 'record by-product internal use');
  const lot = ctx.s.lots[u.lotId] ?? fail('not_found', 'Lot not found');
  if (!['HUSK', 'CHURI'].includes(lot.material)) fail('validation', 'Internal use applies to Husk/Churi by-products');
  if (!DEMO.internalPurposes.includes(u.purpose)) fail('validation', 'Choose a configured internal-use purpose (A7)');
  const reasons = ineligibility(ctx.s, u.lotId, u.loc, ctx.at);
  if (reasons.length) fail('business_rule', `Not usable: ${reasons[0]}`);
  const ref = nextId(ctx.s, 'USE');
  move(ctx, { lotId: u.lotId, qty: kg(u.kg), from: u.loc, kind: 'internal-use', basis: 'Actual', ref, note: u.purpose });
  return ref;
}

/** WF-08 count against a snapshot; the difference is posted only after checker approval. */
export function submitCount(ctx: Ctx, c: { lotId: string; loc: string; countedKg: number; snapshotKg?: number }) {
  requireCap(ctx, c.loc.startsWith('DIST:') ? 'distributor.operate' : 'godown.operate', 'submit a physical count');
  if (c.loc.startsWith('DIST:')) requireScope(ctx, 'distributors', c.loc.split(':')[1], 'count this distributor stock');
  const snap = c.snapshotKg !== undefined ? kg(c.snapshotKg) : pos(ctx, c.lotId, c.loc);
  const counted = kg(c.countedKg);
  const difference = counted - snap;
  const id = nextId(ctx.s, 'CNT');
  const count: import('./types').StockCount = { id, location: c.loc, lotId: c.lotId, snapshot: snap, snapshotAt: ctx.at, counted, movementsAfter: 0, difference, status: 'pending_approval', countedBy: ctx.actor.id };
  ctx.s.counts.push(count);
  if (difference === 0) {
    count.status = 'posted';
    return count;
  }
  const ap = requestApproval(ctx, { type: 'stock_adjustment', ref: id, summary: `Count ${id}: ${c.lotId} at ${c.loc} counted ${fmtKg(counted)} vs snapshot ${fmtKg(snap)} → adjust ${difference > 0 ? '+' : ''}${fmtKg(difference)}`, rule: 'BR-003 / WF-08: count adjustment requires checker approval', exposure: fmtKg(Math.abs(difference)), payload: { countId: id, lotId: c.lotId, loc: c.loc, difference }, requiredCapability: 'approve.adjustment' });
  count.approvalId = ap.id;
  return count;
}

// ================================================================ approvals (maker-checker)

export function requestApproval(ctx: Ctx, a: { type: ApprovalType; ref: string; summary: string; rule: string; payload: Record<string, unknown>; requiredCapability: string; exposure?: string; ownerOnly?: boolean }): RApproval {
  const ap: RApproval = { id: nextId(ctx.s, 'APR'), status: 'pending', requestedBy: ctx.actor.id, requestedAt: ctx.at, ...a };
  ctx.s.approvals.push(ap);
  return ap;
}

export type ApprovalApplier = (ctx: Ctx, a: RApproval) => void;
const appliers: Partial<Record<ApprovalType, ApprovalApplier>> = {
  residual_loss: applyResidual,
  stock_adjustment: (ctx, a) => {
    const c = ctx.s.counts.find((x) => x.id === a.payload.countId)!;
    const d = Number(a.payload.difference);
    if (d < 0) move(ctx, { lotId: c.lotId, qty: -d, from: c.location, kind: 'adjust', basis: 'Counted', ref: a.id, note: `Approved count adjustment ${c.id}` });
    else move(ctx, { lotId: c.lotId, qty: d, to: c.location, kind: 'adjust', basis: 'Counted', ref: a.id, note: `Approved found stock ${c.id}` });
    c.status = 'posted';
  },
  regrade: (ctx, a) => {
    const lot = ctx.s.lots[String(a.payload.lotId)];
    lot.grade = String(a.payload.to);
    lot.label = `${lot.label.replace(/ [A-Z]\d$/, '')} ${lot.grade}`;
  },
  capacity_override: () => undefined,
  loss_over_tolerance: () => undefined,
  credit_override: (ctx, a) => {
    const o = ctx.s.orders.find((x) => x.id === a.payload.orderId)!;
    o.status = 'approved';
    o.approvedBy = ctx.actor.id;
    o.revisions.push({ at: ctx.at, by: ctx.actor.id, change: `Credit override approved (${a.id})` });
  },
  fefo_override: () => undefined,
};

export function registerApplier(type: ApprovalType, fn: ApprovalApplier) {
  appliers[type] = fn;
}

export function decideApproval(ctx: Ctx, d: { approvalId: string; approve: boolean; reason?: string }) {
  const a = ctx.s.approvals.find((x) => x.id === d.approvalId) ?? fail('not_found', 'Approval not found');
  if (a.status !== 'pending') fail('duplicate', `${a.id} was already ${a.status} by ${a.decidedBy}`);
  requireCap(ctx, a.requiredCapability, `decide ${a.type.replace('_', ' ')} approvals`);
  notSelf(ctx, a.requestedBy, `request ${a.id}`);
  if (!d.approve && !d.reason?.trim()) fail('validation', 'A rejection needs a reason');
  a.status = d.approve ? 'approved' : 'rejected';
  a.decidedBy = ctx.actor.id;
  a.decidedAt = ctx.at;
  a.reason = d.reason;
  if (d.approve) appliers[a.type]?.(ctx, a);
  else if (a.type === 'stock_adjustment') {
    const c = ctx.s.counts.find((x) => x.id === a.payload.countId);
    if (c) c.status = 'rejected';
  }
  return a;
}

// ================================================================ M10 queue hook (used by several modules)

export function enqueueTally(ctx: Ctx, sourceType: 'purchase' | 'sale' | 'byproduct-sale' | 'freight' | 'receipt', sourceId: string, party: string, amount: number) {
  if (ctx.s.tally.some((t) => t.sourceType === sourceType && t.sourceId === sourceId)) return;
  ctx.s.tally.push({ id: nextId(ctx.s, 'TLY'), sourceType, sourceId, party, amount, status: 'queued', attempts: [], createdAt: ctx.at });
}
