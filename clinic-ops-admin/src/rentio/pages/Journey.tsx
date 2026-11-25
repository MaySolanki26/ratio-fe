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
import { LotTrace } from '../LotTrace';
import { Grid, Kpi, KpiRow, LotLink, PageLink, Panel, Qty, RPage, Sim, Status, Table, fmtTime } from '../ui';

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

function GenealogyTree({ id, depth = 0 }: { id: string; depth?: number }) {
  const { s } = useR();
  const kids = Object.values(s.lots).filter((l) => l.parents.some((p) => p.lotId === id));
  const lot = s.lots[id];
  const pos = computePositions(s);
  let live = 0;
  pos.forEach((q, k) => k.startsWith(`${id}|`) && (live += q));
  return (
    <>
      <li style={{ paddingLeft: depth * 16 }}>
        <LotLink id={id} /> <span className="muted">{lot.label}</span> {live ? <strong> · live {fmtKg(live)}</strong> : <span className="muted"> · consumed/left</span>}
      </li>
      {kids.map((k) => (
        <GenealogyTree key={k.id} id={k.id} depth={depth + 1} />
      ))}
    </>
  );
}

export default function Journey() {
  const { s, db, now } = useR();
  const toast = useToast();
  const [reset, setReset] = useState<null | 'start' | 'completed' | 'demo'>(null);
  const [restoreMsg, setRestoreMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [demo, setDemo] = useState<{ title: string; ok: boolean; text: string } | null>(null);
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

  return (
    <RPage title="Demo script & RT-001 trace" description="Presenter tools — not part of daily work. Run or verify the RT-001 scenario, reset or back up the demo data.">
      <InlineAlert tone="warning" title="Presenter area">These controls change the demo data in this browser. Staff never need this page.</InlineAlert>
      <Panel title="Client walkthrough (8–10 minutes)" meta="Use the demo snapshot">
        <ol className="rt-steps">
          {[
            ['Owner overview', 'As Vikram (Owner): decisions first, top three risks with named people, then Raw → Processing → Finished → Transit → Distributors.', 'dashboard'],
            ['Delayed stage', 'Open the late RT-002 cleaning run: planned finish kept, “ETA needs update” until Suresh gives a new time with a reason.', 'production/stages'],
            ['Manual handover', 'Switch to Anil Kumar (Oiling). My work shows “Receive RT-003/G1”: receive it, start, record output with 6 kg oil, issue to Conditioning.', 'home/my-work'],
            ['Balanced output', 'Show RT-001 peeling: 7,800 main + 1,000 rework + 700 Husk + 200 Churi + 100 loss — every kilogram classified.', 'production/stage?stage=PEEL'],
            ['Finished bags by stack', 'As Ravi: F1 stacks with bags, grade, capacity; stack totals reconcile to the godown.', 'stock/godowns?focus=F1'],
            ['Reserve → dispatch → receive', 'As Kiran: an order reserves without moving stock; dispatch moves it to transit; Dinesh (D01) receives it.', 'distribution/orders'],
            ['Retail delivery & trace', 'D01 delivers to a retailer (deducts once); trace RT-001 back to Farmer Ramesh: 10,020 kg balanced.', 'finance/reports?focus=RT-001'],
            ['Controls', 'Held stock cannot ship (D02 order); Kiran cannot approve his own intake; try the safety buttons below.', 'stock/holds'],
          ].map(([t, d, to], i) => (
            <li key={t} className="rt-step">
              <span className="rt-step-no">{i + 1}</span>
              <div>
                <div className="rt-step-title">{t}</div>
                <div className="rt-step-detail">{d}</div>
              </div>
              <PageLink to={to}>Open</PageLink>
            </li>
          ))}
        </ol>
      </Panel>
      <KpiRow>
        <Kpi label="Data set" value={s.dataset === 'completed' ? 'RT-001 completed' : s.dataset === 'demo' ? 'Client demo snapshot' : 'Starting (execute RT-001)'} note={`${step} of ${RT001_STEPS.length} RT-001 steps posted`} />
        <Kpi label="Lot accounting" value={acc ? (acc.balanced ? 'Balanced ✓' : 'Not balanced') : '—'} tone={acc?.balanced ? 'success' : undefined} note={acc ? `${fmtKg(acc.total)} accounted of ${fmtKg(acc.expected)}` : 'RT-001 not received yet'} />
        <Kpi label="Drying run (example)" value={dryT ? `${fmtDuration(dryT.activeMs)} active` : '—'} note={dryT ? `${fmtDuration(dryT.heldMs)} held · ${fmtDuration(dryT.delayMs)} delay` : 'after step 6'} />
      </KpiRow>
      <InlineAlert tone="info" title="How to run it">
        Execute each step yourself from the role screens (switch user in the account menu — e.g. Kiran for intake, Meera to check, Suresh for cleaning), or use “Execute next step”. The runner calls the same services as the screens, acting as the named role users with the scenario's demonstration times. Reset returns to a clean starting or completed data set.
      </InlineAlert>
      <Grid cols={2}>
        <Panel
          title="Scenario steps"
          meta={`${step}/${RT001_STEPS.length}`}
          actions={
            <>
              <Button variant="primary" icon="play" onClick={next} disabledReason={step >= RT001_STEPS.length ? 'RT-001 is complete' : undefined}>
                Execute next step
              </Button>
              <Button onClick={() => setReset('demo')}>Reset: demo snapshot</Button>
              <Button onClick={() => setReset('start')}>Reset: starting</Button>
              <Button onClick={() => setReset('completed')}>Reset: completed</Button>
            </>
          }
        >
          <ol className="rt-steps">
            {RT001_STEPS.map((st, i) => (
              <li key={st.id} className={cx('rt-step', i < step && 'is-done', i === step && 'is-next')}>
                <span className="rt-step-no">{st.id}</span>
                <div>
                  <div className="rt-step-title">{st.title}</div>
                  <div className="rt-step-detail">{st.detail}</div>
                  <div className="rt-step-detail">By: {st.actors.map(userName).join(', ')}</div>
                </div>
                {i < step ? <Status s="posted" /> : i === step ? <Status s="ready" /> : null}
              </li>
            ))}
          </ol>
        </Panel>
        <div className="rt-stack">
          <Panel title="Expected vs derived lot accounting" meta="Derived live from the movement ledger">
            <Table
              rows={[...EXPECTED.map(([l, e]) => ({ l, e, a: bucket(l) })), { l: 'Total accounted (10,000 kg raw + 20 kg oil)', e: 10020, a: acc?.total ?? 0 }]}
              rowKey={(r) => r.l}
              rowClass={(r) => (r.l.startsWith('Total') ? 'is-total' : undefined)}
              cols={[
                { key: 'l', label: 'Bucket', render: (r) => r.l },
                { key: 'e', label: 'Expected at end', num: true, render: (r) => `${r.e.toLocaleString('en-IN')} kg` },
                { key: 'a', label: 'Now (derived)', num: true, render: (r) => <Qty g={r.a} strong /> },
                { key: 'ok', label: '', render: (r) => (r.a === r.e * 1000 ? '✓' : '') },
              ]}
            />
            {acc && acc.buckets.some((b) => b.key.startsWith('WIP') || b.key === 'TRANSIT') && (
              <p className="muted">
                In progress: {acc.buckets.filter((b) => b.key.startsWith('WIP') || b.key === 'TRANSIT').map((b) => `${b.label} ${fmtKg(b.qty)}`).join(' · ')}. The total still balances at every step.
              </p>
            )}
            <p className="muted">Oil (20 kg) is counted once, as a measured addition crossing into the lot; stores oil decreased by the same 20 kg. Cleaning rejects stay physically held in quarantine.</p>
          </Panel>
          {dry && dryT && (
            <Panel title="Drying-delay example (demonstration values)">
              <dl className="rt-dl">
                <dt>Start</dt>
                <dd>{fmtTime(dryT.start)}</dd>
                <dt>Original finish (baseline)</dt>
                <dd>{fmtTime(dryT.baselineFinish)}</dd>
                <dt>Hold</dt>
                <dd>{dry.events.filter((e) => e.type !== 'start' && e.type !== 'complete').map((e) => `${e.type} ${fmtTime(e.at)}${e.reason ? ` (${e.reason})` : ''}`).join(' → ')}</dd>
                <dt>Actual finish</dt>
                <dd>{fmtTime(dryT.actualFinish)}</dd>
                <dt>Active / held / delay</dt>
                <dd>
                  <strong>
                    {fmtDuration(dryT.activeMs)} / {fmtDuration(dryT.heldMs)} / {fmtDuration(dryT.delayMs)}
                  </strong>
                </dd>
              </dl>
            </Panel>
          )}
          {s.lots['RT-001'] && (
            <Panel title="RT-001 genealogy" meta="Parents are history, not extra stock">
              <ul className="rt-steps" style={{ gap: 2 }}>
                <GenealogyTree id="RT-001" />
              </ul>
            </Panel>
          )}
        </div>
      </Grid>

      {s.lots['RT-001'] && <LotTrace rootId="RT-001" />}

      <Panel title="Exception scenarios" meta="Separate fictional cases built with the same services — they never touch RT-001">
        <Table
          rows={EXCEPTIONS}
          rowKey={(e) => e.id}
          cols={[
            { key: 'id', label: 'Case', render: (e) => <strong>{e.id}</strong> },
            { key: 't', label: 'Scenario', render: (e) => (<><div>{e.title}</div><div className="muted">{e.detail}</div></>) },
            { key: 'w', label: 'Where to see it', render: (e) => e.where },
          ]}
        />
      </Panel>

      <Panel title="Try the controls live" meta="Each button attempts a real action as the named user; blocked attempts change nothing and are logged">
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
          <Sim what="Demo controls" />
        </div>
        {demo && (
          <InlineAlert tone={demo.ok ? 'success' : 'warning'} title={`${demo.title}: ${demo.ok ? 'posted' : 'blocked — nothing changed'}`}>
            {demo.text}
          </InlineAlert>
        )}
      </Panel>

      <Panel title="Back up or restore this browser's demo data" meta="JSON file · Rentio data only">
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
