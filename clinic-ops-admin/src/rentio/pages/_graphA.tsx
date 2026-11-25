/**
 * Graphical views for the stock, procurement and production-support pages. Every figure is derived from the
 * same scoped rows / records the page tables use; segments are mutually exclusive (zero baseline).
 */
import type { RActor } from '../../domain/rentio/access';
import { userName } from '../../domain/rentio/access';
import { stageInfo } from '../../domain/rentio/data';
import type { StockRow } from '../../domain/rentio/engine';
import { outstanding, purchaseBalances } from '../../domain/rentio/ops';
import type { Suggestion } from '../../domain/rentio/replenish';
import type { Handover, Hold, Purchase, Repack, RentioState, StageRun, StockCount } from '../../domain/rentio/types';
import { fmtKg, type Grams, sum } from '../../domain/rentio/units';
import { byproductReconciliation, stageName } from '../../domain/rentio/views';
import { routeFlow, stockFlow } from '../flows';
import { type BarRow, CAT, ChartGrid, FlowChain, type FlowNode, MASS_SEGS, massRows, RunTimeline, type Seg, ShareStrip, StackBars, STATUS } from '../graphics';

const kgOf = (rs: StockRow[]) => sum(rs.map((r) => r.qty));
const foodRows = (rows: StockRow[]) => rows.filter((r) => r.lot.unit !== 'bag' && !['OIL', 'BAGS', 'SPARES'].includes(r.lot.material));

/** Condition split of positions: exclusive parts whose sum is the physical quantity. */
function conditionValues(rs: StockRow[]) {
  const v = { free: 0, reserved: 0, held: 0, ready: 0, custody: 0 };
  for (const r of rs) {
    if (r.held || r.expired) v.held += r.qty;
    else if (r.sellable) {
      v.free += r.available;
      v.reserved += r.qty - r.available;
    } else if (r.readyToProcess) v.ready += r.qty;
    else v.custody += r.qty;
  }
  return v;
}

const CONDITION_SEGS: Seg[] = [
  { key: 'free', label: 'Free to sell', color: STATUS.good },
  { key: 'reserved', label: 'Reserved', color: STATUS.info },
  { key: 'held', label: 'On hold / expired', color: STATUS.warn, pattern: true },
  { key: 'ready', label: 'Ready to process', color: CAT[0] },
  { key: 'custody', label: 'In process / transit (not sellable here)', color: STATUS.faint },
];

// ---------------------------------------------------------------- Godowns

