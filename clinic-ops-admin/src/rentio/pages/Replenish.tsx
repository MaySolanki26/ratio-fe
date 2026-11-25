/**
 * Replenishment suggestions (FR-101/106/113/117, WF-12, AC-26). Derived live from the ledger and policy; every
 * input, unit, cutoff and source is shown. Review (accept / defer) is an audited decision that posts nothing;
 * accepting hands off to the existing Purchase or Order form, prefilled. Stale partner figures need an explicit,
 * attributed stock confirmation first.
 */
import { Link } from 'react-router-dom';
import { InlineAlert, StatusChip } from '../../components/primitives/feedback';
import { hasCap, userName } from '../../domain/rentio/access';
import { DEMO } from '../../domain/rentio/config';
import { confirmPartnerStock, openSuggestions, reviewSuggestion, scopedSuggestions, type Suggestion } from '../../domain/rentio/replenish';
import { wsBase } from '../../lib/routes';
import { useAct, useR } from '../store';
import { ReplenishGraphics } from './_graphA';
import '../../styles/rentio-ux-b.css';
import { FormButton, ImplNote, Panel, RPage, Table, fmtTime, num, str, useFocusId } from '../ui';

const KIND: Record<Suggestion['kind'], string> = { raw: 'Plant raw', stores: 'Critical stores', partner: 'Partner (distributor)' };

