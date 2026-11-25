/** Stage workspace: Receive → Start → Record output → Issue, prefilled from source records. */
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { InlineAlert } from '../../components/primitives/feedback';
import { hasCap, type RActor } from '../../domain/rentio/access';
import { STAGES, stageInfo } from '../../domain/rentio/data';
import { computePositions, earliestAvailable, fmtIst } from '../../domain/rentio/engine';
import { holdRun, issue, outstanding, receive, recordOutput, resumeRun, reviseEta, runBalance, runTiming, startRun, stageIn, stageOut, type OutputInput } from '../../domain/rentio/ops';
import { readScope, scopedHandovers, scopedRuns, scopedStockRows } from '../../domain/rentio/scope';
import type { Handover, Lot, RentioState, StageCode, StageRun } from '../../domain/rentio/types';
import { fmtDuration, fmtKg, kg } from '../../domain/rentio/units';
import { stageName } from '../../domain/rentio/views';
import { useQuery } from '../../components/primitives/feedback';
import { cx } from '../../lib/format';
import { wsBase } from '../../lib/routes';
import { useAct, useR } from '../store';
import { BasisChip, Details, Eta, FormButton, type FormValues, fromLocalInput, fromLocalInputAfter,ImplNote, LotLink, num, Panel, Qty, Ref, RPage, Status, Steps, str, Table, toLocalInput, useFocusId, Who, fmtTime } from '../ui';

const OUT_FIELDS: Record<StageCode, { fwd: number; grade?: boolean; rework?: boolean; byp?: boolean; reject?: boolean; oil?: boolean; pack?: boolean }> = {
  CLEAN: { fwd: 1, reject: true },
  G1: { fwd: 2, grade: true },
  OIL: { fwd: 1, oil: true },
  COND: { fwd: 1 },
  DRY: { fwd: 1 },
  PEEL: { fwd: 1, rework: true, byp: true },
  G2: { fwd: 3, grade: true },
  PACK: { fwd: 1, pack: true },
};

const Preview = ({ cells }: { cells: { label: string; value: string; key?: boolean; tone?: 'danger' | 'success' }[] }) => (
  <div className="rt-preview" role="status">
    {cells.map((c) => (
      <div key={c.label} className={cx(c.key && 'is-key')}>
        <span>{c.label}</span>
        <strong className={c.tone ? `tone-text-${c.tone}` : undefined}>{c.value}</strong>
      </div>
    ))}
  </div>
);

/** "Earliest allowed … IST · not later than now" — the engine enforces the same bounds. */
export const timeHelp = (earliest?: string) =>
  earliest
    ? `Earliest allowed: ${fmtIst(earliest)}${new Date(earliest).getUTCSeconds() ? ' — choosing that minute records exactly this time' : ''} · not in the future`
    : 'Not in the future';

/** Prefill: now, but never before the earliest allowed time. */
const prefill = (now: string, earliest?: string) => toLocalInput(earliest && earliest > now ? earliest : now);

function TimeInput({ id, label, value, onChange, earliest, now }: { id: string; label: string; value: string; onChange: (v: string) => void; earliest?: string; now: string }) {
  return (
    <div className="form-field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input id={id} className="input" type="datetime-local" min={earliest ? toLocalInput(earliest) : undefined} max={toLocalInput(now)} value={value} onChange={(e) => onChange(e.target.value)} />
      <span className="field-help">{timeHelp(earliest)}</span>
    </div>
  );
}

/** Why this actor cannot operate this stage (undefined = may operate). */
export function stageBlock(actor: RActor, stage: StageCode) {
  if (!hasCap(actor, 'stage.operate')) return `${actor.roleLabel} does not operate stages`;
  if (!hasCap(actor, 'stage.backup') && !(actor.scope.stages ?? []).includes(stage)) return `${actor.name} is not assigned to ${stageName(stage)}`;
  return undefined;
}

// ---------------------------------------------------------------- actions (reused by My Work)

