/**
 * Rentio Inbox model: the signed-in person's actionable items, built ONLY from the scoped domain
 * views (myWork + alertsFor), so another role's or another distributor's records never appear.
 * Read / unread is personal UI state (settings.inboxRead, per user); acknowledging an alert is the
 * audited business action on the Alerts page and also counts as read here.
 */
import type { RActor } from '../domain/rentio/access';
import type { RentioState } from '../domain/rentio/types';
import { alertsFor, ctaFor, myWork, type Alert } from '../domain/rentio/views';
import { getSettings } from '../services/settings';
import type { Db } from '../services/types';

export type InboxSeverity = Alert['severity'];

export interface InboxItem {
  key: string;
  source: 'task' | 'alert';
  title: string;
  detail: string;
  qty?: string;
  /** module/page?focus=<record> (relative to the workspace) */
  link: string;
  action: string;
  severity: InboxSeverity;
  due?: string;
  /** who is accountable when it is not the viewer (alerts) */
  nextStep?: string;
  ownerId?: string;
  escalatedTo?: string;
  ackedByMe: boolean;
  read: boolean;
  readAt?: string;
}

const RANK: Record<InboxSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Alerts that belong in THIS person's inbox (already limited to their read scope by alertsFor). */
function relevant(a: Alert, actor: RActor) {
  if (a.ownerId === actor.id || a.escalatedTo === actor.id || a.roles.includes(actor.roleId)) return true;
  // the owner sees decisions and the serious exceptions across the network, not every routine reminder
  return actor.roleId === 'owner' && (a.ownerDecision || a.severity === 'critical' || a.severity === 'high');
}

export function inboxItems(db: Db, actor: RActor, now: string): InboxItem[] {
  if (!db.rentio) return [];
  const s = db.rentio as RentioState;
  const read = getSettings(actor.id).inboxRead ?? {};
  const out: InboxItem[] = [];
  const seen = new Set<string>();
  for (const w of myWork(db, actor, now)) {
    if (seen.has(w.key)) continue;
    seen.add(w.key);
    seen.add(w.link);
    out.push({ key: w.key, source: 'task', title: w.title, detail: w.detail, qty: w.qty, link: w.link, action: w.action, severity: w.urgent ? 'high' : 'medium', ackedByMe: false, read: !!read[w.key], readAt: read[w.key]?.at });
  }
  for (const a of alertsFor(db, actor, now)) {
    if (!relevant(a, actor) || seen.has(a.key) || seen.has(a.link)) continue;
    seen.add(a.key);
    const ackedByMe = s.acks.some((x) => x.key === a.key && x.by === actor.id);
    const mine = ctaFor(a, actor) === a.action;
    out.push({
      key: a.key,
      source: 'alert',
      title: a.title,
      detail: a.detail,
      qty: a.qty,
      link: a.link,
      action: mine ? a.action : 'Review',
      severity: a.severity,
      due: a.due,
      nextStep: a.nextStep,
      ownerId: a.ownerId,
      escalatedTo: a.escalatedTo,
      ackedByMe,
      read: !!read[a.key] || ackedByMe,
      readAt: read[a.key]?.at,
    });
  }
  return out.sort((x, y) => RANK[x.severity] - RANK[y.severity] || Number(x.source === 'alert') - Number(y.source === 'alert'));
}

/** Read items that are no longer open: finished, settled or no longer in this person's scope. */
export function inboxDone(actor: RActor, open: InboxItem[]) {
  const read = getSettings(actor.id).inboxRead ?? {};
  const openKeys = new Set(open.map((i) => i.key));
  return Object.entries(read)
    .filter(([k]) => !openKeys.has(k))
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.at.localeCompare(a.at));
}

export const inboxUnread = (db: Db, actor: RActor, now: string) => inboxItems(db, actor, now).filter((i) => !i.read).length;
