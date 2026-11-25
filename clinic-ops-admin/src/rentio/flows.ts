/**
 * Shared derivations for the graphical flow views. Everything is computed from the same scoped ledger
 * rows the tables use (scope.ts / views.ts) — graphics never hold their own numbers.
 */
import type { RActor } from '../domain/rentio/access';
import { computePositions } from '../domain/rentio/engine';
import { runTiming } from '../domain/rentio/ops';
import { canReadLot, readScope, scopedPositions, scopedStockRows } from '../domain/rentio/scope';
import type { RentioState, StageCode } from '../domain/rentio/types';
import { fmtKg, type Grams, sum } from '../domain/rentio/units';
import { lotAccounting, stageFunnel } from '../domain/rentio/views';
import type { FlowNode, Seg, TreeNode } from './graphics';
import { CAT, STATUS } from './graphics';

/** Short stage names for flow steps (full names stay in tables and tooltips). */
export const STAGE_SHORT: Record<StageCode, string> = { CLEAN: 'Cleaning', G1: 'G1 grading', OIL: 'Oiling', COND: 'Conditioning', DRY: 'Drying', PEEL: 'Peeling', G2: 'G2 grading', PACK: 'Packing' };

/** Production route as a flow: each stage's material (arriving + queued + in process + ready), status and exits. */
export function routeFlow(s: RentioState, actor: RActor, now: string, base: string, opts: { exitsFromRoot?: string } = {}): FlowNode[] {
  const sc = readScope(actor);
  const funnel = stageFunnel(s, now).filter((f) => sc.factory || sc.stages.includes(f.code));
  const exitsFor = (st: StageCode) => {
    if (!opts.exitsFromRoot) return undefined;
    const runs = s.runs.filter((r) => r.stage === st && s.lots[r.inputLotId]?.rootId === opts.exitsFromRoot && r.status === 'completed');
    const by = (k: string) => sum(runs.flatMap((r) => r.outputs.filter((o) => o.kind === k).map((o) => o.qty)));
    const add = sum(runs.flatMap((r) => r.additions.map((a) => a.qty)));
    return [
      add ? { label: 'Oil added', value: `+${fmtKg(add)}` } : null,
      by('husk') ? { label: 'Husk', value: fmtKg(by('husk')) } : null,
      by('churi') ? { label: 'Churi', value: fmtKg(by('churi')) } : null,
      by('rework') ? { label: 'Rework', value: fmtKg(by('rework')) } : null,
      by('reject') ? { label: 'Rejects', value: fmtKg(by('reject')), tone: 'warn' as const } : null,
      by('loss') ? { label: 'Loss', value: fmtKg(by('loss')), tone: 'warn' as const } : null,
    ].filter(Boolean) as FlowNode['exits'];
  };
  return funnel.map((f) => {
    const total = f.pendingIn + f.queue + f.running + f.held + f.output;
    const late = f.runs.find((r) => r.t.status === 'Delayed');
    const status: FlowNode['status'] = f.held
      ? { label: 'Paused', tone: 'warn' }
      : late
        ? { label: 'Late', tone: 'bad' }
        : f.running
          ? { label: 'Running', tone: 'info' }
          : f.pendingIn
            ? { label: 'Arriving', tone: 'info' }
            : f.output
              ? { label: 'Ready to issue', tone: 'good' }
              : f.queue
                ? { label: 'Queued', tone: 'muted' }
                : { label: 'Idle', tone: 'muted' };
    const n = (g: number) => (g / 1000).toLocaleString('en-IN');
    const parts = [f.pendingIn && `${n(f.pendingIn)} arriving`, f.queue && `${n(f.queue)} queued`, f.running && `${n(f.running)} running`, f.output && `${n(f.output)} ready`].filter(Boolean);
    const first = f.ownerName.split(' ')[0];
    return {
      key: f.code,
      label: STAGE_SHORT[f.code],
      value: fmtKg(total),
      magnitude: total,
      // one short line: the biggest part of the material, else who owns the stage (full detail on hover)
      sub: parts.length ? `${parts[parts.length > 1 ? 1 : 0]}${parts.length > 1 ? ` +${parts.length - 1}` : ''}` : first,
      status,
      current: !!late || !!f.held,
      to: `${base}/production/stage?stage=${f.code}`,
      exits: exitsFor(f.code),
    };
  });
}

