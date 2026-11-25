/**
 * Multi-stop delivery proof: plan one ordered trip for several reserved orders (Trips & freight), record each
 * stop's outcome from the receiving distributor's own screen, and decide refused-goods disposition.
 */
import { dispatchMultiStop, recordStopOutcome, returnRefused, tripProgress, type StopStatus } from '../../domain/rentio/delivery';
import type { RentioState, Trip, TripStop } from '../../domain/rentio/types';
import { fmtKg, kg, sum } from '../../domain/rentio/units';
import { useAct, useR } from '../store';
import { FormButton, Panel, Qty, Ref, Table, Who, fmtTime, num, str, useCan } from '../ui';
import type { Tone } from '../../metadata/types';
import { StatusChip } from '../../components/primitives/feedback';
import { TripCharts } from './_graphB';

const STOP_TONE: Record<StopStatus, Tone> = { pending: 'info', accepted: 'success', part_accepted: 'warning', refused: 'danger', returned: 'neutral' };
const STOP_LABEL: Record<StopStatus, string> = { pending: 'Pending', accepted: 'Accepted', part_accepted: 'Part accepted', refused: 'Refused', returned: 'Refused qty returned' };
export const StopChip = ({ st }: { st: StopStatus }) => <StatusChip label={STOP_LABEL[st]} tone={STOP_TONE[st]} />;

export function MultiStopPanel({ trips, focus }: { trips: Trip[]; focus?: string }) {
  const { db, s } = useR();
  const run = useAct();
  const can = useCan();
  const ready = s.orders.filter((o) => o.kind === 'factory' && o.status === 'approved' && s.reservations.some((r) => r.orderId === o.id && r.status === 'active'));
  const multi = trips.filter((t) => t.stops?.length);
  const transporters = (db.records.transporters ?? []).map((t) => ({ value: String(t.id), label: String(t.name) }));
  const reserved = (id: string) => sum(s.reservations.filter((r) => r.orderId === id && r.status === 'active').map((r) => r.qty));
  const dispatchReason = can('dispatch', 'dispatch shipments') ?? (ready.length < 2 ? 'Needs at least two orders with reserved stock' : undefined);
  return (
    <Panel
      title="Multi-stop deliveries"
      meta="One vehicle, ordered stops, proof per stop"
      id="multistop"
      actions={
        <FormButton
          label="Dispatch multi-stop trip"
          variant="primary"
          icon="send"
          disabledReason={dispatchReason}
          title="Dispatch reserved orders on one vehicle"
          submitLabel="Dispatch trip"
          note="Each ticked order becomes its own shipment and stop, in the order shown. Each distributor records its own outcome; payment is followed up separately by Accounts."
          initial={{ transporterId: 'TR-01', vehicle: 'MH12-AB-4455', driver: 'Sanjay More (fictional)', ...Object.fromEntries(ready.filter((o) => o.lines.some((l) => l.grade === 'B2')).map((o) => [`o:${o.id}`, true])) }}
          fields={[
            ...ready.map((o) => ({ key: `o:${o.id}`, label: `${o.id} → ${o.partyId} · ${o.lines.map((l) => l.grade).join('/')} · ${fmtKg(reserved(o.id))} reserved`, type: 'checkbox' as const })),
            { key: 'transporterId', label: 'Transporter', type: 'select', options: transporters, required: true },
            { key: 'vehicle', label: 'Vehicle', type: 'text', required: true },
            { key: 'driver', label: 'Driver', type: 'text', required: true },
          ]}
          onSubmit={(v, key) =>
            run('Dispatch multi-stop trip', (ctx) => dispatchMultiStop(ctx, { orderIds: ready.filter((o) => v[`o:${o.id}`]).map((o) => o.id), transporterId: str(v.transporterId), vehicle: str(v.vehicle), driver: str(v.driver) }), {
              key,
              success: (t) => `${t.id} dispatched — ${t.stops!.map((x) => `stop ${x.seq} ${x.distributorId}`).join(', ')}`,
            })
          }
        />
      }
    >
      {multi.length === 0 && <p className="rt-empty">No multi-stop trip yet. Orders ready to dispatch: {ready.map((o) => `${o.id} (${o.partyId})`).join(', ') || 'none'}.</p>}
      {multi.map((t) => (
        <TripStops key={t.id} trip={t} focused={focus === t.id} />
      ))}
    </Panel>
  );
}