export function GodownGraphics({ s, rows, handovers, base, stacks, godowns, capacity, labelOf, focus }: { s: RentioState; rows: StockRow[]; handovers: Handover[]; base: string; stacks: string[]; godowns: string[]; capacity: (id: string) => Grams; labelOf: (id: string) => string; focus?: string }) {
  const food = foodRows(rows);
  const at = (loc: string) => food.filter((r) => r.loc === loc || (r.location?.godown === loc && !stacks.includes(r.loc)));
  const ids = [...stacks, ...godowns.filter((g) => g !== 'F1' && g !== 'STORES')];
  const bars: BarRow[] = ids.map((id) => {
    const here = at(id);
    const v = conditionValues(here);
    const used = kgOf(here);
    const cap = capacity(id);
    const bags = sum(here.filter((r) => r.lot.bagSize).map((r) => Math.floor(r.qty / r.lot.bagSize!)));
    const grades = [...new Set(here.map((r) => r.lot.grade).filter(Boolean))].join(', ');
    return {
      id,
      label: labelOf(id),
      text: labelOf(id),
      to: `${base}/stock/godowns?focus=${id}`,
      values: { ...v, freeCap: cap ? Math.max(0, cap - used) : 0 },
      note: [bags ? `${bags} bags` : '', grades, cap ? `cap ${fmtKg(cap)}` : 'no limit'].filter(Boolean).join(' · '),
    };
  });
  const max = Math.max(1, ...ids.map((id) => Math.max(capacity(id), kgOf(at(id)))));
  const kind = (k: string[]) => food.filter((r) => k.includes(r.location?.kind));
  const putaway = sum(handovers.filter((h) => h.toStage === 'F1').map((h) => outstanding(h)));
  const prodPending = sum(handovers.filter((h) => h.toStage !== 'F1' && h.toStage !== 'R1').map((h) => outstanding(h)));
  const inProd = kgOf(kind(['stage-in', 'stage-out', 'run']));
  const f1 = kind(['finished']);
  const nodes: FlowNode[] = [
    { key: 'gate', label: 'Gate (awaiting check)', value: fmtKg(kgOf(kind(['intake']))), magnitude: kgOf(kind(['intake'])), status: kgOf(kind(['intake'])) ? { label: 'Check pending', tone: 'warn' } : undefined, to: `${base}/procurement/intake` },
    { key: 'r1', label: 'Raw Godown R1', value: fmtKg(kgOf(at('R1'))), magnitude: kgOf(at('R1')), sub: 'ready for cleaning', to: `${base}/stock/godowns?focus=R1` },
    { key: 'prod', label: 'Issued to stages', value: fmtKg(inProd + prodPending), magnitude: inProd + prodPending, sub: prodPending ? `${fmtKg(prodPending)} in handover` : 'queued / running / ready', to: `${base}/production/stages` },
    { key: 'put', label: 'Awaiting put-away', value: fmtKg(putaway), magnitude: putaway, status: putaway ? { label: 'Put away into stacks', tone: 'info' } : undefined },
    { key: 'f1', label: 'F1 stacks', value: `${sum(f1.filter((r) => r.lot.bagSize).map((r) => Math.floor(r.qty / r.lot.bagSize!))).toLocaleString('en-IN')} bags`, magnitude: kgOf(f1), sub: fmtKg(kgOf(f1)), status: f1.some((r) => r.held || r.expired) ? { label: `${fmtKg(kgOf(f1.filter((r) => r.held || r.expired)))} on hold`, tone: 'warn' } : undefined },
    { key: 'road', label: 'Dispatched (on the road)', value: fmtKg(kgOf(kind(['transit']))), magnitude: kgOf(kind(['transit'])), to: `${base}/distribution/orders` },
  ];
  return (
    <>
      <StackBars title="Stack map — what each stack holds against its capacity" caption="kg · bar length = capacity; grey = free space" segs={[...CONDITION_SEGS, { key: 'freeCap', label: 'Free capacity', color: STATUS.faint }].filter((x) => x.key !== 'custody')} rows={bars} rowHeader="Stack / godown" max={max} focus={focus} empty="No godowns in your area." />
      <FlowChain title="Godown flow" caption={`kg now at each step · ${s.route.stages.length}-stage route between R1 and F1`} nodes={nodes} />
    </>
  );
}

// ---------------------------------------------------------------- Inventory

export function InventoryGraphics({ s, actor, now, base, rows, buckets, bucketOf }: { s: RentioState; actor: RActor; now: string; base: string; rows: StockRow[]; buckets: { id: string; label: string }[]; bucketOf: (r: StockRow) => string }) {
  const food = foodRows(rows).filter((r) => r.loc !== 'STORES');
  const bars: BarRow[] = buckets
    .filter((b) => b.id !== 'stores')
    .map((b) => ({ b, rs: food.filter((r) => bucketOf(r) === b.id) }))
    .filter((x) => x.rs.length)
    .map(({ b, rs }) => ({ id: b.id, label: b.label, text: b.label, values: conditionValues(rs) }));
  return (
    <>
      <FlowChain title="Where the stock is" caption="Raw → processing → finished → transit → distributors (your area)" nodes={stockFlow(s, actor, now, base)} />
      <StackBars title="Stock by condition" caption="kg · parts are exclusive — each bar equals the physical stock at that point" segs={CONDITION_SEGS} rows={bars} rowHeader="Where" empty="No stock in your area." />
    </>
  );
}

// ---------------------------------------------------------------- By-products

