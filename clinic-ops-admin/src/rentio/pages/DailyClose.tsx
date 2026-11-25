/** Daily close: summary prefilled from postings; open work is carried forward explicitly. */
import { useState } from 'react';
import { InlineAlert } from '../../components/primitives/feedback';
import { Button } from '../../components/primitives/Button';
import { confirmDailyClose } from '../../domain/rentio/close';
import { STAGES } from '../../domain/rentio/data';
import { outstanding, runTiming } from '../../domain/rentio/ops';
import type { StageCode } from '../../domain/rentio/types';
import { fmtKg, sum } from '../../domain/rentio/units';
import { newKey, useAct, useR } from '../store';
import { CloseGraphics } from './_graphA';
import { readScope, scopedHandovers, scopedRuns } from '../../domain/rentio/scope';
import { Details, ImplNote, Kpi, KpiRow, LotLink, Panel, Ref, RPage, Status, Table, Who, fmtTime } from '../ui';

const istDate = (iso: string) => new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10);

export default function DailyClose() {
  const { s, actor, now } = useR();
  const act = useAct();
  const mine = (actor.scope.stages ?? []) as StageCode[];
  const [stage, setStage] = useState<string>(mine[0] ?? 'ALL');
  const [date, setDate] = useState(istDate(now));
  const [note, setNote] = useState('');
  const [key] = useState(() => newKey('close'));
  // read scope: stage staff close only their own stages; plant roles may close the whole factory
  const sc = readScope(actor);
  const stageChoices = STAGES.filter((st) => sc.factory || sc.stages.includes(st.code));
  const inStage = (st?: string) => (stage === 'ALL' ? sc.factory || sc.stages.includes(st as StageCode) : st === stage);
  const runsInScope = scopedRuns(s, actor);
  const completed = runsInScope.filter((r) => r.completedAt && istDate(r.completedAt) === date && inStage(r.stage));
  const open = runsInScope.filter((r) => r.status !== 'completed' && inStage(r.stage));
  const pending = scopedHandovers(s, actor).filter((h) => outstanding(h) > 0 && (inStage(h.toStage) || inStage(s.locations[h.fromLoc]?.stage)));
  const holds = sc.factory ? s.holds.filter((h) => h.status === 'active') : [];
  const approvals = s.approvals.filter((a) => a.status === 'pending' && (sc.factory || a.requestedBy === actor.id));
  const carried = [
    ...open.map((r) => `${r.stage} run on ${r.inputLotId} still open (${runTiming(r, now).status})`),
    ...pending.map((h) => `${h.lotId}: ${fmtKg(outstanding(h))} not yet received at ${h.toStage}`),
    ...approvals.map((a) => `Waiting for approval: ${a.summary}`),
  ];
  const already = (s.closes ?? []).find((c) => c.date === date && c.stage === stage);
  return (
    <RPage title="Daily close" description="Confirm today's work; anything still open is carried to the next shift, never marked done.">
      <div className="rt-row">
        <label className="field-label" htmlFor="dc-stage">Scope</label>
        <select id="dc-stage" className="input" style={{ maxWidth: 240 }} value={stage} onChange={(e) => setStage(e.target.value)}>
          {(sc.factory || stageChoices.length > 1) && <option value="ALL">{sc.factory ? 'Whole factory' : 'All my stages'}</option>}
          {stageChoices.map((st) => (
            <option key={st.code} value={st.code}>{st.label}</option>
          ))}
        </select>
        <label className="field-label" htmlFor="dc-date">Date</label>
        <input id="dc-date" className="input" type="date" style={{ maxWidth: 180 }} value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <KpiRow>
        <Kpi label="Runs completed" value={completed.length} note={fmtKg(sum(completed.flatMap((r) => r.outputs.filter((o) => o.kind === 'forward').map((o) => o.qty))))} />
        <Kpi label="Open runs carried" value={open.length} tone={open.length ? 'warning' : undefined} />
        <Kpi label="Pending handovers" value={pending.length} tone={pending.some((h) => h.received > 0) ? 'danger' : undefined} />
        <Kpi label="Active holds" value={holds.length} />
        <Kpi label="Pending approvals" value={approvals.length} />
      </KpiRow>
      <CloseGraphics completed={completed} open={open} now={now} />
      <Panel title="Completed today">
        <Table rows={completed} rowKey={(r) => r.id} empty="No runs completed on this date." cols={[
          { key: 'id', label: 'Run', render: (r) => <Ref>{r.id}</Ref> },
          { key: 'st', label: 'Stage', render: (r) => r.stage },
          { key: 'lot', label: 'Input', render: (r) => <LotLink id={r.inputLotId} /> },
          { key: 'out', label: 'Outputs', render: (r) => r.outputs.map((o) => `${o.kind}${o.grade ? ` ${o.grade}` : ''} ${fmtKg(o.qty)}`).join(' · ') },
          { key: 'by', label: 'Owner', render: (r) => <Who id={r.ownerId} /> },
        ]} />
      </Panel>
      <Panel title="Carried forward (not resolved by closing)">
        <Table rows={carried} rowKey={(c) => c} empty="Nothing open — clean close." cols={[{ key: 'c', label: 'Open item', render: (c) => c }]} />
      </Panel>
      <Panel title="Confirm close">
        {already ? (
          <InlineAlert tone="success" title={`Closed by ${already.by} at ${fmtTime(already.at)}`}>{already.carried.length} item(s) carried forward. {already.note}</InlineAlert>
        ) : (
          <div className="rt-stack">
            <label className="field-label" htmlFor="dc-note">Supervisor note</label>
            <textarea id="dc-note" className="input textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            <div>
              <Button variant="primary" icon="check" onClick={() => act('Confirm daily close', (ctx) => confirmDailyClose(ctx, { date, stage, carried, note: note || undefined }), { key })}>
                Confirm close with {carried.length} carried item(s)
              </Button>
            </div>
          </div>
        )}
      </Panel>
      <Details summary="Close history">
        <Table rows={(s.closes ?? []).slice().reverse()} rowKey={(c) => c.id} empty="No closes yet." cols={[
          { key: 'd', label: 'Date', render: (c) => c.date },
          { key: 's', label: 'Scope', render: (c) => c.stage },
          { key: 'b', label: 'Confirmed by', render: (c) => <Who id={c.by} /> },
          { key: 'c', label: 'Carried', render: (c) => c.carried.length },
          { key: 'st', label: '', render: () => <Status s="posted" /> },
        ]} />
      </Details>
      <ImplNote>Daily close (FR-024, FR-116): summary prefilled from postings; confirmation records responsibility and carries open runs, handovers and approvals forward without completing them. Scope via readScope/scopedRuns/scopedHandovers.</ImplNote>
    </RPage>
  );
}
