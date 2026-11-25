import { Button } from '../../components/primitives/Button';
import { InlineAlert } from '../../components/primitives/feedback';
import { hasCap, userName } from '../../domain/rentio/access';
import { DEMO } from '../../domain/rentio/config';
import { STAGES } from '../../domain/rentio/data';
import { outstanding, runTiming } from '../../domain/rentio/ops';
import * as P from '../../domain/rentio/people';
import type { StageCode } from '../../domain/rentio/types';
import { fmtDuration, fmtKg, kg, sum } from '../../domain/rentio/units';
import { lotAccounting, stageFunnel, yieldReport } from '../../domain/rentio/views';
import { useAct, useR } from '../store';
import { Eta, FormButton, Grid, ImplNote, Kpi, KpiRow, LotLink, num, Panel, Reason, Ref, RPage, Status, str, Table, fmtTime, useCan, type FieldSpec } from '../ui';
import { ForecastChart, TargetChart } from './_graphB';

const istDay = (iso: string) => new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10);

export default function Season() {
  const { s, now, actor } = useR();
  const run = useAct();
  const can = useCan();
  const today = istDay(now);
  const stageOpts = STAGES.map((x) => ({ value: x.code, label: `${x.code} · ${x.label}` }));
  const lotOpts = Object.values(s.lots)
    .filter((l) => l.nextStage && l.nextStage !== 'F1' && l.nextStage !== 'R1')
    .map((l) => ({ value: l.id, label: `${l.id} → ${l.nextStage}` }));
  const planFields: FieldSpec[] = [
    { key: 'date', label: 'Plan date', type: 'text', required: true },
    ...[1, 2, 3].flatMap((i): FieldSpec[] => [
      { key: `stage${i}`, label: `Item ${i} stage`, type: 'select', options: stageOpts, required: i === 1 },
      { key: `lot${i}`, label: `Item ${i} lot (optional)`, type: 'select', options: lotOpts },
      { key: `kg${i}`, label: `Item ${i} target`, type: 'number', unit: 'kg', min: 0 },
    ]),
  ];

  const activeRuns = s.runs.filter((r) => r.status !== 'completed');
  const holds = s.holds.filter((h) => h.status === 'active');
  const pending = s.handovers.filter((h) => outstanding(h) > 0);
  const todaysPlan = [...s.plans].reverse().find((p) => p.date === today);
  const doneToday = s.runs.filter((r) => r.completedAt && istDay(r.completedAt) === today);
  const actualBy = (st: StageCode) => sum(doneToday.filter((r) => r.stage === st).flatMap((r) => r.outputs.filter((o) => o.kind === 'forward').map((o) => o.qty)));

  // forecast inputs
  const completedRoots = [...new Set(s.runs.filter((r) => r.stage === 'PACK' && r.status === 'completed').map((r) => s.lots[r.inputLotId]?.rootId))].filter((id) => id && s.lots[id]?.material === 'RAW' && lotAccounting(s, id).balanced) as string[];
  const observed = completedRoots.length ? sum(completedRoots.map((id) => yieldReport(s, id).rootYield)) / completedRoots.length : 0;
  const funnel = stageFunnel(s, now);
  const wip = sum(funnel.map((f) => f.queue + f.running + f.held + f.output + f.pendingIn));
  const daily = funnel.find((f) => f.code === 'PACK');
  const packCapacityPerDay = daily ? Math.round((24 * 60 * kg(DEMO.packingKgPerRun)) / daily.plannedMinutes / (s.season.active ? s.season.factor : 1)) : 0;
  const targetRows = STAGES.map((st) => ({ st, target: sum(todaysPlan?.items.filter((i) => i.stage === st.code).map((i) => i.targetQty) ?? []), actual: actualBy(st.code) }));
  const forecastRows = Array.from({ length: 7 }, (_, i) => {
    const day = new Date(Date.parse(`${today}T00:00:00Z`) + (i + 1) * 86_400_000).toISOString().slice(0, 10);
    const cumulativeCap = packCapacityPerDay * (i + 1);
    const projectedTotal = Math.min(Math.round((wip * (s.baseline.yieldPct ?? 0)) / 100), cumulativeCap);
    const prevTotal = Math.min(Math.round((wip * (s.baseline.yieldPct ?? 0)) / 100), packCapacityPerDay * i);
    return { day, out: projectedTotal - prevTotal, cum: projectedTotal };
  });

  return (
    <RPage title="Season, plan & forecast" description="Season settings, today's plan and readiness, shift handover and the gated 7-day forecast.">
      <Grid cols={2}>
        <Panel
          title="Season mode"
          meta={s.season.changedBy ? `Changed by ${userName(s.season.changedBy)} · ${fmtTime(s.season.changedAt)}` : 'Not yet changed'}
          actions={
            <FormButton
              label={s.season.active ? 'Edit season settings' : 'Activate season mode'}
              icon="calendar"
              variant="primary"
              title="Season mode"
              disabledReason={can('season.manage', 'change season mode')}
              note="Applies to NEW runs only: each run stores its season factor and baseline when it starts. Existing runs keep their original baseline (lateness is never erased)."
              fields={[
                { key: 'active', label: 'Season mode active (24/7 shifts, shorter escalation)', type: 'checkbox' },
                { key: 'factor', label: 'Duration factor for new runs', type: 'number', min: 0.1, step: 0.05, required: true, help: 'Demo value — the real factor is still to be agreed' },
                { key: 'esc', label: 'Escalation after', type: 'number', unit: 'hours', min: 0.5, step: 0.5, required: true },
              ]}
              initial={{ active: s.season.active, factor: String(s.season.factor), esc: String(s.season.escalationHours) }}
              submitLabel="Save season settings"
              onSubmit={(v, key) => run('Change season mode', (ctx) => P.setSeason(ctx, { active: !!v.active, factor: num(v.factor), escalationHours: num(v.esc) }), { key })}
            />
          }
        >
          <KpiRow>
            <Kpi label="Season mode" value={s.season.active ? 'Active' : 'Off'} tone={s.season.active ? 'warning' : undefined} />
            <Kpi label="Factor for new runs" value={`× ${s.season.factor}`} />
            <Kpi label="Escalation" value={`${s.season.escalationHours} h`} />
          </KpiRow>
          <Table
            rows={activeRuns}
            rowKey={(r) => r.id}
            empty="No active runs."
            cols={[
              { key: 'r', label: 'Active run', render: (r) => <span title={`Planned ${fmtDuration(r.plannedMinutes * 60_000)}`}><Ref>{r.id}</Ref> {r.stage}</span> },
              { key: 'f', label: 'Stored factor', num: true, render: (r) => `× ${r.seasonFactor}` },
              { key: 'b', label: 'Planned finish', render: (r) => fmtTime(r.baselineFinish) },
              { key: 'e', label: 'Expected finish', render: (r) => <Eta t={runTiming(r, now)} /> },
            ]}
          />
        </Panel>

        <Panel title="Shift handover summary" meta={`As of ${fmtTime(now)} IST · ${activeRuns.length} active runs · ${holds.length} holds · ${pending.length} pending receipts`}>
          <Table
            rows={[
              ...activeRuns.map((r) => ({ k: r.id, what: `${r.stage} run on ${r.inputLotId}`, who: userName(r.ownerId), q: fmtKg(r.inputQty), st: runTiming(r, now).status })),
              ...holds.map((h) => ({ k: h.id, what: `${h.kind} hold on ${h.target}`, who: userName(h.createdBy), q: '—', st: 'on_hold' })),
              ...pending.map((h) => ({ k: h.id, what: `Handover ${h.id} ${h.lotId} → ${h.toStage}`, who: userName(h.issuedBy), q: fmtKg(outstanding(h)), st: h.received ? 'partial' : 'awaiting' })),
            ]}
            rowKey={(r) => r.k}
            empty="Nothing open to hand over."
            cols={[
              { key: 'w', label: 'Open item', render: (r) => r.what },
              { key: 'o', label: 'Responsible', render: (r) => r.who },
              { key: 'q', label: 'Qty', num: true, render: (r) => r.q },
              { key: 's', label: 'Status', render: (r) => <Status s={r.st} /> },
            ]}
          />
          <p className="rt-empty">The incoming shift sees the same references; nothing is retyped and unresolved work stays linked to its history.</p>
        </Panel>
      </Grid>

      <Panel
        title="Daily plan & readiness"
        meta="Blocked items name the constraint and who resolves it"
        actions={
          <FormButton
            label="New daily plan"
            icon="plus"
            variant="primary"
            title="Prepare daily plan"
            disabledReason={can('plan.manage', 'prepare the daily plan')}
            fields={planFields}
            initial={{ date: today }}
            submitLabel="Check readiness & save"
            onSubmit={(v, key) =>
              run(
                'Create daily plan',
                (ctx) =>
                  P.createPlan(ctx, {
                    date: str(v.date),
                    items: [1, 2, 3].filter((i) => str(v[`stage${i}`])).map((i) => ({ stage: str(v[`stage${i}`]) as StageCode, lotId: str(v[`lot${i}`]) || undefined, targetKg: num(v[`kg${i}`]) })),
                  }),
                { key, success: (p) => `${p.id} ${p.status}${p.blockers.length ? ` — ${p.blockers.length} blocker(s)` : ''}` },
              )
            }
          />
        }
      >
        <Table
          rows={[...s.plans].reverse()}
          rowKey={(p) => p.id}
          empty="No plans yet. A plan does not move stock or buy anything; it checks equipment, packing bags and material first."
          cols={[
            { key: 'id', label: 'Plan', render: (p) => <Ref>{p.id}</Ref> },
            { key: 'd', label: 'Date', render: (p) => p.date },
            { key: 'i', label: 'Items', render: (p) => p.items.map((it) => `${it.stage}${it.lotId ? ` ${it.lotId}` : ''} ${fmtKg(it.targetQty)}`).join(' · ') },
            { key: 's', label: 'Status', render: (p) => <Status s={p.status} /> },
            { key: 'b', label: 'Blockers', render: (p) => (p.blockers.length ? <Reason tone="danger" text={p.blockers.join('; ')} /> : 'None') },
            {
              key: 'x',
              label: '',
              render: (p) =>
                p.status !== 'released' ? (
                  <Button size="compact" variant="primary" disabledReason={can('plan.manage', 'release plans')} onClick={() => run(`Release ${p.id}`, (ctx) => P.releasePlan(ctx, p.id))}>
                    Re-check & release
                  </Button>
                ) : (
                  `Released by ${userName(p.releasedBy)}`
                ),
            },
          ]}
        />
        <TargetChart rows={targetRows.map((r) => ({ code: r.st.code, label: r.st.label, target: r.target, actual: r.actual }))} />
      </Panel>

      <Panel title="Seven-day forecast" meta="Projected output — not stock, cannot be reserved">
        {!s.baseline.approved ? (
          <div className="rt-stack">
            <InlineAlert tone="warning" title="Baseline pending — forecast disabled">
              An owner-approved yield baseline from {DEMO.baselineLotsRequired}–30 suitable lots is required. {completedRoots.length} completed, balanced lot(s) available; no authoritative prediction is shown.
            </InlineAlert>
            <Table
              rows={completedRoots}
              rowKey={(id) => id}
              empty="No completed lots yet."
              cols={[
                { key: 'l', label: 'Candidate lot', render: (id) => <LotLink id={id} /> },
                { key: 'y', label: 'Root yield', num: true, render: (id) => `${(yieldReport(s, id).rootYield * 100).toFixed(2)}%` },
              ]}
            />
            <div className="rt-row">
              <FormButton
                label="Approve baseline"
                icon="check"
                variant="primary"
                title="Approve yield baseline"
                disabledReason={can('baseline.approve', 'approve the yield baseline (Owner)')}
                note={`Observed mean root yield over ${completedRoots.length} lot(s): ${(observed * 100).toFixed(2)}%.`}
                fields={[
                  { key: 'yield', label: 'Approved root yield', type: 'number', unit: '%', min: 1, step: 0.1, required: true },
                  { key: 'demo', label: 'Demo override: approve with fewer lots (not a production rule)', type: 'checkbox' },
                ]}
                initial={{ yield: (observed * 100).toFixed(1), demo: false }}
                submitLabel="Approve baseline"
                onSubmit={(v, key) => run('Approve yield baseline', (ctx) => P.approveBaseline(ctx, { lots: completedRoots, yieldPct: num(v.yield), demoOverride: !!v.demo }), { key })}
              />
            </div>
          </div>
        ) : (
          <div className="rt-stack">
            <p className="rt-empty">
              Baseline {s.baseline.yieldPct}% approved by {userName(s.baseline.approvedBy)} on {fmtTime(s.baseline.approvedAt)} from {s.baseline.lots.length} lot(s){s.baseline.lots.length < DEMO.baselineLotsRequired ? ' — DEMO override, low confidence' : ''}.
            </p>
            <ForecastChart rows={forecastRows} lowConfidence={s.baseline.lots.length < DEMO.baselineLotsRequired} />
            <Table
              rows={forecastRows}
              rowKey={(r) => r.day}
              cols={[
                { key: 'd', label: 'Day', render: (r) => r.day },
                { key: 'o', label: 'Projected packed output', num: true, render: (r) => fmtKg(r.out) },
                { key: 'c', label: 'Cumulative', num: true, render: (r) => fmtKg(r.cum) },
                { key: 'k', label: 'Confidence', render: () => (s.baseline.lots.length < DEMO.baselineLotsRequired ? 'Low (demo baseline)' : 'Baseline') },
              ]}
            />
            <p className="rt-empty">
              Assumptions: open WIP {fmtKg(wip)} × approved yield, limited by packing capacity ≈ {fmtKg(packCapacityPerDay)}/day (demo: {fmtKg(kg(DEMO.packingKgPerRun))} per planned packing run, season factor applied). Excludes new intake and holds. Projected supply cannot be reserved; advance bookings remain planned demand.
            </p>
          </div>
        )}
      </Panel>
      {hasCap(actor, 'scope.all') || hasCap(actor, 'plan.manage') ? null : <p className="rt-empty">You can view the plan; changes need the Factory Head.</p>}
      <ImplNote>Season mode and forecast (M16): FR-087 season factor applied to new runs only, FR-088 shift handover, FR-118/WF-11 plan readiness, FR-089 target vs actual, FR-090/091 forecast gated by an owner-approved baseline (OQ-20; demo override labelled), BR-025 projection never shown as stock. Expected finish uses the shared ETA rule (no estimate shown once overdue).</ImplNote>
    </RPage>
  );
}