export function ByproductGraphics({ s }: { s: RentioState }) {
  const rec = byproductReconciliation(s);
  const name = (t: string) => (t === 'HUSK' ? 'Husk' : 'Churi');
  return (
    <>
      <ChartGrid>
        {rec.map((r) => (
          <FlowChain
            key={r.type}
            title={`${name(r.type)} flow`}
            caption="kg · generated in peeling → kept in store or leaving the plant"
            nodes={[
              { key: 'gen', label: 'Generated', value: fmtKg(r.generation + r.opening), magnitude: r.generation + r.opening, sub: r.opening ? `incl. ${fmtKg(r.opening)} opening` : 'from production runs' },
              {
                key: 'kept',
                label: 'Kept in store',
                value: fmtKg(r.closing),
                magnitude: r.closing,
                status: r.reconciled ? { label: 'Reconciled', tone: 'good' } : { label: 'Mismatch', tone: 'bad' },
                exits: [
                  r.internal ? { label: 'Used internally', value: fmtKg(r.internal) } : null,
                  r.external ? { label: 'Sold to buyers', value: fmtKg(r.external) } : null,
                  r.disposal ? { label: 'Disposed', value: fmtKg(r.disposal), tone: 'warn' as const } : null,
                ].filter(Boolean) as FlowNode['exits'],
              },
            ]}
          />
        ))}
      </ChartGrid>
      <StackBars
        title="Husk & Churi — what happened to it"
        caption="kg · exclusive parts of everything generated"
        segs={[
          { key: 'kept', label: 'Kept in store', color: CAT[0] },
          { key: 'internal', label: 'Used internally', color: CAT[1] },
          { key: 'external', label: 'Sold to buyers', color: CAT[2] },
          { key: 'disposal', label: 'Disposed', color: STATUS.muted, pattern: true },
        ]}
        rows={rec.map((r) => ({ id: r.type, label: name(r.type), text: name(r.type), values: { kept: r.closing, internal: r.internal, external: r.external, disposal: r.disposal } }))}
        rowHeader="By-product"
      />
    </>
  );
}

// ---------------------------------------------------------------- Holds & counts

export function HoldGraphics({ holds, affected, counts, labelOf }: { holds: Hold[]; affected: (h: Hold) => StockRow[]; counts: StockCount[]; labelOf: (h: Hold) => string }) {
  const holdRows: BarRow[] = holds.map((h) => {
    const a = foodRows(affected(h));
    const v = { factory: 0, dist: 0, transit: 0 };
    for (const r of a) {
      const k = r.location?.kind;
      if (k === 'distributor' || k === 'distributor-held') v.dist += r.qty;
      else if (k === 'transit') v.transit += r.qty;
      else v.factory += r.qty;
    }
    return { id: h.id, label: labelOf(h), text: labelOf(h), values: v, note: `${h.kind} hold` };
  });
  const countRows: BarRow[] = counts.map((c) => ({ id: c.id, label: `${c.lotId}`, text: `${c.lotId} @ ${c.location}`, values: { match: Math.min(c.counted, c.snapshot), diff: Math.abs(c.difference) }, note: c.difference ? `${c.difference > 0 ? '+' : '−'}${fmtKg(Math.abs(c.difference))} · ${c.status.replace('_', ' ')}` : 'matches' }));
  return (
    <ChartGrid>
      <StackBars
        title="Stock stopped by each active hold"
        caption="kg of live stock affected (the lot and everything made from it)"
        segs={[
          { key: 'factory', label: 'In the factory', color: CAT[0] },
          { key: 'transit', label: 'In transit', color: CAT[1] },
          { key: 'dist', label: 'At distributors', color: CAT[2] },
        ]}
        rows={holdRows}
        rowHeader="Hold on"
        empty="No active holds in your area."
      />
      <StackBars
        title="Physical counts vs system"
        caption="kg · difference needs an independent approval before stock changes"
        segs={[
          { key: 'match', label: 'Agrees with system', color: STATUS.good },
          { key: 'diff', label: 'Difference', color: STATUS.warn, pattern: true },
        ]}
        rows={countRows}
        rowHeader="Lot counted"
        empty="No counts yet."
      />
    </ChartGrid>
  );
}

