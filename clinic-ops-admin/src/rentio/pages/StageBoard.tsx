/** Production funnel by stage: queue, running, held, output and pending — derived from the ledger. */
import { InlineAlert } from '../../components/primitives/feedback';
import { hasCap, userName } from '../../domain/rentio/access';
import { reviseEta, runTiming } from '../../domain/rentio/ops';
import { readScope, scopedRuns } from '../../domain/rentio/scope';
import { fmtDuration, fmtKg } from '../../domain/rentio/units';
import { stageFunnel } from '../../domain/rentio/views';
import { useAct, useR } from '../store';
import { Details, Eta, FormButton, fromLocalInput, ImplNote, Kpi, KpiRow, LotLink, PageLink, Panel, Qty, RPage, Status, str, Table, toLocalInput, Who, fmtTime, useFocusId } from '../ui';

export default function StageBoard() {
  const { s, now, actor } = useR();
  const act = useAct();
  const focus = useFocusId();
  const sc = readScope(actor);
  const visible = new Set(scopedRuns(s, actor).map((r) => r.id));
  const funnel = stageFunnel(s, now).filter((f) => sc.factory || sc.stages.includes(f.code));
  const total = (k: 'queue' | 'running' | 'held' | 'output' | 'pendingIn') => funnel.reduce((a, f) => a + f[k], 0);
  const allRuns = funnel.flatMap((f) => f.runs).filter((r) => visible.has(r.run.id));
  const canEta = (stage: string) => hasCap(actor, 'plan.manage') || (hasCap(actor, 'stage.operate') && (actor.scope.stages ?? []).includes(stage));
  const done = s.runs.filter((r) => r.status === 'completed' && visible.has(r.id)).slice().reverse().slice(0, 20);
  return (
    <RPage title="Stage board" description="Material at each stage, who owns it and when it should finish.">
      {focus && !allRuns.some((r) => r.run.id === focus) && !done.some((r) => r.id === focus) && <InlineAlert tone="info">That run is finished or not in your area of work.</InlineAlert>}
      <KpiRow>
        <Kpi label="Waiting to be received" value={fmtKg(total('pendingIn'))} />
        <Kpi label="Queued at stages" value={fmtKg(total('queue'))} />
        <Kpi label="Being processed" value={fmtKg(total('running'))} tone="info" />
        <Kpi label="Paused (on hold)" value={fmtKg(total('held'))} tone={total('held') ? 'warning' : undefined} />
        <Kpi label="Ready to issue" value={fmtKg(total('output'))} />
        <Kpi label="Late or paused runs" value={allRuns.filter((r) => r.t.status !== 'On Track').length} tone={allRuns.some((r) => r.t.status === 'Delayed') ? 'danger' : undefined} />
      </KpiRow>
      <Panel title="Stages" meta={`Process route: ${s.route.stages.join(' → ')} → finished godown`}>
        <Table
          rows={funnel}
          rowKey={(f) => f.code}
          cols={[
            { key: 'st', label: 'Stage', render: (f) => <PageLink to={`production/stage?stage=${f.code}`}>{f.label}</PageLink> },
            { key: 'own', label: 'Owner', render: (f) => f.ownerName },
            { key: 'q', label: 'Queued', num: true, render: (f) => (f.queue + f.pendingIn ? fmtKg(f.queue + f.pendingIn) : '—') },
            { key: 'r', label: 'Processing', num: true, render: (f) => (f.running + f.held ? fmtKg(f.running + f.held) : '—') },
            { key: 'o', label: 'Ready to issue', num: true, render: (f) => (f.output ? fmtKg(f.output) : '—') },
            {
              key: 'bar',
              label: 'Load',
              render: (f) => {
                const sum = f.queue + f.running + f.held + f.output || 1;
                return (
                  <div className="rt-bar" style={{ width: 120 }} aria-hidden="true">
                    <span className="b-queue" style={{ width: `${(f.queue / sum) * 100}%` }} />
                    <span className="b-run" style={{ width: `${(f.running / sum) * 100}%` }} />
                    <span className="b-hold" style={{ width: `${(f.held / sum) * 100}%` }} />
                    <span className="b-out" style={{ width: `${(f.output / sum) * 100}%` }} />
                  </div>
                );
              },
            },
            { key: 'eta', label: 'Next finish', render: (f) => (f.etaUnknown ? <Status s="Delayed" /> : f.nextEta ? fmtTime(f.nextEta) : '—') },
          ]}
        />
      </Panel>
      <Panel title="Runs in progress" meta="The planned finish never changes; a revised finish needs a named person and a reason">
        <Table
          rows={allRuns}
          rowKey={(r) => r.run.id}
          focus={focus}
          empty="No runs in progress."
          cols={[
            { key: 'st', label: 'Stage', render: (r) => `${r.run.stage}${r.run.pass > 1 ? ` pass ${r.run.pass}` : ''}` },
            { key: 'lot', label: 'Lot', render: (r) => <LotLink id={r.run.inputLotId} /> },
            { key: 'q', label: 'Qty', num: true, render: (r) => <Qty g={r.run.inputQty} /> },
            { key: 's', label: 'Status', render: (r) => <Status s={r.t.status} /> },
            { key: 'b', label: 'Planned finish', render: (r) => fmtTime(r.t.baselineFinish) },
            { key: 'f', label: 'Expected finish', render: (r) => <Eta t={r.t} /> },
            { key: 'd', label: 'Late by', num: true, render: (r) => (r.t.delayMs ? fmtDuration(r.t.delayMs) : '—') },
            { key: 'o', label: 'Who acts', render: (r) => <Who id={r.run.ownerId} /> },
            {
              key: 'x',
              label: '',
              render: (r) => (
                <FormButton
                  label="Update ETA"
                  icon="calendar-clock"
                  variant={r.t.etaSource === 'needs_update' ? 'primary' : 'secondary'}
                  disabledReason={canEta(r.run.stage) ? undefined : `${actor.roleLabel} cannot change this stage's finish time`}
                  title={`New finish time · ${r.run.inputLotId}`}
                  submitLabel="Save revised finish"
                  note={<>Planned finish {fmtTime(r.t.baselineFinish)} stays on record. Give your best estimate and what it depends on.</>}
                  fields={[
                    { key: 'eta', label: 'Expected finish (IST)', type: 'datetime', },
                    { key: 'reason', label: 'Reason / what it depends on', type: 'textarea', required: true },
                  ]}
                  initial={{ eta: toLocalInput(new Date(Date.parse(now) + 2 * 3_600_000).toISOString()) }}
                  onSubmit={(v, key) => act(`Revise ETA for ${r.run.inputLotId}`, (ctx) => reviseEta(ctx, { runId: r.run.id, eta: fromLocalInput(String(v.eta)), reason: str(v.reason) }), { key, success: () => 'Revised finish recorded' })}
                />
              ),
            },
          ]}
        />
        {allRuns.some((r) => r.run.etaRevisions?.length) && (
          <Details summary="Finish-time revisions">
            <Table
              rows={allRuns.flatMap((r) => (r.run.etaRevisions ?? []).map((e, i) => ({ r, e, i })))}
              rowKey={(x) => `${x.r.run.id}-${x.i}`}
              cols={[
                { key: 'l', label: 'Lot', render: (x) => x.r.run.inputLotId },
                { key: 'at', label: 'Recorded', render: (x) => fmtTime(x.e.at) },
                { key: 'by', label: 'By', render: (x) => userName(x.e.by) },
                { key: 'eta', label: 'New finish', render: (x) => fmtTime(x.e.eta) },
                { key: 'why', label: 'Reason', render: (x) => x.e.reason },
              ]}
            />
          </Details>
        )}
      </Panel>
      <Details summary={`Completed runs (${done.length})`}>
        <Table
          rows={done}
          rowKey={(r) => r.id}
          focus={focus}
          cols={[
            { key: 'st', label: 'Stage', render: (r) => `${r.stage}${r.pass > 1 ? ` pass ${r.pass}` : ''}` },
            { key: 'lot', label: 'Lot', render: (r) => <LotLink id={r.inputLotId} /> },
            { key: 'base', label: 'Planned finish', render: (r) => fmtTime(r.baselineFinish) },
            { key: 'fin', label: 'Actual finish', render: (r) => fmtTime(r.completedAt) },
            { key: 't', label: 'Active / paused / late', render: (r) => { const t = runTiming(r, now); return `${fmtDuration(t.activeMs)} / ${fmtDuration(t.heldMs)} / ${fmtDuration(t.delayMs)}`; } },
            { key: 'holds', label: 'Pauses', render: (r) => r.events.filter((e) => e.type === 'hold').map((e) => e.reason).join('; ') || '—' },
          ]}
        />
      </Details>
      <ImplNote>
        Production and stage tracking (M4): FR-072 funnel, FR-073 baseline vs revised forecast — an overdue run shows "ETA needs update" instead of a computed time; revisions record person, reason and time (reviseEta) and never change the baseline. Elapsed = finish − start; active excludes holds. Runs filtered by scopedRuns.
      </ImplNote>
    </RPage>
  );
}
