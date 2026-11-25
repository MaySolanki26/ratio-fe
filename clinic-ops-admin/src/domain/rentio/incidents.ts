/**
 * Grouped incidents (FR-115 / AC-25). A named parent with ONE accountable lead links live child alerts.
 * The parent never clears, resolves or hides a child: each child keeps its own owner, scope, timestamps
 * and obligation, stays in that person's queue, and is "handled" only when its underlying exception is
 * gone from the live alert list — or when the lead explicitly detaches it with a reason (it then stays
 * open on its own). Closing the parent is refused while any linked child is unresolved.
 */
import type { Db } from '../../services/types';
import { hasCap, type RActor, rentioUsers } from './access';
import { type Ctx, fail, nextId } from './engine';
import { readScope } from './scope';
import type { Incident, RentioState } from './types';
import { type Alert, alerts, alertVisibleTo } from './views';

export const incidentsOf = (s: RentioState) => s.incidents ?? (s.incidents = []);

/** Stable identity of an alert's underlying record across status changes (run:R-1:Delayed → run:R-1). */
export const childRef = (a: Pick<Alert, 'key' | 'sourceId'>) => `${a.key.split(':')[0]}:${a.sourceId}`;

const MANAGE = 'incident.manage';
const canManage = (ctx: Ctx) => hasCap(ctx.actor, MANAGE) || hasCap(ctx.actor, 'plan.manage') || hasCap(ctx.actor, 'scope.all');

function requireManage(ctx: Ctx, what: string) {
  if (!canManage(ctx) || !['owner', 'factory_head'].includes(ctx.actor.roleId)) fail('forbidden', `${ctx.actor.roleLabel} cannot ${what} — incidents are coordinated by the Owner or Factory Head`);
}

export function createIncident(ctx: Ctx, i: { title: string; leadId: string; alertRefs: string[]; note?: string }) {
  requireManage(ctx, 'create incidents');
  if (!i.title?.trim()) fail('validation', 'Name the incident');
  const lead = rentioUsers.find((u) => u.id === i.leadId) ?? fail('validation', 'Choose one accountable lead');
  if (!['owner', 'factory_head', 'back_office', 'qc', 'godown'].includes(lead.roleId)) fail('validation', `${lead.name} cannot lead a cross-team incident (choose Owner, Factory Head, Back Office, QC or Godown)`);
  const refs = [...new Set(i.alertRefs)];
  if (refs.length < 2) fail('validation', 'Group at least two related alerts');
  const live = alerts(ctx.db, ctx.now);
  const open = incidentsOf(ctx.s).filter((x) => x.status === 'open');
  const children = refs.map((ref) => {
    const a = readableAlert(ctx, live, ref);
    const other = open.find((x) => x.children.some((c) => c.ref === ref && !c.detached));
    if (other) fail('conflict', `${a.title} is already part of ${incidentView(ctx.db, ctx.actor, ctx.now, other, live).label}`);
    return childOf(ctx, a);
  });
  const inc: Incident = { id: nextId(ctx.s, 'INC'), title: i.title.trim(), leadId: lead.id, status: 'open', children, notes: i.note?.trim() ? [{ at: ctx.at, by: ctx.actor.id, text: i.note.trim() }] : [], createdBy: ctx.actor.id, createdAt: ctx.at };
  incidentsOf(ctx.s).push(inc);
  return inc;
}

const find = (ctx: Ctx, id: string) => incidentsOf(ctx.s).find((x) => x.id === id) ?? fail('not_found', 'Incident not found');

function requireLeadOrManager(ctx: Ctx, inc: Incident, what: string) {
  if (inc.leadId === ctx.actor.id) return;
  requireManage(ctx, what);
}

/** Coordination note (who is doing what by when) — audit only, never changes a child. */
export function noteIncident(ctx: Ctx, n: { incidentId: string; text: string }) {
  const inc = find(ctx, n.incidentId);
  requireLeadOrManager(ctx, inc, 'coordinate this incident');
  if (inc.status !== 'open') fail('business_rule', `${inc.id} is closed`);
  if (!n.text?.trim()) fail('validation', 'Write the coordination note');
  inc.notes.push({ at: ctx.at, by: ctx.actor.id, text: n.text.trim() });
  return inc;
}

export function addToIncident(ctx: Ctx, a: { incidentId: string; alertRef: string }) {
  const inc = find(ctx, a.incidentId);
  requireLeadOrManager(ctx, inc, 'link alerts');
  if (inc.status !== 'open') fail('business_rule', `${inc.id} is closed`);
  if (inc.children.some((c) => c.ref === a.alertRef && !c.detached)) fail('duplicate', 'Already linked');
  inc.children.push(childOf(ctx, readableAlert(ctx, alerts(ctx.db, ctx.now), a.alertRef)));
  return inc;
}

/** Only alerts the actor may read can be grouped (an unreadable one is reported as not open — its existence is not revealed). */
function readableAlert(ctx: Ctx, live: Alert[], ref: string) {
  const a = live.find((x) => childRef(x) === ref);
  if (!a || !alertVisibleTo(ctx.s, ctx.actor, a)) fail('not_found', `Alert ${ref} is no longer open in your area — refresh and choose again`);
  return a;
}

