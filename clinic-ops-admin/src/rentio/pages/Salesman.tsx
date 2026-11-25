/** Salesman app (simulated phone): mapped distributors, rates at capture, offline queue and sync. */
import { useState } from 'react';
import { Button } from '../../components/primitives/Button';
import { InlineAlert } from '../../components/primitives/feedback';
import * as C from '../../domain/rentio/commerce';
import { readScope, scopedComplaints, scopedOrders, scopedStockRows, visibleDistributorIds } from '../../domain/rentio/scope';
import { fmtINR, fmtKg, sum } from '../../domain/rentio/units';
import { useAct, useR } from '../store';
import { Details, FormButton, Grid, ImplNote, num, Panel, Qty, Ref, RPage, Sim, Status, str, Table, useCan, useFocusId, fmtTime } from '../ui';
import { FocusMissing } from './_distHelpers';

const GRADES = ['A1', 'B1', 'A2', 'B2'];

export default function Salesman() {
  const { db, s, actor, now } = useR();
  const run = useAct();
  const can = useCan();
  const focus = useFocusId();
  const [syncResult, setSyncResult] = useState<{ id: string; status: string; message: string }[] | null>(null);
  const isSalesman = actor.roleId === 'salesman';
  // salesman: own mapped distributors only (empty scope = none). Office roles view the salesman's mapped set within their own scope.
  const mapped = isSalesman
    ? readScope(actor).distributors
    : visibleDistributorIds(
        (db.records.distributors ?? []).filter((d) => d.salesmanId).map((d) => String(d.id)),
        actor,
      );
  const online = s.offline.online;
  const retailers = (db.records.retailers ?? []).filter((r) => mapped.includes(String(r.distributorId)));
  const orderReason = can('order.create.retail', 'take retailer orders');
  const rateOf = (g: string) => {
    try {
      return C.currentRate({ s }, g, 'retail');
    } catch {
      return undefined;
    }
  };
  const stock = mapped.flatMap((d) =>
    GRADES.map((g) => ({ d, g, avail: sum(C.eligibleFor({ s, at: now }, g, (l) => l === C.distLoc(d)).map((r) => r.available)), rate: rateOf(g) })).filter((x) => x.avail > 0),
  );
  const queue = s.offline.queue.filter((q) => mapped.includes(q.distributorId) && (!isSalesman || q.salesmanId === actor.id));
  const myOrders = scopedOrders(s, actor)
    .filter((o) => o.kind === 'retail' && mapped.includes(o.distributorId ?? '') && (!isSalesman || o.salesmanId === actor.id || o.createdBy === actor.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const myOrderIds = new Set(myOrders.map((o) => o.id));
  const cols = s.collections.filter((c) => myOrderIds.has(c.orderId) && (!isSalesman || c.recordedBy === actor.id));
  const complaints = scopedComplaints(s, actor).filter((c) => mapped.includes(c.distributorId ?? ''));
  const lotOpts = [
    ...new Map(
      scopedStockRows(s, actor, now)
        .filter((r) => mapped.includes(r.location?.distributorId ?? '') && r.lot.material === 'PACKED')
        .map((r) => [r.lotId, { value: r.lotId, label: `${r.lotId} · ${r.lot.grade ?? ''} · at ${r.location.distributorId}` }]),
    ).values(),
  ];
  const focusFound = !focus || queue.some((q) => q.id === focus) || myOrderIds.has(focus);
  const retailerOpts = retailers.map((r) => ({ value: String(r.id), label: `${r.name} (${r.distributorId})` }));

  return (
    <RPage
      title="Salesman app"
      description="Simulated phone app for mapped distributors and retailers, with offline capture and sync."
      intro={
        <>
          Orders taken offline wait in the queue and are checked again on sync <Sim what="Phone app simulated" />
        </>
      }
    >
      <FocusMissing focus={focus} found={focusFound} />
      <div className="rt-split">
        <div className="rt-mobile rt-stack">
          <div className="rt-row">
            <strong>{isSalesman ? 'My phone' : "Salesman's phone (view)"}</strong>
            <span className="spacer" />
            <Status s={online ? 'online' : 'offline'} />
            <Button
              size="compact"
              disabledReason={orderReason}
              onClick={() => run(online ? 'Device goes offline' : 'Device reconnects', (ctx) => C.setDeviceOnline(ctx, !online), { success: () => (online ? 'Device offline — orders will queue' : 'Device online — sync queued orders') })}
            >
              {online ? 'Go offline' : 'Reconnect'}
            </Button>
          </div>
          {!online && <InlineAlert tone="warning" title="Offline">New orders are saved as “Queued offline”. Stock and rates shown are the last cached values.</InlineAlert>}
          <FormButton
            label={online ? 'Submit retailer order' : 'Queue order offline'}
            variant="primary"
            icon="plus"
            disabledReason={orderReason ?? (retailerOpts.length ? undefined : 'No mapped retailers')}
            title={online ? 'New retailer order' : 'Capture order offline'}
            submitLabel={online ? 'Submit (reserve at distributor)' : 'Save to offline queue'}
            note={online ? 'Reserves stock at the serving distributor; their stock reduces only on delivery.' : 'Saved on the phone with the rate shown now; checked again on sync.'}
            fields={[
              { key: 'retailerId', label: 'Retailer', type: 'select', options: retailerOpts, required: true },
              { key: 'grade', label: 'Grade', type: 'select', options: GRADES.map((g) => ({ value: g, label: `${g}${rateOf(g) ? ` · ${fmtINR(rateOf(g)!.ratePerKg)}/kg` : ''}` })), required: true },
              { key: 'kg', label: 'Quantity', type: 'number', unit: 'kg, 25 kg bags', step: 25, required: true },
              { key: 'advance', label: 'Advance booking (no reservation)', type: 'checkbox' },
            ]}
            initial={{ retailerId: retailerOpts[0]?.value ?? '', grade: 'A1', kg: '100' }}
            onSubmit={(v, key) => {
              const ret = retailers.find((r) => r.id === v.retailerId);
              const distributorId = String(ret?.distributorId ?? '');
              return online
                ? run('Retailer order', (ctx) => C.createRetailOrder(ctx, { distributorId, retailerId: str(v.retailerId), grade: str(v.grade), kg: num(v.kg), advance: !!v.advance }), { key, success: (o) => `Submitted ${o.id} — reserved at ${distributorId}` })
                : run('Queue offline order', (ctx) => C.queueOfflineOrder(ctx, { distributorId, retailerId: str(v.retailerId), grade: str(v.grade), kg: num(v.kg) }), { key, success: (q) => `Queued offline as ${q.id}` });
            }}
          />
          <h3 className="rt-h3">Mapped distributor stock & rates</h3>
          <Table
            cols={[
              { key: 'd', label: 'Distributor', render: (x) => x.d },
              { key: 'g', label: 'Grade', render: (x) => x.g },
              { key: 'a', label: 'Available', num: true, render: (x) => <Qty g={x.avail} /> },
              { key: 'r', label: 'Rate', num: true, render: (x) => (x.rate ? `${fmtINR(x.rate.ratePerKg)}/kg` : '—') },
              ]}
            rows={stock}
            rowKey={(x) => `${x.d}${x.g}`}
            empty="No eligible stock at mapped distributors."
          />
          <p className="muted">
            As of {fmtTime(now)} {online ? '(live)' : '(cached — device offline)'}
          </p>
        </div>

        <div className="rt-stack">
          <Panel
            title="Orders waiting to sync"
            meta={`${queue.filter((q) => q.status === 'queued').length} queued · ${queue.filter((q) => q.status === 'conflict').length} conflicts`}
            actions={
              <Button
                variant="primary"
                icon="reset"
                disabledReason={orderReason ?? (!online ? 'Device is offline — reconnect first' : queue.some((q) => q.status === 'queued') ? undefined : 'Nothing queued')}
                onClick={() => {
                  const r = run('Sync offline orders', (ctx) => C.syncOffline(ctx), { success: (res) => `Synced ${res.length}: ${res.filter((x) => x.status === 'accepted').length} accepted, ${res.filter((x) => x.status === 'conflict').length} conflicts` });
                  if (r.ok) setSyncResult(r.result ?? null);
                }}
              >
                Sync now
              </Button>
            }
          >
            {syncResult && (
              <InlineAlert tone={syncResult.some((x) => x.status === 'conflict') ? 'warning' : 'success'} title="Sync outcome — one result per request">
                {syncResult.map((x) => `${x.id}: ${x.message}`).join(' · ')}
              </InlineAlert>
            )}
            <Table
              focus={focus}
              cols={[
                { key: 'id', label: 'Request', render: (q) => <Ref>{q.id}</Ref> },
                { key: 'c', label: 'Captured', render: (q) => fmtTime(q.capturedAt) },
                { key: 'r', label: 'Retailer', render: (q) => `${q.retailerId} (${q.distributorId})` },
                { key: 'g', label: 'Grade', render: (q) => q.grade },
                { key: 'q', label: 'Qty', num: true, render: (q) => fmtKg(q.qty) },
                { key: 'rate', label: 'Rate seen', num: true, render: (q) => `${fmtINR(q.rateSeen)}/kg` },
                { key: 'st', label: 'State', render: (q) => <Status s={q.status === 'queued' ? 'queued' : q.status} /> },
                { key: 'm', label: 'Outcome', render: (q) => q.conflict ?? (q.orderId ? `Accepted as ${q.orderId}` : 'Queued offline — not yet reserved') },
                {
                  key: 'a',
                  label: 'Resolve',
                  render: (q) =>
                    q.status === 'conflict' ? (
                      <span className="rt-row">
                        {q.conflict?.startsWith('Rate') && (
                          <Button size="compact" onClick={() => run('Resolve: accept current rate', (ctx) => C.resolveOffline(ctx, { id: q.id, action: 'accept_current_rate' }))}>
                            Accept current rate
                          </Button>
                        )}
                        {q.conflict?.startsWith('Stock') && (
                          <Button size="compact" onClick={() => run('Resolve: reduce to available', (ctx) => C.resolveOffline(ctx, { id: q.id, action: 'reduce_to_available' }))}>
                            Reduce to available
                          </Button>
                        )}
                        <Button size="compact" variant="ghost" onClick={() => run('Resolve: cancel', (ctx) => C.resolveOffline(ctx, { id: q.id, action: 'cancel' }))}>
                          Cancel
                        </Button>
                      </span>
                    ) : (
                      '—'
                    ),
                },
              ]}
              rows={queue}
              rowKey={(q) => q.id}
              empty="Queue is empty."
            />
          </Panel>

          <Panel title={isSalesman ? 'My retailer orders' : 'Retailer orders'}>
            <Table
              focus={focus}
              cols={[
                { key: 'id', label: 'Order', render: (o) => <Ref>{o.id}</Ref> },
                { key: 'r', label: 'Retailer', render: (o) => o.partyId },
                { key: 'd', label: 'Distributor', render: (o) => o.distributorId },
                { key: 'g', label: 'Grade', render: (o) => o.lines[0].grade },
                { key: 'q', label: 'Qty', num: true, render: (o) => fmtKg(o.lines[0].qty) },
                { key: 'rate', label: 'Locked rate', num: true, render: (o) => `${fmtINR(o.lines[0].ratePerKg)}/kg` },
                { key: 'st', label: 'Status', render: (o) => <span className="rt-row"><Status s={o.status === 'closed' ? 'delivered' : o.status} />{o.advance && <Status s="advance" />}</span> },
              ]}
              rows={myOrders}
              rowKey={(o) => o.id}
              empty="No retailer orders yet."
            />
            <Details summary="Order source and rate version">
              <Table
                cols={[
                  { key: 'id', label: 'Order', render: (o) => o.id },
                  { key: 'src', label: 'Taken', render: (o) => (o.source === 'offline' ? 'Offline, synced' : 'Online') },
                  { key: 'v', label: 'Rate version', render: (o) => <Ref>{o.lines[0].rateVersion}</Ref> },
                ]}
                rows={myOrders}
                rowKey={(o) => o.id}
              />
            </Details>
          </Panel>

          <Grid>
            <Panel
              title="Collections"
              actions={
                <FormButton
                  label="Record collection"
                  disabledReason={can('collection.record', 'record collections') ?? (myOrders.length ? undefined : 'No orders')}
                  title="Record collection evidence"
                  submitLabel="Save as provisional"
                  note="The retailer owes the distributor, not Rentio. It stays provisional until Accounts confirms it."
                  fields={[
                    { key: 'orderId', label: 'Order', type: 'select', options: myOrders.map((o) => ({ value: o.id, label: `${String((db.records.retailers ?? []).find((r) => r.id === o.partyId)?.name ?? o.partyId).replace(' (fictional)', '')} · ${o.lines[0].grade} ${fmtKg(o.lines[0].qty)} (${o.id})` })), required: true },
                    { key: 'amount', label: 'Amount', type: 'number', unit: '₹', required: true },
                    { key: 'mode', label: 'Mode', type: 'select', options: [{ value: 'cash', label: 'Cash' }, { value: 'cheque', label: 'Cheque' }, { value: 'upi', label: 'UPI' }], required: true },
                  ]}
                  initial={{ mode: 'upi' }}
                  onSubmit={(v, key) => run('Record collection', (ctx) => C.recordCollection(ctx, { orderId: str(v.orderId), amount: num(v.amount), mode: str(v.mode) as 'cash' | 'cheque' | 'upi' }), { key })}
                />
              }
            >
              <Table
                cols={[
                  { key: 'id', label: 'Ref', render: (c) => <Ref>{c.id}</Ref> },
                  { key: 'o', label: 'Order', render: (c) => c.orderId },
                  { key: 'dc', label: 'Debtor → creditor', render: (c) => `${c.debtor} → ${c.creditor}` },
                  { key: 'a', label: 'Amount', num: true, render: (c) => fmtINR(c.amount) },
                  { key: 's', label: 'Status', render: (c) => <Status s={c.status} /> },
                ]}
                rows={cols}
                rowKey={(c) => c.id}
                empty="No collections recorded."
              />
            </Panel>
            <Panel
              title="Complaints"
              actions={
                <FormButton
                  label="Log complaint"
                  disabledReason={can('complaint.create', 'log complaints')}
                  title="Log a retailer complaint"
                  submitLabel="Log complaint"
                  note="Choose “Lot not known” if the label is missing — the case is flagged for identification instead of guessing."
                  fields={[
                    { key: 'retailerId', label: 'Retailer', type: 'select', options: retailerOpts, required: true },
                    { key: 'category', label: 'Category', type: 'select', options: ['quality', 'short', 'damage', 'wrong_grade', 'other'].map((c) => ({ value: c, label: c.replace('_', ' ') })), required: true },
                    { key: 'lotId', label: 'Lot', type: 'select', options: [{ value: '__unknown', label: 'Lot not known' }, ...lotOpts] },
                    { key: 'description', label: 'Description', type: 'textarea', required: true },
                  ]}
                  initial={{ category: 'quality', lotId: '__unknown' }}
                  onSubmit={(v, key) => {
                    const ret = retailers.find((r) => r.id === v.retailerId);
                    return run('Log complaint', (ctx) => C.createComplaint(ctx, { retailerId: str(v.retailerId), distributorId: String(ret?.distributorId ?? ''), lotId: str(v.lotId) && str(v.lotId) !== '__unknown' ? str(v.lotId) : undefined, category: str(v.category) as 'quality', description: str(v.description) }), { key });
                  }}
                />
              }
            >
              <Table
                cols={[
                  { key: 'id', label: 'Case', render: (c) => <Ref>{c.id}</Ref> },
                  { key: 'r', label: 'Retailer', render: (c) => c.retailerId ?? '—' },
                  { key: 'l', label: 'Lot', render: (c) => c.lotId ?? 'Unknown' },
                  { key: 's', label: 'Status', render: (c) => <Status s={c.status} /> },
                ]}
                rows={complaints}
                rowKey={(c) => c.id}
                empty="No complaints."
              />
            </Panel>
          </Grid>
        </div>
      </div>
      <ImplNote>
        Mapped-distributor visibility (FR-050, BR-015) via scope.ts — a salesman with no mapping sees nothing. Rate snapshot at acceptance (FR-051). Offline capture queues requests, not reservations (A5); sync revalidates mapping, rate and stock with one visible outcome per request (FR-052, EC-27). Collections stay provisional until Accounts confirms (FR-108, BR-030). Unknown-lot complaints stay flagged (FR-063). The phone and offline connectivity are simulated; the offline switch is one shared demo device.
      </ImplNote>
    </RPage>
  );
}