/** Physical stock along the network: Raw → In processing → Finished → On the road → Distributors (scoped). */
export function stockFlow(s: RentioState, actor: RActor, now: string, base: string): FlowNode[] {
  const sc = readScope(actor);
  const rows = scopedStockRows(s, actor, now).filter((r) => r.lot.unit !== 'bag' && !['OIL', 'BAGS', 'SPARES'].includes(r.lot.material));
  const of = (kinds: string[]) => rows.filter((r) => kinds.includes(r.location?.kind));
  const kg = (rs: typeof rows) => sum(rs.map((r) => r.qty));
  const raw = of(['intake', 'raw']);
  const proc = of(['stage-in', 'stage-out', 'run', 'pending']);
  const fin = of(['finished']).filter((r) => r.lot.material === 'PACKED' || r.lot.material === 'DAL');
  const tr = of(['transit']);
  const dist = of(['distributor', 'distributor-held']);
  const bags = sum(fin.filter((r) => r.lot.bagSize).map((r) => Math.floor(r.qty / r.lot.bagSize!)));
  const finHeld = kg(fin.filter((r) => r.held || r.expired));
  const gate = kg(of(['intake']));
  const nodes: FlowNode[] = [
    { key: 'raw', label: 'Raw toor', value: fmtKg(kg(raw)), magnitude: kg(raw), sub: gate ? `${fmtKg(gate)} at the gate` : `${fmtKg(sum(raw.map((r) => r.readyToProcess)))} ready`, status: gate ? { label: 'Check pending', tone: 'warn' } : { label: 'Ready', tone: 'good' }, to: `${base}/stock/godowns` },
    { key: 'proc', label: 'In processing', value: fmtKg(kg(proc)), magnitude: kg(proc), sub: `${new Set(proc.map((r) => r.location.stage).filter(Boolean)).size} stage(s) busy`, status: proc.some((r) => r.location.kind === 'pending') ? { label: 'Handover open', tone: 'info' } : undefined, to: `${base}/production/stages` },
    { key: 'fin', label: 'Finished (factory)', value: `${bags.toLocaleString('en-IN')} bags`, magnitude: kg(fin), sub: `${fmtKg(kg(fin))} · ${fmtKg(sum(fin.map((r) => r.available)))} free`, status: finHeld ? { label: `${fmtKg(finHeld)} on hold`, tone: 'warn' } : { label: 'All sellable', tone: 'good' }, to: `${base}/stock/godowns` },
    { key: 'transit', label: 'On the road', value: fmtKg(kg(tr)), magnitude: kg(tr), sub: `${new Set(tr.map((r) => r.loc)).size} shipment(s)`, to: `${base}/distribution/orders` },
  ];
  if (sc.all || sc.allDistributors || sc.distributors.length)
    nodes.push({ key: 'dist', label: sc.all || sc.allDistributors ? 'At distributors' : 'At your distributor', value: fmtKg(kg(dist)), magnitude: kg(dist), sub: `${new Set(dist.map((r) => r.location.distributorId)).size} partners`, status: dist.some((r) => r.held) ? { label: `${fmtKg(kg(dist.filter((r) => r.held)))} held`, tone: 'warn' } : undefined, to: `${base}/distribution/distributors` });
  return nodes.filter((n) => sc.factory || n.key === 'dist' || n.key === 'transit');
}

/** Genealogy tree of a root lot, limited to lots the actor may read. */
export function genealogy(s: RentioState, actor: RActor, rootId: string, base: string): TreeNode | null {
  if (!canReadLot(s, actor, rootId)) return null;
  const kids = new Map<string, string[]>();
  for (const l of Object.values(s.lots)) for (const p of l.parents) kids.set(p.lotId, [...(kids.get(p.lotId) ?? []), l.id]);
  const seen = new Set<string>();
  const build = (id: string): TreeNode => {
    seen.add(id);
    const lot = s.lots[id];
    const live = sum(scopedPositions(s, actor, id).map((p) => p.qty));
    return {
      id,
      title: id,
      sub: `${lot.label}${lot.bags ? ` · ${lot.bags} bags` : ''}`,
      live,
      to: `${base}/finance/reports?focus=${encodeURIComponent(rootId)}`,
      children: (kids.get(id) ?? []).filter((c) => !seen.has(c) && s.lots[c]?.rootId === rootId && canReadLot(s, actor, c)).map(build),
    };
  };
  return build(rootId);
}

