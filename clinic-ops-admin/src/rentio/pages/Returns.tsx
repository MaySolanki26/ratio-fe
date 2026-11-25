/** Returns & complaints: lot-linked cases, held returns, QC decision, replacement, credit and recall trace. */
import { useState } from 'react';
import { Button } from '../../components/primitives/Button';
import { InlineAlert } from '../../components/primitives/feedback';
import * as C from '../../domain/rentio/commerce';
import { descendants } from '../../domain/rentio/engine';
import { canReadLot, readScope, scopedComplaints, scopedLots, scopedOrders, scopedStockRows, visibleDistributorIds } from '../../domain/rentio/scope';
import * as O from '../../domain/rentio/ops';
import { recallRecipients } from '../../domain/rentio/recall';
import type { Complaint } from '../../domain/rentio/types';
import { fmtKg, sum } from '../../domain/rentio/units';
import { useAct, useR } from '../store';
import { Details, FormButton, ImplNote, LotLink, num, Panel, Qty, Reason, Ref, RPage, Status, str, Table, useCan, useFocusId, fmtTime } from '../ui';
import { FocusMissing } from './_distHelpers';

export default function Returns() {
  const { db, s, actor, now } = useR();
  const run = useAct();
  const can = useCan();
  const focus = useFocusId();
  const sc = readScope(actor);
  const visible = visibleDistributorIds((db.records.distributors ?? []).map((d) => String(d.id)), actor);
  const cases = scopedComplaints(s, actor).slice().reverse();
  const distOpts = (db.records.distributors ?? []).filter((d) => visible.includes(String(d.id))).map((d) => ({ value: String(d.id), label: `${d.id} — ${String(d.name).replace(' (fictional)', '')}` }));
  const retailerOpts = (db.records.retailers ?? []).filter((r) => visible.includes(String(r.distributorId))).map((r) => ({ value: String(r.id), label: `${String(r.name).replace(' (fictional)', '')} (${r.distributorId})` }));
  const retailOrders = scopedOrders(s, actor).filter((o) => o.kind === 'retail');
  const orderOpts = [{ value: '__none', label: 'Not known' }, ...retailOrders.map((o) => ({ value: o.id, label: `${o.partyId} · ${o.lines[0].grade} ${fmtKg(o.lines[0].qty)} · ${o.distributorId} (${o.id})` }))];
  const lotOpts = [
    { value: '__none', label: 'Lot not known' },
    ...new Map(
      scopedStockRows(s, actor, now)
        .filter((r) => r.lot.material === 'PACKED' && (r.location?.kind === 'distributor' || r.location?.kind === 'finished'))
        .map((r) => [r.lotId, { value: r.lotId, label: `${r.lotId} · ${r.lot.grade ?? ''}` }]),
    ).values(),
  ];
  const canTrace = sc.all || sc.allDistributors;

  return (
    <RPage
      title="Returns & complaints"
      description="Lot-linked complaints, held returns, QC decisions, replacements, credit and recall tracing."
      intro="Returned goods stay on hold until QC decides; replacement and credit are tracked separately."
      actions={
        <FormButton
          label="New complaint"
          variant="primary"
          icon="plus"
          disabledReason={can('complaint.create', 'record complaints')}
          title="New complaint"
          submitLabel="Create case"
          note="If the lot is not known the case is flagged for identification — never matched to a guessed lot."
          fields={[
            { key: 'distributorId', label: 'Distributor', type: 'select', options: distOpts, required: true },
            { key: 'retailerId', label: 'Retailer', type: 'select', options: retailerOpts },
            { key: 'orderId', label: 'Order', type: 'select', options: orderOpts },
            { key: 'lotId', label: 'Lot', type: 'select', options: lotOpts },
            { key: 'category', label: 'Category', type: 'select', options: ['quality', 'short', 'damage', 'wrong_grade', 'other'].map((c) => ({ value: c, label: c.replace('_', ' ') })), required: true },
            { key: 'description', label: 'Description', type: 'textarea', required: true },
          ]}
          initial={{ category: 'quality', distributorId: distOpts[0]?.value ?? '', orderId: '__none', lotId: '__none' }}
          onSubmit={(v, key) =>
            run('Create complaint', (ctx) => C.createComplaint(ctx, { distributorId: str(v.distributorId) || undefined, retailerId: str(v.retailerId) || undefined, orderId: str(v.orderId) && str(v.orderId) !== '__none' ? str(v.orderId) : undefined, lotId: str(v.lotId) && str(v.lotId) !== '__none' ? str(v.lotId) : undefined, category: str(v.category) as Complaint['category'], description: str(v.description) }), { key, success: (c) => `Case ${c.id} opened` })
          }
        />
      }
    >
      <FocusMissing focus={focus} found={!focus || cases.some((c) => c.id === focus)} />
      <Panel title="Cases" meta={`${cases.length}`}>
        <Table
          focus={focus}
          cols={[
            { key: 'id', label: 'Case', render: (c) => <Ref>{c.id}</Ref> },
            { key: 'r', label: 'Retailer / distributor', render: (c) => `${c.retailerId ?? '—'} / ${c.distributorId ?? '—'}` },
            { key: 'lot', label: 'Lot', render: (c) => (c.lotId ? (canReadLot(s, actor, c.lotId) ? <LotLink id={c.lotId} /> : c.lotId) : <span className="tone-text-warning">Unknown — needs identification</span>) },
            { key: 'st', label: 'Case', render: (c) => <Status s={c.status} /> },
            { key: 'phys', label: 'Goods returned', render: (c) => (c.returnQty ? `${fmtKg(c.returnQty)} on hold` : 'None') },
            { key: 'disp', label: 'QC decision', render: (c) => (c.disposition ? <Status s={c.disposition === 'dispose' && c.status !== 'resolved' ? 'disposal pending approval' : c.disposition} /> : '—') },
            { key: 'rep', label: 'Replacement', render: (c) => c.replacementOrderId ?? '—' },
            { key: 'cr', label: 'Credit', render: (c) => <Status s={c.creditStatus === 'none' ? 'no credit' : c.creditStatus} /> },
            { key: 'a', label: 'Actions', render: (c) => <CaseActions c={c} /> },
          ]}
          rows={cases}
          rowKey={(c) => c.id}
          empty="No complaints in your area."
        />
        <Details summary="Case details — category, opened, where returned goods are held">
          <Table
            cols={[
              { key: 'id', label: 'Case', render: (c) => c.id },
              { key: 'at', label: 'Opened', render: (c) => fmtTime(c.createdAt) },
              { key: 'cat', label: 'Category', render: (c) => c.category.replace('_', ' ') },
              { key: 'd', label: 'Description', render: (c) => <Reason text={c.description} /> },
              { key: 'loc', label: 'Held at', render: (c) => (c.returnLoc ? s.locations[c.returnLoc]?.label ?? c.returnLoc : '—') },
              { key: 'rl', label: 'Returned lot', render: (c) => (c.returnLotId ? (canReadLot(s, actor, c.returnLotId) ? <LotLink id={c.returnLotId} /> : c.returnLotId) : '—') },
            ]}
            rows={cases}
            rowKey={(c) => c.id}
          />
        </Details>
      </Panel>

      {canTrace ? <RecallView /> : null}
      <ImplNote>
        Lot-linked complaints, unknown lot flagged (FR-063); returns received into held stock (FR-064); replacement linked, not a stock credit (FR-065, EC-34); disposal needs evidence and approval (FR-066); release/dispose with origin history (FR-067); recall case lists descendants, current positions and recipients (FR-062, EC-50) — shown only to roles whose read scope covers the whole distributor network (Owner, Accounts, QC, Back Office). Physical, QC, replacement and credit states are separate (WF-06).
      </ImplNote>
    </RPage>
  );
}

