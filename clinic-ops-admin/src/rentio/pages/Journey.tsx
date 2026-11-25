/** RT-001 journey: scenario runner, lot accounting, genealogy, drying-delay example and exception demos. */
import { useState } from 'react';
import { Button } from '../../components/primitives/Button';
import { InlineAlert, useToast } from '../../components/primitives/feedback';
import { Dialog } from '../../components/primitives/overlay';
import { userName } from '../../domain/rentio/access';
import * as C from '../../domain/rentio/commerce';
import { computePositions } from '../../domain/rentio/engine';
import { EXCEPTIONS } from '../../domain/rentio/fixtures';
import * as O from '../../domain/rentio/ops';
import { currentStep, RT001_STEPS } from '../../domain/rentio/scenario';
import { fmtDuration, fmtKg } from '../../domain/rentio/units';
import { lotAccounting } from '../../domain/rentio/views';
import { cx } from '../../lib/format';
import { __failNextWrites, exportDb, importDb, resetDb } from '../../services/db';

function saveBackup() {
  const url = URL.createObjectURL(new Blob([exportDb()], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `rentio-demo-backup-${new Date().toISOString().slice(0, 16).replace(':', '')}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
import { act, newKey, runStep, useR } from '../store';
import { Kpi, KpiRow, PageLink, Panel, Qty, Reason, RPage, Sim, Status, Table, fmtTime } from '../ui';
import { ChartGrid, FlowChain, MASS_SEGS, massRows, RunTimeline, ShareStrip, StackBars } from '../graphics';
import { wsBase } from '../../lib/routes';
import { stageName } from '../../domain/rentio/views';
import { lotOutcome, lotRouteFlow } from '../flows';
import { PageTabs, usePageTab } from './_uxA';

const EXPECTED: [string, number][] = [
  ['Factory finished dal', 4500],
  ['Distributor dal', 3000],
  ['Retailer delivered', 1000],
  ['Husk remaining', 650],
  ['Churi remaining', 175],
  ['Husk internally consumed', 200],
  ['Churi externally dispatched', 100],
  ['Cleaning rejects + recorded process losses', 395],
];

export default function Journey() {
  const { s, db, now } = useR();
  const toast = useToast();
  const [reset, setReset] = useState<null | 'start' | 'completed' | 'demo'>(null);
  const [restoreMsg, setRestoreMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [demo, setDemo] = useState<{ title: string; ok: boolean; text: string } | null>(null);
  const [tab, setTab] = usePageTab(['overview', 'steps', 'trace', 'controls', 'data'] as const, 'overview');
  const step = currentStep(db); // derived from the ledger: steps done from the screens count too
  const acc = s.lots['RT-001'] ? lotAccounting(s, 'RT-001') : null;
  const bucket = (label: string) => {
    if (!acc) return 0;
    const map: Record<string, string[]> = {
      'Factory finished dal': ['FACTORY'],
      'Distributor dal': ['DIST'],
      'Retailer delivered': ['Retailer delivered'],
      'Husk remaining': ['HUSK'],
      'Churi remaining': ['CHURI'],
      'Husk internally consumed': ['By-product internal use'],
      'Churi externally dispatched': ['By-product external dispatch'],
      'Cleaning rejects + recorded process losses': ['REJECT', 'Recorded process / transit loss'],
    };
    return acc.buckets.filter((b) => map[label].includes(b.key)).reduce((a, b) => a + b.qty, 0);
  };
  const dry = s.runs.find((r) => r.stage === 'DRY' && r.inputLotId.startsWith('RT-001'));
  const dryT = dry ? O.runTiming(dry, now) : null;

  const next = () => {
    const r = runStep();
    if (r.ok) toast(`Step done: ${r.result}`, 'success');
    else toast(r.error ?? 'Step failed — nothing posted', 'danger');
  };
  const runDemo = (title: string, fn: () => { ok: boolean; error?: string; duplicate?: boolean; txId?: string }, okText?: string) => {
    const r = fn();
    setDemo({ title, ok: r.ok, text: r.ok ? okText ?? `Posted ${r.txId}${r.duplicate ? ' (duplicate — no second effect)' : ''}` : r.error ?? 'Blocked' });
  };
  const husk = (() => {
    const pos = computePositions(s);
    return pos.get('RT-001/HUSK-PEEL|BYP') ?? 0;
  })();
  const regrade = s.approvals.find((a) => a.type === 'regrade' && a.status === 'pending' && a.requestedBy === 'u_fhead');
  const heldSo = s.orders.find((o) => o.partyId === 'D02' && o.lines[0].grade === 'B1' && o.status === 'approved');

  const exceptionsDetail = EXCEPTIONS;
  const outcome = s.lots['RT-001'] ? lotOutcome(s, 'RT-001') : null;
  const steps = RT001_STEPS;
  const base = wsBase(db.session.workspaceId);
  const runs = s.runs.filter((r) => s.lots[r.inputLotId]?.rootId === 'RT-001').sort((a, b) => a.events[0].at.localeCompare(b.events[0].at));

  return (
    <RPage
      title="Demo script & RT-001 trace"
      description="Presenter tools — not part of daily work. Run or verify the RT-001 scenario, reset or back up the demo data."
      actions={
        <div className="rt-headrow">
          <p className="rt-intro">
            <strong>Presenter area</strong> · data set: {s.dataset === 'completed' ? 'RT-001 completed' : s.dataset === 'demo' ? 'client demo snapshot' : 'starting'}
          </p>
          <div className="rt-row">
            <Button variant="primary" icon="play" onClick={next} disabledReason={step >= steps.length ? 'RT-001 is complete' : undefined}>
              Execute next step
            </Button>
            <Button icon="download" onClick={() => saveBackup()}>
              Download backup
            </Button>
          </div>
        </div>
      }
    >
      <PageTabs
        label="Presenter sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Demo overview' },
          { id: 'steps', label: 'Scenario steps', count: steps.length },
          { id: 'trace', label: 'RT-001 trace' },
          { id: 'controls', label: 'Safety controls' },
          { id: 'data', label: 'Reset & backup' },
        ]}
      >
        {tab === 'overview' && (
          <>
            <KpiRow>
              <Kpi label="RT-001 steps posted" value={`${step} / ${steps.length}`} note={step >= steps.length ? 'Complete' : `Next: ${steps[step]?.title ?? ''}`} />
              <Kpi label="Lot accounting" value={acc ? (acc.balanced ? 'Balanced ✓' : 'Not balanced') : '—'} tone={acc?.balanced ? 'success' : undefined} note={acc ? `${fmtKg(acc.total)} of ${fmtKg(acc.expected)}` : 'RT-001 not received yet'} />
              <Kpi label="Drying run (example)" value={dryT ? `${fmtDuration(dryT.activeMs)} working` : '—'} note={dryT ? `${fmtDuration(dryT.heldMs)} held · ${fmtDuration(dryT.delayMs)} late` : 'after step 6'} />
            </KpiRow>
            <div className="rt-split2">
              <Panel title="Client walkthrough" meta="8–10 minutes · use the demo snapshot">
                <ol className="rt-steps is-compact">
                  {[
                    ['Owner overview', 'Vikram: decisions first, top risks with named people, stock flow.', 'dashboard'],
                    ['Delayed stage', 'Late RT-002 cleaning: planned finish kept, “ETA needs update”.', 'production/stages'],
                    ['Manual handover', 'Anil: receive RT-003/G1, start, record output with oil, issue.', 'home/my-work'],
                    ['Balanced output', 'Peeling: 7,800 main + 1,000 rework + husk, churi, loss.', 'production/stage?stage=PEEL'],
                    ['Finished bags by stack', 'Ravi: F1 stacks with bags and capacity; totals reconcile.', 'stock/godowns'],
                    ['Reserve → dispatch → receive', 'Kiran reserves without moving stock; Dinesh receives.', 'distribution/orders'],
                    ['Retail delivery & trace', 'Trace RT-001 back to Farmer Ramesh: 10,020 kg balanced.', 'finance/reports?focus=RT-001'],
                    ['Controls', 'Held stock cannot ship; nobody approves their own request.', 'stock/holds'],
                  ].map(([t, d, to], i) => (
                    <li key={t} className="rt-step">
                      <span className="rt-step-no">{i + 1}</span>
                      <div>
                        <div className="rt-step-title">{t}</div>
                        <div className="rt-step-detail" data-tooltip={d}>{d}</div>
                      </div>
                      <PageLink to={to}>Open</PageLink>
                    </li>
                  ))}
                </ol>
              </Panel>
              <Panel title="Expected vs derived lot accounting" meta="Live from the movement ledger">
                <Table
                  rows={[...EXPECTED.map(([l, e]) => ({ l, e, a: bucket(l) })), { l: 'Total accounted (10,000 kg raw + 20 kg oil)', e: 10020, a: acc?.total ?? 0 }]}
                  rowKey={(r) => r.l}
                  rowClass={(r) => (r.l.startsWith('Total') ? 'is-total' : undefined)}
                  cols={[
                    { key: 'l', label: 'Bucket', render: (r) => r.l },
                    { key: 'e', label: 'Expected at end', num: true, render: (r) => `${r.e.toLocaleString('en-IN')} kg` },
                    { key: 'a', label: 'Now', num: true, render: (r) => <Qty g={r.a} strong /> },
                    { key: 'ok', label: '', render: (r) => (r.a === r.e * 1000 ? '✓' : '') },
                  ]}
                />
                {acc && acc.buckets.some((b) => b.key.startsWith('WIP') || b.key === 'TRANSIT') && (
                  <p className="muted small">In progress: {acc.buckets.filter((b) => b.key.startsWith('WIP') || b.key === 'TRANSIT').map((b) => `${b.label} ${fmtKg(b.qty)}`).join(' · ')}. The total balances at every step.</p>
                )}
              </Panel>
            </div>
            {outcome && <ShareStrip title="RT-001 — where every kilogram is now" caption="Oil (20 kg) is counted once as a measured addition; cleaning rejects stay held in quarantine" segs={outcome.segs} values={outcome.values} />}
          </>
        )}

        {tab === 'steps' && (
          <Panel title="RT-001 scenario steps" meta={`${step} of ${steps.length} posted · the runner acts as the named people with the scenario's demonstration times`}>
            <ol className="rt-steps is-compact">
              {steps.map((st, i) => (
                <li key={st.id} className={cx('rt-step', i < step && 'is-done', i === step && 'is-next')}>
                  <span className="rt-step-no">{st.id}</span>
                  <div>
                    <div className="rt-step-title">{st.title}</div>
                    <div className="rt-step-detail" data-tooltip={st.detail}>
                      {st.actors.map(userName).join(', ')} · {st.detail}
                    </div>
                  </div>
                  {i < step ? <Status s="posted" /> : i === step ? <Status s="ready" /> : <span className="muted small">to do</span>}
                </li>
              ))}
            </ol>
          </Panel>
        )}

        {tab === 'trace' && (
          <div className="rt-tabpanel">
            {dry && dryT && (
              <Panel title="Drying-delay example" meta="Demonstration values">
                <div className="rt-figs">
                  <Kpi label="Started" value={fmtTime(dryT.start)} />
                  <Kpi label="Planned finish" value={fmtTime(dryT.baselineFinish)} />
                  <Kpi label="Actual finish" value={fmtTime(dryT.actualFinish)} />
                  <Kpi label="Working / held / late" value={`${fmtDuration(dryT.activeMs)} / ${fmtDuration(dryT.heldMs)} / ${fmtDuration(dryT.delayMs)}`} note={dry.events.filter((e) => e.type === 'hold').map((e) => e.reason).join('; ')} />
                </div>
              </Panel>
            )}
            {s.lots['RT-001'] ? (
              <>
                <div className="rt-route-wrap"><FlowChain title="RT-001 — route this lot took" caption="Input kg at each stage pass (incl. oil added) · side exits show what left the main flow there" nodes={lotRouteFlow(s, 'RT-001', base)} /></div>
                {runs.length > 0 && (
                  <ChartGrid>
                    <StackBars title="Each stage pass — where its input went" caption="kg per run in route order" rowHeader="Stage pass" segs={MASS_SEGS} rows={massRows(runs, (r) => `${stageName(r.stage)}${r.pass > 1 ? ` ${r.pass}` : ''}${r.inputLotId !== 'RT-001' && runs.filter((x) => x.stage === r.stage && x.pass === r.pass).length > 1 ? ` · ${r.inputLotId.split('/').pop()}` : ''}`)} />
                    <RunTimeline title="Stage timing — planned vs actual" caption="Holds and lateness per pass (e.g. drying weather hold)" runs={runs} now={now} labelOf={(r) => `${stageName(r.stage)}${r.pass > 1 ? ` ${r.pass}` : ''} · ${r.inputLotId.split('/').pop()}`} />
                  </ChartGrid>
                )}
                <p className="muted small">
                  Genealogy, yield and costing for RT-001: <PageLink to="finance/reports?focus=RT-001">Yield, costing & trace →</PageLink>
                </p>
              </>
            ) : (
              <p className="rt-empty">RT-001 has not been received yet — execute step 1.</p>
            )}
          </div>
        )}

        {tab === 'controls' && (
          <>
            <Panel title="Try the controls live" meta="Each button attempts a real action as the named person; blocked attempts change nothing and are logged" actions={<Sim what="Demo controls" />}>
              <div className="rt-row">
                <Button onClick={() => runDemo('Negative stock (Ravi moves 99,999 kg from F1-S05)', () => act('Demo: oversized transfer', (ctx) => O.transferStock(ctx, { lotId: 'MIG-0001/B1-PK', from: 'F1-S05', to: 'F1-S06', kg: 99999 }), { as: 'u_ravi' }))}>Over-issue stock</Button>
                <Button disabledReason={regrade ? undefined : 'No pending re-grade by Sunita (already decided)'} onClick={() => regrade && runDemo('Self-approval (Sunita approves her own re-grade)', () => act('Demo: self-approval', (ctx) => O.decideApproval(ctx, { approvalId: regrade.id, approve: true }), { as: 'u_fhead' }))}>
                  Self-approve a request
                </Button>
                <Button disabledReason={heldSo ? undefined : 'Held-stock order no longer open'} onClick={() => heldSo && runDemo('Dispatch on held stock (Ravi dispatches SO for D02 B1)', () => act('Demo: dispatch held reservation', (ctx) => C.dispatchOrder(ctx, { orderId: heldSo.id, transporterId: 'TR-01', vehicle: 'MH12-DEMO', driver: 'Demo' }), { as: 'u_ravi' }))}>
                  Dispatch held stock
                </Button>
                <Button
                  disabledReason={husk >= 25000 ? undefined : 'Available once RT-001 Husk exists (step 7+)'}
                  onClick={() => {
                    const key = newKey('dup-demo');
                    const a = act('Demo: Husk internal use 25 kg', (ctx) => O.internalUse(ctx, { lotId: 'RT-001/HUSK-PEEL', loc: 'BYP', kg: 25, purpose: 'Boiler fuel (demo)' }), { key, as: 'u_ravi' });
                    const b = act('Demo: Husk internal use 25 kg', (ctx) => O.internalUse(ctx, { lotId: 'RT-001/HUSK-PEEL', loc: 'BYP', kg: 25, purpose: 'Boiler fuel (demo)' }), { key, as: 'u_ravi' });
                    setDemo({ title: 'Duplicate submission (same request sent twice)', ok: a.ok, text: a.ok ? `First: posted ${a.txId}. Second: ${b.duplicate ? `returned the same ${b.txId} — no second deduction` : 'unexpected'}. Husk went down 25 kg once.` : a.error ?? '' });
                  }}
                >
                  Submit twice
                </Button>
                <Button
                  onClick={() => {
                    __failNextWrites(1);
                    runDemo('Browser storage failure during a save', () => act('Demo: decision during storage failure', (ctx) => ctx.s.decisions.push({ id: 'DEC-DEMO', title: 'Should not persist', answer: '-', scope: '-', by: ctx.actor.id, at: ctx.at }), { as: 'u_owner' }));
                  }}
                >
                  Simulate storage failure
                </Button>
                <PageLink to="sales/salesman">Offline conflicts →</PageLink>
                <PageLink to="finance/tally">Tally failure/retry →</PageLink>
                <PageLink to="production/handovers">Partial receipt →</PageLink>
              </div>
              {demo && (
                <InlineAlert tone={demo.ok ? 'success' : 'warning'} title={`${demo.title}: ${demo.ok ? 'posted' : 'blocked — nothing changed'}`}>
                  {demo.text}
                </InlineAlert>
              )}
            </Panel>
            <Panel title="Exception scenarios" meta="Separate fictional cases built with the same services — they never touch RT-001">
              <Table
                rows={exceptionsDetail}
                rowKey={(e) => e.id}
                cols={[
                  { key: 'id', label: 'Case', render: (e) => <strong>{e.id}</strong> },
                  { key: 't', label: 'Scenario', render: (e) => (<><div>{e.title}</div><div className="muted small"><Reason text={e.detail} /></div></>) },
                  { key: 'w', label: 'Where to see it', render: (e) => e.where },
                ]}
              />
            </Panel>
          </>
        )}

        {tab === 'data' && (
          <div className="rt-split2">
            <Panel title="Reset the demo data" meta="Always asks first — download a backup before resetting">
              <div className="rt-row">
                <Button onClick={() => setReset('demo')}>Reset: demo snapshot</Button>
                <Button onClick={() => setReset('start')}>Reset: starting</Button>
                <Button onClick={() => setReset('completed')}>Reset: completed</Button>
              </div>
              <p className="muted small">Demo snapshot = RT-001 completed plus RT-003 waiting for a manual handover · Starting = RT-001 ready to execute · Completed = all RT-001 steps posted. Exception cases are included in all three.</p>
            </Panel>
            <Panel title="Back up or restore" meta="JSON file · Rentio data only">
              <div className="rt-row">
                <Button icon="download" onClick={() => saveBackup()}>
                  Download backup
                </Button>
                <label className="btn btn-secondary">
                  <span className="btn-label">Restore from file…</span>
                  <input
                    type="file"
                    accept="application/json,.json"
                    hidden
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      try {
                        importDb(await f.text());
                        setRestoreMsg({ ok: true, text: `Restored ${f.name}` });
                      } catch (err) {
                        setRestoreMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
                      }
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
              {restoreMsg && <InlineAlert tone={restoreMsg.ok ? 'success' : 'danger'}>{restoreMsg.text}{restoreMsg.ok ? '' : ' — nothing was changed.'}</InlineAlert>}
            </Panel>
          </div>
        )}
      </PageTabs>

      <Dialog
        open={!!reset}
        onClose={() => setReset(null)}
        size="sm"
        role="alertdialog"
        title={`Reset to the ${reset === 'start' ? 'starting' : reset === 'demo' ? 'demo snapshot' : 'completed'} data set?`}
        footer={
          <>
            <Button onClick={() => setReset(null)} data-autofocus>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                resetDb({ dataset: reset });
                setReset(null);
                setDemo(null);
                toast(`Rentio demo data reset (${reset})`, 'info');
              }}
            >
              Reset Rentio data
            </Button>
          </>
        }
      >
        <p className="muted">All Rentio transactions in this browser are replaced by a freshly replayed {reset === 'start' ? 'starting' : reset === 'demo' ? 'demo snapshot' : 'completed'} data set (exception scenarios included). Clinic example data and personal settings are kept.</p>
        <p>
          <Button icon="download" onClick={() => saveBackup()}>
            Download a backup first
          </Button>
        </p>
      </Dialog>
    </RPage>
  );
}
