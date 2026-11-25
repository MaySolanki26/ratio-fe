/**
 * Controlled repacking (FR-103 / BR-029 / WF-13 / AC-23). Two steps:
 *  1. Godown staff RECORD the measured repack proposal (input, opened bags, filled packs, measured net,
 *     packaging lot, any real loss with reason). Nothing moves: the source stays intact.
 *  2. An independent QC checker RELEASES it. Release re-validates everything against the live ledger and
 *     posts in ONE transaction: source consumed once, loss sunk once, new packaging deducted once, child
 *     packed lot created with the source genealogy, grade, manufacturing date and the SAME expiry.
 * Food mass never includes packaging (packaging is a separate stores lot counted in units).
 */
import { hasCap } from './access';
import { DEMO } from './config';
import { type Ctx, createLot, fail, ineligibility, locationHolds, move, nextId, notSelf, requireCap } from './engine';
import { capacityCheck, rec } from './ops';
import type { Repack, RentioState } from './types';
import { fmtKg, type Grams, kg } from './units';

const pkey = (lot: string, loc: string) => `${lot}|${loc}`;

/** Pack size (g) a packaging lot fits: explicit bagSize, else parsed from the id (BAGS-25-…, POUCH-1-…). */
export function packagingSize(s: RentioState, lotId: string): Grams | undefined {
  const l = s.lots[lotId];
  if (!l || l.material !== 'BAGS') return undefined;
  if (l.bagSize) return l.bagSize;
  const m = /-(\d+)-/.exec(lotId);
  return m ? kg(Number(m[1])) : undefined;
}

/** Why a stack cannot receive released repacked stock (active hold on the stack or its parent godown), else undefined. UI uses it to omit/explain blocked stacks. */
export function destinationBlock(s: RentioState, loc: string): string | undefined {
  const hs = locationHolds(s, loc);
  return hs.length ? hs.map((h) => `${h.kind} hold ${h.id} on ${s.locations[h.target]?.label ?? h.target}: ${h.reason}`).join('; ') : undefined;
}

export const repacksOf =(s: RentioState) => s.repacks ?? (s.repacks = []);

export interface RepackInput {
  lotId: string;
  fromLoc: string;
  toLoc?: string;
  inputKg: number;
  targetBagKg: number;
  outputBags: number;
  measuredOutputKg: number;
  packagingLotId: string;
  lossKg?: number;
  lossReason?: string;
}