function CaseActions({ c }: { c: Complaint }) {
  const { s, actor } = useR();
  const run = useAct();
  const can = useCan();
  const retailOrders = scopedOrders(s, actor).filter((o) => o.kind === 'retail' && o.distributorId === c.distributorId && o.id !== c.orderId).map((o) => ({ value: o.id, label: `${o.id} · ${o.partyId} · ${fmtKg(o.lines[0].qty)}` }));
  return (
    <span className="rt-row">
      {!c.returnLotId && c.status !== 'closed' && (
        <FormButton
          label="Receive return"
          disabledReason={can('distributor.operate', 'receive returned goods')}
          title={`Receive return for ${c.id}`}
          submitLabel="Receive into held stock"
          note={c.lotId ? `Returned ${c.lotId} goes on hold at the distributor — never straight back to sellable stock.` : 'Lot unknown: goods are received under a temporary unidentified lot and stay on hold.'}
          fields={[{ key: 'kg', label: 'Returned quantity', type: 'number', unit: 'kg', required: true }]}
          initial={{ kg: '25' }}
          onSubmit={(v, key) => run('Receive return', (ctx) => C.receiveReturn(ctx, { complaintId: c.id, kg: num(v.kg) }), { key })}
        />
      )}
      {c.returnLotId && !c.disposition && (
        <FormButton
          label="Disposition"
          disabledReason={can('return.disposition', 'decide return disposition')}
          title={`QC disposition for ${c.id}`}
          submitLabel="Record disposition"
          note="Release puts goods back into sellable stock. Disposal needs photo/video evidence and an approver; stock is removed only after approval."
          fields={[
            { key: 'action', label: 'Decision', type: 'select', options: [{ value: 'release', label: 'Release to sellable stock' }, { value: 'dispose', label: 'Dispose (needs approval)' }], required: true },
            { key: 'evidence', label: 'Evidence reference (required for disposal)', type: 'text' },
          ]}
          initial={{ action: 'release' }}
          onSubmit={(v, key) => run('Return disposition', (ctx) => C.returnDisposition(ctx, { complaintId: c.id, action: str(v.action) as 'release' | 'dispose', evidence: str(v.evidence) || undefined }), { key })}
        />
      )}
      {!c.replacementOrderId && c.status !== 'closed' && (
        <FormButton
          label="Link replacement"
          disabledReason={retailOrders.length ? undefined : 'Create the replacement retailer order first (Salesman app)'}
          title={`Link replacement to ${c.id}`}
          submitLabel="Link order"
          fields={[{ key: 'orderId', label: 'Replacement order', type: 'select', options: retailOrders, required: true }]}
          onSubmit={(v, key) => run('Link replacement', (ctx) => C.linkReplacement(ctx, c.id, str(v.orderId)), { key })}
        />
      )}
      {c.creditStatus === 'none' && c.status !== 'closed' && (
        <Button size="compact" disabledReason={can('complaint.create', 'request credit')} onClick={() => run('Request credit note', (ctx) => C.requestCredit(ctx, c.id))}>
          Request credit
        </Button>
      )}
      {c.creditStatus === 'requested' && (
        <Button size="compact" disabledReason={can('tally.sync', 'confirm credit notes')} onClick={() => run('Confirm credit note', (ctx) => C.confirmCredit(ctx, c.id))}>
          Confirm credit
        </Button>
      )}
      {c.status !== 'closed' && (
        <Button size="compact" variant="ghost" disabledReason={can('complaint.create', 'close complaints')} onClick={() => run('Close complaint', (ctx) => C.closeComplaint(ctx, c.id))}>
          Close
        </Button>
      )}
    </span>
  );
}