export function ReceiveButton({ h, variant = 'primary' }: { h: Handover; variant?: 'primary' | 'secondary' }) {
  const act = useAct();
  const { actor, now, s } = useR();
  const stage = h.toStage as StageCode;
  const already = h.received;
  const out = outstanding(h);
  const earliest = earliestAvailable(s, h.lotId, `PEND:${h.id}`, out);
  return (
    <FormButton
      label="Receive"
      icon="download"
      variant={variant}
      disabledReason={stageBlock(actor, stage)}
      title={`Receive ${h.lotId} at ${stageName(stage)}`}
      submitLabel="Confirm receipt"
      fields={[]}
      initial={{ qty: String(out / 1000), note: '', at: prefill(now, earliest) }}
      onSubmit={(v, key) =>
        act(`Receive ${h.lotId}`, (ctx) => receive(ctx, { handoverId: h.id, qtyKg: num(v.qty), note: str(v.note) || undefined }), {
          key,
          at: fromLocalInputAfter(String(v.at), earliest),
          ref: h.id,
          success: (r) => (r.residual ? `Received ${fmtKg(r.received)} — ${fmtKg(r.residual)} still outstanding on ${h.id}` : `Received ${fmtKg(r.received)} — handover complete`),
        })
      }
    >
      {(v, set) => {
        const recvNow = kg(num(v.qty));
        const after = out - recvNow;
        return (
          <>
            <Preview
              cells={[
                { label: 'Originally issued', value: fmtKg(h.qty) },
                { label: 'Already received', value: fmtKg(already) },
                { label: 'Outstanding', value: fmtKg(out) },
                { label: 'Receive now', value: fmtKg(recvNow), key: true },
                { label: 'Left outstanding after this', value: after < 0 ? `${fmtKg(-after)} too much` : fmtKg(after), tone: after < 0 ? 'danger' : after === 0 ? 'success' : undefined },
              ]}
            />
            <div className="form-field">
              <label className="field-label" htmlFor="rcv-qty">
                Receive now <span className="req">*</span> <span className="optional">(kg — weigh or count what physically arrived)</span>
              </label>
              <input id="rcv-qty" className="input" type="number" step="any" min={0} value={String(v.qty ?? '')} onChange={(e) => set('qty', e.target.value)} />
              <span className="field-help">
                From {h.lotId} · sent by <Who id={h.issuedBy} /> on {fmtTime(h.issuedAt)} · {h.basis} basis. Anything not received stays on record as outstanding — the sender&apos;s figure is never changed.
              </span>
            </div>
            <div className="form-field">
              <label className="field-label" htmlFor="rcv-note">Note (mismatch, condition)</label>
              <input id="rcv-note" className="input" value={String(v.note ?? '')} onChange={(e) => set('note', e.target.value)} />
            </div>
            <TimeInput id="rcv-at" label="When it arrived (IST)" value={String(v.at ?? '')} onChange={(x) => set('at', x)} earliest={earliest} now={now} />
          </>
        );
      }}
    </FormButton>
  );
}

export function StartButton({ lot, stage, qty, variant = 'primary' }: { lot: Lot; stage: StageCode; qty: number; variant?: 'primary' | 'secondary' }) {
  const act = useAct();
  const { actor, now, s } = useR();
  const info = stageInfo(stage);
  const earliest = earliestAvailable(s, lot.id, stageIn(stage), qty);
  return (
    <FormButton
      label="Start"
      icon="play"
      variant={variant}
      disabledReason={stageBlock(actor, stage) ?? (lot.nextStage !== stage ? `${lot.id} goes to ${lot.nextStage} next` : undefined)}
      title={`Start ${stageName(stage)} · ${lot.id}`}
      submitLabel="Start run"
      note={<>Planned {Math.round(info.plannedMinutes / 6) / 10} h{lot.label ? ` · ${lot.label}` : ''}. The planned finish is fixed when you start.</>}
      fields={[
        { key: 'qty', label: 'Quantity to process', type: 'number', unit: 'kg', required: true, help: `${fmtKg(qty)} queued — anything you leave stays in the queue` },
        { key: 'at', label: 'Start time (IST)', type: 'datetime', min: earliest, max: now, help: timeHelp(earliest) },
      ]}
      initial={{ qty: String(qty / 1000), at: prefill(now, earliest) }}
      onSubmit={(v, key) => act(`Start ${stage} run`, (ctx) => startRun(ctx, { stage, lotId: lot.id, qtyKg: num(v.qty) }), { key, at: fromLocalInputAfter(String(v.at), earliest), success: (r) => `${stageName(stage)} started (${r.id})` })}
    />
  );
}