/** All business checks — run at proposal AND again at release against the then-current ledger. */
function validate(ctx: Ctx, r: Omit<Repack, 'id' | 'status' | 'requestedBy' | 'requestedAt' | 'residualAtRequest'>, excludeId?: string) {
  const s = ctx.s;
  const lot = s.lots[r.sourceLotId] ?? fail('not_found', `Lot ${r.sourceLotId} not found`);
  if (lot.material !== 'PACKED' || !lot.bagSize) fail('business_rule', `${lot.id} is not a packed lot — only packed stock can be repacked`);
  const loc = s.locations[r.fromLoc] ?? fail('not_found', `Unknown location ${r.fromLoc}`);
  if (loc.kind !== 'finished' || !loc.godown) fail('business_rule', `Choose the real finished-godown stack holding ${lot.id} (not ${loc.label})`);
  // held (own or inherited), location/stack treatment holds and expiry all block repacking
  const why = ineligibility(s, lot.id, r.fromLoc, ctx.at);
  if (why.length) fail('business_rule', `Not eligible for repacking: ${why.join('; ')}. Source left unchanged.`);
  const physical = ctx.pos.get(pkey(lot.id, r.fromLoc)) ?? 0;
  const reserved = s.reservations.filter((x) => x.status === 'active' && x.lotId === lot.id && x.location === r.fromLoc).reduce((a, x) => a + x.qty, 0);
  const pendingOther = repacksOf(s).filter((x) => x.status === 'pending_qc' && x.id !== excludeId && x.sourceLotId === lot.id && x.fromLoc === r.fromLoc).reduce((a, x) => a + x.inputQty, 0);
  const free = physical - reserved - pendingOther;
  if (r.inputQty <= 0) fail('validation', 'Enter the released net input in kg');
  if (r.inputQty > free)
    fail('business_rule', `Only ${fmtKg(Math.max(0, free))} of ${lot.id} at ${loc.label} is free to repack (physical ${fmtKg(physical)}${reserved ? `, reserved for orders ${fmtKg(reserved)}` : ''}${pendingOther ? `, already proposed for repack ${fmtKg(pendingOther)}` : ''}). Reserved stock cannot be repacked.`);
  if (r.inputQty % lot.bagSize !== 0) fail('validation', `Input must be whole opened bags of ${fmtKg(lot.bagSize)} (${fmtKg(r.inputQty)} is not)`);
  // permitted target: an ACTIVE SKU of the same grade at that pack size
  const sku = rec(ctx, 'skus', `SKU-${lot.grade}-${r.targetBagSize / 1000}`);
  if (!sku || sku.active === false) fail('business_rule', `No active ${lot.grade} SKU for ${fmtKg(r.targetBagSize)} packs — the target bag size is not permitted (FR-001)`);
  if (r.targetBagSize === lot.bagSize) fail('validation', 'Target pack size is the same as the source — this is not a repack');
  if (!Number.isInteger(r.outputBags) || r.outputBags <= 0) fail('validation', 'Enter the number of new packs filled');
  if (r.measuredOutput !== r.outputBags * r.targetBagSize)
    fail('business_rule', `Measured net ${fmtKg(r.measuredOutput)} does not equal ${r.outputBags} × ${fmtKg(r.targetBagSize)} = ${fmtKg(r.outputBags * r.targetBagSize)}. Re-weigh; never adjust the loss to make pack counts fit.`);
  if (r.loss < 0) fail('validation', 'Loss cannot be negative');
  if (r.loss > 0 && !r.lossReason?.trim()) fail('validation', 'A recorded loss needs a reason (spillage, sweepings, torn bag …)');
  const diff = r.inputQty - r.measuredOutput - r.loss;
  if (diff !== 0)
    fail('business_rule', `Unbalanced repack: input ${fmtKg(r.inputQty)} ≠ new packs ${fmtKg(r.measuredOutput)} + recorded loss ${fmtKg(r.loss)} (difference ${fmtKg(diff)}). Nothing is balanced automatically.`);
  if ((r.loss * 100) / r.inputQty > DEMO.repackLossTolerancePct)
    fail('business_rule', `Loss ${fmtKg(r.loss)} is above the ${DEMO.repackLossTolerancePct}% demo repack tolerance — investigate and use a stock count adjustment instead`);
  // packaging: matching size, counted stock enough (units ×1000 g)
  const size = packagingSize(s, r.packagingLotId);
  if (!size) fail('validation', `${r.packagingLotId} is not a packaging lot`);
  if (size !== r.targetBagSize) fail('business_rule', `${r.packagingLotId} fits ${fmtKg(size!)} packs, not ${fmtKg(r.targetBagSize)}`);
  const packs = ctx.pos.get(pkey(r.packagingLotId, 'STORES')) ?? 0;
  if (packs < r.outputBags * 1000) fail('negative_stock', `Insufficient packaging: ${packs / 1000} × ${r.packagingLotId} in stores, ${r.outputBags} needed. Source left unchanged.`);
  const to = s.locations[r.toLoc] ?? fail('not_found', `Unknown target location ${r.toLoc}`);
  if (to.kind !== 'finished') fail('business_rule', 'New packs must go to a finished-godown stack');
  // released packs cannot land in a stack (or its godown) under treatment / location hold — re-checked at release
  const blocked = destinationBlock(s, r.toLoc);
  if (blocked) fail('business_rule', `${to.label} cannot receive released packs: ${blocked}. Choose another stack; source, packaging and this request are unchanged.`);
  return { lot, physical };
}

