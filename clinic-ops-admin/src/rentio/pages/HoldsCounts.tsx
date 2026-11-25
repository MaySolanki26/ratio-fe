import { InlineAlert } from '../../components/primitives/feedback';
import { descendants } from '../../domain/rentio/engine';
import { canReadLoc, canReadLot, readScope, scopedLots, scopedStockRows } from '../../domain/rentio/scope';
import { placeHold, releaseHold, submitCount } from '../../domain/rentio/ops';
import { disposeSample, takeSample } from '../../domain/rentio/control';
import type { Hold } from '../../domain/rentio/types';
import { fmtKg, sum } from '../../domain/rentio/units';
import { useAct, useR } from '../store';
import { HoldGraphics } from './_graphA';
import { Details, FormButton, ImplNote, Kpi, KpiRow, LotLink, Panel, Qty, RPage, Reason, Status, Table, Who, fmtTime, num, str, useCan, useFocusId } from '../ui';

export default function HoldsCounts() {
  const { s, now, actor } = useR();
  const run = useAct();
  const can = useCan();
  const focus = useFocusId();
  const sc = readScope(actor);
  const rows = scopedStockRows(s, actor, now);
  const affected = (h: Hold) => {
    if (h.scope === 'lot') {
      const lots = [h.target, ...descendants(s, h.target)];
      return rows.filter((r) => lots.includes(r.lotId));
    }
    return rows.filter((r) => r.loc === h.target || r.location?.godown === h.target);
  };
  const holdReason = can('quality.hold', 'place a quality hold');
  const countReason = actor.caps.includes('godown.operate') || actor.caps.includes('distributor.operate') ? undefined : `${actor.roleLabel} cannot submit physical counts`;
  const lotOpts = scopedLots(s, actor)
    .filter((l) => l.unit !== 'bag' && rows.some((r) => r.lotId === l.id))
    .map((l) => {
      const here = rows.filter((r) => r.lotId === l.id);
      return { value: l.id, label: `${l.id} · ${l.grade ?? l.material} · ${here.map((r) => r.location?.label ?? r.loc).join(', ')} — ${fmtKg(sum(here.map((r) => r.qty)))}` };
    });
  const countOpts = rows
    .filter((r) => r.lot.unit !== 'bag' && r.location && ['raw', 'finished', 'byproduct', 'quarantine', 'stores', 'distributor', 'distributor-held'].includes(r.location.kind))
    .map((r) => ({ value: `${r.lotId}@${r.loc}`, label: `${r.lotId} · ${r.lot.grade ?? r.lot.material} · ${r.location.label} — system shows ${fmtKg(r.qty)}` }));
  // only holds on stock/locations in the actor's area
  const visibleHolds = s.holds.filter((h) => (h.scope === 'lot' ? canReadLot(s, actor, h.target) || affected(h).length > 0 : canReadLoc(s, actor, h.target, sc)));
  const active = visibleHolds.filter((h) => h.status === 'active');
  const counts = s.counts.filter((c) => canReadLoc(s, actor, c.location, sc));

  return (
    <RPage
      title="Holds & counts"
      description="Quality and location holds, and physical counts that need an independent approval."
      intro="A hold keeps the stock counted but stops it being used — for the lot and everything made from it."
      actions={
        <>
          <FormButton
            label="Place quality hold"
            variant="primary"
            disabledReason={holdReason}
            title="Quality hold on a lot (and its descendants)"
            submitLabel="Place hold"
            fields={[
              { key: 'target', label: 'Lot', type: 'select', required: true, options: lotOpts },
              { key: 'kind', label: 'Type', type: 'select', required: true, options: [{ value: 'quality', label: 'Quality' }, { value: 'recall', label: 'Recall / containment' }, { value: 'other', label: 'Other' }] },
              { key: 'reason', label: 'Reason', type: 'textarea', required: true },
            ]}
            initial={{ kind: 'quality' }}
            onSubmit={(v, key) => run('Place quality hold', (ctx) => placeHold(ctx, { scope: 'lot', target: str(v.target), kind: str(v.kind) as Hold['kind'], reason: str(v.reason) }), { key, success: (h) => `Hold ${h.id} placed — descendants and reservations affected` })}
          />
          <FormButton
            label="Take retained sample"
            disabledReason={holdReason}
            title="Retained QC sample"
            submitLabel="Move to sample store"
            note="The sample leaves available stock and is kept, held, in the QC sample store. Testing or disposal later deducts it once."
            fields={[
              { key: 'pos', label: 'From lot @ location', type: 'select', required: true, options: countOpts },
              { key: 'kg', label: 'Sample quantity', type: 'number', unit: 'kg', required: true },
              { key: 'purpose', label: 'Purpose', type: 'text', required: true, placeholder: 'e.g. retained batch sample — 6 months' },
            ]}
            initial={{ kg: '2' }}
            onSubmit={(v, key) => {
              const [lotId, loc] = str(v.pos).split('@');
              return run('Take retained sample', (ctx) => takeSample(ctx, { lotId, loc, kg: num(v.kg), purpose: str(v.purpose) }), { key, success: (r) => `Sample ${r.ref}: ${r.qty} moved to QC sample store` });
            }}
          />
          <FormButton
            label="Submit count"
            disabledReason={countReason}
            title="Physical count against snapshot"
            submitLabel="Submit count"
            note="Your count is compared with the system quantity now. A difference goes to another person for approval; nothing changes until then."
            fields={[
              { key: 'pos', label: 'Lot @ location', type: 'select', required: true, options: countOpts },
              { key: 'counted', label: 'Counted quantity', type: 'number', unit: 'kg', required: true },
            ]}
            onSubmit={(v, key) => {
              const [lotId, loc] = str(v.pos).split('@');
              return run('Submit physical count', (ctx) => submitCount(ctx, { lotId, loc, countedKg: num(v.counted) }), { key, success: (c) => (c.difference ? `Count ${c.id}: difference ${fmtKg(c.difference)} sent for approval` : `Count ${c.id} matches the ledger`) });
            }}
          />
        </>
      }
    >
      <KpiRow>
        <Kpi label="Active holds" value={active.length} tone={active.length ? 'warning' : undefined} />
        <Kpi label="Stock on hold" value={fmtKg(sum(rows.filter((r) => r.held && r.lot.unit !== 'bag').map((r) => r.qty)))} note="still counted in physical stock" />
        <Kpi label="Reserved stock at risk" value={fmtKg(sum(rows.map((r) => r.reservedAtRisk)))} tone={rows.some((r) => r.reservedAtRisk) ? 'danger' : undefined} />
        <Kpi label="Counts awaiting approval" value={counts.filter((c) => c.status === 'pending_approval').length} />
      </KpiRow>

      <HoldGraphics holds={active} affected={affected} counts={counts} labelOf={(h) => (h.scope === 'lot' ? h.target : s.locations[h.target]?.label ?? h.target)} />

      {focus && !visibleHolds.some((h) => h.id === focus) && <InlineAlert tone="warning">That record is not in your area or no longer open.</InlineAlert>}
      <Panel title="Holds" meta="Released by QC — never by the person who placed it">
        <Table
          cols={[
            { key: 't', label: 'On', render: (h) => (h.scope === 'lot' ? <LotLink id={h.target} /> : s.locations[h.target]?.label ?? h.target) },
            { key: 'k', label: 'Type', render: (h) => h.kind },
            { key: 'r', label: 'Reason', render: (h) => <Reason text={h.reason} /> },
            {
              key: 'aff',
              label: 'Affected live qty',
              num: true,
              render: (h) => {
                const a = affected(h);
                return (
                  <span data-tooltip={a.map((r) => `${r.lotId} @ ${r.loc}`).join(', ') || 'none'}>
                    <Qty g={sum(a.map((r) => r.qty))} /> · {new Set(a.map((r) => r.lotId)).size} lot(s)
                  </span>
                );
              },
            },
            { key: 'by', label: 'Placed', render: (h) => (<><Who id={h.createdBy} /> · {fmtTime(h.createdAt)}{h.releasedBranches?.length ? <div className="muted">branches released: {h.releasedBranches.join(', ')}</div> : null}</>) },
            { key: 'st', label: 'Status', render: (h) => (h.status === 'released' ? <span><Status s="released" /> <Who id={h.releasedBy} /></span> : <Status s="active" />) },
            {
              key: 'act',
              label: 'Actions',
              render: (h) => {
                if (h.status !== 'active') return '—';
                const relReason = can(h.scope === 'lot' ? 'quality.release' : 'location.hold', 'release this hold');
                const branches = h.scope === 'lot' ? descendants(s, h.target).filter((d) => rows.some((r) => r.lotId === d) && !(h.releasedBranches ?? []).includes(d)) : [];
                return (
                  <div className="rt-row">
                    <FormButton
                      label="Release"
                      disabledReason={relReason}
                      title={`Release hold ${h.id}`}
                      submitLabel="Release hold"
                      note={`Releasing restores eligibility for ${h.target}${h.scope === 'lot' ? ' and all its descendants' : ''}. It does not create new reservations or release other holds.`}
                      fields={[{ key: 'note', label: 'Release evidence / note', type: 'text', required: true }]}
                      onSubmit={(v, key) => run(`Release ${h.id}`, (ctx) => releaseHold(ctx, { holdId: h.id, note: str(v.note) }), { key })}
                    />
                    {branches.length > 0 && (
                      <FormButton
                        label="Release one branch"
                        disabledReason={relReason}
                        title={`Release one branch of ${h.id}`}
                        submitLabel="Release branch"
                        note="Only the chosen branch becomes usable; other branches stay on hold."
                        fields={[
                          { key: 'branch', label: 'Descendant lot', type: 'select', required: true, options: branches.map((b) => ({ value: b, label: b })) },
                          { key: 'note', label: 'Evidence', type: 'text', required: true },
                        ]}
                        onSubmit={(v, key) => run(`Release branch of ${h.id}`, (ctx) => releaseHold(ctx, { holdId: h.id, branchLotId: str(v.branch), note: str(v.note) }), { key })}
                      />
                    )}
                  </div>
                );
              },
            },
          ]}
          rows={[...visibleHolds].reverse()}
          rowKey={(h) => h.id}
          rowClass={(h) => (h.status === 'released' ? 'is-muted' : undefined)}
          focus={focus}
          empty="No holds."
        />
      </Panel>

      <Details summary={`Physical counts (${counts.length})`} open={counts.some((c) => c.status === 'pending_approval')}>
        <Table
          cols={[
            { key: 'lot', label: 'Lot', render: (c) => <LotLink id={c.lotId} /> },
            { key: 'loc', label: 'Location', render: (c) => s.locations[c.location]?.label ?? c.location },
            { key: 'snap', label: 'Snapshot', num: true, render: (c) => <Qty g={c.snapshot} /> },
            { key: 'cnt', label: 'Counted', num: true, render: (c) => <Qty g={c.counted} /> },
            { key: 'd', label: 'Difference', num: true, render: (c) => <Qty g={c.difference} strong /> },
            { key: 'by', label: 'Counted by', render: (c) => (<><Who id={c.countedBy} /> · {fmtTime(c.snapshotAt)}</>) },
            { key: 'st', label: 'Status', render: (c) => <Status s={c.status} /> },
          ]}
          rows={[...counts].reverse()}
          rowKey={(c) => c.id}
          focus={focus}
          empty="No counts yet."
        />
      </Details>

      <Details summary={`QC retained samples (${rows.filter((r) => r.loc === 'SAMPLES').length})`}>
        <Table
          rows={rows.filter((r) => r.loc === 'SAMPLES')}
          rowKey={(r) => r.lotId}
          empty="No retained samples."
          cols={[
            { key: 'lot', label: 'Lot', render: (r) => <LotLink id={r.lotId} /> },
            { key: 'g', label: 'Grade', render: (r) => r.lot.grade ?? r.lot.material },
            { key: 'q', label: 'Kept', num: true, render: (r) => <Qty g={r.qty} /> },
            {
              key: 'act',
              label: '',
              render: (r) => (
                <FormButton
                  label="Test / dispose"
                  disabledReason={can('quality.release', 'dispose samples')}
                  title={`Use sample ${r.lotId}`}
                  submitLabel="Deduct sample"
                  fields={[
                    { key: 'kg', label: 'Quantity used or disposed', type: 'number', unit: 'kg', required: true },
                    { key: 'reason', label: 'Test or reason', type: 'text', required: true },
                  ]}
                  initial={{ kg: String(r.qty / 1000) }}
                  onSubmit={(v, key) => run('Dispose retained sample', (ctx) => disposeSample(ctx, { lotId: r.lotId, kg: num(v.kg), reason: str(v.reason) }), { key, success: () => 'Sample deducted once' })}
                />
              ),
            },
          ]}
        />
      </Details>
      <ImplNote>Retained samples FR-102 (held sample custody, deducted once on test/disposal). Holds and counts (M5/M6). Holds remove eligibility without changing physical quantity, propagate to descendants and reservations, and support per-branch release (FR-038, FR-110, BR-032). Location holds FR-100. Counts compare with a snapshot and post an adjustment only after approval (FR-030, WF-08, BR-003). Visibility follows scope.ts.</ImplNote>
    </RPage>
  );
}