function outputsFrom(v: FormValues, st: StageCode): OutputInput[] {
  const cfg = OUT_FIELDS[st];
  const out: OutputInput[] = [];
  for (let i = 1; i <= cfg.fwd; i++) if (num(v[`fwd${i}`]) > 0) out.push({ kind: 'forward', kg: num(v[`fwd${i}`]), grade: cfg.grade ? str(v[`grade${i}`]) || undefined : undefined });
  (['rework', 'husk', 'churi', 'reject', 'residual'] as const).forEach((k) => num(v[k]) > 0 && out.push({ kind: k, kg: num(v[k]) }));
  if (num(v.loss) > 0) out.push({ kind: 'loss', kg: num(v.loss), reason: str(v.lossReason) || (st === 'DRY' ? 'Recorded moisture loss' : `${stageName(st)} loss`) });
  return out;
}

/** Stores lots by material within the actor's view, labelled with what is available. */
function storesOptions(s: RentioState, actor: RActor, now: string, material: 'OIL' | 'BAGS') {
  const rows = scopedStockRows(s, actor, now).filter((r) => r.loc === 'STORES' && r.lot.material === material);
  // stage staff do not browse stores; the issued stores lot is offered by name
  const all = rows.length ? rows : Object.values(s.lots).filter((l) => l.material === material).map((l) => ({ lotId: l.id, lot: l, qty: computePositions(s).get(`${l.id}|STORES`) ?? 0 }));
  return all.map((r) => ({ value: r.lotId, label: `${r.lot.label} — ${material === 'BAGS' ? `${(r.qty / 1000).toLocaleString('en-IN')} bags` : fmtKg(r.qty)} in stores` }));
}

