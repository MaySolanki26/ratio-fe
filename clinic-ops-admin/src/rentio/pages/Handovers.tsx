/** Issue/receive handovers: what was sent, what arrived, and what is still outstanding until settled. */
import { useState } from 'react';
import { InlineAlert, Tabs } from '../../components/primitives/feedback';
import { outstanding, requestResidualSettlement } from '../../domain/rentio/ops';
import { scopedHandovers } from '../../domain/rentio/scope';
import type { Handover } from '../../domain/rentio/types';
import { fmtKg } from '../../domain/rentio/units';
import { useAct, useR } from '../store';
import { BasisChip, Details, FormButton, ImplNote, Kpi, KpiRow, LotLink, Panel, Qty, RPage, Status, str, Table, useCan, Who, fmtTime, useFocusId } from '../ui';

/** Issued · received · outstanding shown together so nobody mistakes the original issue for what is left. */
function Balance({ h }: { h: Handover }) {
  const settled = h.settled.reduce((a, x) => a + x.qty, 0);
  return (
    <div className="rt-preview">
      <div>
        <span>Issued</span>
        <strong>{fmtKg(h.qty)}</strong>
      </div>
      <div>
        <span>Already received</span>
        <strong>{fmtKg(h.received)}</strong>
      </div>
      {settled > 0 && (
        <div>
          <span>Settled</span>
          <strong>{fmtKg(settled)}</strong>
        </div>
      )}
      <div className="is-key">
        <span>Outstanding</span>
        <strong>{fmtKg(outstanding(h))}</strong>
      </div>
    </div>
  );
}

export default function Handovers() {
  const { s, actor } = useR();
  const act = useAct();
  const can = useCan();
  const focus = useFocusId();
  // read scope: stage staff see only handovers to or from their stages
  const visible = scopedHandovers(s, actor);
  const open = visible.filter((h) => outstanding(h) > 0);
  const focused = focus ? visible.find((h) => h.id === focus) : undefined;
  const [tab, setTab] = useState<'open' | 'all'>(() => (focused && outstanding(focused) === 0 ? 'all' : 'open'));
  const rows = (tab === 'open' ? open : visible).slice().reverse();
  const partials = open.filter((h) => h.received > 0);
  const where = (loc: string) => s.locations[loc]?.label ?? loc;
  return (
    <RPage title="Handovers" description="Material sent between stages: what was issued, what arrived, and what is still outstanding.">
      {focus && !focused && <InlineAlert tone="info">That handover is not in your area of work, or does not exist.</InlineAlert>}
      <KpiRow>
        <Kpi label="Open handovers" value={open.length} />
        <Kpi label="Between stages (not yet received)" value={fmtKg(open.reduce((a, h) => a + outstanding(h), 0))} />
        <Kpi label="Short receipts to settle" value={partials.length} tone={partials.length ? 'danger' : undefined} />
      </KpiRow>
      {partials.map((h) => (
        <Panel key={h.id} title={`Short receipt · ${h.lotId}`} meta={`${where(h.fromLoc)} → ${h.toStage}`} id={`ho-${h.id}`}>
          <div className="rt-stack">
            <Balance h={h} />
            {s.approvals.some((a) => a.ref === h.id && a.status === 'pending') ? (
              <p className="muted">
                <Status s="pending_approval" /> Settlement requested — waiting for an independent approver.
              </p>
            ) : (
              <div>
                <FormButton
                  label="Settle the shortfall"
                  variant={focus === h.id ? 'primary' : 'secondary'}
                  disabledReason={can('handover.settle.request', 'request a settlement')}
                  title={`Settle ${fmtKg(outstanding(h))} outstanding on ${h.lotId}`}
                  submitLabel="Send for approval"
                  note={
                    <>
                      Issued {fmtKg(h.qty)} · already received {fmtKg(h.received)} · <strong>outstanding {fmtKg(outstanding(h))}</strong>. The outstanding quantity stays accountable until an independent approver accepts what happened to it. Nothing is posted now.
                    </>
                  }
                  fields={[
                    { key: 'how', label: 'What happened to it', type: 'select', required: true, options: [{ value: 'located', label: 'Found — receive it at the destination' }, { value: 'returned', label: 'Never left — return it to the sender' }, { value: 'loss', label: 'Lost — record as loss' }] },
                    { key: 'reason', label: 'Evidence / reason', type: 'textarea', required: true },
                  ]}
                  onSubmit={(v, key) => act('Request settlement of shortfall', (ctx) => requestResidualSettlement(ctx, { handoverId: h.id, how: str(v.how) as 'loss', reason: str(v.reason) }), { key, success: () => 'Sent for approval' })}
                />
              </div>
            )}
          </div>
        </Panel>
      ))}
      <Panel title="All handovers" actions={<Tabs label="Handover filter" value={tab} onChange={setTab} tabs={[{ id: 'open', label: 'Open', count: open.length }, { id: 'all', label: 'All', count: visible.length }]} />}>
        <Table
          rows={rows}
          rowKey={(h) => h.id}
          focus={focus}
          empty="No handovers."
          cols={[
            { key: 'lot', label: 'Lot', render: (h) => <LotLink id={h.lotId} /> },
            { key: 'route', label: 'From → to', render: (h) => `${where(h.fromLoc)} → ${h.toStage}` },
            { key: 'iss', label: 'Issued', num: true, render: (h) => <Qty g={h.qty} /> },
            { key: 'rec', label: 'Received', num: true, render: (h) => <Qty g={h.received} /> },
            { key: 'out', label: 'Outstanding', num: true, render: (h) => <Qty g={outstanding(h)} strong /> },
            { key: 'st', label: 'Status', render: (h) => <Status s={h.status} /> },
            { key: 'who', label: 'Issued by', render: (h) => (<><Who id={h.issuedBy} /> · {fmtTime(h.issuedAt)}</>) },
          ]}
        />
      </Panel>
      <Details summary="Receipt history">
        <Table
          rows={visible.flatMap((h) => h.receipts.map((r, i) => ({ h, r, i }))).reverse().slice(0, 40)}
          rowKey={(x) => `${x.h.id}-${x.i}`}
          cols={[
            { key: 'lot', label: 'Lot', render: (x) => <LotLink id={x.h.lotId} /> },
            { key: 'q', label: 'Received', num: true, render: (x) => <Qty g={x.r.qty} /> },
            { key: 'b', label: 'Basis', render: (x) => <BasisChip basis={x.h.basis} /> },
            { key: 'to', label: 'Into', render: (x) => where(x.r.to) },
            { key: 'by', label: 'Received by', render: (x) => (<><Who id={x.r.by} /> · {fmtTime(x.r.at)}</>) },
            { key: 'n', label: 'Note', render: (x) => x.r.note ?? '—' },
          ]}
        />
      </Details>
      <ImplNote>Issue/receive handover (WF-04, FR-018): issue moves stock into pending handover custody; each receipt settles part; the outstanding residual needs an approved settlement (found / returned / loss). Visible handovers come from scopedHandovers.</ImplNote>
    </RPage>
  );
}