function TripStops({ trip, focused }: { trip: Trip; focused: boolean }) {
  const { s, actor } = useR();
  const run = useAct();
  const can = useCan();
  const p = tripProgress(s, trip);
  const dispReason = can('dispatch', 'decide refused-goods disposition');
  return (
    <div className={focused ? 'rt-stack is-focus' : 'rt-stack'} aria-label={`Trip ${trip.id}`}>
      <h3 className="rt-h3">
        <Ref>{trip.id}</Ref> · {trip.vehicle} · {trip.driver} — {p.label}
      </h3>
      <TripCharts s={s} trip={trip} actor={actor} />
      <Table
        cols={[
          { key: 'seq', label: 'Stop', render: (x) => `#${x.seq}` },
          { key: 'd', label: 'Distributor', render: (x) => x.distributorId },
          { key: 'sh', label: 'Shipment / order', render: (x) => (<><Ref>{x.shipmentId}</Ref> · {x.shipment.orderId}</>) },
          { key: 'q', label: 'On board', num: true, render: (x) => <Qty g={x.total} /> },
          { key: 'st', label: 'Outcome', render: (x) => <StopChip st={x.status} /> },
          { key: 'acc', label: 'Accepted / refused', num: true, render: (x) => (x.outcome ? `${fmtKg(x.acceptedQty ?? 0)} / ${fmtKg(x.refusedQty ?? 0)}${x.damagedQty ? ` · ${fmtKg(x.damagedQty)} damaged` : ''}` : '—') },
          { key: 'pr', label: 'Proof', render: (x) => (x.outcome ? <span>{x.receiverName} · {x.evidence} · {fmtTime(x.at)} · by <Who id={x.recordedBy} />{x.reason ? <div className="muted small">{x.reason}</div> : null}</span> : '—') },
          { key: 'open', label: 'In transit', num: true, render: (x) => <Qty g={x.openInTransit} strong={x.openInTransit > 0} /> },
          { key: 'nx', label: 'Next step', render: (x) => (x.disposition ? <span>Returned {fmtKg(x.disposition.qty)} to quarantine by <Who id={x.disposition.by} /> — {x.disposition.reason}</span> : x.next) },
          {
            key: 'act',
            label: '',
            render: (x) =>
              x.outcome && x.outcome !== 'accepted' && !x.disposition && x.openInTransit > 0 ? (
                <FormButton
                  label="Return to factory"
                  disabledReason={dispReason}
                  title={`Return refused goods of stop ${x.seq} (${x.distributorId})`}
                  submitLabel="Move to factory quarantine"
                  note={`${fmtKg(x.openInTransit)} comes back into Quarantine for QC inspection. The order quantity becomes open again; nothing is marked delivered.`}
                  fields={[{ key: 'reason', label: 'Disposition reason', type: 'text', required: true }]}
                  onSubmit={(v, key) => run(`Return refused goods ${trip.id} stop ${x.seq}`, (ctx) => returnRefused(ctx, { tripId: trip.id, seq: x.seq, reason: str(v.reason) }), { key, success: (r) => `${fmtKg(r.disposition!.qty)} returned to factory quarantine` })}
                />
              ) : (
                '—'
              ),
          },
        ]}
        rows={p.stops}
        rowKey={(x) => String(x.seq)}
      />
    </div>
  );
}

