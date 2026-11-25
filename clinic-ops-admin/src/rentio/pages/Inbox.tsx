/**
 * Rentio Inbox — everything that needs the signed-in person, in one list: their own next actions
 * (My work) plus the alerts they are accountable for or that were escalated to them. Built only from
 * scoped views, so each role and each distributor sees just their own records. Every row opens the
 * exact record (?focus=<id>). Read / unread is personal; completing the work is what clears an item.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../components/primitives/Button';
import { EmptyState, StatusChip } from '../../components/primitives/feedback';
import { rentioRoles, userName } from '../../domain/rentio/access';
import { readScope } from '../../domain/rentio/scope';
import { cx } from '../../lib/format';
import { wsBase } from '../../lib/routes';
import type { Tone } from '../../metadata/types';
import { clearInboxDone, markInboxRead, markInboxUnread } from '../../services/settings';
import { inboxDone, inboxItems, type InboxItem, type InboxSeverity } from '../inbox';
import { useR } from '../store';
import { Panel, RPage, fmtTime } from '../ui';
import { IncidentTag } from './Alerts';
import { InboxChart } from './_graphB';

const SEV_TONE: Record<InboxSeverity, Tone> = { critical: 'danger', high: 'warning', medium: 'info', low: 'neutral' };
const SEV_LABEL: Record<InboxSeverity, string> = { critical: 'Critical', high: 'Urgent', medium: 'Normal', low: 'Low' };

export default function Inbox() {
  const { db, actor, now } = useR();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const items = inboxItems(db, actor, now);
  const unread = items.filter((i) => !i.read);
  const done = inboxDone(actor, items);
  const shown = filter === 'unread' ? unread : items;
  const role = rentioRoles.find((r) => r.id === actor.roleId);
  const base = wsBase(db.session.workspaceId);
  const read = (i: InboxItem) => markInboxRead(actor.id, [{ key: i.key, title: i.title, link: i.link }]);

  return (
    <RPage
      title="Inbox"
      description="Things that need you: your next actions and the alerts you are accountable for. Each item opens the exact record."
      actions={
        <Button onClick={() => markInboxRead(actor.id, unread.map((i) => ({ key: i.key, title: i.title, link: i.link })))} disabledReason={unread.length ? undefined : 'Nothing unread'}>
          Mark all read
        </Button>
      }
    >
      <p className="rt-intro">
        <strong>{actor.name}</strong> · {role?.label ?? actor.roleLabel} · {readScope(actor).label}
      </p>
      <div className="rt-inbox-bar">
        <div className="segmented" role="radiogroup" aria-label="Show">
          {(['all', 'unread'] as const).map((f) => (
            <button key={f} type="button" role="radio" aria-checked={filter === f} className={cx('seg-btn', filter === f && 'is-on')} onClick={() => setFilter(f)}>
              {f === 'all' ? `All open (${items.length})` : `Unread (${unread.length})`}
            </button>
          ))}
        </div>
        <span className="muted small">Reading an item never approves or completes it — the item leaves the inbox when the work is done.</span>
      </div>
      {items.length > 0 && <InboxChart items={items} />}
      <Panel title="Open items" meta={`${items.length} open · ${unread.length} unread`}>
        {shown.length ? (
          <ul className="rt-inbox" aria-label="Inbox items">
            {shown.map((i) => (
              <li key={i.key} className={cx('rt-inbox-item', !i.read && 'is-unread')} data-key={i.key}>
                <span className="rt-inbox-dot" aria-hidden="true" />
                <div className="rt-inbox-main">
                  <div className="rt-inbox-chips">
                    <StatusChip label={i.read ? (i.ackedByMe ? 'Acknowledged · still open' : 'Read') : 'Unread'} tone={i.read ? 'neutral' : 'accent'} />
                    <StatusChip label={SEV_LABEL[i.severity]} tone={SEV_TONE[i.severity]} />
                    <StatusChip label={i.source === 'task' ? 'Your action' : i.ownerId === actor.id ? 'Alert · yours' : i.escalatedTo === actor.id ? 'Alert · escalated to you' : 'Alert · in your scope'} tone="neutral" />
                  </div>
                  <div className="rt-inbox-title">{i.title}</div>
                  <div className="muted small">
                    {i.detail}
                    {i.qty ? ` · ${i.qty}` : ''}
                    {i.due ? ` · due ${fmtTime(i.due)}` : ''}
                  </div>
                  {i.source === 'alert' && i.ownerId !== actor.id && i.nextStep && <div className="muted small">Next step: {i.nextStep}{i.escalatedTo ? ` · escalated to ${userName(i.escalatedTo)}` : ''}</div>}
                  <IncidentTag sourceId={new URLSearchParams(i.link.split('?')[1] ?? '').get('focus') ?? undefined} />
                </div>
                <div className="rt-inbox-actions">
                  <Link className={cx('btn', i.read ? 'btn-secondary' : 'btn-primary')} to={`${base}/${i.link}`} onClick={() => read(i)}>
                    <span className="btn-label">{i.action}</span>
                  </Link>
                  {i.read ? (
                    !i.ackedByMe && (
                      <Button variant="ghost" onClick={() => markInboxUnread(actor.id, i.key)}>
                        Mark unread
                      </Button>
                    )
                  ) : (
                    <Button variant="ghost" onClick={() => read(i)}>
                      Mark read
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon="inbox" title={filter === 'unread' && items.length ? 'Nothing unread' : 'Nothing needs you right now'}>
            {filter === 'unread' && items.length
              ? `You have read all ${items.length} open item(s). They stay here until the work is done.`
              : `No actions or alerts are waiting for ${actor.name} in ${readScope(actor).label.toLowerCase()}. New work appears here as soon as it is assigned or escalated to you.`}
          </EmptyState>
        )}
      </Panel>
      {done.length > 0 && (
        <Panel
          title="No longer open"
          meta="Read items that were completed, settled or moved out of your scope"
          actions={
            <Button variant="ghost" onClick={() => clearInboxDone(actor.id, items.map((i) => i.key))}>
              Clear list
            </Button>
          }
        >
          <ul className="rt-inbox is-done" aria-label="Completed items">
            {done.slice(0, 20).map((d) => (
              <li key={d.key} className="rt-inbox-item">
                <div className="rt-inbox-main">
                  <div className="rt-inbox-chips">
                    <StatusChip label="Done" tone="success" />
                  </div>
                  <div className="rt-inbox-title">{d.title}</div>
                  <div className="muted small">Read {fmtTime(d.at)}</div>
                </div>
                <div className="rt-inbox-actions">
                  <Link className="btn btn-ghost" to={`${base}/${d.link}`}>
                    <span className="btn-label">Open record</span>
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </RPage>
  );
}