function RecallView() {
  const { db, s, now, actor } = useR();
  const run = useAct();
  const can = useCan();
  const roots = scopedLots(s, actor).filter((l) => l.rootId === l.id && l.material !== 'OIL' && l.material !== 'BAGS');
  const [root, setRoot] = useState(roots.find((r) => r.id === 'RT-001')?.id ?? roots[0]?.id ?? '');
  const fam = root ? [root, ...descendants(s, root)] : [];
  const rows = scopedStockRows(s, actor, now).filter((r) => fam.includes(r.lotId));
  // one row per physical destination event; the matching ledger movement is evidence, not a second recipient
  const recipients = recallRecipients(s, actor, fam, (kind, id) => String(db.records[kind === 'distributor' ? 'distributors' : kind === 'buyer' ? 'buyers' : 'retailers']?.find((r) => r.id === id)?.name ?? id).replace(' (fictional)', ''));
  const activeRecall = s.holds.find((h) => h.status === 'active' && h.kind === 'recall' && h.target === root);
  return (
    <Panel
      title="Recall trace"
      meta="Origin lot, every lot made from it, where it is now and who received it"
      actions={
        <>
          <select className="input" aria-label="Root lot" value={root} onChange={(e) => setRoot(e.target.value)}>
            {roots.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id} — {r.label}
              </option>
            ))}
          </select>
          <FormButton
            label="Place recall hold"
            variant="primary"
            disabledReason={can('quality.hold', 'place recall holds') ?? (activeRecall ? `Recall hold ${activeRecall.id} already active` : undefined)}
            title={`Recall hold on ${root}`}
            submitLabel="Hold root and descendants"
            note="All undispatched stock made from this lot goes on hold and its reservations become at risk. Recipients are listed for follow-up; this does not file a regulator notice."
            fields={[{ key: 'reason', label: 'Reason', type: 'text', required: true }]}
            onSubmit={(v, key) => run('Place recall hold', (ctx) => O.placeHold(ctx, { scope: 'lot', target: root, kind: 'recall', reason: str(v.reason) }), { key })}
          />
        </>
      }
    >
      <div className="rt-stack">
        {activeRecall && <InlineAlert tone="warning" title={`Recall hold ${activeRecall.id} active`}>{activeRecall.reason}</InlineAlert>}
        <h3 className="rt-h3">Current stock positions ({fmtKg(sum(rows.map((r) => r.qty)))})</h3>
        <Table
          cols={[
            { key: 'lot', label: 'Lot', render: (r) => <LotLink id={r.lotId} /> },
            { key: 'loc', label: 'Custody', render: (r) => r.location?.label ?? r.loc },
            { key: 'q', label: 'Physical', num: true, render: (r) => <Qty g={r.qty} /> },
            { key: 'r', label: 'Reserved', num: true, render: (r) => <Qty g={r.reserved} /> },
            { key: 'h', label: 'Condition', render: (r) => (r.held ? <Reason tone="warning" text={r.holds[0]} /> : r.expired ? 'Expired' : r.sellable ? 'Good — sellable' : 'Good') },
          ]}
          rows={rows.filter((r) => r.lot.unit !== 'bag')}
          rowKey={(r) => `${r.lotId}|${r.loc}`}
          rowClass={(r) => (r.held ? 'is-held' : undefined)}
          empty="No live stock in this genealogy."
        />
        <h3 className="rt-h3">Recipients</h3>
        <Table
          cols={[
            { key: 'to', label: 'Recipient', render: (x) => (<><div>{x.recipient}</div><div className="muted">{x.recipientId}</div></>) },
            { key: 'lot', label: 'Lot', render: (x) => <LotLink id={x.lotId} /> },
            { key: 'q', label: 'Qty', num: true, render: (x) => <Qty g={x.qty} /> },
            { key: 'st', label: 'Custody state', render: (x) => x.stateLabel },
            { key: 'ref', label: 'Evidence', render: (x) => (<><Ref>{x.ref}</Ref>{x.movementIds.length > 0 && <div className="muted">ledger {x.movementIds.join(', ')}</div>}</>) },
            { key: 'at', label: 'When', render: (x) => fmtTime(x.at) },
          ]}
          rows={recipients}
          rowKey={(x) => x.id}
          empty="No recipients yet."
        />
      </div>
    </Panel>
  );
}
