/** Factory → distributor orders: FEFO reservation, dispatch weighing and in-transit custody. */
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '../../components/primitives/Button';
import { InlineAlert } from '../../components/primitives/feedback';
import * as C from '../../domain/rentio/commerce';
import { DEMO } from '../../domain/rentio/config';
import { computePositions, stockRows } from '../../domain/rentio/engine';
import { readScope, scopedOrders, scopedShipments, scopedStockRows, visibleDistributorIds } from '../../domain/rentio/scope';
import type { Order } from '../../domain/rentio/types';
import { fmtINR, fmtKg, kg, sum } from '../../domain/rentio/units';
import { newKey, useAct, useR } from '../store';
import { Details, FormButton, Grid, ImplNote, Kpi, KpiRow, LotLink, num, OrderStatusChip, Panel, Qty, Reason, Ref, RPage, Sim, Status, str, Table, useCan, useFocusId, Who, fmtTime } from '../ui';
import { FocusMissing, Preview } from './_distHelpers';
import { OrderCharts } from './_graphB';
import { wsBase } from '../../lib/routes';

const GRADES = ['A1', 'B1', 'A2', 'B2'].map((g) => ({ value: g, label: g }));

export default function Orders() {
  const { db, s, actor, now } = useR();
  const run = useAct();
  const can = useCan();
  const focus = useFocusId();
  const [sel, setSel] = useState<string>('');
  const sc = readScope(actor);
  const orders = scopedOrders(s, actor)
    .filter((o) => o.kind === 'factory')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const distIds = visibleDistributorIds((db.records.distributors ?? []).map((d) => String(d.id)), actor);
  const distOpts = (db.records.distributors ?? []).filter((d) => distIds.includes(String(d.id))).map((d) => ({ value: String(d.id), label: `${d.id} — ${d.name}` }));
  const transporters = (db.records.transporters ?? []).map((t) => ({ value: String(t.id), label: String(t.name) }));
  const rows = scopedStockRows(s, actor, now);
  const pos = computePositions(s);
  const focusedOrder = focus ? orders.find((o) => o.id === focus) : undefined;
  const order = orders.find((o) => o.id === sel) ?? focusedOrder ?? orders.find((o) => o.status === 'approved' && s.reservations.some((r) => r.orderId === o.id && r.status === 'active')) ?? orders[0];
  const shipments = scopedShipments(s, actor).filter((sh) => sh.toDistributor || sh.toBuyer);

  const lineRows = orders.flatMap((o) => o.lines.map((l) => ({ o, l, b: C.lineBalance(s, o, l) })));
  const orderIds = new Set(orders.map((o) => o.id));
  const activeRes = s.reservations.filter((r) => r.status === 'active' && orderIds.has(r.orderId));
  const finished = rows.filter((r) => r.location?.kind === 'finished' && r.lot.unit !== 'bag');
  const focusFound = !focus || orderIds.has(focus);
  // replenishment handoff: /distribution/orders?new=order&d=D04&grade=A1&kg=5700 opens the normal form prefilled
  const q = new URLSearchParams(useLocation().search);
  const handoff = q.get('new') === 'order' ? q : undefined;

  return (
    <RPage
      title="Orders & dispatch"
      description="Factory to distributor orders, stock reservation, dispatch weighing and stock in transit."
      intro="Reserving keeps stock in the godown for an order; dispatch moves it into transit until the distributor receives it."
      actions={
        <FormButton
          label="New factory order"
          icon="plus"
          variant="primary"
          disabledReason={can('order.create.factory', 'create factory orders')}
          title="New factory order"
          submitLabel="Create order"
          note={handoff ? `Prefilled from replenishment suggestion for ${handoff.get('d')} — check the quantity with the distributor. Nothing is created until you submit. Uses today's published rate; above the credit limit it waits for a credit decision.` : "Uses today's published rate. Within the distributor's credit limit the order is approved automatically; above it, it waits for a credit decision."}
          defaultOpen={!!handoff}
          fields={[
            { key: 'distributorId', label: 'Distributor', type: 'select', options: distOpts, required: true },
            { key: 'grade', label: 'Grade', type: 'select', options: GRADES, required: true },
            { key: 'kg', label: 'Quantity', type: 'number', unit: 'kg, whole 25 kg bags', min: 25, step: 25, required: true },
            { key: 'promisedDate', label: 'Promised date', type: 'text', placeholder: 'YYYY-MM-DD' },
            { key: 'advance', label: 'Advance booking — planned demand, does not reserve stock', type: 'checkbox' },
          ]}
          initial={handoff ? { distributorId: handoff.get('d') ?? '', grade: handoff.get('grade') ?? 'A1', kg: handoff.get('kg') ?? '' } : { grade: 'A1', kg: '1000' }}
          onSubmit={(v, key) =>
            run('Create factory order', (ctx) => C.createFactoryOrder(ctx, { distributorId: str(v.distributorId), lines: [{ grade: str(v.grade), kg: num(v.kg) }], promisedDate: str(v.promisedDate) || undefined, advance: !!v.advance }), { key, success: (o) => `Order ${o.id} ${o.status === 'credit_hold' ? 'is on credit hold — approval requested' : 'approved within credit'}` })
          }
        />
      }
    >
      <FocusMissing focus={focus} found={focusFound} />
      <KpiRow>
        <Kpi label="Finished in godown" value={fmtKg(sum(finished.map((r) => r.qty)))} note="All F1 stacks" />
        <Kpi label="Reserved for orders" value={fmtKg(sum(finished.map((r) => r.reserved)))} note="Still in the godown" />
        <Kpi label="Available to reserve" value={fmtKg(sum(finished.map((r) => r.available)))} />
        <Kpi label="On hold" value={fmtKg(sum(finished.filter((r) => r.held).map((r) => r.qty)))} tone={finished.some((r) => r.held) ? 'warning' : undefined} />
        {sc.transit && <Kpi label="In transit" value={fmtKg(sum(rows.filter((r) => r.location?.kind === 'transit').map((r) => r.qty)))} />}
      </KpiRow>

      <OrderCharts s={s} orders={orders} order={order} base={wsBase(db.session.workspaceId)} focus={focus && orderIds.has(focus) ? focus : undefined} rows={rows} shipments={shipments} />

      <Panel title="Factory orders" meta="ordered = reserved + dispatched + open (+ cancelled)">
        <Table
          focus={focus ? lineRows.find((r) => r.o.id === focus) && `${focus}:${lineRows.find((r) => r.o.id === focus)!.l.id}` : undefined}
          cols={[
            { key: 'id', label: 'Order', render: (r) => <button type="button" className="rt-lot" aria-pressed={order?.id === r.o.id} onClick={() => setSel(r.o.id)}>{r.o.id}</button> },
            { key: 'd', label: 'Distributor', render: (r) => r.o.partyId },
            { key: 'g', label: 'Grade', render: (r) => r.l.grade },
            { key: 'q', label: 'Ordered', num: true, render: (r) => <Qty g={r.b.ordered} /> },
            { key: 'res', label: 'Reserved', num: true, render: (r) => <Qty g={r.b.reserved} /> },
            { key: 'dsp', label: 'Dispatched', num: true, render: (r) => <Qty g={r.b.dispatched} /> },
            { key: 'tr', label: 'In transit', num: true, render: (r) => <Qty g={r.b.inTransit} /> },
            { key: 'rcv', label: 'Delivered', num: true, render: (r) => <Qty g={r.b.delivered} /> },
            { key: 'un', label: 'Open', num: true, render: (r) => <Qty g={r.b.unallocated} strong={r.b.unallocated > 0} /> },
            { key: 'p', label: 'Promised', render: (r) => r.o.promisedDate ?? '—' },
            { key: 'st', label: 'Status', render: (r) => <OrderStatusChip order={r.o} /> },
          ]}
          rows={lineRows}
          rowKey={(r) => `${r.o.id}:${r.l.id}`}
          rowClass={(r) => (order?.id === r.o.id ? 'is-total' : undefined)}
          empty="No factory orders in your area."
        />
        <Details summary="Rate snapshot and cancelled quantity per line">
          <Table
            cols={[
              { key: 'id', label: 'Order / line', render: (r) => `${r.o.id} · ${r.l.id}` },
              { key: 'rate', label: 'Rate at order', render: (r) => <span>{fmtINR(r.l.ratePerKg)}/kg <Ref>{r.l.rateVersion}</Ref></span> },
              { key: 'c', label: 'Cancelled', num: true, render: (r) => <Qty g={r.b.cancelled} /> },
            ]}
            rows={lineRows}
            rowKey={(r) => `${r.o.id}:${r.l.id}`}
          />
        </Details>
      </Panel>

      {order && <OrderDetail key={order.id} order={order} transporters={transporters} />}

      <Grid>
        <Panel title="Finished stock and reservations" meta="Reserving does not move or reduce physical stock">
          <Table
            cols={[
              { key: 'lot', label: 'Lot', render: (r) => <LotLink id={r.lotId} /> },
              { key: 'loc', label: 'Stack', render: (r) => r.location.label },
              { key: 'g', label: 'Grade', render: (r) => r.lot.grade ?? '—' },
              { key: 'p', label: 'In godown', num: true, render: (r) => <Qty g={r.qty} /> },
              { key: 'r', label: 'Reserved', num: true, render: (r) => <Qty g={r.reserved} /> },
              { key: 'a', label: 'Available', num: true, render: (r) => <Qty g={r.available} strong /> },
              { key: 'h', label: 'Condition', render: (r) => (r.held ? <Reason tone="warning" text={r.holds[0]} /> : r.expired ? <Reason tone="warning" text={`Expired ${r.lot.expiry}`} /> : 'Good') },
            ]}
            rows={finished}
            rowKey={(r) => `${r.lotId}|${r.loc}`}
            rowClass={(r) => (r.held || r.expired ? 'is-held' : undefined)}
            empty="No finished stock."
          />
        </Panel>
        <Panel title="Active reservations" meta={`${activeRes.length}`}>
          <Table
            cols={[
              { key: 'o', label: 'Order', render: (r) => r.orderId },
              { key: 'lot', label: 'Lot', render: (r) => <LotLink id={r.lotId} /> },
              { key: 'loc', label: 'Location', render: (r) => s.locations[r.location]?.label ?? r.location },
              { key: 'q', label: 'Qty', num: true, render: (r) => <Qty g={r.qty} /> },
              {
                key: 'risk',
                label: 'Can ship?',
                render: (r) => {
                  const row = rows.find((x) => x.lotId === r.lotId && x.loc === r.location);
                  if (!row) return '—';
                  return row.reservedAtRisk > 0 || !row.sellable ? <Reason tone="danger" text={`At risk — ${row.holds[0] ?? (row.expired ? `expired ${row.lot.expiry}` : 'not sellable here')}`} /> : 'Yes';
                },
              },
            ]}
            rows={activeRes}
            rowKey={(r) => r.id}
            empty="No active reservations."
          />
        </Panel>
      </Grid>

      <Panel title="Shipments">
        <Table
          cols={[
            { key: 'id', label: 'Shipment', render: (sh) => <Ref>{sh.id}</Ref> },
            { key: 'o', label: 'Order', render: (sh) => sh.orderId },
            { key: 'to', label: 'To', render: (sh) => sh.toDistributor ?? sh.toBuyer ?? '—' },
            { key: 'q', label: 'Shipped', num: true, render: (sh) => <Qty g={sum(sh.lines.map((l) => l.qty))} /> },
            { key: 't', label: 'Still in transit', num: true, render: (sh) => <Qty g={sh.transitLoc ? sum(sh.lines.map((l) => pos.get(`${l.lotId}|${sh.transitLoc}`) ?? 0)) : 0} /> },
            { key: 'at', label: 'Dispatched', render: (sh) => <span>{fmtTime(sh.dispatchedAt)} · <Who id={sh.dispatchedBy} /></span> },
            { key: 'st', label: 'Status', render: (sh) => <Status s={sh.status} /> },
          ]}
          rows={shipments.slice().reverse()}
          rowKey={(sh) => sh.id}
          empty="No shipments."
        />
        <Details summary="Weighbridge and receipt detail per shipment">
          <Table
            cols={[
              { key: 'id', label: 'Shipment', render: (sh) => sh.id },
              { key: 'l', label: 'Lots', render: (sh) => <span className="rt-row">{sh.lines.map((l, i) => <LotLink key={i} id={l.lotId} />)}</span> },
              { key: 'w', label: 'Net dal / packaging / cargo', render: (sh) => (sh.weights ? `${fmtKg(sum(sh.lines.map((l) => l.qty)))} / ${fmtKg(sh.weights.packagingTare)} / ${fmtKg(sh.weights.vehicleGross - sh.weights.vehicleTare)}` : '—') },
              { key: 'r', label: 'Received good / damaged / short', render: (sh) => (sh.receipt ? `${fmtKg(sh.receipt.good)} / ${fmtKg(sh.receipt.damaged)} / ${fmtKg(sh.receipt.short)}` : '—') },
            ]}
            rows={shipments.slice().reverse()}
            rowKey={(sh) => sh.id}
          />
        </Details>
      </Panel>

      <ImplNote>
        Reservation without physical change (FR-039, BR-019); FEFO over eligible stock only (FR-032, EC-25); line balance buckets (FR-042); dispatch weight check net vs packaging vs vehicle tare (FR-040, FR-104, BR-028); single transit movement, idempotent (FR-041); cancel only undispatched quantity (FR-056, EC-26); advance bookings never reserve (FR-054, BR-025); credit limit (BR-009); rate snapshot (FR-051). Sales documents queue for Tally at dispatch <Sim what="Tally simulated" />. Visibility follows the read scope in domain/rentio/scope.ts.
      </ImplNote>
    </RPage>
  );
}

