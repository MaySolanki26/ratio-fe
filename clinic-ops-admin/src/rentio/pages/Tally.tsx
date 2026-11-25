import { useState } from 'react';
import { Button } from '../../components/primitives/Button';
import { InlineAlert } from '../../components/primitives/feedback';
import { userName } from '../../domain/rentio/access';
import * as C from '../../domain/rentio/commerce';
import { purchaseBalances } from '../../domain/rentio/ops';
import { fmtINR, fmtKg } from '../../domain/rentio/units';
import { useAct, useR } from '../store';
import { Details, FormButton, Grid, ImplNote, num, Panel, Reason, Ref, RPage, Sim, Status, Table, fmtTime, useCan, useFocusId } from '../ui';
import { TallyCharts } from './_graphB';
import { wsBase } from '../../lib/routes';

export default function Tally() {
  const { db, s } = useR();
  const run = useAct();
  const can = useCan();
  const focus = useFocusId();
  const [sel, setSel] = useState<string | null>(() => (focus && s.tally.some((t) => t.id === focus) ? focus : null));
  const syncNo = can('tally.sync', 'synchronize with Tally');
  const doc = s.tally.find((t) => t.id === sel);
  const credits = s.complaints.filter((c) => c.creditStatus === 'requested');
  const bills = s.purchases.map((p) => ({ p, b: purchaseBalances(s, p) }));
  const party = (id: string) => String(db.records.distributors?.find((d) => d.id === id)?.name ?? db.records.retailers?.find((r) => r.id === id)?.name ?? id);

  return (
    <RPage
      title="Tally & e-invoice"
      description="Send documents to Tally, fix failures, confirm collections and credit notes."
      intro={
        <>
          Retries look up the document first, so nothing is posted twice. <Sim what="Tally, GSP and IRN are simulated" />
        </>
      }
    >
      {focus && !s.tally.some((t) => t.id === focus) && !s.collections.some((c) => c.id === focus) && <InlineAlert tone="info">That document is not in the queue any more.</InlineAlert>}
      <TallyCharts s={s} base={wsBase(db.session.workspaceId)} />

      <Panel
        title="Document queue"
        meta={`${s.tally.length} source documents · simulator: next ${s.tallySim.failNext} fail / ${s.tallySim.timeoutNext} time out`}
        actions={
          <FormButton
            label="Simulator settings"
            icon="sliders"
            title="Tally simulator (no external system)"
            disabledReason={syncNo}
            note={<>Make the next sync attempts fail or time out. A timeout happens <em>after</em> Tally created the voucher, so the retry must find it rather than post again.</>}
            fields={[
              { key: 'failNext', label: 'Fail next N syncs', type: 'number', min: 0, step: 1 },
              { key: 'timeoutNext', label: 'Time out next N syncs (after creation)', type: 'number', min: 0, step: 1 },
            ]}
            initial={{ failNext: String(s.tallySim.failNext), timeoutNext: String(s.tallySim.timeoutNext) }}
            submitLabel="Apply"
            onSubmit={(v, key) => run('Configure Tally simulator', (ctx) => C.setTallySimulation(ctx, { failNext: num(v.failNext), timeoutNext: num(v.timeoutNext) }), { key })}
          />
        }
      >
        <Table
          rows={[...s.tally].reverse()}
          rowKey={(t) => t.id}
          focus={focus}
          cols={[
            { key: 'id', label: 'Doc', render: (t) => <button type="button" className="rt-lot" onClick={() => setSel(t.id)}>{t.id}</button> },
            { key: 'src', label: 'Source', render: (t) => <>{t.sourceType} <Ref>{t.sourceId}</Ref></> },
            { key: 'party', label: 'Party', render: (t) => t.party },
            { key: 'amt', label: 'Amount', num: true, render: (t) => fmtINR(t.amount) },
            { key: 'st', label: 'Status', render: (t) => <Status s={t.status} /> },
            { key: 'ref', label: 'Tally ref', render: (t) => (t.tallyRef ? <Ref>{t.tallyRef}</Ref> : '—') },
            { key: 'irn', label: 'IRN (source)', render: (t) => (t.irn ? <><Ref>{t.irn}</Ref> ({t.irnSource})</> : '—') },
            {
              key: 'act',
              label: 'Actions',
              render: (t) => (
                <div className="rt-row">
                  {t.status !== 'acknowledged' && t.status !== 'reconciled' && (
                    <Button size="compact" variant="primary" disabledReason={syncNo} onClick={() => { setSel(t.id); run(`${t.status === 'queued' ? 'Sync' : 'Retry'} ${t.id} with Tally`, (ctx) => C.syncTally(ctx, t.id), { success: (d) => `${d.id}: ${d.status.replace('_', ' ')}` }); }}>
                      {t.status === 'queued' ? 'Sync' : 'Retry (lookup first)'}
                    </Button>
                  )}
                  {['sale', 'byproduct-sale'].includes(t.sourceType) && !t.irn && (
                    <>
                      <Button size="compact" disabledReason={syncNo} onClick={() => run(`Generate IRN for ${t.id}`, (ctx) => C.generateIrn(ctx, t.id), { success: (d) => `IRN ${d.irn} (${d.irnSource})` })}>
                        Generate IRN
                      </Button>
                      <Button size="compact" variant="ghost" disabledReason={syncNo} onClick={() => run(`Simulate IRN created in Tally for ${t.id}`, (ctx) => C.simulateIrnInTally(ctx, t.id))}>
                        Simulate IRN in Tally
                      </Button>
                    </>
                  )}
                </div>
              ),
            },
          ]}
        />
      </Panel>

      {doc && (
        <Panel title={`Attempt history · ${doc.id}`} meta={`${doc.sourceType} ${doc.sourceId}`} actions={<Button size="compact" onClick={() => setSel(null)}>Close</Button>}>
          <Table
            rows={doc.attempts}
            rowKey={(a) => a.at + a.outcome}
            empty="No attempts yet — the document is queued."
            cols={[
              { key: 'at', label: 'Time (IST)', render: (a) => fmtTime(a.at) },
              { key: 'by', label: 'By', render: (a) => userName(a.by) },
              { key: 'o', label: 'Outcome', render: (a) => <Status s={a.outcome === 'found_existing' ? 'reconciled' : a.outcome === 'timeout' ? 'status_unknown' : a.outcome} /> },
              { key: 'm', label: 'Message', render: (a) => a.message },
            ]}
          />
        </Panel>
      )}

      <Grid cols={2}>
        <Panel title="Collections awaiting confirmation" meta="Evidence alone never settles the debt">
          <Table
            rows={s.collections}
            rowKey={(c) => c.id}
            focus={focus}
            empty="No collections recorded."
            cols={[
              { key: 'id', label: 'Collection', render: (c) => <Ref>{c.id}</Ref> },
              { key: 'o', label: 'Order', render: (c) => c.orderId },
              { key: 'd', label: 'Debtor → creditor', render: (c) => `${party(c.debtor)} → ${c.creditor === 'Rentio' ? 'Rentio' : party(c.creditor)}` },
              { key: 'a', label: 'Amount', num: true, render: (c) => `${fmtINR(c.amount)} · ${c.mode}` },
              { key: 's', label: 'Status', render: (c) => <Status s={c.status} /> },
              {
                key: 'x',
                label: '',
                render: (c) =>
                  c.status === 'provisional' ? (
                    <div className="rt-row">
                      <Button size="compact" variant="primary" disabledReason={can('collection.confirm', 'confirm settlement')} onClick={() => run(`Confirm collection ${c.id}`, (ctx) => C.confirmCollection(ctx, c.id, true))}>Confirm</Button>
                      <Button size="compact" disabledReason={can('collection.confirm', 'reject settlement')} onClick={() => run(`Reject collection ${c.id}`, (ctx) => C.confirmCollection(ctx, c.id, false))}>Reject</Button>
                    </div>
                  ) : (
                    userName(c.confirmedBy)
                  ),
              },
            ]}
          />
        </Panel>
        <Panel title="Credit notes awaiting confirmation" meta="Financial outcome is separate from physical return">
          <Table
            rows={credits}
            rowKey={(c) => c.id}
            empty="No credit requests pending."
            cols={[
              { key: 'id', label: 'Complaint', render: (c) => <Ref>{c.id}</Ref> },
              { key: 'p', label: 'Party', render: (c) => party(c.retailerId ?? c.distributorId ?? '') },
              { key: 'r', label: 'Returned', num: true, render: (c) => (c.returnQty ? fmtKg(c.returnQty) : '—') },
              { key: 'x', label: '', render: (c) => <Button size="compact" variant="primary" disabledReason={syncNo} onClick={() => run(`Confirm credit for ${c.id}`, (ctx) => C.confirmCredit(ctx, c.id))}>Confirm credit</Button> },
            ]}
          />
        </Panel>
      </Grid>

      <Details summary="Supplier bills against accepted receipts">
        <Table
          rows={bills}
          rowKey={(x) => x.p.id}
          cols={[
            { key: 'id', label: 'Purchase', render: (x) => <Ref>{x.p.id}</Ref> },
            { key: 'sup', label: 'Supplier', render: (x) => String(db.records.suppliers?.find((r) => r.id === x.p.supplierId)?.name ?? x.p.supplierId) },
            { key: 'acc', label: 'Accepted', num: true, render: (x) => fmtKg(x.b.accepted) },
            { key: 'bq', label: 'Billed qty', num: true, render: (x) => (x.p.billedQty !== undefined ? fmtKg(x.p.billedQty) : '—') },
            { key: 'ba', label: 'Bill amount', num: true, render: (x) => (x.p.billAmount !== undefined ? fmtINR(x.p.billAmount) : '—') },
            { key: 'st', label: 'Match', render: (x) => (x.p.billMatch ? <Status s={x.p.billMatch.status} /> : <Status s="pending" />) },
            { key: 'n', label: 'Note', render: (x) => <Reason text={x.p.billMatch?.note ?? 'Bill not yet matched (Buying & intake)'} /> },
          ]}
        />
      </Details>

      <Details summary={<>Messaging log <Sim what="Simulated WhatsApp/SMS" /></>}>
        {s.messages.some((m) => m.status === 'failed') && (
          <InlineAlert tone="warning" title="Channel delivery failed">
            The in-app alert stays visible; a failed WhatsApp/SMS never hides the exception.
          </InlineAlert>
        )}
        <Table
          rows={s.messages}
          rowKey={(m) => m.id}
          empty="No messages sent."
          cols={[
            { key: 'at', label: 'Time (IST)', render: (m) => fmtTime(m.at) },
            { key: 'ch', label: 'Channel', render: (m) => m.channel },
            { key: 'to', label: 'To', render: (m) => m.to },
            { key: 't', label: 'Message', render: (m) => m.text },
            { key: 's', label: 'Delivery', render: (m) => <Status s={m.status === 'delivered' ? 'acknowledged' : 'failed'} /> },
          ]}
        />
      </Details>
      <ImplNote>Tally and compliance (M10): FR-057/058 lookup-before-retry, EC-37 timeout after creation, FR-059/EC-38 single IRN source, FR-094 bill matching, FR-108/BR-030 collections confirmed only by Accounts. All external calls are local simulations.</ImplNote>
    </RPage>
  );
}