/** Step 1 — measured proposal by authorized godown staff (no stock change). */
export function requestRepack(ctx: Ctx, i: RepackInput): Repack {
  if (!hasCap(ctx.actor, 'godown.operate') && !hasCap(ctx.actor, 'plan.manage')) fail('forbidden', `${ctx.actor.roleLabel} cannot record repacking`);
  const lot = ctx.s.lots[i.lotId] ?? fail('not_found', `Lot ${i.lotId} not found`);
  const draft = {
    sourceLotId: i.lotId,
    fromLoc: i.fromLoc,
    toLoc: i.toLoc || i.fromLoc,
    inputQty: kg(i.inputKg),
    sourceBagSize: lot.bagSize ?? 0,
    openedBags: lot.bagSize ? kg(i.inputKg) / lot.bagSize : 0,
    targetBagSize: kg(i.targetBagKg),
    outputBags: Number(i.outputBags),
    measuredOutput: kg(i.measuredOutputKg),
    packagingLotId: i.packagingLotId,
    loss: kg(i.lossKg ?? 0),
    lossReason: i.lossReason?.trim() || undefined,
  };
  const { physical } = validate(ctx, draft);
  const rp: Repack = { ...draft, id: nextId(ctx.s, 'RPK'), status: 'pending_qc', requestedBy: ctx.actor.id, requestedAt: ctx.at, residualAtRequest: physical - draft.inputQty };
  repacksOf(ctx.s).push(rp);
  return rp;
}

/** Step 2 — independent QC release posts everything once; rejection changes no stock. */
export function decideRepack(ctx: Ctx, d: { repackId: string; release: boolean; note?: string }) {
  const rp = repacksOf(ctx.s).find((x) => x.id === d.repackId) ?? fail('not_found', 'Repack not found');
  if (rp.status !== 'pending_qc') fail('duplicate', `${rp.id} was already ${rp.status === 'posted' ? 'released and posted' : 'rejected'} by ${rp.decidedBy}`);
  requireCap(ctx, 'quality.release', 'release repacked stock');
  notSelf(ctx, rp.requestedBy, `repack ${rp.id}`);
  if (!d.release) {
    if (!d.note?.trim()) fail('validation', 'Say why the repack is rejected');
    rp.status = 'rejected';
    rp.decidedBy = ctx.actor.id;
    rp.decidedAt = ctx.at;
    rp.decisionNote = d.note.trim();
    return rp;
  }
  const { lot } = validate(ctx, rp, rp.id);
  const ref = rp.id;
  // source: food mass leaves the old packs exactly once (consumed into the child, loss sunk with reason)
  const consumed = rp.inputQty - rp.loss;
  move(ctx, { lotId: lot.id, qty: consumed, from: rp.fromLoc, kind: 'consume', basis: 'Actual', ref, note: `Repacked: ${rp.openedBags} × ${fmtKg(rp.sourceBagSize)} opened` });
  if (rp.loss) move(ctx, { lotId: lot.id, qty: rp.loss, from: rp.fromLoc, kind: 'loss', basis: 'Actual', ref, note: `Repack loss: ${rp.lossReason}` });
  // new packaging: stores consumption in units, never food mass (BR-028)
  move(ctx, { lotId: rp.packagingLotId, qty: rp.outputBags * 1000, from: 'STORES', kind: 'pack-material', basis: 'Counted', ref, note: `${rp.outputBags} new packs for ${ref}` });
  capacityCheck(ctx, rp.toLoc, rp.measuredOutput);
  let id = `${lot.id}/RP${rp.targetBagSize / 1000}`;
  for (let n = 2; ctx.s.lots[id]; n++) id = `${lot.id}/RP${rp.targetBagSize / 1000}-${n}`;
  createLot(ctx, {
    id,
    rootId: lot.rootId,
    material: 'PACKED',
    label: `Repacked dal ${lot.grade} · ${rp.targetBagSize / 1000} kg packs`,
    grade: lot.grade,
    sku: `SKU-${lot.grade}-${rp.targetBagSize / 1000}`,
    parents: [{ lotId: lot.id, qty: consumed }],
    pass: lot.pass,
    routeVersion: lot.routeVersion,
    mfgDate: lot.mfgDate, // original manufacturing date — repacking does not make food newer
    expiry: lot.expiry, // never later than the source
    bags: rp.outputBags,
    bagSize: rp.targetBagSize,
  });
  move(ctx, { lotId: id, qty: rp.measuredOutput, to: rp.toLoc, kind: 'produce', basis: 'Actual', ref, note: `Released by QC from ${lot.id}` });
  rp.status = 'posted';
  rp.decidedBy = ctx.actor.id;
  rp.decidedAt = ctx.at;
  rp.decisionNote = d.note?.trim() || undefined;
  rp.childLotId = id;
  rp.txId = ctx.txId;
  return rp;
}
