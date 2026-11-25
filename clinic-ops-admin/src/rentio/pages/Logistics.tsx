/** Trips, vehicle changes, versioned transporter rate cards and freight bill reconciliation. */
import * as C from '../../domain/rentio/commerce';
import { computePositions } from '../../domain/rentio/engine';
import { scopedShipments } from '../../domain/rentio/scope';
import { fmtINR, fmtKg, sum } from '../../domain/rentio/units';
import { useAct, useR } from '../store';
import { Details, FormButton, Grid, ImplNote, num, Panel, Qty, Ref, RPage, Status, str, Table, useCan, useFocusId, fmtTime, Who } from '../ui';
import { FocusMissing } from './_distHelpers';

export default function Logistics() {
  const { db, s, actor } = useR();
  const run = useAct();
  const can = useCan();
  const focus = useFocusId();
  const pos = computePositions(s);
  const tName = (id: string) => String(db.records.transporters?.find((t) => t.id === id)?.name ?? id);
  // read scope: only trips/disputes for shipments the actor may see
  const shipIds = new Set(scopedShipments(s, actor).map((x) => x.id));
  const trips = s.trips.filter((t) => t.shipmentIds.some((id) => shipIds.has(id))).reverse();
  const disputes = s.disputes.filter((d) => (d.shipmentId ? shipIds.has(d.shipmentId) : true)).reverse();
  const focusDispute = focus ? disputes.find((d) => d.id === focus) : undefined;
  const focusTrip = focusDispute?.shipmentId ? trips.find((t) => t.shipmentIds.includes(focusDispute.shipmentId!))?.id : focus && trips.some((t) => t.id === focus) ? focus : undefined;
  const focusFound = !focus || !!focusDispute || !!focusTrip;
  const transporterOpts = (db.records.transporters ?? []).map((t) => ({ value: String(t.id), label: String(t.name) }));
  const tripOpts = trips.map((t) => ({ value: t.id, label: `${t.vehicle} · ${tName(t.transporterId)} · ${t.shipmentIds.join(', ')} (${t.id})` }));
  const openTripOpts = trips.filter((t) => !t.freightBill).map((t) => ({ value: t.id, label: `${t.vehicle} · ${tName(t.transporterId)} · expected ${fmtINR(C.tripFreight({ s }, t.id).calculated)} (${t.id})` }));
  const manage = can('logistics.manage', 'manage logistics');

  return (
    <RPage
      title="Trips & freight"
      description="Trips, vehicle changes, transporter rate cards and freight bill reconciliation."
      intro="Freight bills are checked against weight × the trip's rate card; a mismatch goes to Accounts for approval."
      actions={
        <>
          <FormButton
            label="Change vehicle"
            disabledReason={can('dispatch', 'change trip vehicles') && manage ? manage : tripOpts.length ? undefined : 'No trips'}
            title="Record vehicle change during transit"
            submitLabel="Record change"
            note="The earlier vehicle stays on the trip record with your reason."
            fields={[
              { key: 'tripId', label: 'Trip', type: 'select', options: tripOpts, required: true },
              { key: 'to', label: 'New vehicle number', type: 'text', required: true },
              { key: 'reason', label: 'Reason', type: 'text', required: true },
            ]}
            onSubmit={(v, key) => run('Change trip vehicle', (ctx) => C.changeVehicle(ctx, { tripId: str(v.tripId), to: str(v.to), reason: str(v.reason) }), { key })}
          />
          <FormButton
            label="Record freight bill"
            variant="primary"
            disabledReason={manage ?? (openTripOpts.length ? undefined : 'Every trip already has a bill')}
            title="Record transporter freight bill"
            submitLabel="Reconcile bill"
            fields={[
              { key: 'tripId', label: 'Trip', type: 'select', options: openTripOpts, required: true },
              { key: 'amount', label: 'Bill amount', type: 'number', unit: '₹', required: true },
              { key: 'ref', label: 'Bill reference', type: 'text', required: true },
            ]}
            onSubmit={(v, key) => run('Record freight bill', (ctx) => C.recordFreightBill(ctx, { tripId: str(v.tripId), amount: num(v.amount), ref: str(v.ref) }), { key, success: (t) => (t.freightBill?.status === 'matched' ? `${t.id} matched — queued for Tally` : `${t.id} mismatch — sent for approval`) })}
          />
          <FormButton
            label="Revise rate card"
            disabledReason={manage}
            title="Publish a new transporter rate card"
            submitLabel="Publish rate card"
            fields={[
              { key: 'transporterId', label: 'Transporter', type: 'select', options: transporterOpts, required: true },
              { key: 'perKg', label: 'Rate', type: 'number', unit: '₹/kg', required: true },
            ]}
            onSubmit={(v, key) => run('Revise rate card', (ctx) => C.reviseRateCard(ctx, { transporterId: str(v.transporterId), perKg: num(v.perKg) }), { key, success: (c) => `${c.id} active from now` })}
          />
        </>
      }
    >
      <FocusMissing focus={focus} found={focusFound} />
      <Panel title="Trips" meta={`${trips.length}`}>
        <Table
          focus={focusTrip}
          cols={[
            { key: 'id', label: 'Trip', render: (t) => <Ref>{t.id}</Ref> },
            { key: 'tr', label: 'Transporter', render: (t) => tName(t.transporterId) },
            { key: 'v', label: 'Vehicle / driver', render: (t) => `${t.vehicle} · ${t.driver}` },
            { key: 'sh', label: 'Shipments', render: (t) => t.shipmentIds.join(', ') },
            { key: 'q', label: 'Shipped', num: true, render: (t) => <Qty g={C.tripFreight({ s }, t.id).shipped} /> },
            {
              key: 'transit',
              label: 'Still in transit',
              num: true,
              render: (t) => <Qty g={sum(s.shipments.filter((x) => t.shipmentIds.includes(x.id)).flatMap((x) => x.lines.map((l) => pos.get(`${l.lotId}|${x.transitLoc}`) ?? 0)))} />,
            },
            { key: 'calc', label: 'Expected freight', num: true, render: (t) => fmtINR(C.tripFreight({ s }, t.id).calculated) },
            { key: 'bill', label: 'Freight bill', render: (t) => (t.freightBill ? <span className="rt-row">{fmtINR(t.freightBill.amount)} <Status s={t.freightBill.status} /></span> : 'Not billed') },
          ]}
          rows={trips}
          rowKey={(t) => t.id}
          empty="No trips yet — trips are created at dispatch."
        />
        <Details summary="Rate card used, bill reference and vehicle changes per trip">
          <Table
            cols={[
              { key: 'id', label: 'Trip', render: (t) => t.id },
              { key: 'rc', label: 'Rate card at dispatch', render: (t) => { const f = C.tripFreight({ s }, t.id); return <span><Ref>{f.card.id}</Ref> {fmtINR(f.card.perKg)}/kg</span>; } },
              { key: 'ref', label: 'Bill reference', render: (t) => t.freightBill?.ref ?? '—' },
              { key: 'vc', label: 'Vehicle changes', render: (t) => (t.vehicleChanges.length ? t.vehicleChanges.map((c) => `${c.from} → ${c.to} (${c.reason}, ${fmtTime(c.at)})`).join('; ') : '—') },
            ]}
            rows={trips}
            rowKey={(t) => t.id}
          />
        </Details>
      </Panel>

      <Grid>
        <Panel title="Transporter rate cards">
          <Table
            cols={[
              { key: 'id', label: 'Card', render: (c) => <Ref>{c.id}</Ref> },
              { key: 't', label: 'Transporter', render: (c) => tName(c.transporterId) },
              { key: 'r', label: 'Route', render: (c) => c.route },
              { key: 'p', label: 'Rate', num: true, render: (c) => `${fmtINR(c.perKg)}/kg` },
              { key: 'f', label: 'Valid from', render: (c) => fmtTime(c.validFrom) },
              { key: 'to', label: 'Valid to', render: (c) => (c.validTo ? fmtTime(c.validTo) : <Status s="active" />) },
              { key: 'u', label: 'Trips using it', num: true, render: (c) => s.trips.filter((t) => t.rateCardId === c.id).length },
            ]}
            rows={[...s.rateCards].reverse()}
            rowKey={(c) => c.id}
          />
        </Panel>
        <Panel title="Receipt shortfalls" meta="Unresolved quantity stays in transit until settled">
          <Table
            focus={focusDispute?.id}
            cols={[
              { key: 'id', label: 'Dispute', render: (d) => <Ref>{d.id}</Ref> },
              { key: 'sh', label: 'Shipment', render: (d) => d.shipmentId ?? d.handoverId ?? '—' },
              { key: 'q', label: 'Short qty', num: true, render: (d) => fmtKg(d.qty) },
              { key: 'r', label: 'Reason', render: (d) => d.reason },
              { key: 'by', label: 'Raised by', render: (d) => <Who id={d.createdBy} /> },
              { key: 'st', label: 'Status', render: (d) => <Status s={d.status} /> },
              { key: 'res', label: 'Resolution', render: (d) => d.resolution ?? '—' },
            ]}
            rows={disputes}
            rowKey={(d) => d.id}
            empty="No disputes."
          />
        </Panel>
      </Grid>
      <ImplNote>
        Versioned rate cards — trips keep the card in force at dispatch (FR-068); trip ↔ truck/driver/lots with reasoned vehicle change (FR-069, EC-32); out-of-tolerance delivery variance held for supervisor resolution (FR-070); freight bill reconciliation before Accounts export, mismatch → approval (FR-071). Trips and shortfalls are limited to shipments in the actor's read scope.
      </ImplNote>
    </RPage>
  );
}
