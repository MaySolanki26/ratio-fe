/** Grading: G1 size and G2 quality × size child lots, balance per run, controlled re-grade. */
import { userName } from '../../domain/rentio/access';
import { requestRegrade } from '../../domain/rentio/ops';
import { fmtKg, sum } from '../../domain/rentio/units';
import { useAct, useR } from '../store';
import { GradingGraphics } from './_graphA';
import { canReadLot, scopedRuns, scopedStockRows } from '../../domain/rentio/scope';
import { ImplNote, FormButton, Kpi, KpiRow, LotLink, PageLink, Panel, Qty, Ref, RPage, Status, str, Table, useCan, fmtTime, useFocusId } from '../ui';

export default function Grading() {
  const { s, actor, now } = useR();
  const act = useAct();
  const can = useCan();
  const focus = useFocusId();
  // read scope: stage staff see only their stages' runs and the stock positions they may see
  const runs = scopedRuns(s, actor).filter((r) => r.stage === 'G1' || r.stage === 'G2').slice().reverse();
  const rowsInScope = scopedStockRows(s, actor, now);
  const live = (id: string) => rowsInScope.filter((r) => r.lotId === id).reduce((a, r) => a + r.qty, 0);
  const graded = Object.values(s.lots).filter((l) => l.grade && ['DAL', 'PACKED', 'WIP'].includes(l.material) && canReadLot(s, actor, l.id) && live(l.id) > 0);
  const byGrade = new Map<string, number>();
  graded.filter((l) => /^[AB]\d$/.test(l.grade!)).forEach((l) => byGrade.set(l.grade!, (byGrade.get(l.grade!) ?? 0) + live(l.id)));
  const regrades = s.approvals.filter((a) => a.type === 'regrade' && canReadLot(s, actor, String(a.payload.lotId)));
  return (
    <RPage title="Grading & re-grade" description="Grade outputs as linked child lots; the input is used up, never counted twice.">
      <KpiRow>
        {[...byGrade.entries()].map(([g, q]) => (
          <Kpi key={g} label={`Grade ${g} in your area`} value={fmtKg(q)} />
        ))}
        <Kpi label="Re-grade requests pending" value={regrades.filter((a) => a.status === 'pending').length} to={undefined} />
      </KpiRow>
      <GradingGraphics runs={runs} byGrade={byGrade} />
      <Panel title="Grading runs" meta="Every kilogram is classified — an unexplained difference cannot be posted">
        <Table
          rows={runs}
          focus={focus}
          rowKey={(r) => r.id}
          empty="No grading runs yet — use My stage for G1/G2."
          cols={[
            { key: 'id', label: 'Run', render: (r) => <Ref>{r.id}</Ref> },
            { key: 'st', label: 'Stage', render: (r) => r.stage },
            { key: 'in', label: 'Input lot', render: (r) => <LotLink id={r.inputLotId} /> },
            { key: 'q', label: 'Input', num: true, render: (r) => <Qty g={r.inputQty} /> },
            { key: 'out', label: 'Child lots', render: (r) => (r.outputs.length ? r.outputs.filter((o) => o.lotId).map((o) => <span key={o.lotId} className="rt-row" style={{ display: 'inline-flex', marginRight: 8 }}><LotLink id={o.lotId!} /> {fmtKg(o.qty)}</span>) : <Status s={r.status} />) },
            { key: 'loss', label: 'Loss', num: true, render: (r) => fmtKg(sum(r.outputs.filter((o) => o.kind === 'loss').map((o) => o.qty))) },
            { key: 'bal', label: 'Balance', render: (r) => (r.status === 'completed' ? (sum(r.outputs.map((o) => o.qty)) === r.inputQty + sum(r.additions.map((a) => a.qty)) ? 'balanced ✓' : 'check') : '—') },
            { key: 'at', label: 'Completed', render: (r) => fmtTime(r.completedAt) },
          ]}
        />
        <p className="muted">
          Grade outputs: open <PageLink to="production/stage?stage=G2">My stage · G2</PageLink> to record a run.
        </p>
      </Panel>
      <Panel title="Graded stock" meta="What is in stock now, by grade">
        <Table
          rows={graded}
          rowKey={(l) => l.id}
          cols={[
            { key: 'lot', label: 'Lot', render: (l) => <LotLink id={l.id} /> },
            { key: 'g', label: 'Grade', render: (l) => l.grade },
            { key: 'm', label: 'Material', render: (l) => l.label },
            { key: 'root', label: 'Root', render: (l) => l.rootId },
            { key: 'par', label: 'Parent', render: (l) => l.parents.map((p) => p.lotId).join(', ') || '—' },
            { key: 'q', label: 'Live qty', num: true, render: (l) => <Qty g={live(l.id)} strong /> },
            {
              key: 'act',
              label: '',
              render: (l) => (
                <FormButton
                  label="Request re-grade"
                  disabledReason={can('stage.operate', 'request re-grades') && can('quality.hold', 'request re-grades')}
                  title={`Re-grade ${l.id}`}
                  submitLabel="Request approval"
                  note={<>The current grade stays until a different authorized person approves the change.</>}
                  fields={[
                    { key: 'grade', label: 'New grade', type: 'select', required: true, options: ['A1', 'B1', 'A2', 'B2'].filter((g) => g !== l.grade).map((g) => ({ value: g, label: g })) },
                    { key: 'reason', label: 'Reason', type: 'textarea', required: true },
                  ]}
                  onSubmit={(v, key) => act(`Request re-grade ${l.id}`, (ctx) => requestRegrade(ctx, { lotId: l.id, newGrade: str(v.grade), reason: str(v.reason) }), { key, success: (a) => `Approval ${a.id} requested` })}
                />
              ),
            },
          ]}
        />
      </Panel>
      <Panel title="Re-grade requests">
        <Table
          rows={regrades.slice().reverse()}
          rowKey={(a) => a.id}
          empty="No re-grade requests."
          cols={[
            { key: 'id', label: 'Request', render: (a) => <Ref>{a.id}</Ref> },
            { key: 'sum', label: 'Change', render: (a) => a.summary },
            { key: 'why', label: 'Reason', render: (a) => String(a.payload.reason ?? '') },
            { key: 'by', label: 'Requested by', render: (a) => userName(a.requestedBy) },
            { key: 'st', label: 'Status', render: (a) => <Status s={a.status} /> },
            { key: 'dec', label: 'Decided by', render: (a) => (a.decidedBy ? `${userName(a.decidedBy)} · ${fmtTime(a.decidedAt)}` : <PageLink to="home/approvals">Open approvals</PageLink>) },
          ]}
        />
      </Panel>
      <ImplNote>Grading (M3): FR-013 G1/G2 categories, FR-014 linked child lots consuming only the processed input, FR-016 unbalanced runs blocked, FR-015/BR-003 re-grade by maker-checker. Data limited by scopedRuns/scopedStockRows.</ImplNote>
    </RPage>
  );
}