export default function Replenish() {
  const { db, actor, now } = useR();
  const run = useAct();
  const focus = useFocusId();
  // same read-scoped list as the owner overview and My work
  const list = scopedSuggestions(db, actor, now);
  const open = openSuggestions(list);
  const base = wsBase(db.session.workspaceId);
  const isReviewer = (x: Suggestion) => actor.id === x.reviewerId || hasCap(actor, 'scope.all') || hasCap(actor, 'plan.manage');

  const section = (kind: Suggestion['kind']) => {
    const rows = list.filter((x) => x.kind === kind);
    if (!rows.length) return null;
    return (
      <Panel key={kind} title={KIND[kind]} meta={`${openSuggestions(rows).length} to review`}>
        <Table
          focus={focus}
          rowKey={(x) => x.key}
          rows={rows}
          empty="Nothing to replenish."
          cols={[
            { key: 't', label: 'Item', render: (x) => (<><strong>{x.title}</strong><div className="muted small">{x.qty > 0 ? `arrange by ${x.orderBy} · ` : ''}reviewer {userName(x.reviewerId)}</div></>) },
            { key: 'q', label: 'Suggested', num: true, render: (x) => (x.qty > 0 ? <strong>{x.qtyLabel}</strong> : <span className="muted">No action — above minimum</span>) },
            {
              key: 'in',
              label: 'How it is worked out',
              render: (x) => (
                <details className="rt-cell-more" open={focus === x.key}>
                  <summary>{x.inputs.length} inputs (units · source)</summary>
                  <div className="muted small">{x.formula}</div>
                  <ul className="rt-inputs">
                    {x.inputs.map((i) => (
                      <li key={i.label}>
                        {i.label}: <strong>{i.value}</strong> <span className="muted small">— {i.source}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ),
            },
            { key: 'f', label: 'Freshness', render: (x) => (<><StatusChip label={x.freshness === 'stale' ? 'Stale data' : 'Current'} tone={x.freshness === 'stale' ? 'warning' : 'success'} /><div className="muted small">cutoff {fmtTime(x.cutoff)}</div>{x.confirmed && <div className="muted small">confirmed by {userName(x.confirmed.by)}</div>}</>) },
            {
              key: 'st',
              label: 'Review',
              render: (x) =>
                x.review ? (
                  <>
                    <StatusChip label={x.review.decision === 'accepted' ? 'Accepted' : 'Deferred'} tone={x.review.decision === 'accepted' ? 'success' : 'neutral'} />
                    <div className="muted small">
                      {userName(x.review.by)} · {fmtTime(x.review.at)} · {x.review.reason}
                      {x.review.staleReason === 'qty' ? ' · quantity changed since — review again' : ''}
                      {x.review.staleReason === 'data' ? ' · the partner figures it relied on have expired — confirm current stock and review again' : ''}
                    </div>
                  </>
                ) : x.qty > 0 ? (
                  <StatusChip label="To review" tone="info" />
                ) : (
                  '—'
                ),
            },
            {
              key: 'act',
              label: '',
              render: (x) => {
                if (x.qty <= 0) return '—';
                const reason = isReviewer(x) ? undefined : `${userName(x.reviewerId)} reviews this suggestion`;
                const done = x.review && !x.review.stale;
                return (
                  <div className="rt-row-actions">
                    {x.needsConfirmation && (
                      <FormButton
                        label="Confirm current stock"
                        variant="primary"
                        disabledReason={hasCap(actor, 'order.create.factory') || hasCap(actor, 'scope.all') ? undefined : 'Back Office confirms partner stock'}
                        title={`Confirm ${x.partyId} stock (stale app data)`}
                        submitLabel="Record confirmation"
                        note="The app figure is older than the freshness limit. Record what the distributor confirms now (call or visit). This is audited and never creates an order by itself."
                        fields={[
                          { key: 'kg', label: 'Confirmed available stock', type: 'number', unit: 'kg', required: true },
                          { key: 'note', label: 'How confirmed (with whom)', type: 'text', required: true },
                        ]}
                        onSubmit={(v, key) => run(`Confirm ${x.partyId} stock`, (ctx) => confirmPartnerStock(ctx, { distributorId: x.partyId!, kg: num(v.kg), note: str(v.note) }), { key, success: () => `${x.partyId} stock confirmed — suggestion recalculated` })}
                      />
                    )}
                    {!done && (
                      <>
                        <FormButton
                          label="Accept"
                          variant={x.needsConfirmation ? 'secondary' : 'primary'}
                          disabledReason={reason ?? (x.needsConfirmation ? 'Confirm the current stock first — stale data cannot be accepted' : undefined)}
                          title={`Accept: ${x.title}`}
                          submitLabel="Accept (posts nothing)"
                          note={`Records your review of ${x.qtyLabel} with all inputs. It does not create a purchase, order or transfer — next you open ${x.handoff.label}.`}
                          fields={[{ key: 'reason', label: 'Note (supplier / agreement)', type: 'text', required: true }]}
                          onSubmit={(v, key) => run(`Accept replenishment ${x.key}`, (ctx) => reviewSuggestion(ctx, { key: x.key, decision: 'accepted', reason: str(v.reason) }), { key, success: (r) => `${r.id} accepted — open the ${x.action === 'factory_order' ? 'order' : 'purchase'} form to act` })}
                        />
                        <FormButton
                          label="Defer"
                          disabledReason={reason}
                          title={`Defer: ${x.title}`}
                          submitLabel="Defer"
                          fields={[{ key: 'reason', label: 'Why, and until when', type: 'text', required: true }]}
                          onSubmit={(v, key) => run(`Defer replenishment ${x.key}`, (ctx) => reviewSuggestion(ctx, { key: x.key, decision: 'deferred', reason: str(v.reason) }), { key, success: (r) => `${r.id} deferred` })}
                        />
                      </>
                    )}
                    {x.review?.decision === 'accepted' && !x.review.stale && (
                      hasCap(actor, `page:${x.handoff.page}`) ? (
                        <Link className="btn btn-primary" to={`${base}/${x.handoff.page}${x.handoff.query ? `?${x.handoff.query}` : ''}`}>
                          <span className="btn-label">{x.handoff.label}</span>
                        </Link>
                      ) : (
                        <span className="muted small">Hand-off: {x.handoff.label}</span>
                      )
                    )}
                  </div>
                );
              },
            },
          ]}
        />
      </Panel>
    );
  };

  return (
    <RPage
      title="Replenishment suggestions"
      description="What to buy or send, derived from demand, minimums, lead times, eligible stock and timely incoming supply. Suggestions never post anything."
      intro={list.length ? `${open.length} suggestion(s) to review · data as of ${fmtTime(now)}` : undefined}
    >
      {list.length > 0 && <ReplenishGraphics list={list} />}
      {list.some((x) => x.needsConfirmation) && <InlineAlert tone="warning" title="Stale partner data">Some distributor figures are older than {DEMO.staleDistributorHours} h. Confirm current stock before acting — stale data never becomes an order automatically.</InlineAlert>}
      {section('raw')}
      {section('stores')}
      {section('partner')}
      {!list.length && <p className="rt-empty">No suggestions in your area of work.</p>}
      <ImplNote>
        Fictional demo policy (config.ts DEMO.replenish; DEMO_ASSUMPTIONS.md): raw minimum {DEMO.replenish.rawMinKg.toLocaleString('en-IN')} kg, raw lead time {DEMO.replenish.rawLeadDays} days, yield {DEMO.replenish.yieldPct}%, finished minimum {DEMO.replenish.finishedMinKg.toLocaleString('en-IN')} kg; stores minimum / reorder-to per item; partner reorder level = distributor minimum + {DEMO.replenish.partnerLeadDays} days × {DEMO.replenish.partnerDailyOfftakeKg} kg/day. FR-101/106/113/117, WF-12, AC-26.
      </ImplNote>
    </RPage>
  );
}