const childOf = (ctx: Ctx, a: Alert): Incident['children'][number] => ({ ref: childRef(a), key: a.key, title: a.title, ownerId: a.ownerId, link: a.link, addedAt: ctx.at, addedBy: ctx.actor.id, roles: [...a.roles], scope: { ...a.scope } });

/** Remove a child from the group with a reason. The underlying alert is NOT resolved — it stays with its owner. */
export function detachChild(ctx: Ctx, d: { incidentId: string; ref: string; reason: string }) {
  const inc = find(ctx, d.incidentId);
  requireLeadOrManager(ctx, inc, 'detach linked alerts');
  const c = inc.children.find((x) => x.ref === d.ref && !x.detached) ?? fail('not_found', 'Child not linked');
  if (!d.reason?.trim()) fail('validation', 'Say why this alert is no longer part of the incident (it stays open with its owner)');
  c.detached = { by: ctx.actor.id, at: ctx.at, reason: d.reason.trim() };
  return inc;
}

export function closeIncident(ctx: Ctx, c: { incidentId: string; note: string }) {
  const inc = find(ctx, c.incidentId);
  requireLeadOrManager(ctx, inc, 'close this incident');
  if (inc.status === 'closed') fail('duplicate', `${inc.id} was already closed by ${inc.closedBy}`);
  const v = incidentView(ctx.db, ctx.actor, ctx.now, inc);
  const open = v.kids.filter((x) => x.state === 'open');
  const named = v.shown.filter((x) => x.state === 'open');
  const hidden = open.length - named.length;
  if (open.length) fail('business_rule', `Cannot close ${inc.id}: ${open.length} linked alert(s) are still unresolved — ${[...named.map((x) => `${x.title} (${x.ownerName})`), ...(hidden ? [`${hidden} outside your area of work`] : [])].join('; ')}. Resolve them, or detach them with a reason; closing never clears a child.`);
  if (!c.note?.trim()) fail('validation', 'Write the closing summary');
  inc.status = 'closed';
  inc.closedBy = ctx.actor.id;
  inc.closedAt = ctx.at;
  inc.closeNote = c.note.trim();
  return inc;
}

/** Live child state: open (underlying exception still present), resolved (gone from the live list) or detached. */
export function incidentChildren(db: Db, now: string, inc: Incident, live = alerts(db, now)) {
  return inc.children.map((c) => {
    const a = live.find((x) => childRef(x) === c.ref);
    const state: 'open' | 'resolved' | 'detached' = c.detached ? 'detached' : a ? 'open' : 'resolved';
    return { ...c, state, alert: a, ownerName: rentioUsers.find((u) => u.id === (a?.ownerId ?? c.ownerId))?.name ?? c.ownerId, title: a?.title ?? c.title, link: a?.link ?? c.link };
  });
}

/**
 * What this actor may see of an incident. A child is visible under the alert read rule — the live alert while
 * open, else the scope snapshotted when it was linked (older children without a snapshot: Owner/Accounts or the
 * child's owner only). The live alert's rule wins while it exists, including for detached children. When any child is hidden, free-text notes and the closing summary are limited to the
 * actor's own (they may describe the hidden items); counts stay visible so cross-team coordination still works.
 */
export const RESTRICTED_TITLE = 'Restricted details — includes items outside your area of work';

export function incidentView(db: Db, actor: RActor, now: string, inc: Incident, live = alerts(db, now)) {
  const s = db.rentio as RentioState;
  const sc = readScope(actor);
  const kids = incidentChildren(db, now, inc, live);
  const shown = kids.filter((k) => {
    if (sc.all || k.ownerId === actor.id) return true;
    if (k.alert) return alertVisibleTo(s, actor, k.alert, sc);
    return !!(k.roles && k.scope) && alertVisibleTo(s, actor, { roles: k.roles, scope: k.scope, ownerId: k.ownerId }, sc);
  });
  const full = shown.length === kids.length;
  const notes = full ? inc.notes : inc.notes.filter((n) => n.by === actor.id);
  return {
    /** Owner-entered title only for viewers who can read every child (it may name a restricted partner). */
    title: full ? inc.title : RESTRICTED_TITLE,
    /** `INC-0001 · title` (or the neutral label) — use for every summary, heading and link. */
    label: `${inc.id} · ${full ? inc.title : RESTRICTED_TITLE}`,
    kids,
    shown,
    hidden: kids.length - shown.length,
    notes,
    hiddenNotes: inc.notes.length - notes.length,
    closeNote: full || inc.closedBy === actor.id ? inc.closeNote : undefined,
    /** Listed for the actor: the lead, the creator, or anyone who can see at least one child. */
    listed: sc.all || inc.leadId === actor.id || inc.createdBy === actor.id || shown.length > 0,
  };
}

/** Open incident a live alert belongs to (for "Part of INC-…" chips in staff and owner views). */
export function incidentFor(s: RentioState, a: Pick<Alert, 'key' | 'sourceId'>) {
  const ref = childRef(a);
  return (s.incidents ?? []).find((x) => x.status === 'open' && x.children.some((c) => c.ref === ref && !c.detached));
}

/** Open incident linking any alert on this source record (My work items carry the record id, not the alert key). */
export function incidentForSource(s: RentioState, sourceId: string) {
  return (s.incidents ?? []).find((x) => x.status === 'open' && x.children.some((c) => !c.detached && c.ref.slice(c.ref.indexOf(':') + 1) === sourceId));
}