// ---------------------------------------------------------------- Intake

export function IntakeGraphics({ s, purchases, base, supplierName, focus }: { s: RentioState; purchases: Purchase[]; base: string; supplierName: (id: string) => string; focus?: string }) {
  const b = purchases.map((p) => ({ p, x: purchaseBalances(s, p) }));
  const tot = (f: (x: ReturnType<typeof purchaseBalances>, p: Purchase) => number) => sum(b.map(({ p, x }) => f(x, p)));
  const ordered = tot((_x, p) => p.declaredQty);
  const gate = tot((x) => x.inspecting);
  const accepted = tot((x) => x.accepted);
  const rejected = tot((x) => x.rejected);
  const open = tot((x, p) => (p.status === 'closed' ? 0 : x.open));
  return (
    <>
      <FlowChain
        title="Buying flow"
        caption="kg across all purchases"
        nodes={[
          { key: 'po', label: 'Ordered', value: fmtKg(ordered), magnitude: ordered, sub: `${purchases.length} purchase(s)` },
          { key: 'gate', label: 'At the gate', value: fmtKg(gate), magnitude: gate, status: gate ? { label: 'Waiting for independent check', tone: 'warn' } : { label: 'Nothing waiting', tone: 'muted' } },
          { key: 'acc', label: 'Accepted into R1', value: fmtKg(accepted), magnitude: accepted, status: { label: 'Stock', tone: 'good' }, exits: rejected ? [{ label: 'Rejected (quarantine)', value: fmtKg(rejected), tone: 'warn' }] : undefined, to: `${base}/stock/godowns?focus=R1` },
          { key: 'open', label: 'Still to arrive', value: fmtKg(open), magnitude: open, sub: 'not stock yet' },
        ]}
      />
      <StackBars
        title="Each purchase — received vs still to come"
        caption="kg · parts are exclusive; together they make up what was received plus the open balance"
        segs={[
          { key: 'accepted', label: 'Accepted', color: STATUS.good },
          { key: 'rejected', label: 'Rejected', color: STATUS.bad, pattern: true },
          { key: 'gate', label: 'At the gate', color: STATUS.info },
          { key: 'open', label: 'Still to arrive', color: STATUS.faint },
        ]}
        rows={b.map(({ p, x }) => ({ id: p.id, label: `${p.id}`, text: `${p.id} · ${supplierName(p.supplierId)}`, values: { accepted: x.accepted, rejected: x.rejected, gate: x.inspecting, open: p.status === 'closed' ? 0 : x.open }, note: `${supplierName(p.supplierId)}${p.status === 'closed' ? ' · closed' : ''}` }))}
        rowHeader="Purchase"
        focus={focus}
        empty="No purchases in your area."
      />
    </>
  );
}

// ---------------------------------------------------------------- Route setup

export function RouteGraphic({ s, actor, now, base }: { s: RentioState; actor: RActor; now: string; base: string }) {
  const live = new Map(routeFlow(s, actor, now, base).map((n) => [n.key, n]));
  const nodes: FlowNode[] = s.route.stages.map((code) => {
    const info = stageInfo(code);
    const down = s.equipment.filter((e) => e.stage === code && e.status !== 'released');
    const n = live.get(code);
    return {
      key: code,
      label: stageName(code),
      value: n?.value ?? `${Math.round(info.plannedMinutes / 6) / 10} h plan`,
      magnitude: n?.magnitude,
      sub: `Owner ${userName(info.owner)} · backup ${userName(info.backup)}`,
      status: down.length ? { label: `${down[0].label} unavailable`, tone: 'bad' } : { label: 'Machines released', tone: 'good' },
      current: down.length > 0,
      to: n?.to,
    };
  });
  return <FlowChain title={`Active route v${s.route.version}`} caption="Raw Godown R1 → stages → Finished Godown F1 · material now at each stage where visible to you" nodes={nodes} />;
}

// ---------------------------------------------------------------- Grading

const GRADE_ORDER = ['A1', 'B1', 'A2', 'B2'];

