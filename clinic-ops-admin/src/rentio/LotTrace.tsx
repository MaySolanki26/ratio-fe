/** Graphical lot trace: route taken, where every kilogram went, run timing, mass balance and genealogy. */
import { canReadLot } from '../domain/rentio/scope';
import { fmtKg } from '../domain/rentio/units';
import { stageName } from '../domain/rentio/views';
import { wsBase } from '../lib/routes';
import { genealogy, lotOutcome, lotRouteFlow } from './flows';
import { ChartGrid, FlowChain, GenealogyTree, MASS_SEGS, massRows, RunTimeline, ShareStrip, StackBars } from './graphics';
import { useR } from './store';

export function LotTrace({ rootId }: { rootId: string }) {
  const { s, db, actor, now } = useR();
  if (!s.lots[rootId] || !canReadLot(s, actor, rootId)) return null;
  const base = wsBase(db.session.workspaceId);
  const runs = s.runs.filter((r) => s.lots[r.inputLotId]?.rootId === rootId).sort((a, b) => a.events[0].at.localeCompare(b.events[0].at));
  const out = lotOutcome(s, rootId);
  const tree = genealogy(s, actor, rootId, base);
  const balanced = out.total === out.expected;
  return (
    <section className="rt-stack" aria-label={`${rootId} graphical trace`}>
      <FlowChain title={`${rootId} — route this lot took`} caption="Input kg at each stage pass (incl. oil added) · side exits show what left the main flow there" nodes={lotRouteFlow(s, rootId, base)} />
      <ShareStrip
        title={`${rootId} — where all ${fmtKg(out.total)} is now`}
        caption={`${balanced ? 'Balanced ✓' : 'NOT balanced'}: ${fmtKg(out.expected)} came in (raw + measured additions) · ${fmtKg(out.total)} accounted`}
        segs={out.segs}
        values={out.values}
      />
      {runs.length > 0 && (
        <ChartGrid>
          <StackBars title="Each stage pass — where its input went" caption="kg per run in route order" rowHeader="Stage pass" segs={MASS_SEGS} rows={massRows(runs, (r) => `${stageName(r.stage)}${r.pass > 1 ? ` ${r.pass}` : ''}${r.inputLotId !== rootId && runs.filter((x) => x.stage === r.stage && x.pass === r.pass).length > 1 ? ` · ${r.inputLotId.split('/').pop()}` : ''}`)} />
          <RunTimeline title="Stage timing — planned vs actual" caption="Holds and lateness per pass (e.g. drying weather hold)" runs={runs} now={now} labelOf={(r) => `${stageName(r.stage)}${r.pass > 1 ? ` ${r.pass}` : ''} · ${r.inputLotId.split('/').pop()}`} />
        </ChartGrid>
      )}
      {tree && <GenealogyTree title={`${rootId} — genealogy`} caption="Each box is a child lot; the bar shows what is still physically there (parents are history, not extra stock)" root={tree} scale={out.expected} />}
    </section>
  );
}
