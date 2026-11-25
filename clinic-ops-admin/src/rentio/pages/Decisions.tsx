import { userName } from '../../domain/rentio/access';
import { recordDecision } from '../../domain/rentio/people';
import { useAct, useR } from '../store';
import { Details, FormButton, ImplNote, Panel, Ref, RPage, Status, str, Table, fmtTime, useCan, useFocusId } from '../ui';

const OQS: [string, string][] = [
  ['OQ-01', 'Exact manufacturing route, “Seeping”, cleaning/pitting/finishing'],
  ['OQ-02', 'SPOCs, checker matrix, delegated limits, self-approval policy'],
  ['OQ-03', 'Base units, precision, counted factors, tare policy'],
  ['OQ-04', 'Lot vs fragment location; balance equations (ledger sign-off)'],
  ['OQ-05', 'QC limits, readiness, hold propagation, returned food disposition'],
  ['OQ-06', 'Duplicate slip scope, bill/weight variances, over-receipt tolerance'],
  ['OQ-07', 'Manufacturing date, shelf life, expiry boundary, min remaining life'],
  ['OQ-08', 'Broken/unpeeled classification, blends, max rework passes'],
  ['OQ-09', 'Distributor ownership/consignment, retailer transit, network boundary'],
  ['OQ-10', 'Offline price lock, stale stock/credit, advance commitment'],
  ['OQ-11', 'Reservation expiry, FEFO ties, count cutoff, bins, samples'],
  ['OQ-12', 'Capacity units, ETA method, calendars, season factors, escalation'],
  ['OQ-13', 'Invoice/IRN source, tax/HSN, GSP, credit and collection authority'],
  ['OQ-14', 'Cost allocation, by-product credits, freight/overhead, margin basis'],
  ['OQ-15', 'Pay rules, biometric format, OT/leave, PF/ESI, bank output'],
  ['OQ-16', 'Food/label/weights/privacy obligations, retention, fumigation'],
  ['OQ-17', 'Legal entities/plants, shared masters, tenant isolation'],
  ['OQ-18', 'Load, availability, freshness, recovery, accessibility targets'],
  ['OQ-19', 'Milestones, migration cutoff, fallback forms, go/no-go'],
  ['OQ-20', 'Baseline lot selection, forecast release and confidence'],
  ['OQ-21', 'Prior master-MD rules not available'],
  ['OQ-22', 'Owner brief, My Work, grouped alerts, workload targets'],
];

export default function Decisions() {
  const { s } = useR();
  const run = useAct();
  const can = useCan();
  const focus = useFocusId();
  const superseded = new Set(s.decisions.map((d) => d.supersedes).filter(Boolean));
  return (
    <RPage title="Decision register" description="Business decisions recorded once, with scope and superseded history.">
      <Panel
        title="Decisions"
        meta={`${s.decisions.length} recorded`}
        actions={
          <FormButton
            label="Record decision"
            icon="plus"
            variant="primary"
            title="Record a business decision"
            disabledReason={can('decision.record', 'record business decisions (Owner only)')}
            fields={[
              { key: 'title', label: 'Decision topic', type: 'text', required: true },
              { key: 'answer', label: 'Decision', type: 'textarea', required: true },
              { key: 'scope', label: 'Affected scope / effective from', type: 'text', required: true },
              { key: 'sup', label: 'Supersedes (optional)', type: 'select', options: s.decisions.filter((d) => !superseded.has(d.id)).map((d) => ({ value: d.id, label: `${d.id} — ${d.title}` })) },
            ]}
            submitLabel="Record decision"
            onSubmit={(v, key) => run('Record decision', (ctx) => recordDecision(ctx, { title: str(v.title), answer: str(v.answer), scope: str(v.scope), supersedes: str(v.sup) || undefined }), { key })}
          />
        }
      >
        <Table
          rows={[...s.decisions].reverse()}
          rowKey={(d) => d.id}
          focus={focus}
          rowClass={(d) => (superseded.has(d.id) ? 'is-muted' : undefined)}
          empty="No decisions recorded."
          cols={[
            { key: 'id', label: 'ID', render: (d) => <Ref>{d.id}</Ref> },
            { key: 't', label: 'Topic', render: (d) => d.title },
            { key: 'a', label: 'Decision', render: (d) => d.answer },
            { key: 's', label: 'Scope', render: (d) => d.scope },
            { key: 'b', label: 'By / when', render: (d) => `${userName(d.by)} · ${fmtTime(d.at)}` },
            { key: 'st', label: 'State', render: (d) => (superseded.has(d.id) ? <Status s="closed" /> : d.supersedes ? <>Supersedes <Ref>{d.supersedes}</Ref></> : <Status s="approved" />) },
          ]}
        />
      </Panel>
      <Details summary={`Open business questions still using demo defaults (${OQS.length})`}>
        <Table
          rows={OQS}
          rowKey={(q) => q[0]}
          cols={[
            { key: 'id', label: 'ID', render: (q) => <Ref>{q[0]}</Ref> },
            { key: 't', label: 'Decision needed', render: (q) => q[1] },
            { key: 's', label: 'Prototype handling', render: () => 'Demo default applied' },
          ]}
        />
      </Details>
      <ImplNote>Decision register (M13, FR-076). Open questions are §28 OQ-01…OQ-22 of the requirements; demo defaults are listed in docs/rentio/DEMO_ASSUMPTIONS.md.</ImplNote>
    </RPage>
  );
}
