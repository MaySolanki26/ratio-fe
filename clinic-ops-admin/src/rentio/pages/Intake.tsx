import { useLocation } from 'react-router-dom';
import { InlineAlert } from '../../components/primitives/feedback';
import { DEMO } from '../../domain/rentio/config';
import { checkIntake, closePurchase, createPurchase, matchBill, purchaseBalances, purchaseLotCode, recordIntake } from '../../domain/rentio/ops';
import type { Intake as IntakeRec, Purchase } from '../../domain/rentio/types';
import { readScope } from '../../domain/rentio/scope';
import { fmtINR, fmtKg, kg, valueOf } from '../../domain/rentio/units';
import { useAct, useR } from '../store';
import { IntakeGraphics } from './_graphA';
import { wsBase } from '../../lib/routes';
import { FormButton, ImplNote, Kpi, KpiRow, LotLink, Panel, Qty, RPage, Reason, Ref, Status, Table, Who, fmtTime, num, str, useCan, useFocusId } from '../ui';

export default function Intake() {
  const { s, db, actor } = useR();
  const focus = useFocusId();
  // purchases and truck intakes are plant documents: visible only to roles with plant scope
  const plant = readScope(actor).factory;
  const purchases = plant ? s.purchases : [];
  const intakes = plant ? s.intakes : [];
  const run = useAct();
  const can = useCan();
  const supplierName = (id: string) => String(db.records.suppliers?.find((x) => x.id === id)?.name ?? id);
  // replenishment handoff: ?new=purchase&kg=4000 opens the normal purchase form with the suggested quantity
  const q = new URLSearchParams(useLocation().search);
  const handoffKg = q.get('new') === 'purchase' ? q.get('kg') ?? '' : undefined;
  const suppliers = (db.records.suppliers ?? []).filter((x) => x.category !== 'stores_vendor').map((x) => ({ value: x.id, label: String(x.name) }));
  const rt001Free = !s.lots['RT-001'] && !s.purchases.some((p) => purchaseLotCode(p) === 'RT-001');
  const bal = (p: Purchase) => purchaseBalances(s, p);
  const inspecting = intakes.filter((i) => i.status === 'under_inspection');
  const createReason = can('purchase.create', 'create purchases');
  const intakeReason = can('intake.record', 'record truck intake');
  const checkReason = can('intake.check', 'accept or reject intake');
  const billReason = can('bill.match', 'match supplier bills');

  const totals = purchases.reduce(
    (a, p) => {
      const b = bal(p);
      return { declared: a.declared + p.declaredQty, accepted: a.accepted + b.accepted, open: a.open + (p.status === 'closed' ? 0 : b.open), held: a.held + b.inspecting };
    },
    { declared: 0, accepted: 0, open: 0, held: 0 },
  );

  return (
    <RPage
      title="Purchases & intake"
      description="Farmer and vendor purchases, truck weighing and the independent intake check."
      intro="A truck's toor stays at the gate until someone other than the recorder checks and accepts it."
      actions={
        <FormButton
          label="New purchase"
          icon="plus"
          variant="primary"
          disabledReason={createReason}
          title="New farmer / vendor purchase"
          submitLabel="Create purchase"
          initial={handoffKg !== undefined ? { supplierId: '', declaredKg: handoffKg, ratePerKg: '', lotCode: '', billRef: '' } : { supplierId: rt001Free ? 'SUP-001' : '', declaredKg: rt001Free ? '10000' : '', ratePerKg: rt001Free ? '80' : '', lotCode: rt001Free ? 'RT-001' : '', billRef: '' }}
          note={handoffKg !== undefined ? `Prefilled from the reviewed raw-toor replenishment suggestion (${handoffKg} kg). Choose the supplier and agreed rate — nothing is created until you submit.` : rt001Free ? 'Prefilled with the RT-001 purchase (fictional Farmer Ramesh, 10,000 kg at ₹80/kg).' : 'Leave the lot code blank — the next number is assigned.'}
          defaultOpen={handoffKg !== undefined}
          fields={[
            { key: 'supplierId', label: 'Supplier / farmer', type: 'select', options: suppliers, required: true },
            { key: 'declaredKg', label: 'Declared quantity', type: 'number', unit: 'kg', required: true, min: 0 },
            { key: 'ratePerKg', label: 'Agreed rate', type: 'number', unit: '₹/kg', required: true, min: 0 },
            { key: 'lotCode', label: 'Lot code (optional)', type: 'text', help: 'Leave blank to assign the next number automatically' },
            { key: 'billRef', label: 'Supplier bill reference', type: 'text' },
            { key: 'promisedDate', label: 'Promised receipt date', type: 'text', placeholder: 'YYYY-MM-DD' },
          ]}
          onSubmit={(v, key) =>
            run('Create purchase', (ctx) => createPurchase(ctx, { supplierId: str(v.supplierId), declaredKg: num(v.declaredKg), ratePerKg: num(v.ratePerKg), lotCode: str(v.lotCode) || undefined, billRef: str(v.billRef) || undefined, promisedDate: str(v.promisedDate) || undefined }), { key, success: (p) => `Purchase ${p.id} created` })
          }
        />
      }
    >
      <KpiRow>
        <Kpi label="Ordered (all purchases)" value={fmtKg(totals.declared)} />
        <Kpi label="Accepted into raw godown" value={fmtKg(totals.accepted)} tone="success" />
        <Kpi label="Held at gate (awaiting checker)" value={fmtKg(totals.held)} tone={totals.held ? 'warning' : undefined} note={`${inspecting.length} intake(s)`} />
        <Kpi label="Open purchase balance" value={fmtKg(totals.open)} note="not stock — still to arrive" />
      </KpiRow>

      {plant && <IntakeGraphics s={s} purchases={purchases} base={wsBase(db.session.workspaceId)} supplierName={supplierName} focus={focus} />}

      {focus && !purchases.some((p) => p.id === focus) && !intakes.some((i) => i.id === focus) && <InlineAlert tone="warning">That record is not in your area or no longer open.</InlineAlert>}
      <Panel title="Purchases" meta="Several trucks can fill one purchase">
        <Table
          cols={[
            { key: 'id', label: 'Purchase', render: (p) => (<><Ref>{p.id}</Ref><div className="muted">{s.lots[purchaseLotCode(p)] ? <LotLink id={purchaseLotCode(p)} /> : purchaseLotCode(p)}</div></>) },
            { key: 'sup', label: 'Supplier', render: (p) => (<>{supplierName(p.supplierId)}<div className="muted">{fmtINR(p.ratePerKg)}/kg</div></>) },
            { key: 'decl', label: 'Ordered', num: true, render: (p) => <Qty g={p.declaredQty} /> },
            { key: 'acc', label: 'Accepted', num: true, render: (p) => (<><Qty g={bal(p).accepted} />{bal(p).rejected ? <div className="muted">rejected {fmtKg(bal(p).rejected)}</div> : null}</>) },
            { key: 'insp', label: 'At gate', num: true, render: (p) => <Qty g={bal(p).inspecting} /> },
            { key: 'open', label: 'Open balance', num: true, render: (p) => (p.status === 'closed' ? 'closed' : <Qty g={bal(p).open} strong />) },
            { key: 'bill', label: 'Bill match', render: (p) => (p.billMatch ? <span data-tooltip={p.billMatch.note}><Status s={p.billMatch.status} /></span> : '—') },
            { key: 'st', label: 'Status', render: (p) => <Status s={p.status} /> },
            {
              key: 'act',
              label: 'Actions',
              render: (p) => {
                const b = bal(p);
                const open = p.status !== 'closed' && p.status !== 'cancelled';
                return (
                  <div className="rt-row">
                    {open && b.open > 0 && (
                      <FormButton
                        label="Record truck"
                        disabledReason={intakeReason}
                        title={`Truck intake for ${p.id}`}
                        submitLabel="Submit for checker"
                        note={`${supplierName(p.supplierId)} · open ${fmtKg(b.open)} · rate ${fmtINR(p.ratePerKg)}/kg. Net = gross − tare. Stock is held until an independent checker decides.`}
                        initial={{ evidence: '', moisturePct: '0', foreignMatterPct: '0', damagePct: '0' }}
                        fields={[
                          { key: 'truck', label: 'Truck number', type: 'text', required: true },
                          { key: 'slip', label: 'Weighbridge slip no.', type: 'text', required: true },
                          { key: 'grossKg', label: 'Gross', type: 'number', unit: 'kg', required: true },
                          { key: 'tareKg', label: 'Tare', type: 'number', unit: 'kg', required: true },
                          { key: 'moisturePct', label: 'Moisture', type: 'number', unit: '%', help: `Above ${DEMO.moistureDeductionAbovePct}% reduces the price, not the kilograms` },
                          { key: 'foreignMatterPct', label: 'Foreign matter', type: 'number', unit: '%' },
                          { key: 'damagePct', label: 'Damage', type: 'number', unit: '%' },
                          { key: 'evidence', label: 'Slip / photo evidence reference', type: 'text', required: true, placeholder: 'e.g. slip-WB-55013.jpg' },
                        ]}
                        onSubmit={(v, key) =>
                          run(
                            'Record truck intake',
                            (ctx) =>
                              recordIntake(ctx, { purchaseId: p.id, truck: str(v.truck), slip: str(v.slip), grossKg: num(v.grossKg), tareKg: num(v.tareKg), moisturePct: num(v.moisturePct), foreignMatterPct: num(v.foreignMatterPct), damagePct: num(v.damagePct), evidence: [str(v.evidence)].filter(Boolean) }),
                            { key, success: (i) => `Intake ${i.id}: ${fmtKg(i.net)} held at gate for checker` },
                          )
                        }
                      >
                        {(v) => <div className="rt-balance">Computed net: {num(v.grossKg) > num(v.tareKg) ? fmtKg((num(v.grossKg) - num(v.tareKg)) * 1000) : '—'}</div>}
                      </FormButton>
                    )}
                    {b.accepted > 0 && (
                      <FormButton
                        label="Match bill"
                        disabledReason={billReason}
                        title={`Match supplier bill for ${p.id}`}
                        submitLabel="Match"
                        note={`Accepted ${fmtKg(b.accepted)} × ${fmtINR(p.ratePerKg)}/kg = ${fmtINR(valueOf(b.accepted, p.ratePerKg))}. Matching a bill never changes stock.`}
                        initial={{ billedKg: String(b.accepted / 1000), billAmount: String(valueOf(b.accepted, p.ratePerKg) / 100) }}
                        fields={[
                          { key: 'billedKg', label: 'Billed quantity', type: 'number', unit: 'kg', required: true },
                          { key: 'billAmount', label: 'Bill amount', type: 'number', unit: '₹', required: true },
                          { key: 'acceptDifference', label: 'Accept difference under policy', type: 'checkbox' },
                          { key: 'note', label: 'Note', type: 'text' },
                        ]}
                        onSubmit={(v, key) =>
                          run('Match supplier bill', (ctx) => matchBill(ctx, { purchaseId: p.id, billedKg: num(v.billedKg), billAmount: num(v.billAmount), acceptDifference: !!v.acceptDifference, note: str(v.note) || undefined }), { key, success: (r) => `Bill ${r.status.replace('_', ' ')}` })
                        }
                      />
                    )}
                    {open && b.open > 0 && b.received > 0 && (
                      <FormButton
                        label="Close balance"
                        disabledReason={createReason}
                        title={`Close open balance on ${p.id}`}
                        submitLabel="Close purchase"
                        note={`${fmtKg(b.open)} will not be received. No receipt is fabricated for the cancelled balance.`}
                        fields={[{ key: 'reason', label: 'Reason', type: 'text', required: true }]}
                        onSubmit={(v, key) => run('Close purchase balance', (ctx) => closePurchase(ctx, p.id, str(v.reason)), { key })}
                      />
                    )}
                  </div>
                );
              },
            },
          ]}
          rows={[...purchases].reverse()}
          rowKey={(p) => p.id}
          focus={focus}
          empty="No purchases yet."
        />
      </Panel>

      <Panel title="Truck intakes" meta="Recorded by one person, checked by another">
        <Table
          cols={[
            { key: 'tr', label: 'Truck', render: (i: IntakeRec) => (<>{i.truck}<div className="muted">slip {i.slip} · <LotLink id={i.lotId} /></div></>) },
            { key: 'net', label: 'Net (gross − tare)', num: true, render: (i) => (<><Qty g={i.net} strong /><div className="muted">{fmtKg(i.gross)} − {fmtKg(i.tare)}</div></>) },
            { key: 'q', label: 'Quality', render: (i) => <Reason text={`Moisture ${i.moisturePct}% · foreign matter ${i.foreignMatterPct}% · damage ${i.damagePct}%${i.valueDeduction ? ` · price deduction ${fmtINR(i.valueDeduction)}` : ''}`} /> },
            { key: 'acc', label: 'Accepted / rejected', num: true, render: (i) => (i.accepted !== undefined ? `${fmtKg(i.accepted)} / ${fmtKg(i.rejected ?? 0)}` : '—') },
            { key: 'st', label: 'Status', render: (i) => <Status s={i.status} /> },
            { key: 'mk', label: 'Recorded → checked by', render: (i) => (<><Who id={i.makerId} /> → {i.checkerId ? <Who id={i.checkerId} /> : <em className="muted">waiting</em>}<div className="muted">{fmtTime(i.createdAt)}</div></>) },
            {
              key: 'act',
              label: 'Checker',
              render: (i) =>
                i.status === 'under_inspection' ? (
                  <FormButton
                    label="Check intake"
                    variant="primary"
                    disabledReason={checkReason}
                    title={`Independent check — ${i.id}`}
                    submitLabel="Post decision"
                    note={
                      <>
                        {i.makerId === actor.id && (
                          <InlineAlert tone="warning" title="You recorded this intake">
                            Your own decision will be rejected as self-approval. Switch to an independent checker (e.g. Meera Iyer, QC).
                          </InlineAlert>
                        )}
                        Truck {i.truck} · {i.lotId}. Accepted + rejected must equal the net weight.
                      </>
                    }
                    initial={{ acceptKg: String(i.net / 1000), rejectKg: '0', godown: 'R1' }}
                    fields={[
                      { key: 'acceptKg', label: 'Accept into raw godown', type: 'number', unit: 'kg', required: true },
                      { key: 'rejectKg', label: 'Reject to quarantine', type: 'number', unit: 'kg' },
                      { key: 'godown', label: 'Raw godown', type: 'select', options: [{ value: 'R1', label: 'Raw Godown R1' }], required: true },
                    ]}
                    onSubmit={(v, key) =>
                      run('Check intake', (ctx) => checkIntake(ctx, { intakeId: i.id, acceptKg: num(v.acceptKg), rejectKg: num(v.rejectKg), godown: str(v.godown) }), { key, success: (r) => `${r.id} ${r.status.replace('_', ' ')} into ${r.godown}` })
                    }
                  >
                    {(v) => {
                      const acc = kg(num(v.acceptKg));
                      const rej = kg(num(v.rejectKg));
                      const left = i.net - acc - rej;
                      return (
                        <div className="rt-preview" aria-live="polite">
                          <div><span>Net on truck</span><strong>{fmtKg(i.net)}</strong></div>
                          <div className="is-key"><span>Accept into R1</span><strong>{fmtKg(acc)}</strong></div>
                          <div><span>Reject to quarantine</span><strong>{fmtKg(rej)}</strong></div>
                          <div><span>Unaccounted</span><strong className={left !== 0 ? 'tone-text-danger' : 'tone-text-success'}>{left === 0 ? '0 kg ✓' : fmtKg(left)}</strong></div>
                        </div>
                      );
                    }}
                  </FormButton>
                ) : (
                  <span className="muted">{fmtTime(i.decidedAt)}</span>
                ),
            },
          ]}
          rows={[...intakes].reverse()}
          rowKey={(i) => i.id}
          focus={focus}
          empty="No trucks received yet."
        />
      </Panel>

      <ImplNote>
        Procurement and intake (M2). Purchase FR-006; partial trucks FR-007; net = gross − tare with slip evidence FR-008/BR-004; duplicate slip blocked FR-009 (scope supplier + slip, OQ-06); held until an independent checker accepts (FR-011, BR-003, self-approval rejected); moisture above {DEMO.moistureDeductionAbovePct}% is a value deduction only (FR-010, EC-04); bill matching FR-094; over-receipt tolerance {DEMO.overReceiptPct}% (demo).
      </ImplNote>
    </RPage>
  );
}
