/** Distributor stock: own stock, shipment receipts and variances, retailer deliveries, outside sales, counts. */
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { hasCap } from '../../domain/rentio/access';
import * as C from '../../domain/rentio/commerce';
import { computePositions } from '../../domain/rentio/engine';
import * as O from '../../domain/rentio/ops';
import { scopedOrders, scopedShipments, scopedStockRows, visibleDistributorIds } from '../../domain/rentio/scope';
import { fmtKg, kg, sum } from '../../domain/rentio/units';
import { distributorOverview } from '../../domain/rentio/views';
import { useAct, useR } from '../store';
import { Details, FormButton, ImplNote, Kpi, KpiRow, LotLink, num, Panel, Qty, Reason, Ref, RPage, Status, str, Table, useCan, useFocusId, fmtTime } from '../ui';
import { FocusMissing, Preview, stockOptionLabel } from './_distHelpers';

export default function Distributors() {
  const { db, s, actor, now } = useR();
  const run = useAct();
  const can = useCan();
  const focus = useFocusId();
  const { search, pathname } = useLocation();
  const navigate = useNavigate();
  const allIds = (db.records.distributors ?? []).map((d) => String(d.id));
  const visibleIds = visibleDistributorIds(allIds, actor);
  // scoped: only distributors the actor may read; missing scope = none
  const overview = distributorOverview(db, now).filter((d) => visibleIds.includes(d.id));
  const scopedView = visibleIds.length < allIds.length;
  const requested = new URLSearchParams(search).get('d') ?? undefined;
  const [sel, setSel] = useState<string>('');
  const pick = (id: string) => {
    setSel(id);
    const q = new URLSearchParams(search);
    q.set('d', id);
    q.delete('focus');
    navigate(`${pathname}?${q.toString()}`, { replace: true });
  };
  const requestedVisible = !requested || visibleIds.includes(requested);
  const d = overview.find((x) => x.id === sel) ?? (requested && requestedVisible ? overview.find((x) => x.id === requested) : undefined) ?? overview[0];
  const rows = scopedStockRows(s, actor, now);
  const pos = computePositions(s);
  const mine = actor.scope.distributors ?? [];
  const opsReason = can('distributor.operate', 'operate distributor stock') ?? (d && !mine.includes(d.id) ? `You are not assigned to ${d.id}` : undefined);

  if (!d)
    return (
      <RPage title="Distributor stock" description="No distributors in your area">
        <p className="rt-empty">No distributor is in your area of work.</p>
      </RPage>
    );

  const dRows = rows.filter((r) => r.location?.distributorId === d.id && (r.location.kind === 'distributor' || r.location.kind === 'distributor-held'));
  const sellable = dRows.filter((r) => r.sellable && r.available > 0);
  const ships = scopedShipments(s, actor);
  const incoming = ships.filter((sh) => sh.toDistributor === d.id && sh.status === 'in_transit');
  const disputed = ships.filter((sh) => sh.toDistributor === d.id && sh.status === 'disputed');
  const retail = scopedOrders(s, actor)
    .filter((o) => o.kind === 'retail' && o.distributorId === d.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const lotOpts = sellable.map((r) => ({ value: r.lotId, label: stockOptionLabel(r) }));
  const countOpts = dRows.map((r) => ({ value: r.lotId, label: `${r.lotId} · ${r.lot.grade ?? ''} · ${fmtKg(r.qty)} on record` }));
  // transfer destinations: names only (receiver's stock is never shown to the sender)
  const otherDist = (db.records.distributors ?? []).filter((x) => x.id !== d.id).map((x) => ({ value: String(x.id), label: `${x.id} — ${x.name}` }));
  const transitLeft = (sh: (typeof s.shipments)[number]) => sum(sh.lines.map((l) => pos.get(`${l.lotId}|${sh.transitLoc}`) ?? 0));
  const focusIds = new Set<string>([...overview.map((x) => x.id), ...ships.map((x) => x.id), ...retail.map((o) => o.id), ...dRows.map((r) => r.lotId)]);
  const focusFound = !focus || focusIds.has(focus);
  const focusRow = focus ? dRows.find((r) => r.lotId === focus) : undefined;

  return (
    <RPage title="Distributor stock" description="Own stock, receipts, retailer deliveries and counts per distributor." intro="Stock reduces once — when a retailer delivery is confirmed or an outside sale is recorded.">
      {requested && !requestedVisible && <FocusMissing focus={requested} found={false} />}
      <FocusMissing focus={focus} found={focusFound} />
      <Panel title={scopedView ? `Your distributor${overview.length > 1 ? 's' : ''}` : `All distributors (${overview.length})`} meta={`as of ${fmtTime(now)}`}>
        <Table
          focus={focus && overview.some((x) => x.id === focus) ? focus : undefined}
          cols={[
            { key: 'id', label: 'Distributor', render: (x) => <button type="button" className="rt-lot" aria-pressed={x.id === d.id} onClick={() => pick(x.id)}>{x.id}</button> },
            { key: 'n', label: 'Name', render: (x) => x.name.replace(' (fictional)', '') },
            { key: 'p', label: 'In stock', num: true, render: (x) => <Qty g={x.physical} /> },
            { key: 'a', label: 'Available', num: true, render: (x) => <Qty g={x.available} strong /> },
            { key: 't', label: 'Incoming', num: true, render: (x) => <Qty g={x.inTransit} /> },
            { key: 'sync', label: 'Last update', render: (x) => (x.stale ? <span className="tone-text-warning">Stale · {x.lastSyncHours} h ago</span> : `${x.lastSyncHours} h ago`) },
            { key: 'f', label: 'Needs attention', render: (x) => <span className="rt-row">{x.openDisputes > 0 && <Status s="disputed" />}{x.held > 0 && <Status s="on hold" />}{x.belowMin && <Status s="below min" />}{x.nearExpiry > 0 && <Status s="near expiry" />}</span> },
          ]}
          rows={overview}
          rowKey={(x) => x.id}
          rowClass={(x) => (x.id === d.id ? 'is-total' : undefined)}
        />
      </Panel>

      <KpiRow>
        <Kpi label={`${d.id} in stock`} value={fmtKg(d.physical)} note={d.stale ? `Stale — last update ${d.lastSyncHours} h ago` : 'Live from postings'} tone={d.stale ? 'warning' : undefined} />
        <Kpi label="Available to sell" value={fmtKg(d.available)} />
        <Kpi label="Reserved for retailers" value={fmtKg(d.reserved)} />
        <Kpi label="Damaged / held" value={fmtKg(d.held)} tone={d.held ? 'warning' : undefined} />
        <Kpi label="Incoming" value={fmtKg(d.inTransit)} />
      </KpiRow>

      <Panel title="Shipments to receive & shortfalls">
        <Table
          focus={focus}
          cols={[
            { key: 'id', label: 'Shipment', render: (sh) => <Ref>{sh.id}</Ref> },
            { key: 'from', label: 'From', render: (sh) => sh.fromDistributor ?? 'Factory' },
            { key: 'q', label: 'Shipped', num: true, render: (sh) => <Qty g={sum(sh.lines.map((l) => l.qty))} /> },
            { key: 'left', label: 'Still in transit', num: true, render: (sh) => <Qty g={transitLeft(sh)} strong={transitLeft(sh) > 0} /> },
            { key: 'st', label: 'Status', render: (sh) => <Status s={sh.status} /> },
            {
              key: 'act',
              label: 'Action',
              render: (sh) => {
                const shipped = sum(sh.lines.map((l) => l.qty));
                return sh.status === 'in_transit' ? (
                  <FormButton
                    label="Receive"
                    variant="primary"
                    disabledReason={opsReason}
                    title={`Receive ${sh.id} at ${d.id}`}
                    submitLabel="Submit & lock receipt"
                    note="Enter what physically arrived. Anything not counted as good or damaged stays short in transit and opens a dispute."
                    fields={[
                      { key: 'good', label: 'Good received now', type: 'number', unit: 'kg', required: true },
                      { key: 'damaged', label: 'Damaged (kept on hold)', type: 'number', unit: 'kg' },
                      { key: 'excess', label: 'Extra found beyond the shipment', type: 'number', unit: 'kg', help: 'Held as unidentified stock until its source is found — never added to this lot' },
                      { key: 'note', label: 'Note / evidence', type: 'text' },
                    ]}
                    initial={{ good: String(shipped / 1000), damaged: '0', excess: '0' }}
                    onSubmit={(v, key) => run('Receive shipment', (ctx) => C.receiveShipment(ctx, { shipmentId: sh.id, goodKg: num(v.good), damagedKg: num(v.damaged), excessKg: num(v.excess), note: str(v.note) || undefined }), { key, success: (x) => `${x.id} ${x.status === 'received' ? 'received in full' : `received with exceptions (${fmtKg(x.receipt!.short)} short${x.receipt!.excess ? `, ${fmtKg(x.receipt!.excess)} extra held` : ''}) — case ${x.disputeId}`}` })}
                  >
                    {(v) => {
                      const good = kg(num(v.good));
                      const dmg = kg(num(v.damaged));
                      const short = shipped - good - dmg;
                      return (
                        <Preview
                          items={[
                            { label: 'Shipped', g: shipped },
                            { label: 'Good now', g: good, key: true },
                            { label: 'Damaged (held)', g: dmg },
                            { label: short < 0 ? 'Over shipped qty' : 'Short — stays in transit', g: Math.abs(short), tone: short !== 0 ? 'danger' : undefined },
                          ]}
                        />
                      );
                    }}
                  </FormButton>
                ) : transitLeft(sh) > 0 ? (
                  <FormButton
                    label="Request settlement"
                    disabledReason={hasCap(actor, 'logistics.manage') || hasCap(actor, 'handover.settle.request') ? undefined : 'Back Office settles shortfalls — you will see the outcome here'}
                    title={`Settle shortfall on ${sh.id}`}
                    submitLabel="Request approval"
                    fields={[
                      { key: 'how', label: 'Outcome', type: 'select', options: [{ value: 'loss', label: 'Approved transit loss' }, { value: 'located', label: 'Found — receive into distributor' }], required: true },
                      { key: 'reason', label: 'Evidence-based reason', type: 'text', required: true },
                    ]}
                    initial={{ how: 'loss' }}
                    onSubmit={(v, key) => run('Request transit settlement', (ctx) => C.requestTransitSettlement(ctx, { shipmentId: sh.id, how: str(v.how) as 'loss' | 'located', reason: str(v.reason) }), { key, success: (a) => `${a.id} sent for approval` })}
                  />
                ) : (
                  '—'
                );
              },
            },
          ]}
          rows={[...incoming, ...disputed]}
          rowKey={(sh) => sh.id}
          empty="Nothing in transit to this distributor and no open shortfalls."
        />
      </Panel>

      <Panel title="Retailer orders" meta="Reserved at the distributor; stock reduces on delivery">
        <Table
          focus={focus}
          cols={[
            { key: 'id', label: 'Order', render: (o) => <Ref>{o.id}</Ref> },
            { key: 'r', label: 'Retailer', render: (o) => String(db.records.retailers?.find((x) => x.id === o.partyId)?.name ?? o.partyId).replace(' (fictional)', '') },
            { key: 'g', label: 'Grade', render: (o) => o.lines[0].grade },
            { key: 'q', label: 'Qty', num: true, render: (o) => <Qty g={o.lines[0].qty} /> },
            { key: 'res', label: 'Reserved', num: true, render: (o) => <Qty g={C.lineBalance(s, o, o.lines[0]).reserved} /> },
            { key: 'st', label: 'Status', render: (o) => <span className="rt-row"><Status s={o.status === 'closed' ? 'delivered' : o.status} />{o.advance && <Status s="advance" />}</span> },
            {
              key: 'act',
              label: 'Action',
              render: (o) => {
                const reserved = C.lineBalance(s, o, o.lines[0]).reserved;
                return o.status === 'approved' && !o.advance ? (
                  <FormButton
                    label="Confirm delivery"
                    variant="primary"
                    disabledReason={opsReason}
                    title={`Deliver ${o.id}`}
                    submitLabel="Confirm delivered"
                    note="Stock is deducted now, once. The challan number cannot be used again for another deduction."
                    fields={[{ key: 'ref', label: 'Delivery challan number', type: 'text', required: true }]}
                    initial={{ ref: `${d.id}-CH-${String(retail.length + 1).padStart(4, '0')}` }}
                    onSubmit={(v, key) => run('Confirm retailer delivery', (ctx) => C.deliverRetail(ctx, { orderId: o.id, challanRef: str(v.ref) }), { key })}
                  >
                    {() => (
                      <Preview
                        items={[
                          { label: 'Reserved for this order', g: reserved },
                          { label: 'Delivered now', g: reserved, key: true },
                          { label: `${d.id} stock after`, g: d.physical - reserved },
                        ]}
                      />
                    )}
                  </FormButton>
                ) : (
                  '—'
                );
              },
            },
          ]}
          rows={retail}
          rowKey={(o) => o.id}
          empty="No retailer orders for this distributor."
        />
      </Panel>

      <Panel
        title={`${d.id} stock by lot`}
        actions={
          <>
            <FormButton
              label="Outside-app sale"
              disabledReason={opsReason ?? (lotOpts.length ? undefined : 'No sellable stock')}
              title={`Outside-app sale at ${d.id}`}
              submitLabel="Record sale"
              note="The bill number must be new: a number already used by an app delivery or earlier sale is blocked."
              fields={[
                { key: 'lotId', label: 'Stock', type: 'select', options: lotOpts, required: true },
                { key: 'kg', label: 'Quantity', type: 'number', unit: 'kg', required: true },
                { key: 'ref', label: 'Bill number', type: 'text', required: true },
              ]}
              initial={{ lotId: lotOpts[0]?.value ?? '' }}
              onSubmit={(v, key) => run('Outside-app sale', (ctx) => C.outsideSale(ctx, { distributorId: d.id, lotId: str(v.lotId), kg: num(v.kg), externalRef: str(v.ref) }), { key })}
            />
            <FormButton
              label="Transfer to distributor"
              disabledReason={opsReason ?? (lotOpts.length ? undefined : 'No sellable stock')}
              title={`Transfer from ${d.id}`}
              submitLabel="Send into transit"
              note="Stock leaves now and is in transit; the receiving distributor's stock increases only when they receive it."
              fields={[
                { key: 'to', label: 'To distributor', type: 'select', options: otherDist, required: true },
                { key: 'lotId', label: 'Stock', type: 'select', options: lotOpts, required: true },
                { key: 'kg', label: 'Quantity', type: 'number', unit: 'kg', required: true },
              ]}
              initial={{ lotId: lotOpts[0]?.value ?? '' }}
              onSubmit={(v, key) => run('Inter-distributor transfer', (ctx) => C.distributorTransfer(ctx, { from: d.id, to: str(v.to), lotId: str(v.lotId), kg: num(v.kg) }), { key, success: (sh) => `${sh.id} in transit` })}
            />
            <FormButton
              label="Physical count"
              disabledReason={opsReason ?? (countOpts.length ? undefined : 'No stock to count')}
              title={`Count at ${d.id}`}
              submitLabel="Submit count"
              note="A difference is never overwritten: it goes to an approver as an adjustment request."
              fields={[
                { key: 'lotId', label: 'Stock', type: 'select', options: countOpts, required: true },
                { key: 'kg', label: 'Counted quantity', type: 'number', unit: 'kg', required: true },
              ]}
              initial={{ lotId: countOpts[0]?.value ?? '' }}
              onSubmit={(v, key) => run('Distributor count', (ctx) => O.submitCount(ctx, { lotId: str(v.lotId), loc: `DIST:${d.id}`, countedKg: num(v.kg) }), { key, success: (c) => (c.difference ? `Count ${c.id}: difference ${fmtKg(c.difference)} sent for approval` : `Count ${c.id} matched`) })}
            />
          </>
        }
      >
        <Table
          focus={focusRow ? `${focusRow.lotId}|${focusRow.loc}` : undefined}
          cols={[
            { key: 'lot', label: 'Lot', render: (r) => <LotLink id={r.lotId} /> },
            { key: 'g', label: 'Grade', render: (r) => r.lot.grade ?? '—' },
            { key: 'b', label: 'Bags', num: true, render: (r) => (r.lot.bagSize ? Math.floor(r.qty / r.lot.bagSize) : '—') },
            { key: 'p', label: 'In stock', num: true, render: (r) => <Qty g={r.qty} /> },
            { key: 'a', label: 'Available', num: true, render: (r) => <Qty g={r.available} strong /> },
            { key: 'h', label: 'Condition', render: (r) => (r.held ? <Reason tone="warning" text={r.holds[0]} /> : r.expired ? <Reason tone="warning" text={`Expired ${r.lot.expiry}`} /> : 'Good') },
          ]}
          rows={dRows}
          rowKey={(r) => `${r.lotId}|${r.loc}`}
          rowClass={(r) => (r.held || r.expired ? 'is-held' : undefined)}
          empty="No stock at this distributor."
        />
        <Details summary="Best-before dates and reservations by lot">
          <Table
            cols={[
              { key: 'lot', label: 'Lot', render: (r) => r.lotId },
              { key: 'e', label: 'Best before', render: (r) => r.lot.expiry ?? '—' },
              { key: 'r', label: 'Reserved', num: true, render: (r) => <Qty g={r.reserved} /> },
              { key: 'risk', label: 'Reserved but cannot ship', num: true, render: (r) => <Qty g={r.reservedAtRisk} /> },
            ]}
            rows={dRows}
            rowKey={(r) => `${r.lotId}|${r.loc}`}
          />
        </Details>
      </Panel>

      <ImplNote>
        Receipt good/damaged/short with locked submission and dispute (FR-044/045); own-only scope (FR-046, BR-015 via scope.ts: distributor and salesman see only their distributor ids; ?d= outside scope is refused); deduction on retailer delivery with unique challan and outside-sale duplicate block (FR-047, EC-30); distributor-to-distributor via transit (FR-048); counts via approval (FR-049); stale data flag (FR-077, EC-49). Last-update hours are simulated device sync values from the distributor master.
      </ImplNote>
    </RPage>
  );
}
