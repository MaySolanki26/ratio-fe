/**
 * Controlled repacking panel (Godowns & stacks). Godown staff record a measured repack; an independent QC
 * checker releases it, which posts everything once. The live preview shows the balance before submit.
 */
import { InlineAlert } from '../../components/primitives/feedback';
import { DEMO } from '../../domain/rentio/config';
import { decideRepack, packagingSize, requestRepack } from '../../domain/rentio/repack';
import { fmtKg, kg } from '../../domain/rentio/units';
import { useAct, useR } from '../store';
import { FormButton, LotLink, Panel, Status, Table, Who, fmtTime, num, str, useCan } from '../ui';
import type { StockRow } from '../../domain/rentio/engine';
import { RepackFlow } from './_graphA';

export function RepackPanel({ rows, focus }: { rows: StockRow[]; focus?: string }) {
  const { s, db, actor } = useR();
  const run = useAct();
  const can = useCan();
  const recordReason = can('godown.operate', 'record repacking') && can('plan.manage', 'record repacking');
  const releaseReason = can('quality.release', 'release repacked stock (QC checker)');
  const eligible = rows.filter((r) => r.lot.material === 'PACKED' && r.location?.godown === 'F1' && r.lot.bagSize && r.available > 0);
  const packaging = Object.values(s.lots).filter((l) => l.material === 'BAGS');
  const packsInStores = (id: string) => rows.find((r) => r.lotId === id && r.loc === 'STORES')?.qty ?? 0;
  const skus = (db.records.skus ?? []).filter((k) => k.active !== false);
  const list = [...(s.repacks ?? [])].reverse();
  const pending = list.filter((x) => x.status === 'pending_qc');

  return (
    <Panel
      title="Controlled repacking"
      meta={pending.length ? `${pending.length} waiting for QC release` : 'QC release required before stock changes'}
      id="repack"
      actions={
        <FormButton
          label="Record repack"
          icon="plus"
          disabledReason={recordReason}
          title="Record a measured repack"
          submitLabel="Submit for QC release"
          wide
          note={`Nothing moves now: the source stays intact until an independent QC checker releases it. Input = new packs + recorded loss, exactly. Loss above ${DEMO.repackLossTolerancePct}% (demo) is refused. Held, expired or reserved stock and stacks under treatment hold cannot be repacked.`}
          initial={{ target: '1', loss: '0' }}
          fields={[
            { key: 'pos', label: 'Packed lot and stack', type: 'select', required: true, options: eligible.map((r) => ({ value: `${r.lotId}@${r.loc}`, label: `${r.lotId} · ${r.lot.grade} · ${r.location?.label} — ${fmtKg(r.available)} free (${Math.floor(r.available / r.lot.bagSize!)} × ${fmtKg(r.lot.bagSize!)})` })) },
            { key: 'kg', label: 'Released net input (whole opened bags)', type: 'number', unit: 'kg', required: true },
            { key: 'target', label: 'Target pack size', type: 'select', required: true, options: [...new Set(skus.map((k) => Number(k.packKg)))].sort((a, b) => a - b).map((n) => ({ value: String(n), label: `${n} kg packs` })) },
            { key: 'bags', label: 'New packs filled', type: 'number', required: true, step: 1, min: 1 },
            { key: 'measured', label: 'Measured net of new packs (check-weigher)', type: 'number', unit: 'kg', required: true },
            { key: 'pack', label: 'Packaging used', type: 'select', required: true, options: packaging.map((l) => ({ value: l.id, label: `${l.id} — ${l.label} · ${packsInStores(l.id) / 1000} in stores` })) },
            { key: 'loss', label: 'Real loss (only what was actually lost)', type: 'number', unit: 'kg' },
            { key: 'why', label: 'Loss reason', type: 'text', placeholder: 'Spillage, sweepings, torn bag …' },
            { key: 'to', label: 'Put new packs in (optional)', type: 'select', options: ['F1-S01', 'F1-S02', 'F1-S03', 'F1-S04', 'F1-S05', 'F1-S06'].map((x) => ({ value: x, label: s.locations[x]?.label ?? x })) },
          ]}
          onSubmit={(v, key) => {
            const [lotId, fromLoc] = str(v.pos).split('@');
            return run(
              `Record repack of ${lotId}`,
              (ctx) => requestRepack(ctx, { lotId, fromLoc, toLoc: str(v.to) || undefined, inputKg: num(v.kg), targetBagKg: num(v.target), outputBags: num(v.bags), measuredOutputKg: num(v.measured), packagingLotId: str(v.pack), lossKg: num(v.loss), lossReason: str(v.why) }),
              { key, success: (r) => `${r.id} recorded — waiting for QC release; source unchanged` },
            );
          }}
        >
          {(v) => {
            const [lotId, loc] = str(v.pos).split('@');
            const r = eligible.find((x) => x.lotId === lotId && x.loc === loc);
            const input = kg(num(v.kg));
            const out = num(v.bags) * kg(num(v.target));
            const measured = kg(num(v.measured));
            const loss = kg(num(v.loss));
            const diff = input - measured - loss;
            const size = str(v.pack) ? packagingSize(s, str(v.pack)) : undefined;
            const packs = packsInStores(str(v.pack)) / 1000;
            return (
              <div className="rt-preview" aria-live="polite">
                <div><span>Source free to repack</span><strong>{r ? fmtKg(r.available) : '—'}</strong></div>
                <div><span>Opened bags</span><strong>{r?.lot.bagSize ? `${input / r.lot.bagSize} × ${fmtKg(r.lot.bagSize)}` : '—'}</strong></div>
                <div><span>Packs × size</span><strong className={measured && out !== measured ? 'tone-text-danger' : undefined}>{fmtKg(out)}{measured && out !== measured ? ` ≠ measured ${fmtKg(measured)}` : ''}</strong></div>
                <div><span>Recorded loss</span><strong>{fmtKg(loss)}{input ? ` (${((loss * 100) / input).toFixed(2)}%)` : ''}</strong></div>
                <div className="is-key"><span>Input − packs − loss</span><strong className={diff ? 'tone-text-danger' : 'tone-text-success'}>{diff ? `${fmtKg(diff)} unbalanced` : 'Balanced ✓'}</strong></div>
                <div><span>Packaging</span><strong className={size && (size !== kg(num(v.target)) || packs < num(v.bags)) ? 'tone-text-danger' : undefined}>{str(v.pack) ? `${packs} in stores · fits ${size ? fmtKg(size) : '—'} packs` : '—'}</strong></div>
                <div><span>Stays in the stack</span><strong>{r ? fmtKg(Math.max(0, r.qty - input)) : '—'}</strong></div>
              </div>
            );
          }}
        </FormButton>
      }
    >
      {(() => {
        const shown = (focus && list.find((x) => x.id === focus)) || pending[0] || list[0];
        return shown ? <RepackFlow x={shown} locLabel={(id) => s.locations[id]?.label ?? id} /> : null;
      })()}
      <Table
        cols={[
          { key: 'id', label: 'Repack', render: (x) => <strong>{x.id}</strong> },
          { key: 'src', label: 'Source', render: (x) => (<><LotLink id={x.sourceLotId} /> · {s.locations[x.fromLoc]?.label ?? x.fromLoc}</>) },
          { key: 'in', label: 'Input', num: true, render: (x) => `${fmtKg(x.inputQty)} (${x.openedBags} × ${fmtKg(x.sourceBagSize)})` },
          { key: 'out', label: 'New packs', num: true, render: (x) => `${x.outputBags} × ${fmtKg(x.targetBagSize)} = ${fmtKg(x.measuredOutput)}` },
          { key: 'loss', label: 'Loss', render: (x) => (x.loss ? `${fmtKg(x.loss)} — ${x.lossReason}` : 'none') },
          { key: 'res', label: 'Left in stack', num: true, render: (x) => fmtKg(x.residualAtRequest) },
          { key: 'st', label: 'Status', render: (x) => (<><Status s={x.status === 'pending_qc' ? 'pending' : x.status} />{x.childLotId && <> → <LotLink id={x.childLotId} /></>}</>) },
          { key: 'by', label: 'Recorded / decided', render: (x) => (<><Who id={x.requestedBy} /> {fmtTime(x.requestedAt)}{x.decidedBy && <> · <Who id={x.decidedBy} /> {fmtTime(x.decidedAt)}</>}{x.decisionNote && <div className="muted small">{x.decisionNote}</div>}</>) },
          {
            key: 'act',
            label: '',
            render: (x) =>
              x.status === 'pending_qc' ? (
                <div className="rt-row-actions">
                  <FormButton
                    label="Release & post"
                    variant="primary"
                    disabledReason={releaseReason ?? (x.requestedBy === actor.id ? 'You recorded this repack — an independent checker must release it' : undefined)}
                    title={`QC release of ${x.id}`}
                    submitLabel="Release and post"
                    note={`Posting re-checks holds, expiry, reservations and packaging now. It consumes ${fmtKg(x.inputQty)} from ${x.sourceLotId}, records ${fmtKg(x.loss)} loss, deducts ${x.outputBags} packs of ${x.packagingLotId} and creates the child lot with the same grade, packing date and best-before.`}
                    fields={[{ key: 'note', label: 'QC check note', type: 'text', placeholder: 'Seal, label and net weight checked' }]}
                    onSubmit={(v, key) => run(`Release repack ${x.id}`, (ctx) => decideRepack(ctx, { repackId: x.id, release: true, note: str(v.note) }), { key, success: (r) => `${r.id} posted — new lot ${r.childLotId}` })}
                  />
                  <FormButton
                    label="Reject"
                    disabledReason={releaseReason ?? (x.requestedBy === actor.id ? 'You recorded this repack — an independent checker decides' : undefined)}
                    title={`Reject ${x.id}`}
                    submitLabel="Reject — no stock change"
                    fields={[{ key: 'note', label: 'Reason', type: 'text', required: true }]}
                    onSubmit={(v, key) => run(`Reject repack ${x.id}`, (ctx) => decideRepack(ctx, { repackId: x.id, release: false, note: str(v.note) }), { key, success: (r) => `${r.id} rejected — source unchanged` })}
                  />
                </div>
              ) : (
                '—'
              ),
          },
        ]}
        rows={list}
        rowKey={(x) => x.id}
        focus={focus}
        empty="No repacks recorded. Use Record repack for torn or re-sized packs."
      />
      {pending.some((x) => x.requestedBy === actor.id) && <InlineAlert tone="info">Your repack is waiting for Meera Joshi (QC) or another QC checker. The source lot stays unchanged and available-to-sell excludes nothing until release.</InlineAlert>}
    </Panel>
  );
}
