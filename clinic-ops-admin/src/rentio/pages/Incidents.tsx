/**
 * Grouped incidents (FR-115). Owner / Factory Head group related live alerts under a named incident with one
 * accountable lead. Children keep their own owner, scope, due time and action; closing is refused while any
 * linked child is unresolved. Staff see the incidents that contain their own alerts (children in their scope only).
 */
import { Link } from 'react-router-dom';
import { InlineAlert, StatusChip } from '../../components/primitives/feedback';
import { rentioUsers, userName } from '../../domain/rentio/access';
import { childRef, closeIncident, createIncident, detachChild, incidentFor, incidentView, noteIncident } from '../../domain/rentio/incidents';
import { alerts, alertsFor } from '../../domain/rentio/views';
import { wsBase } from '../../lib/routes';
import { useAct, useR } from '../store';
import { Details, FormButton, ImplNote, Panel, RPage, Status, Table, Who, fmtTime, str, useFocusId } from '../ui';
import { IncidentsChart } from './_graphB';

const LEADS = ['owner', 'factory_head', 'back_office', 'qc', 'godown'];

export default function Incidents() {
  const { db, s, actor, now } = useR();
  const run = useAct();
  const focus = useFocusId();
  const manager = ['owner', 'factory_head'].includes(actor.roleId);
  const live = alerts(db, now);
  const mine = alertsFor(db, actor, now);
  // every role (Factory Head included) sees only children inside its own alert read scope
  const list = [...(s.incidents ?? [])].reverse().map((inc) => ({ inc, v: incidentView(db, actor, now, inc, live) })).filter((x) => x.v.listed);
  const groupable = mine.filter((a) => !incidentFor(s, a));
  const base = wsBase(db.session.workspaceId);
  const manageReason = manager ? undefined : `${actor.roleLabel} cannot create incidents — the Owner or Factory Head groups alerts`;

  return (
    <RPage
      title="Incidents"
      description="Related alerts grouped under one accountable lead. Each linked alert stays open with its own owner until it is really resolved."
      actions={
        <FormButton
          label="Group alerts into incident"
          variant="primary"
          icon="plus"
          disabledReason={manageReason ?? (groupable.length < 2 ? 'Needs at least two open alerts that are not already in an incident' : undefined)}
          title="New incident"
          submitLabel="Create incident"
          wide
          note="Grouping never resolves, hides or reassigns an alert. The lead coordinates; each alert's owner still does their own action."
          initial={{ lead: actor.id }}
          fields={[
            { key: 'title', label: 'Incident name', type: 'text', required: true, placeholder: 'RT-002 cleaning delay & D02 supply' },
            { key: 'lead', label: 'Accountable lead', type: 'select', required: true, options: rentioUsers.filter((u) => LEADS.includes(u.roleId)).map((u) => ({ value: u.id, label: `${u.name} · ${u.title}` })) },
            ...groupable.map((a) => ({ key: `a:${childRef(a)}`, label: `${a.title} — ${a.owner}${a.qty ? ` · ${a.qty}` : ''}`, type: 'checkbox' as const })),
            { key: 'note', label: 'First coordination note', type: 'text' },
          ]}
          onSubmit={(v, key) =>
            run('Create incident', (ctx) => createIncident(ctx, { title: str(v.title), leadId: str(v.lead), alertRefs: groupable.map(childRef).filter((r) => v[`a:${r}`]), note: str(v.note) }), {
              key,
              success: (i) => `${i.id} created with ${i.children.length} linked alerts — lead ${userName(i.leadId)}`,
            })
          }
        />
      }
    >
      {!manager && <InlineAlert tone="info">You see incidents that include your own alerts. Do your linked action from the alert as usual — the incident lead coordinates, but cannot close it until your item is resolved.</InlineAlert>}
      {list.length === 0 && <p className="rt-empty">{manager ? 'No incidents yet. Group related alerts (for example a stage delay and the orders it puts at risk) with "Group alerts into incident".' : 'None of your alerts is part of an incident.'}</p>}
      {list.length > 0 && <IncidentsChart rows={list.map(({ inc, v }) => ({ id: inc.id, label: v.label, open: v.kids.filter((k) => k.state === 'open').length, resolved: v.kids.filter((k) => k.state === 'resolved').length, detached: v.kids.filter((k) => k.state === 'detached').length }))} />}
      {list.map(({ inc, v }) => {
        const { kids, shown } = v;
        const open = kids.filter((k) => k.state === 'open').length;
        const canCoord = manager || inc.leadId === actor.id;
        const coordReason = canCoord ? (inc.status === 'closed' ? 'Incident is closed' : undefined) : `Only ${userName(inc.leadId)} (lead), the Owner or the Factory Head coordinate this incident`;
        return (
          <Panel
            key={inc.id}
            id={inc.id}
            className={focus === inc.id ? 'is-focus' : undefined}
            title={v.label}
            meta={
              <span className="rt-row">
                <Status s={inc.status === 'open' ? 'open' : 'closed'} /> {kids.length} linked · {open} open · {kids.filter((k) => k.state === 'resolved').length} resolved
                {kids.some((k) => k.state === 'detached') ? ` · ${kids.filter((k) => k.state === 'detached').length} detached` : ''} · lead {userName(inc.leadId)}
              </span>
            }
            actions={
              <>
                <FormButton label="Add note" disabledReason={coordReason} title={`Coordinate ${inc.id}`} submitLabel="Save note" fields={[{ key: 'text', label: 'Who does what by when', type: 'textarea', required: true }]} onSubmit={(v, key) => run(`Note on ${inc.id}`, (ctx) => noteIncident(ctx, { incidentId: inc.id, text: str(v.text) }), { key })} />
                <FormButton
                  label="Close incident"
                  variant="primary"
                  disabledReason={coordReason ?? (open ? `${open} linked alert(s) still open — resolve or detach them first` : undefined)}
                  title={`Close ${inc.id}`}
                  submitLabel="Close"
                  note="Closing only closes the group. It is allowed when every linked alert is resolved or explicitly detached."
                  fields={[{ key: 'note', label: 'Closing summary', type: 'textarea', required: true }]}
                  onSubmit={(v, key) => run(`Close ${inc.id}`, (ctx) => closeIncident(ctx, { incidentId: inc.id, note: str(v.note) }), { key, success: (i) => `${i.id} closed` })}
                />
              </>
            }
          >
            <Table
              cols={[
                { key: 'st', label: 'State', render: (k) => <StatusChip label={k.state === 'open' ? 'Open' : k.state === 'resolved' ? 'Resolved' : 'Detached — still open with owner'} tone={k.state === 'open' ? 'warning' : k.state === 'resolved' ? 'success' : 'neutral'} /> },
                { key: 't', label: 'Linked alert', render: (k) => k.title },
                { key: 'o', label: 'Responsible', render: (k) => k.ownerName },
                { key: 'd', label: 'Due', render: (k) => (k.alert?.due ? fmtTime(k.alert.due) : '—') },
                { key: 'a', label: 'Linked', render: (k) => (<>{fmtTime(k.addedAt)} by <Who id={k.addedBy} />{k.detached && <div className="muted small">Detached by {userName(k.detached.by)}: {k.detached.reason}</div>}</>) },
                { key: 'go', label: '', render: (k) => <Link className="btn btn-secondary" to={`${base}/${k.link}`}><span className="btn-label">{k.alert && k.alert.ownerId === actor.id ? k.alert.action : 'Open record'}</span></Link> },
                {
                  key: 'x',
                  label: '',
                  render: (k) =>
                    k.state === 'open' ? (
                      <FormButton label="Detach" variant="ghost" disabledReason={coordReason} title={`Detach from ${inc.id}`} submitLabel="Detach — stays open with owner" fields={[{ key: 'reason', label: 'Why it is no longer part of this incident', type: 'text', required: true }]} onSubmit={(v, key) => run(`Detach from ${inc.id}`, (ctx) => detachChild(ctx, { incidentId: inc.id, ref: k.ref, reason: str(v.reason) }), { key })} />
                    ) : (
                      ''
                    ),
                },
              ]}
              rows={shown}
              rowKey={(k) => k.ref}
            />
            {v.hidden > 0 && <p className="muted small">{v.hidden} more linked alert(s) are outside your area of work — their owners act on them; the incident cannot close until they are resolved or detached.</p>}
            <Details summary={`Coordination log (${v.notes.length})${inc.closedAt ? ' · closed' : ''}`} open={focus === inc.id}>
              <ul className="rt-list">
                <li>{fmtTime(inc.createdAt)} — created by {userName(inc.createdBy)}, lead {userName(inc.leadId)}</li>
                {v.notes.map((n, i) => (
                  <li key={i}>{fmtTime(n.at)} — {userName(n.by)}: {n.text}</li>
                ))}
                {v.hiddenNotes > 0 && <li className="muted">{v.hiddenNotes} note(s) by others are not shown — they may describe linked alerts outside your area of work.</li>}
                {inc.closedAt && <li>{fmtTime(inc.closedAt)} — closed by {userName(inc.closedBy)}{v.closeNote ? `: ${v.closeNote}` : ' (summary outside your area of work)'}</li>}
              </ul>
            </Details>
          </Panel>
        );
      })}
      <ImplNote>Grouped incidents (FR-115, AC-25). Child state is derived live from the alert list (childRef = alert family + source record); the parent never writes to a child. Create / note / detach / close are audited transactions; only Owner or Factory Head create, the lead coordinates.</ImplNote>
    </RPage>
  );
}