export function GradingGraphics({ runs, byGrade }: { runs: StageRun[]; byGrade: Map<string, number> }) {
  const done = runs.filter((r) => r.status === 'completed');
  const known = GRADE_ORDER.filter((g) => done.some((r) => r.outputs.some((o) => o.kind === 'forward' && o.grade === g)) || byGrade.has(g));
  const segs: Seg[] = [
    ...known.map((g, i) => ({ key: g, label: `Grade ${g}`, color: CAT[i] })),
    { key: 'other', label: 'Other grades (size grading)', color: CAT[4] },
    { key: 'loss', label: 'Loss', color: STATUS.muted, pattern: true },
    { key: 'residual', label: 'Not processed', color: STATUS.faint },
  ];
  const rows: BarRow[] = done.map((r) => {
    const v: Record<string, number> = {};
    for (const o of r.outputs) {
      const k = o.kind === 'forward' ? (o.grade && known.includes(o.grade) ? o.grade : 'other') : o.kind === 'loss' ? 'loss' : o.kind === 'residual' ? 'residual' : 'other';
      v[k] = (v[k] ?? 0) + o.qty;
    }
    const label = `${r.stage} · ${r.inputLotId}`;
    return { id: r.id, label, text: label, values: v };
  });
  const share: Record<string, number> = Object.fromEntries(known.map((g) => [g, byGrade.get(g) ?? 0]));
  return (
    <ChartGrid>
      <StackBars title="How each grading run split" caption="kg of input · grades, loss and unprocessed are exclusive" segs={segs} rows={rows} rowHeader="Run" empty="No completed grading runs in your area." />
      {Object.values(share).some((v) => v > 0) ? <ShareStrip title="Graded stock in stock now" caption="kg by grade (your area)" segs={known.map((g, i) => ({ key: g, label: `Grade ${g}`, color: CAT[i] }))} values={share} /> : <StackBars title="Graded stock in stock now" segs={[]} rows={[]} empty="No graded stock in your area." />}
    </ChartGrid>
  );
}

// ---------------------------------------------------------------- Handovers

export function HandoverGraphics({ open, focus, where }: { open: Handover[]; focus?: string; where: (loc: string) => string }) {
  const settled = (h: Handover) => sum(h.settled.map((x) => x.qty));
  const issued = sum(open.map((h) => h.qty));
  const out = sum(open.map((h) => outstanding(h)));
  const rec = sum(open.map((h) => h.received));
  return (
    <>
      <FlowChain
        title="Open handovers"
        caption="kg · issue moves stock into handover custody; the receiver's confirmation settles it"
        nodes={[
          { key: 'iss', label: 'Issued by sender', value: fmtKg(issued), magnitude: issued, sub: `${open.length} handover(s)` },
          { key: 'cust', label: 'In handover custody', value: fmtKg(out), magnitude: out, status: out ? { label: 'Not in anyone’s stock yet', tone: 'warn' } : undefined },
          { key: 'rec', label: 'Received', value: fmtKg(rec), magnitude: rec, status: rec ? { label: 'Partly received', tone: 'info' } : { label: 'Nothing received yet', tone: 'muted' } },
        ]}
      />
      <StackBars
        title="Each open handover"
        caption="kg issued · received + settled + outstanding = issued"
        segs={[
          { key: 'rec', label: 'Received', color: STATUS.good },
          { key: 'set', label: 'Settled (found / returned / loss)', color: STATUS.muted },
          { key: 'out', label: 'Outstanding', color: STATUS.warn, pattern: true },
        ]}
        rows={open.map((h) => ({ id: h.id, label: h.lotId, text: `${h.lotId} (${where(h.fromLoc)} → ${h.toStage})`, values: { rec: h.received, set: settled(h), out: outstanding(h) }, note: `→ ${h.toStage}` }))}
        rowHeader="Lot"
        focus={focus}
        empty="No open handovers."
      />
    </>
  );
}

// ---------------------------------------------------------------- Daily close

