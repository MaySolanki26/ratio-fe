import { useState } from 'react';
import { Button } from '../../components/primitives/Button';
import { InlineAlert, StatusChip } from '../../components/primitives/feedback';
import { hasCap, userName } from '../../domain/rentio/access';
import { incidentFor, incidentForSource, incidentView } from '../../domain/rentio/incidents';
import { acknowledgeAlert } from '../../domain/rentio/people';
import { readScope } from '../../domain/rentio/scope';
import { alertsFor, ctaFor, isAcked, type Alert } from '../../domain/rentio/views';
import { useAct, useR } from '../store';
import { Details, ImplNote, PageLink, Panel, Reason, RPage, Status, Table, fmtTime, useFocusId, RSelect } from '../ui';
import { AlertsChart } from './_graphB';
import { useShowMore } from './_uxA';

const SEVERITIES: Alert['severity'][] = ['critical', 'high', 'medium', 'low'];

/** "Part of INC-0001 · lead Sunita Rao" — the alert itself stays open with its own owner. */
export function IncidentTag({ a, sourceId }: { a?: Pick<Alert, 'key' | 'sourceId'>; sourceId?: string }) {
  const { db, s, actor, now } = useR();
  const inc = a ? incidentFor(s, a) : sourceId ? incidentForSource(s, sourceId) : undefined;
  if (!inc) return null;
  return (
    <div className="muted small">
      {hasCap(actor, 'page:home/incidents') ? <PageLink to={`home/incidents?focus=${inc.id}`}>Part of {inc.id}</PageLink> : `Part of ${inc.id}`} · {incidentView(db, actor, now, inc).title} · lead {userName(inc.leadId)}
    </div>
  );
}
const FAMILIES: { id: Alert['family']; label: string }[] = [
  { id: 'decision', label: 'Owner decisions' },
  { id: 'delivery', label: 'Deliveries' },
  { id: 'production', label: 'Production' },
  { id: 'stock', label: 'Stock & quality' },
  { id: 'money', label: 'Money' },
  { id: 'people', label: 'People' },
];

export default function Alerts() {
  const { db, s, actor, now } = useR();
  const run = useAct();
  const focus = useFocusId();
  const [sev, setSev] = useState<string>('');
  const [fam, setFam] = useState<string>('');
  // read scope applies to every role (owner/accounts see the whole network through the same selector)
  const all = alertsFor(db, actor, now);
  const list = all.filter((a) => (!sev || a.severity === sev) && (!fam || a.family === fam));
  const failures = readScope(actor).factory ? s.failures : s.failures.filter((f) => f.actorId === actor.id);
  const focused = focus ? all.find((a) => a.sourceId === focus) : undefined;
  const escalated = all.filter((a) => a.escalation > 0).length;
  // top 8 by rank; the focused alert and alerts that belong to an incident always stay visible
  const more = useShowMore(list, 8, (a) => a.sourceId === focus || !!incidentFor(s, a));

  return (
    <RPage title="Alerts & exceptions" description="Open exceptions in your area, each with a named owner and a direct action.">
      {focus && !focused && <InlineAlert tone="info">That exception is resolved or not in your area of work.</InlineAlert>}
      <AlertsChart alerts={all} families={FAMILIES} />
      <Panel
        title="Open alerts"
        meta={`${list.length} of ${all.length} · ${escalated} escalated · as of ${fmtTime(now)} IST`}
        actions={
          <div className="rt-tabpick">
            <RSelect label="Severity" value={sev} onChange={setSev} options={[{ value: '', label: 'All severities' }, ...SEVERITIES.map((x) => ({ value: x, label: x }))]} />
            <RSelect label="Type" value={fam} onChange={setFam} options={[{ value: '', label: 'All types' }, ...FAMILIES.map((x) => ({ value: x.id, label: x.label }))]} />
          </div>
        }
      >
        <Table
          rows={more.visible}
          rowKey={(a) => a.sourceId}
          focus={focus}
          empty="No open alerts in your area."
          cols={[
            { key: 's', label: 'Severity', render: (a) => <Status s={a.severity} /> },
            {
              key: 'w',
              label: 'What happened',
              render: (a) => (
                <>
                  <div className="rt-brief-title">{a.title}</div>
                  <div className="rt-brief-detail">
                    <Reason text={a.detail} />
                  </div>
                  <IncidentTag a={a} />
                </>
              ),
            },
            { key: 'q', label: 'Qty / value', num: true, render: (a) => a.qty ?? '—' },
            {
              key: 'o',
              label: 'Who acts',
              render: (a) => (
                <>
                  <div>{a.owner}</div>
                  {a.escalation > 0 && a.escalatedTo && <StatusChip label={`Escalated to ${userName(a.escalatedTo)}`} tone={a.escalation === 2 ? 'danger' : 'warning'} />}
                </>
              ),
            },
            { key: 't', label: 'Due', render: (a) => (a.due ? fmtTime(a.due) : '—') },
            { key: 'l', label: 'Action', render: (a) => <PageLink to={a.link}>{ctaFor(a, actor) === a.action ? a.action : `Review (${a.nextStep})`}</PageLink> },
            {
              key: 'k',
              label: 'Acknowledged',
              render: (a) => {
                const acks = isAcked(s, a.key);
                const mine = acks.some((x) => x.by === actor.id);
                return (
                  <div className="rt-row">
                    {acks.length > 0 && <span className="rt-brief-detail">{acks.map((x) => userName(x.by)).join(', ')}</span>}
                    {!mine && (
                      <Button size="compact" onClick={() => run(`Acknowledge: ${a.title}`, (ctx) => acknowledgeAlert(ctx, a.key), { success: () => 'Acknowledged — still open until the cause is fixed' })}>
                        Acknowledge
                      </Button>
                    )}
                  </div>
                );
              },
            },
          ]}
        />
        {more.toggle}
        <p className="muted small">Acknowledging records who is acting. It does not change stock, approve anything or close the alert.</p>
      </Panel>
      <Details summary={`Blocked attempts (${failures.length})`}>
        <Table
          rows={failures}
          rowKey={(f) => f.id}
          empty="No blocked attempts recorded."
          cols={[
            { key: 'at', label: 'Time (IST)', render: (f) => fmtTime(f.at) },
            { key: 'by', label: 'User', render: (f) => userName(f.actorId) },
            { key: 'a', label: 'Attempted', render: (f) => f.action },
            { key: 'r', label: 'Why blocked', render: (f) => <Reason text={f.reason} /> },
          ]}
        />
      </Details>
      <ImplNote>
        Control Tower and alerts (M13): FR-075 assigned alerts with timed escalation (unresolved past due → Factory Head or functional lead; twice the window → Owner; season mode shortens the window), FR-113 ranking, FR-076/077. Alerts are filtered by the actor's read scope (scope.ts) before display.
      </ImplNote>
    </RPage>
  );
}