function OrderDetail({ order, transporters }: { order: Order; transporters: { value: string; label: string }[] }) {
  const { s, now } = useR();
  const run = useAct();
  const can = useCan();
  const [dupMsg, setDupMsg] = useState<string | null>(null);
  const res = s.reservations.filter((r) => r.orderId === order.id && r.status === 'active');
  const net = sum(res.map((r) => r.qty));
  const bags = sum(res.map((r) => r.qty / (s.lots[r.lotId]?.bagSize ?? r.qty)));
  const pkg = bags * DEMO.bagTareG;
  const tare = 6500;
  const gross = tare + (net + pkg) / 1000;
  const candidates = order.lines.flatMap((l) => C.eligibleFor({ s, at: now }, l.grade, (loc) => s.locations[loc]?.kind === 'finished').map((r) => ({ ...r, line: l.id })));
  const unalloc = sum(order.lines.map((l) => C.lineBalance(s, order, l).unallocated));
  const sellable = (lotId: string, loc: string) => !!stockRows(s, now).find((x) => x.lotId === lotId && x.loc === loc)?.sellable;
  const atRisk = res.filter((r) => !sellable(r.lotId, r.location));
  const dispatchReason = can('dispatch', 'dispatch shipments') ?? (res.length ? (atRisk.length ? 'Reserved stock is on hold — reallocate it first' : undefined) : 'Nothing reserved yet — reserve stock first');

  const duplicateDemo = () => {
    const key = newKey(`dispatch-dup-${order.id}`);
    const t = transporters[0]?.value ?? 'TR-01';
    const params = { orderId: order.id, transporterId: t, vehicle: 'MH12-DUP-0001', driver: 'Demo driver', vehicleGrossKg: gross, vehicleTareKg: tare };
    const a = run('Dispatch (submission 1)', (ctx) => C.dispatchOrder(ctx, params), { key });
    if (!a.ok) return setDupMsg(`First submission blocked: ${a.error}`);
    const b = run('Dispatch (submission 2, same key)', (ctx) => C.dispatchOrder(ctx, params), { key });
    setDupMsg(b.duplicate ? `Second submission returned the original ${b.txId} — exactly ${fmtKg(net)} moved into transit once.` : `Unexpected: ${b.error ?? 'second effect'}`);
  };

  return (
    <Panel
      title={`Order ${order.id} → ${order.partyId}`}
      meta={<span className="rt-row"><OrderStatusChip order={order} />{order.promisedDate && <span>promised {order.promisedDate}</span>}{order.approvedBy && <span>approved: {order.approvedBy.startsWith('u_') ? <Who id={order.approvedBy} /> : order.approvedBy.replace('delegated: ', '')}</span>}</span>}
      actions={
        <>
          {atRisk.length > 0 && (
            <Button
              icon="reset"
              variant="primary"
              disabledReason={can('order.reserve', 'reallocate reservations')}
              onClick={() =>
                run('Reallocate held stock', (ctx) => C.reallocateAtRisk(ctx, order.id), {
                  key: newKey(`realloc-${order.id}`),
                  success: (r) => `Released ${fmtKg(sum(atRisk.map((x) => x.qty)))} on held stock and reserved ${r.reserved.map((x) => `${fmtKg(x.qty)} ${x.lotId}`).join(', ')} — the held lot stays blocked`,
                })
              }
            >
              Reallocate held stock ({fmtKg(sum(atRisk.map((x) => x.qty)))})
            </Button>
          )}
          <Button icon="lock" disabledReason={can('order.reserve', 'reserve stock') ?? (unalloc ? undefined : 'Nothing left to allocate')} onClick={() => run('Reserve stock', (ctx) => C.reserveOrder(ctx, order.id), { success: (r) => `Reserved ${fmtKg(sum(r.reservations.map((x) => x.qty)))}${r.short ? `; ${fmtKg(r.short)} still short` : ''}` })}>
            Reserve stock (earliest expiry first)
          </Button>
          <FormButton
            label="Release reservation"
            disabledReason={can('order.reserve', 'release reservations') ?? (res.length ? undefined : 'No active reservations')}
            title={`Release reservations on ${order.id}`}
            submitLabel="Release"
            fields={[{ key: 'reason', label: 'Reason', type: 'text', required: true }]}
            onSubmit={(v, key) => run('Release reservations', (ctx) => C.releaseReservations(ctx, order.id, str(v.reason)), { key })}
          />
          <FormButton
            label="Cancel quantity"
            disabledReason={can('order.create.factory', 'amend orders')}
            title={`Cancel part of ${order.id}`}
            submitLabel="Cancel quantity"
            note="Only quantity not yet dispatched can be cancelled; shipped goods go through returns and credit."
            fields={[
              { key: 'lineId', label: 'Line', type: 'select', options: order.lines.map((l) => ({ value: l.id, label: `${l.grade} · open ${fmtKg(C.lineBalance(s, order, l).unallocated + C.lineBalance(s, order, l).reserved)}` })), required: true },
              { key: 'kg', label: 'Quantity to cancel', type: 'number', unit: 'kg', required: true },
              { key: 'reason', label: 'Reason', type: 'text', required: true },
            ]}
            initial={{ lineId: order.lines[0].id }}
            onSubmit={(v, key) => run('Cancel order quantity', (ctx) => C.cancelOrderLine(ctx, { orderId: order.id, lineId: str(v.lineId), kg: num(v.kg), reason: str(v.reason) }), { key })}
          />
          <FormButton
            label="Dispatch"
            icon="send"
            variant="primary"
            disabledReason={dispatchReason}
            title={`Dispatch ${order.id}`}
            submitLabel="Dispatch into transit"
            note={`Vehicle gross − tare must match net dal + empty bag weight within ${DEMO.dispatchTolerancePct}%. Bag weight is never counted as dal.`}
            fields={[
              { key: 'transporterId', label: 'Transporter', type: 'select', options: transporters, required: true },
              { key: 'vehicle', label: 'Vehicle number', type: 'text', required: true },
              { key: 'driver', label: 'Driver', type: 'text' },
              { key: 'gross', label: 'Weighbridge vehicle gross', type: 'number', unit: 'kg', required: true },
              { key: 'tare', label: 'Weighbridge vehicle tare', type: 'number', unit: 'kg', required: true },
            ]}
            initial={{ transporterId: transporters[0]?.value ?? '', vehicle: 'MH12-XY-1234', driver: '', gross: String(gross), tare: String(tare) }}
            onSubmit={(v, key) =>
              run('Dispatch shipment', (ctx) => C.dispatchOrder(ctx, { orderId: order.id, transporterId: str(v.transporterId), vehicle: str(v.vehicle), driver: str(v.driver), vehicleGrossKg: num(v.gross), vehicleTareKg: num(v.tare) }), { key, success: (sh) => `${sh.id} in transit — ${fmtKg(sum(sh.lines.map((l) => l.qty)))}` })
            }
          >
            {(v) => {
              const cargo = kg(num(v.gross)) - kg(num(v.tare));
              return (
                <Preview
                  items={[
                    { label: `Net dal (${bags} bags)`, g: net, key: true },
                    { label: 'Empty bag weight', g: pkg },
                    { label: 'Expected cargo', g: net + pkg },
                    { label: 'Weighed cargo', g: cargo, tone: Math.abs(cargo - net - pkg) > (net * DEMO.dispatchTolerancePct) / 100 ? 'danger' : undefined },
                  ]}
                />
              );
            }}
          </FormButton>
        </>
      }
    >
      <div className="rt-stack">
        {order.status === 'credit_hold' && <InlineAlert tone="warning" title="Credit hold">The order exceeds the distributor's credit limit; a credit approval is needed before stock is reserved.</InlineAlert>}
        {order.advance && <InlineAlert tone="info" title="Advance booking">Planned demand against future output — no stock is reserved.</InlineAlert>}
        <h3 className="rt-h3">Stock that can fill this order (earliest expiry first; held and expired stock left out)</h3>
        <Table
          cols={[
            { key: 'lot', label: 'Lot', render: (r) => <LotLink id={r.lotId} /> },
            { key: 'g', label: 'Grade', render: (r) => r.lot.grade },
            { key: 'loc', label: 'Stack', render: (r) => r.location.label },
            { key: 'exp', label: 'Best before', render: (r) => r.lot.expiry ?? '—' },
            { key: 'a', label: 'Available', num: true, render: (r) => <Qty g={r.available} /> },
          ]}
          rows={candidates}
          rowKey={(r) => `${r.line}|${r.lotId}|${r.loc}`}
          empty="No eligible released stock for this grade."
        />
        {order.revisions.length > 0 && (
          <Details summary={`Amendment history (${order.revisions.length})`}>
            <ul>
              {order.revisions.map((r, i) => (
                <li key={i}>
                  {fmtTime(r.at)} · <Who id={r.by} /> · {r.change}
                </li>
              ))}
            </ul>
          </Details>
        )}
        <Details summary="Presenter check: submit the same dispatch twice">
          <div className="rt-stack">
            <p className="muted">Sends one dispatch request twice with the same request key. The second must return the first result with no second stock movement.</p>
            <div>
              <Button variant="ghost" disabledReason={dispatchReason} onClick={duplicateDemo}>
                Submit dispatch twice
              </Button>
            </div>
            {dupMsg && <InlineAlert tone="info" title="Duplicate submission check">{dupMsg}</InlineAlert>}
          </div>
        </Details>
      </div>
    </Panel>
  );
}