export function CloseGraphics({ completed, open, now }: { completed: StageRun[]; open: StageRun[]; now: string }) {
  return (
    <ChartGrid>
      <StackBars title="Output by run on this date" caption="kg of input · where every kilogram went" segs={MASS_SEGS} rows={massRows(completed, (r) => `${stageName(r.stage)} · ${r.inputLotId}`)} rowHeader="Run" empty="No runs completed on this date." />
      <RunTimeline title="Open runs carried forward" caption="working vs on hold; dashed = planned finish" runs={open} now={now} labelOf={(r) => `${stageName(r.stage)} · ${r.inputLotId}`} />
    </ChartGrid>
  );
}

// ---------------------------------------------------------------- Repack

export function RepackFlow({ x, locLabel }: { x: Repack; locLabel: (id: string) => string }) {
  const posted = x.status === 'posted';
  const rejected = x.status === 'rejected';
  return (
    <FlowChain
      title={`Repack ${x.id}`}
      caption="kg · source stays unchanged until an independent QC release posts everything once"
      nodes={[
        { key: 'src', label: 'Source packs', value: fmtKg(x.inputQty), magnitude: x.inputQty, sub: `${x.openedBags} × ${fmtKg(x.sourceBagSize)} · ${x.sourceLotId} @ ${locLabel(x.fromLoc)}`, done: true },
        { key: 'prop', label: 'Repack proposal', value: `${x.outputBags} × ${fmtKg(x.targetBagSize)}`, magnitude: x.measuredOutput, sub: `recorded by ${userName(x.requestedBy)}`, done: true },
        { key: 'qc', label: 'QC release', value: posted ? 'Released' : rejected ? 'Rejected' : 'Waiting', status: posted ? { label: `by ${userName(x.decidedBy)}`, tone: 'good' } : rejected ? { label: 'No stock change', tone: 'bad' } : { label: 'Independent checker', tone: 'warn' }, current: x.status === 'pending_qc', done: posted },
        { key: 'new', label: 'New packs', value: posted ? fmtKg(x.measuredOutput) : '—', magnitude: posted ? x.measuredOutput : 0, sub: posted ? `${x.outputBags} packs · ${x.childLotId ?? ''}` : 'created on release', exits: x.loss ? [{ label: `Loss${x.lossReason ? ` (${x.lossReason})` : ''}`, value: fmtKg(x.loss), tone: 'warn' }] : undefined, done: posted },
      ]}
    />
  );
}

// ---------------------------------------------------------------- Replenishment

export function ReplenishGraphics({ list }: { list: Suggestion[] }) {
  const due = list.filter((x) => x.qty > 0);
  const segs: Seg[] = [
    { key: 'current', label: 'Suggested — current data', color: CAT[0] },
    { key: 'stale', label: 'Suggested — stale data, confirm first', color: STATUS.warn, pattern: true },
  ];
  // short chart label (the full title stays in the table below) — e.g. "Partner D04 A1", "Raw toor"
  const short = (x: Suggestion) => (x.partyId ? `Partner ${x.partyId}${x.grade ? ` ${x.grade}` : ''}` : x.kind === 'raw' ? 'Raw toor (plant)' : x.title);
  const row = (x: Suggestion): BarRow => ({ id: x.key, label: short(x), text: short(x), values: { [x.freshness === 'stale' ? 'stale' : 'current']: x.qty }, note: `by ${x.orderBy}` });
  const kgRows = due.filter((x) => x.unit === 'kg').map(row);
  const countRows = due.filter((x) => x.unit !== 'kg').map(row);
  const unit = due.find((x) => x.unit !== 'kg')?.unit ?? 'packs';
  return (
    <ChartGrid>
      <StackBars title="Suggested quantities (kg)" caption="raw toor and partner refills · nothing is ordered until reviewed" segs={segs} rows={kgRows} rowHeader="Item" empty="No kg suggestions right now." />
      <StackBars title={`Suggested stores (${unit === 'bags' ? 'bags / pouches' : unit})`} caption="counts · critical packaging below minimum" segs={segs} rows={countRows} rowHeader="Item" format={(n) => `${(n / 1000).toLocaleString('en-IN')}`} empty="No stores below minimum." />
    </ChartGrid>
  );
}