export function OutputButton({ run, variant = 'primary' }: { run: StageRun; variant?: 'primary' | 'secondary' }) {
  const act = useAct();
  const { s, now, actor } = useR();
  const cfg = OUT_FIELDS[run.stage];
  const input = s.lots[run.inputLotId];
  const block = stageBlock(actor, run.stage) ?? (run.status === 'on_hold' ? 'Resume the run before recording output' : undefined);
  const oil = cfg.oil ? storesOptions(s, actor, now, 'OIL') : [];
  const bags = cfg.pack ? storesOptions(s, actor, now, 'BAGS') : [];
  const earliest = run.events[run.events.length - 1].at;
  const sel = (k: string, label: string, opts: { value: string; label: string }[], v: FormValues, set: (k: string, x: string) => void) => (
    <div className="form-field">
      <label className="field-label" htmlFor={`o-${k}`}>{label}</label>
      <select id={`o-${k}`} className="input" value={String(v[k] ?? '')} onChange={(e) => set(k, e.target.value)}>
        {opts.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
  return (
    <FormButton
      label="Record output"
      icon="check"
      variant={variant}
      disabledReason={block}
      title={`Record ${stageName(run.stage)} output · ${input.id}`}
      submitLabel="Post balanced output"
      wide
      note={<>Input <strong>{fmtKg(run.inputQty)}</strong> of {input.label}. Put every kilogram in one box below — the total must match; the system never adds a balancing loss.</>}
      fields={[]}
      initial={{ at: prefill(now, earliest), bagSize: '25', bagsLot: bags[0]?.value ?? 'BAGS-25-B01', oilLot: oil[0]?.value ?? 'OIL-B01', netWeight: true, seal: true, label: true }}
      onSubmit={(v, key) =>
        act(
          `Record ${run.stage} output`,
          (ctx) =>
            recordOutput(ctx, {
              runId: run.id,
              outputs: outputsFrom(v, run.stage),
              additions: cfg.oil && num(v.oil) > 0 ? [{ lotId: str(v.oilLot), kg: num(v.oil) }] : undefined,
              packing: cfg.pack ? { bagSizeKg: num(v.bagSize), bagsLotId: str(v.bagsLot), checks: { netWeight: !!v.netWeight, seal: !!v.seal, label: !!v.label } } : undefined,
            }),
          { key, at: fromLocalInputAfter(String(v.at), earliest), ref: run.id, success: (r) => `Output posted: ${r.outputs.filter((o) => o.lotId).map((o) => o.lotId).join(', ')}` },
        )
      }
    >
      {(v, set) => {
        const outs = outputsFrom(v, run.stage).map((o) => ({ kind: o.kind, qty: kg(o.kg) }));
        const add = cfg.oil ? kg(num(v.oil)) : 0;
        const bal = runBalance(run, outs, add);
        const numIn = (k: string, label: string, help?: string) => (
          <div className="form-field" key={k}>
            <label className="field-label" htmlFor={`o-${k}`}>
              {label} <span className="optional">(kg)</span>
            </label>
            <input id={`o-${k}`} className="input" type="number" step="any" min={0} value={String(v[k] ?? '')} onChange={(e) => set(k, e.target.value)} />
            {help && <span className="field-help">{help}</span>}
          </div>
        );
        return (
          <>
            {cfg.oil && (
              <div className="rt-out-row">
                {numIn('oil', 'Oil added from stores', 'Weighed addition; stores reduce by the same amount')}
                {sel('oilLot', 'Oil taken from', oil, v, set)}
                <span />
              </div>
            )}
            {Array.from({ length: cfg.fwd }, (_, i) => i + 1).map((i) => (
              <div className="rt-out-row" key={i}>
                {numIn(`fwd${i}`, cfg.grade ? `Graded output ${i}` : run.stage === 'PACK' ? 'Packed dal (net)' : 'Good output to next stage', i === 1 ? `Goes to ${run.stage === 'PACK' ? 'Finished Godown F1' : stageName(s.route.stages[s.route.stages.indexOf(run.stage) + 1] ?? 'PACK')}` : undefined)}
                {cfg.grade ? (
                  <div className="form-field">
                    <label className="field-label" htmlFor={`o-grade${i}`}>Grade</label>
                    <select id={`o-grade${i}`} className="input" value={String(v[`grade${i}`] ?? '')} onChange={(e) => set(`grade${i}`, e.target.value)}>
                      <option value="">Choose grade…</option>
                      {(run.stage === 'G2' ? ['A1', 'B1', 'A2', 'B2'] : ['Bold', 'Medium', 'Small']).map((g) => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <span />
                )}
                <span />
              </div>
            ))}
            <div className="rt-out-row">
              {cfg.rework && numIn('rework', 'Unpeeled — needs another pass', 'Goes back for re-peeling; not new purchase')}
              {cfg.byp && numIn('husk', 'Husk')}
              {cfg.byp && numIn('churi', 'Churi')}
              {cfg.reject && numIn('reject', 'Cleaning rejects (stones, dirt)', 'Held for QC; never sold as dal or by-product')}
            </div>
            <div className="rt-out-row">
              {numIn('loss', run.stage === 'DRY' ? 'Moisture lost in drying' : 'Process loss', `Normal limit ${stageInfo(run.stage).tolerancePct}% (demo)`)}
              <div className="form-field">
                <label className="field-label" htmlFor="o-lossReason">Why was it lost?</label>
                <input id="o-lossReason" className="input" value={String(v.lossReason ?? '')} onChange={(e) => set('lossReason', e.target.value)} />
              </div>
              {numIn('residual', 'Not processed yet', 'Goes back to the queue')}
            </div>
            {cfg.pack && (
              <div className="rt-stack">
                <div className="rt-out-row">
                  {numIn('bagSize', 'Bag size')}
                  {sel('bagsLot', 'Empty bags taken from', bags, v, set)}
                  <span className="field-help">{num(v.fwd1) && num(v.bagSize) ? `= ${num(v.fwd1) / num(v.bagSize)} bags` : ''}</span>
                </div>
                <div className="rt-row">
                  {(['netWeight', 'seal', 'label'] as const).map((k) => (
                    <label key={k} className="rt-check">
                      <input type="checkbox" checked={!!v[k]} onChange={(e) => set(k, e.target.checked)} /> {k === 'netWeight' ? 'Net weight checked' : k === 'seal' ? 'Bags sealed properly' : 'Batch & grade label correct'}
                    </label>
                  ))}
                </div>
                <span className="field-help">If a check fails, the bags are put on quality hold automatically.</span>
              </div>
            )}
            <TimeInput id="o-at" label="When it finished (IST)" value={String(v.at ?? '')} onChange={(x) => set('at', x)} earliest={earliest} now={now} />
            <Preview
              cells={[
                { label: 'Input', value: fmtKg(run.inputQty) },
                ...(add ? [{ label: 'Oil added', value: fmtKg(add) }] : []),
                { label: 'Accounted for', value: fmtKg(bal.accounted), key: true },
                { label: bal.difference === 0 ? 'Balance' : 'Not yet accounted', value: bal.difference === 0 && outs.length ? 'Balanced ✓' : fmtKg(bal.difference), tone: bal.difference === 0 && outs.length ? 'success' : 'danger' },
              ]}
            />
          </>
        );
      }}
    </FormButton>
  );
}

export function IssueButton({ lot, stage, qty, variant = 'primary' }: { lot: Lot; stage: StageCode; qty: number; variant?: 'primary' | 'secondary' }) {
  const act = useAct();
  const { actor, now, s } = useR();
  const info = stageInfo(stage);
  const earliest = earliestAvailable(s, lot.id, stageOut(stage), qty);
  const dest = lot.nextStage === 'F1' ? 'Finished Godown F1 (godown keeper puts it on stacks)' : lot.nextStage === stage ? `${stageName(stage)} again (rework pass ${lot.pass})` : stageName(lot.nextStage as StageCode);
  return (
    <FormButton
      label="Issue"
      icon="send"
      variant={variant}
      disabledReason={stageBlock(actor, stage) ?? (!lot.nextStage ? 'No next step on the route' : undefined)}
      title={`Issue ${lot.id}`}
      submitLabel="Issue"
      note={<>Goes to <strong>{dest}</strong>. Until they confirm receipt it is in handover custody — not in your stock or theirs.</>}
      fields={[
        { key: 'qty', label: 'Quantity sent', type: 'number', unit: 'kg', required: true },
        { key: 'basis', label: 'How was it measured?', type: 'select', required: true, options: [{ value: 'Actual', label: 'Weighed (Actual)' }, { value: 'Counted', label: 'Counted bags (Counted)' }, { value: 'Carried', label: 'Not weighed — carried from earlier figure' }] },
        { key: 'at', label: 'Sent at (IST)', type: 'datetime', min: earliest, max: now, help: timeHelp(earliest) },
      ]}
      initial={{ qty: String(qty / 1000), basis: stage === 'PACK' ? 'Counted' : info.basis, at: prefill(now, earliest) }}
      onSubmit={(v, key) => act(`Issue ${lot.id}`, (ctx) => issue(ctx, { lotId: lot.id, fromLoc: stageOut(stage), qtyKg: num(v.qty), toStage: lot.nextStage as StageCode | 'F1', basis: str(v.basis) as 'Actual' }), { key, at: fromLocalInputAfter(String(v.at), earliest), success: (h) => `Issued to ${lot.nextStage} (${h.id})` })}
    />
  );
}

export function EtaButton({ run, variant = 'secondary' }: { run: StageRun; variant?: 'primary' | 'secondary' }) {
  const act = useAct();
  const { actor, now } = useR();
  const block = hasCap(actor, 'plan.manage') ? undefined : stageBlock(actor, run.stage);
  return (
    <FormButton
      label="Update ETA"
      icon="calendar-clock"
      variant={variant}
      disabledReason={block}
      title={`New finish time · ${run.inputLotId}`}
      submitLabel="Save new ETA"
      note={<>Planned finish {fmtTime(run.baselineFinish)} stays on record. Your name, time and reason are kept with the new estimate.</>}
      fields={[
        { key: 'eta', label: 'Expected finish (IST)', type: 'datetime' },
        { key: 'reason', label: 'Reason and what it depends on', type: 'textarea', required: true },
      ]}
      initial={{ eta: toLocalInput(new Date(Date.parse(now) + 2 * 3_600_000).toISOString()) }}
      onSubmit={(v, key) => act('Revise ETA', (ctx) => reviseEta(ctx, { runId: run.id, eta: fromLocalInput(String(v.eta)), reason: str(v.reason) }), { key, ref: run.id, success: () => 'New ETA saved' })}
    />
  );
}

export function HoldResumeButton({ run }: { run: StageRun }) {
  const act = useAct();
  const { actor, now } = useR();
  const block = stageBlock(actor, run.stage);
  return run.status === 'running' ? (
    <FormButton
      label="Pause / hold"
      icon="pause"
      variant="ghost"
      disabledReason={block}
      title={`Hold ${stageName(run.stage)} · ${run.inputLotId}`}
      submitLabel="Put on hold"
      fields={[
        { key: 'reason', label: 'Reason', type: 'select', required: true, options: ['Weather hold — rain', 'Machine breakdown', 'Quality check pending', 'Power cut', 'No operator'].map((x) => ({ value: x, label: x })) },
        { key: 'at', label: 'Hold time (IST)', type: 'datetime', min: run.events[run.events.length - 1].at, max: now, help: timeHelp(run.events[run.events.length - 1].at) },
      ]}
      initial={{ at: prefill(now, run.events[run.events.length - 1].at) }}
      onSubmit={(v, key) => act(`Hold ${run.id}`, (ctx) => holdRun(ctx, run.id, str(v.reason)), { key, at: fromLocalInputAfter(String(v.at), run.events[run.events.length - 1].at) })}
    />
  ) : (
    <FormButton
      label="Resume"
      icon="play"
      variant="primary"
      disabledReason={block}
      title={`Resume ${stageName(run.stage)} · ${run.inputLotId}`}
      submitLabel="Resume"
      fields={[{ key: 'at', label: 'Resume time (IST)', type: 'datetime', min: run.events[run.events.length - 1].at, max: now, help: timeHelp(run.events[run.events.length - 1].at) }]}
      initial={{ at: prefill(now, run.events[run.events.length - 1].at) }}
      onSubmit={(v, key) => act(`Resume ${run.id}`, (ctx) => resumeRun(ctx, run.id), { key, at: fromLocalInputAfter(String(v.at), run.events[run.events.length - 1].at) })}
    />
  );
}

// ---------------------------------------------------------------- page

export default function StageWork() {
  const q = useQuery();
  const focus = useFocusId();
  const navigate = useNavigate();
  const { s, db, actor, now } = useR();
  const sc = readScope(actor);
  const allowed = (sc.factory ? STAGES.map((x) => x.code) : sc.stages) as StageCode[];
  const requested = q.get('stage') as StageCode | null;
  const stage = (requested && allowed.includes(requested) ? requested : allowed[0]) as StageCode | undefined;
  if (!stage)
    return (
      <RPage title="My stage" description="No stage assigned">
        <InlineAlert tone="info">You are not assigned to a production stage.</InlineAlert>
      </RPage>
    );
  const info = stageInfo(stage);
  const pos = computePositions(s);
  const at = (lot: string, loc: string) => pos.get(`${lot}|${loc}`) ?? 0;
  const block = stageBlock(actor, stage);
  const incoming = scopedHandovers(s, actor).filter((h) => h.toStage === stage && outstanding(h) > 0);
  const queue = Object.values(s.lots).filter((l) => at(l.id, stageIn(stage)) > 0);
  const runs = scopedRuns(s, actor).filter((r) => r.stage === stage && r.status !== 'completed');
  const outputs = Object.values(s.lots).filter((l) => at(l.id, stageOut(stage)) > 0);
  const done = scopedRuns(s, actor).filter((r) => r.stage === stage && r.status === 'completed').slice(-6).reverse();
  const deniedFocus = requested && !allowed.includes(requested);

  // the one clear next action for this stage (oldest first, held/late work first)
  const late = runs.find((r) => runTiming(r, now).etaSource === 'needs_update' && r.status === 'running');
  let next: { title: string; detail: string; button: ReactNode } | null = null;
  if (runs.some((r) => r.status === 'on_hold')) {
    const r = runs.find((x) => x.status === 'on_hold')!;
    next = { title: `Resume ${r.inputLotId}`, detail: `On hold: ${r.events[r.events.length - 1].reason}`, button: <HoldResumeButton run={r} /> };
  } else if (late) next = { title: `Give a new finish time for ${late.inputLotId}`, detail: `Planned finish ${fmtTime(late.baselineFinish)} has passed`, button: <EtaButton run={late} variant="primary" /> };
  else if (incoming.length) next = { title: `Receive ${incoming[0].lotId}`, detail: `${fmtKg(outstanding(incoming[0]))} waiting from ${s.locations[incoming[0].fromLoc]?.label ?? 'previous stage'}`, button: <ReceiveButton h={incoming[0]} /> };
  else if (runs.length) next = { title: `Record output for ${runs[0].inputLotId}`, detail: `${fmtKg(runs[0].inputQty)} in process since ${fmtTime(runs[0].events[0].at)}`, button: <OutputButton run={runs[0]} /> };
  else if (outputs.length) next = { title: `Issue ${outputs[0].id} onward`, detail: `${fmtKg(at(outputs[0].id, stageOut(stage)))} ready to send`, button: <IssueButton lot={outputs[0]} stage={stage} qty={at(outputs[0].id, stageOut(stage))} /> };
  else if (queue.length) next = { title: `Start ${queue[0].id}`, detail: `${fmtKg(at(queue[0].id, stageIn(stage)))} received and waiting`, button: <StartButton lot={queue[0]} stage={stage} qty={at(queue[0].id, stageIn(stage))} /> };

  const stepState = (n: number, active: boolean) => (n > 0 ? 'current' : active ? 'done' : 'pending') as 'current' | 'done' | 'pending';
  return (
    <RPage title={`My stage · ${stageName(stage)}`} description="Receive the material sent to you, start, record what came out, and send it onward.">
      <div className="rt-row">
        <label className="field-label" htmlFor="stage-pick">Stage</label>
        <select id="stage-pick" className="input" style={{ maxWidth: 260 }} value={stage} onChange={(e) => navigate(`${wsBase(db.session.workspaceId)}/production/stage?stage=${e.target.value}`)}>
          {allowed.map((code) => (
            <option key={code} value={code}>
              {stageInfo(code).label}
            </option>
          ))}
        </select>
        <span className="muted">
          Owner <Who id={info.owner} /> · backup <Who id={info.backup} />
        </span>
      </div>
      {deniedFocus && <InlineAlert tone="warning">That stage is not in your area of work.</InlineAlert>}
      {block && <InlineAlert tone="info">View only — {block}.</InlineAlert>}
      <Steps
        steps={[
          { label: 'Receive', state: stepState(incoming.length, queue.length + runs.length + outputs.length > 0), note: incoming.length ? `${incoming.length} waiting` : undefined },
          { label: 'Start', state: stepState(queue.length, runs.length + outputs.length > 0), note: queue.length ? `${queue.length} queued` : undefined },
          { label: 'Record output', state: stepState(runs.length, outputs.length > 0), note: runs.length ? `${runs.length} in process` : undefined },
          { label: 'Issue', state: stepState(outputs.length, false), note: outputs.length ? `${outputs.length} ready` : undefined },
        ]}
      />
      {next ? (
        <div className="rt-next" aria-live="polite">
          <div>
            <div className="muted">Next action</div>
            <div className="rt-next-title">{next.title}</div>
            <div className="muted">{next.detail}</div>
          </div>
          {next.button}
        </div>
      ) : (
        <InlineAlert tone="success">Nothing waiting at {stageName(stage)}. New work appears here when a lot is sent to you.</InlineAlert>
      )}

      {incoming.length > 0 && (
        <Panel title="Receive" meta="Sent to you — confirm what physically arrived">
          <Table
            rows={incoming}
            rowKey={(h) => h.id}
            focus={focus}
            cols={[
              { key: 'lot', label: 'Lot', render: (h) => <LotLink id={h.lotId} /> },
              { key: 'from', label: 'From', render: (h) => s.locations[h.fromLoc]?.label ?? h.fromLoc },
              { key: 'issued', label: 'Sent', num: true, render: (h) => <Qty g={h.qty} /> },
              { key: 'rec', label: 'Received', num: true, render: (h) => (h.received ? <Qty g={h.received} /> : '—') },
              { key: 'out', label: 'Outstanding', num: true, render: (h) => <Qty g={outstanding(h)} strong /> },
              { key: 'act', label: '', render: (h) => <ReceiveButton h={h} variant="secondary" /> },
            ]}
          />
        </Panel>
      )}

      {queue.length > 0 && (
        <Panel title="Start" meta="Received and waiting at this stage">
          <Table
            rows={queue}
            rowKey={(l) => l.id}
            focus={focus}
            cols={[
              { key: 'lot', label: 'Lot', render: (l) => <LotLink id={l.id} /> },
              { key: 'desc', label: 'Material', render: (l) => l.label },
              { key: 'q', label: 'Waiting', num: true, render: (l) => <Qty g={at(l.id, stageIn(stage))} strong /> },
              { key: 'act', label: '', render: (l) => <StartButton lot={l} stage={stage} qty={at(l.id, stageIn(stage))} variant="secondary" /> },
            ]}
          />
        </Panel>
      )}

      {runs.length > 0 && (
        <Panel title="In process" meta="Planned finish stays fixed; a late run needs a named new ETA">
          <Table
            rows={runs}
            rowKey={(r) => r.id}
            focus={focus}
            cols={[
              { key: 'lot', label: 'Lot', render: (r) => (<><LotLink id={r.inputLotId} />{r.pass > 1 ? ` · pass ${r.pass}` : ''}</>) },
              { key: 'q', label: 'Qty', num: true, render: (r) => <Qty g={r.inputQty} /> },
              { key: 'st', label: 'Status', render: (r) => { const t = runTiming(r, now); return (<><Status s={t.status} />{t.delayMs > 0 && <div className="muted">late {fmtDuration(t.delayMs)}</div>}</>); } },
              { key: 'base', label: 'Planned finish', render: (r) => fmtTime(r.baselineFinish) },
              { key: 'eta', label: 'Expected finish', render: (r) => <Eta t={runTiming(r, now)} /> },
              { key: 'act', label: 'Working / held', render: (r) => `${fmtDuration(runTiming(r, now).activeMs)} / ${fmtDuration(runTiming(r, now).heldMs)}` },
              {
                key: 'do',
                label: '',
                render: (r) => (
                  <div className="rt-row">
                    <OutputButton run={r} variant="secondary" />
                    <HoldResumeButton run={r} />
                    <EtaButton run={r} variant="secondary" />
                  </div>
                ),
              },
            ]}
          />
        </Panel>
      )}

      {outputs.length > 0 && (
        <Panel title="Issue" meta="Ready to send to the next step on the route">
          <Table
            rows={outputs}
            rowKey={(l) => l.id}
            focus={focus}
            cols={[
              { key: 'lot', label: 'Lot', render: (l) => <LotLink id={l.id} /> },
              { key: 'desc', label: 'Material', render: (l) => l.label },
              { key: 'q', label: 'Ready', num: true, render: (l) => <Qty g={at(l.id, stageOut(stage))} strong /> },
              { key: 'next', label: 'Goes to', render: (l) => (l.nextStage === stage ? `${stageName(stage)} (rework)` : l.nextStage === 'F1' ? 'Finished Godown F1' : l.nextStage ? stageName(l.nextStage as StageCode) : '—') },
              { key: 'act', label: '', render: (l) => <IssueButton lot={l} stage={stage} qty={at(l.id, stageOut(stage))} variant="secondary" /> },
            ]}
          />
        </Panel>
      )}

      <Details summary={`Recently completed at ${stageName(stage)} (${done.length})`}>
        <Table
          rows={done}
          rowKey={(r) => r.id}
          empty="No completed runs yet."
          cols={[
            { key: 'lot', label: 'Input', render: (r) => <LotLink id={r.inputLotId} /> },
            { key: 'q', label: 'Input + oil', num: true, render: (r) => fmtKg(r.inputQty + r.additions.reduce((a, x) => a + x.qty, 0)) },
            { key: 'out', label: 'What came out', render: (r) => r.outputs.map((o) => `${o.kind === 'forward' ? 'good' : o.kind}${o.grade ? ` ${o.grade}` : ''} ${fmtKg(o.qty)}`).join(' · ') },
            { key: 't', label: 'Working / held / late', render: (r) => { const t = runTiming(r, now); return `${fmtDuration(t.activeMs)} / ${fmtDuration(t.heldMs)} / ${fmtDuration(t.delayMs)}`; } },
            { key: 'done', label: 'Finished', render: (r) => fmtTime(r.completedAt) },
          ]}
        />
      </Details>
      <Details summary="Stage details">
        <p className="muted">
          Planned run time {info.plannedMinutes} min{s.season.active ? ` × season factor ${s.season.factor}` : ''} · normal loss limit {info.tolerancePct}% (demo value) · usual measurement: {info.basis === 'Actual' ? 'weighed' : 'carried forward'} · process route version {s.route.version}.
        </p>
      </Details>
      <ImplNote>
        Stage flow implements M4 (FR-017–025, FR-096/098): separate issue/receipt with pending custody, balanced output (BR-005) with no automatic balancing loss, timers with fixed baseline and named ETA revisions (FR-073). Runs record <Ref>run ids</Ref> and route version. Basis: <BasisChip basis="Actual" /> <BasisChip basis="Counted" /> <BasisChip basis="Carried" />.
      </ImplNote>
    </RPage>
  );
}