/** Where every kilogram of a root lot is now, as exclusive parts (for a share strip). */
export function lotOutcome(s: RentioState, rootId: string): { segs: Seg[]; values: Record<string, Grams>; total: Grams; expected: Grams } {
  const acc = lotAccounting(s, rootId);
  const pick = (pred: (k: string, l: string) => boolean) => sum(acc.buckets.filter((b) => pred(b.key, b.label)).map((b) => b.qty));
  const values: Record<string, Grams> = {
    factory: pick((k) => k === 'FACTORY'),
    process: pick((k) => k.startsWith('WIP') || k === 'TRANSIT'),
    distributor: pick((k) => k === 'DIST'),
    retail: pick((_k, l) => l === 'Retailer delivered'),
    byproduct: pick((k, l) => k === 'HUSK' || k === 'CHURI' || l.startsWith('By-product')),
    rejectLoss: pick((k, l) => k === 'REJECT' || l.startsWith('Recorded') || l === 'Disposed'),
    other: 0,
  };
  values.other = acc.total - sum(Object.values(values));
  return {
    segs: [
      { key: 'factory', label: 'Finished at factory', color: CAT[0] },
      { key: 'process', label: 'Still in process / transit', color: CAT[1] },
      { key: 'distributor', label: 'At distributors', color: CAT[2] },
      { key: 'retail', label: 'Delivered to retailers', color: CAT[3] },
      { key: 'byproduct', label: 'Husk & Churi (kept, used, sold)', color: CAT[4] },
      { key: 'rejectLoss', label: 'Rejects & recorded loss', color: STATUS.muted, pattern: true },
      { key: 'other', label: 'Other', color: STATUS.faint },
    ],
    values,
    total: acc.total,
    expected: acc.expected,
  };
}

/** Live kg per stack location for a godown map. */
export function stackFill(s: RentioState) {
  const pos = computePositions(s);
  return (loc: string) => {
    let t = 0;
    pos.forEach((q, k) => k.endsWith(`|${loc}`) && (t += q));
    return t;
  };
}

export { runTiming };

/** The route ONE root lot actually took: each stage pass with its input, good output and side exits. */
export function lotRouteFlow(s: RentioState, rootId: string, base: string): FlowNode[] {
  const runs = s.runs.filter((r) => s.lots[r.inputLotId]?.rootId === rootId).sort((a, b) => a.events[0].at.localeCompare(b.events[0].at));
  const intake = sum(s.movements.filter((m) => m.lotId === rootId && (m.kind === 'intake' || m.kind === 'opening')).map((m) => m.qty));
  const nodes: FlowNode[] = intake ? [{ key: 'intake', label: 'Accepted intake', value: fmtKg(intake), magnitude: intake, sub: s.lots[rootId]?.label, done: true, to: `${base}/procurement/intake` }] : [];
  for (const r of runs) {
    const by = (k: string) => sum(r.outputs.filter((o) => o.kind === k).map((o) => o.qty));
    const add = sum(r.additions.map((a) => a.qty));
    const fwd = by('forward');
    const grades = r.outputs.filter((o) => o.kind === 'forward' && o.grade).map((o) => `${o.grade} ${fmtKg(o.qty)}`);
    const t = runTiming(r, new Date().toISOString());
    nodes.push({
      key: r.id,
      label: `${STAGE_SHORT[r.stage]}${r.pass > 1 ? ` · pass ${r.pass}` : ''}`,
      value: fmtKg(r.inputQty + add),
      magnitude: r.inputQty + add,
      sub: r.status === 'completed' ? (grades.length > 1 ? grades.join(' · ') : `→ ${fmtKg(fwd)} good`) : 'in process',
      done: r.status === 'completed',
      current: r.status !== 'completed',
      status: t.delayMs > 0 ? { label: `${r.status === 'completed' ? 'Finished' : 'Running'} ${fmtDurationShort(t.delayMs)} late`, tone: r.status === 'completed' ? 'warn' : 'bad' } : r.status === 'completed' ? { label: 'Balanced', tone: 'good' } : undefined,
      to: `${base}/production/stage?stage=${r.stage}`,
      exits: [
        add ? { label: 'Oil added', value: `+${fmtKg(add)}` } : null,
        by('rework') ? { label: 'Rework → next pass', value: fmtKg(by('rework')) } : null,
        by('husk') ? { label: 'Husk', value: fmtKg(by('husk')) } : null,
        by('churi') ? { label: 'Churi', value: fmtKg(by('churi')) } : null,
        by('reject') ? { label: 'Rejects (held)', value: fmtKg(by('reject')), tone: 'warn' as const } : null,
        by('loss') ? { label: 'Loss', value: fmtKg(by('loss')), tone: 'warn' as const } : null,
      ].filter(Boolean) as FlowNode['exits'],
    });
  }
  return nodes;
}

const fmtDurationShort = (ms: number) => {
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
};