/** Distributor's own stop outcome (Accepted / Part accepted / Refused) — replaces the plain Receive button for stops. */
export function StopOutcomeButton({ trip, stop, disabledReason }: { trip: Trip; stop: TripStop; disabledReason?: string }) {
  const { s, actor } = useR();
  const run = useAct();
  const sh = s.shipments.find((x) => x.id === stop.shipmentId)!;
  const total = sum(sh.lines.map((l) => l.qty));
  return (
    <FormButton
      label="Record stop outcome"
      variant="primary"
      disabledReason={disabledReason}
      title={`Stop ${stop.seq} of ${trip.id} — ${sh.id} at ${stop.distributorId}`}
      submitLabel="Submit & lock stop"
      note={`${fmtKg(total)} on board for you. Accepted quantity is received once; anything refused stays on the vehicle in transit custody until Godown/Dispatch returns it. This records delivery only — not payment.`}
      initial={{ outcome: 'accepted', accepted: String(total / 1000), damaged: '0', receiver: actor.name, evidence: '' }}
      fields={[
        { key: 'outcome', label: 'Outcome', type: 'select', required: true, options: [{ value: 'accepted', label: 'Accepted (all)' }, { value: 'part_accepted', label: 'Part accepted' }, { value: 'refused', label: 'Refused (nothing accepted)' }] },
        { key: 'accepted', label: 'Accepted good quantity (part accepted)', type: 'number', unit: 'kg' },
        { key: 'damaged', label: 'Damaged — kept on hold here', type: 'number', unit: 'kg' },
        { key: 'receiver', label: 'Received / refused by (person at the stop)', type: 'text', required: true },
        { key: 'evidence', label: 'Proof reference (signed challan / POD photo)', type: 'text', required: true, placeholder: 'POD-D02-001.jpg' },
        { key: 'reason', label: 'Reason (required for part accepted or refused)', type: 'text' },
      ]}
      onSubmit={(v, key) =>
        run(`Stop ${stop.seq} outcome ${trip.id}`, (ctx) => recordStopOutcome(ctx, { tripId: trip.id, seq: stop.seq, outcome: str(v.outcome) as 'accepted', acceptedKg: num(v.accepted), damagedKg: num(v.damaged), receiverName: str(v.receiver), evidence: str(v.evidence), reason: str(v.reason) }), {
          key,
          success: (r) => `Stop ${r.stop.seq}: ${r.stop.outcome!.replace('_', ' ')} — ${fmtKg(r.stop.acceptedQty ?? 0)} accepted${r.stop.refusedQty ? `, ${fmtKg(r.stop.refusedQty)} stays in transit` : ''}`,
        })
      }
    >
      {(v) => {
        const o = str(v.outcome);
        const dmg = kg(num(v.damaged));
        const acc = o === 'accepted' ? total - dmg : o === 'part_accepted' ? kg(num(v.accepted)) : 0;
        const ref = total - acc - (o === 'refused' ? 0 : dmg);
        return (
          <div className="rt-preview" aria-live="polite">
            <div><span>On board</span><strong>{fmtKg(total)}</strong></div>
            <div className="is-key"><span>Accepted into your stock</span><strong>{fmtKg(acc)}</strong></div>
            <div><span>Damaged (held)</span><strong>{fmtKg(o === 'refused' ? 0 : dmg)}</strong></div>
            <div><span>Refused — stays in transit</span><strong className={ref ? 'tone-text-warning' : undefined}>{ref < 0 ? `${fmtKg(-ref)} too much` : fmtKg(ref)}</strong></div>
          </div>
        );
      }}
    </FormButton>
  );
}

/** The multi-stop trip and stop a shipment belongs to (pure; safe after early returns). */
export function stopOfShipment(s: RentioState, shipmentId: string) {
  const trip = s.trips.find((t) => t.stops?.some((x) => x.shipmentId === shipmentId));
  const stop = trip?.stops?.find((x) => x.shipmentId === shipmentId);
  return trip && stop ? { trip, stop } : undefined;
}
