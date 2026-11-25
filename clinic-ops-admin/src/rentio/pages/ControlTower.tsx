import { stockRows } from '../../domain/rentio/engine';
import { orderStatus } from '../../domain/rentio/commerce';
/** Owner overview — decisions first, then where the stock is, what is running, and promised deliveries. */
import { AlertCircle, AlertTriangle, Info } from 'lucide-react';
import { DashCard, DonutChart, StatCard, StatGrid, TrendChart, TrendLegend, ViewAllLink, type DashTone, type TrendSeries } from '../../components/dashboard';
import { Navigate } from 'react-router-dom';
import { InlineAlert } from '../../components/primitives/feedback';
import { hasCap, type RActor, userName } from '../../domain/rentio/access';
import { readScope, scopedOrders, scopedStockRows } from '../../domain/rentio/scope';
import { fmtINR, fmtKg, sum, toKg } from '../../domain/rentio/units';
import { type Alert, alerts, alertsFor, ctaFor, distributorOverview, stageFunnel, stageName } from '../../domain/rentio/views';
import { incidentView } from '../../domain/rentio/incidents';
import { openSuggestions, scopedSuggestions } from '../../domain/rentio/replenish';
import { DeliveryOutcomeChart, FinishedByGradeChart } from './Charts';
import { RunTimeline } from '../graphics';
import { ProductionLine } from '../ProductionLine';
import { routeFlow, stockFlow } from '../flows';
import { scopedRuns } from '../../domain/rentio/scope';
import { wsBase } from '../../lib/routes';
import { useR } from '../store';
import { Details, Eta, ImplNote, OrderStatusChip, PageLink, RPage, Sim, Status, Table, fmtDay, fmtTime } from '../ui';
import { EmptyValue } from '../../components/primitives/display';
import type { RentioState } from '../../domain/rentio/types';

/** One decision or risk as a compact row: severity icon · title · one meta line · the action. */
const SEV: Record<Alert['severity'], { icon: typeof Info; tone: string }> = {
  critical: { icon: AlertCircle, tone: 'danger' },
  high: { icon: AlertTriangle, tone: 'warning' },
  medium: { icon: Info, tone: 'info' },
  low: { icon: Info, tone: 'neutral' },
};
function DecisionRow({ a, actor }: { a: Alert; actor: RActor }) {
  const cta = ctaFor(a, actor);
  const Sev = SEV[a.severity].icon;
  return (
    <li className="rt-oa-row">
      <span className={`rt-oa-icon is-${SEV[a.severity].tone}`} aria-hidden="true">
        <Sev size={16} strokeWidth={2} />
      </span>
      <div className="rt-oa-body">
        <div className="rt-oa-title" data-tooltip={a.title}>
          {a.title}
        </div>
        <div className="rt-oa-meta">
          <Status s={a.severity} />
          {a.qty && <span className="rt-oa-qty">{a.qty}</span>}
          <span className="truncate">{cta === a.action ? `Owner: ${a.owner}` : `Next: ${a.nextStep}`}</span>
        </div>
        {(a.due || a.escalatedTo) && (
          <div className="rt-oa-meta">
            {a.due && <span>Due {fmtTime(a.due)}</span>}
            {a.escalatedTo && <span className="tone-text-danger">Overdue — escalated to {userName(a.escalatedTo)}</span>}
          </div>
        )}
      </div>
      <PageLink to={a.link}>
        <span className={cta === a.action ? 'btn btn-primary' : 'btn btn-secondary'} aria-label={cta === a.action ? a.action : `Review — ${a.nextStep}`}>
          <span className="btn-label">{cta}</span>
        </span>
      </PageLink>
    </li>
  );
}

/** "5,000 kg" → value "5,000" + unit "kg" for a KPI card */
const kpi = (text: string) => {
  const m = text.match(/^(.*?)\s+(kg|bags)$/);
  return m ? { value: m[1], unit: m[2] } : { value: text, unit: undefined };
};

const TREND: TrendSeries[] = [
  { key: 'received', label: 'Received at gate' },
  { key: 'output', label: 'Stage output' },
  { key: 'dispatched', label: 'Dispatched' },
];
const IST = 330 * 60_000;
const istDay = (iso: string) => new Date(Date.parse(iso) + IST).toISOString().slice(0, 10);
/** Daily kg received, produced by stages and dispatched over the last 14 days — straight from the movement ledger (reversals cancel out). */
function activityTrend(s: RentioState, now: string) {
  const days = Array.from({ length: 14 }, (_, i) => istDay(new Date(Date.parse(now) - (13 - i) * 86_400_000).toISOString()));
  const reversed = new Set(s.movements.map((m) => m.reverses).filter(Boolean));
  const kindKey: Partial<Record<string, string>> = { intake: 'received', produce: 'output', dispatch: 'dispatched' };
  const acc = new Map(days.map((d) => [d, { received: 0, output: 0, dispatched: 0 } as Record<string, number>]));
  for (const m of s.movements) {
    const k = kindKey[m.kind];
    const bucket = k && !m.reverses && !reversed.has(m.id) ? acc.get(istDay(m.at)) : undefined;
    if (bucket) bucket[k!] += m.qty;
  }
  return days.map((d) => {
    const v = acc.get(d)!;
    return { key: d, label: new Date(`${d}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), received: toKg(v.received), output: toKg(v.output), dispatched: toKg(v.dispatched) };
  });
}

export default function ControlTower() {
  const { db, s, actor, now } = useR();
  if (!hasCap(actor, 'ct.view')) return <Navigate to={`${wsBase(db.session.workspaceId)}/home/my-work`} replace />;
  const base = wsBase(db.session.workspaceId);
  const sc = readScope(actor);
  const rows = scopedStockRows(s, actor, now).filter((r) => r.lot.unit !== 'bag' && r.lot.material !== 'OIL');
  const kind = (k: string[]) => rows.filter((r) => k.includes(r.location?.kind));
  const fin = kind(['finished']).filter((r) => r.lot.material === 'PACKED' || r.lot.material === 'DAL');
  const all = alertsFor(db, actor, now);
  const isOwner = actor.roleId === 'owner';
  // decisions = only genuine authority exceptions; escalations are risks someone else still owns
  const needsMe = all.filter((a) => (isOwner ? a.ownerDecision : a.ownerId === actor.id && !a.ownerDecision));
  const escalatedToMe = all.filter((a) => !needsMe.includes(a) && a.escalatedTo === actor.id);
  const risks = [...escalatedToMe, ...all.filter((a) => !needsMe.includes(a) && !escalatedToMe.includes(a) && (a.severity === 'critical' || a.severity === 'high'))].slice(0, 3);
  const funnel = stageFunnel(s, now).filter((f) => f.queue + f.running + f.held + f.output + f.pendingIn > 0);
  const distRows = sc.all || sc.allDistributors ? distributorOverview(db, now) : [];
  const orders = scopedOrders(s, actor).filter((o) => o.kind === 'factory' && !['cancelled', 'closed'].includes(o.status) && !o.revisions.some((r) => r.change.startsWith('Inter-distributor')));
  // most urgent first: problems (dispute, stock on hold, credit hold, short) before routine, then by promised date;
  // every problem order is listed even beyond five so nothing at risk is hidden from the owner
  const URGENCY: Partial<Record<string, number>> = { at_risk: 0, disputed: 1, credit_hold: 2, awaiting_stock: 3, partly_allocated: 3, partially_delivered: 4 };
  const allRows = stockRows(s, now);
  const sellable = (lotId: string, loc: string) => !!allRows.find((x) => x.lotId === lotId && x.loc === loc)?.sellable;
  const rank = (o: (typeof orders)[number]) => URGENCY[orderStatus(s, o, sellable).code] ?? 9; // same status as the chip
  const sortedOrders = [...orders].sort((a, b) => rank(a) - rank(b) || (a.promisedDate ?? '9999').localeCompare(b.promisedDate ?? '9999'));
  const urgentOrders = sortedOrders.filter((o, i) => i < 5 || rank(o) < 9);
  const today = new Date(Date.parse(now) + 330 * 60_000).toISOString().slice(0, 10);
  const live = alerts(db, now);
  // read-scoped like Incidents and Replenishment: no child titles, owners or quantities outside the role's scope
  const incidents = (s.incidents ?? []).filter((x) => x.status === 'open').map((inc) => ({ inc, v: incidentView(db, actor, now, inc, live) })).filter((x) => x.v.listed);
  const replen = hasCap(actor, 'page:planning/replenish') ? openSuggestions(scopedSuggestions(db, actor, now)) : [];
  /* header shortcut hidden (owner, 2026-11-25) — restore with the commented header row above the page body:
  const toCharts = (e: MouseEvent) => {
    const el = document.getElementById('owner-charts');
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView?.({ block: 'start' });
    el.focus();
  };
  */
  const staffTx = s.txLog.filter((t) => t.actorId !== actor.id && new Date(Date.parse(t.at) + 330 * 60_000).toISOString().slice(0, 10) === today).length;


  const flow = stockFlow(s, actor, now, base);
  const node = (k: string) => flow.find((n) => n.key === k);
  const finHeld = sum(fin.filter((r) => !r.sellable).map((r) => r.qty));
  const finFree = sum(fin.map((r) => r.available));
  const atRisk = sortedOrders.filter((o) => rank(o) < 9);
  const trend = sc.factory ? activityTrend(s, now) : [];
  const trendTotal = (k: string) => trend.reduce((a, d) => a + Number(d[k as keyof (typeof trend)[number]]), 0);
  const money = {
    tallyQueued: sum(s.tally.filter((t) => t.status === 'queued').map((t) => t.amount)),
    tallyProblems: s.tally.filter((t) => t.status === 'failed' || t.status === 'status_unknown').length,
    creditHold: s.orders.filter((o) => o.status === 'credit_hold').length,
    collections: s.collections.filter((c) => c.status === 'provisional').length,
    approvals: s.approvals.filter((a) => a.status === 'pending').length,
  };
  const tone = (bad: boolean, t: DashTone = 'danger') => (bad ? t : 'success');
  const toLink = (page: string) => `${base}/${page}`;
  const route = routeFlow(s, actor, now, base, { exitsFromRoot: undefined });

  return (
    <RPage
      title="Owner overview"
      description="What needs you, where the stock is, what is running and which deliveries are at risk."
      /* owner (2026-11-25): header row hidden — the intro line and the "View stock and delivery charts" shortcut
         (the charts now sit right under the KPI row, so the jump link is no longer needed).
      actions={
        <div className="rt-headrow">
          <p className="rt-intro">Plant 1 · {fmtTime(now)} IST · live from staff postings</p>
          <a className="btn btn-secondary" href="#owner-charts" onClick={toCharts}>
            <span className="btn-label">View stock and delivery charts</span>
          </a>
        </div>
      }
      */
    >
      <div className="rt-owner dv-page" data-chart-mode="multi">
        {/* headline figures — the same ledger rows as the flow strip below, Godowns and Inventory */}
        <StatGrid label="Key figures">
          {node('raw') && <StatCard label="Raw toor" info="Raw toor at the gate and in the raw godown." {...kpi(node('raw')!.value)} note={{ text: node('raw')!.sub ?? '', tone: node('raw')!.status?.tone === 'warn' ? 'warning' : 'success' }} to={toLink('stock/godowns')} testId="kpi-raw" />}
          {node('proc') && <StatCard label="In processing" info="Material arriving, queued, running or ready at production stages." {...kpi(node('proc')!.value)} note={{ text: node('proc')!.sub ?? '' }} to={toLink('production/stages')} testId="kpi-proc" />}
          {sc.factory && <StatCard label="Free to sell" info="Finished dal in F1 that is sellable and not reserved." {...kpi(fmtKg(finFree))} note={finHeld ? { text: `${fmtKg(finHeld)} on hold`, tone: 'warning' } : { text: 'Nothing on hold', tone: 'success' }} to={toLink('stock/godowns')} testId="kpi-free" />}
          {node('dist') && <StatCard label="At distributors" info="Physical stock reported by distributors." {...kpi(node('dist')!.value)} note={{ text: node('dist')!.sub ?? '', tone: node('dist')!.status ? 'warning' : undefined }} to={toLink('distribution/distributors')} testId="kpi-dist" />}
          <StatCard label="Exceptions" info="Open alerts you can see; decisions are the ones only you can take." value={String(all.length)} unit="open" note={{ text: `${needsMe.length} need you · ${escalatedToMe.length} escalated`, tone: tone(needsMe.length > 0 || escalatedToMe.length > 0) }} to={toLink('home/alerts')} testId="kpi-exceptions" />
          <StatCard label="Orders at risk" info="Open factory orders with a problem: stock on hold, dispute, credit hold or short." value={String(atRisk.length)} unit={`/ ${orders.length}`} note={{ text: atRisk.length ? `${atRisk.length} need follow-up` : 'All on track', tone: tone(atRisk.length > 0) }} to={toLink('distribution/orders')} testId="kpi-orders" />
        </StatGrid>

        {/* owner (2026-11-25): these four charts come straight after the KPIs (also the header shortcut target) */}
        <section id="owner-charts" tabIndex={-1} aria-label="Owner charts" className="rt-charts">
          <FinishedByGradeChart fin={fin} base={base} />
          <DeliveryOutcomeChart s={s} base={base} visible={(d) => sc.all || sc.allDistributors || sc.distributors.includes(d)} />
        </section>

        {sc.factory && (
          <div className="dv-row is-wide-left">
            <DashCard className="is-centered" title="Plant activity" meta="Per day · last 14 days" action={<TrendLegend series={TREND} />}>
              <TrendChart
                ariaLabel="Kg received, produced by stages and dispatched per day"
                data={trend}
                series={TREND}
                renderTooltip={(i) => (
                  <>
                    <strong>{trend[i].label}</strong>
                    {TREND.map((t) => (
                      <span key={t.key} className="dv-tip-row">
                        {t.label}: <strong>{fmtKg(Number(trend[i][t.key as 'received']) * 1000)}</strong>
                      </span>
                    ))}
                  </>
                )}
              />
              <p className="rt-oa-foot muted small">
                14 days: {fmtKg(trendTotal('received') * 1000)} received · {fmtKg(trendTotal('output') * 1000)} stage output · {fmtKg(trendTotal('dispatched') * 1000)} dispatched
              </p>
            </DashCard>
            <DashCard title="Stock by location" meta="Physical kg">
              <DonutChart
                ariaLabel="Physical stock by location"
                legendTitle="Location"
                totalLabel="kg"
                slices={flow.map((n) => ({ key: n.key, label: n.label, value: toKg(n.magnitude ?? 0)}))}
                summary={(() => {
                  const tot = sum(flow.map((n) => n.magnitude ?? 0));
                  const f = node('fin')?.magnitude ?? 0;
                  return tot ? `${Math.round((f * 100) / tot)}% finished in the factory · ${Math.round(((node('dist')?.magnitude ?? 0) * 100) / tot)}% at distributors` : undefined;
                })()}
              />
            </DashCard>
          </div>
        )}

        <div className="dv-row is-wide-right">
          <DashCard className="rt-oa-card" title={isOwner ? 'Needs your decision' : 'Needs you'} meta={needsMe.length ? `${needsMe.length} waiting` : 'none'}>
            {needsMe.length ? (
              <ul className="rt-oa-list">{needsMe.map((a) => <DecisionRow key={a.key} a={a} actor={actor} />)}</ul>
            ) : (
              <p className="dv-empty is-ok">Nothing needs you right now — routine work is with your staff.</p>
            )}
          </DashCard>
          <DashCard className="rt-oa-card" title="Top risks" meta={`${risks.length} of ${all.length} open${escalatedToMe.length ? ` · ${escalatedToMe.length} escalated to you` : ''}`} action={<ViewAllLink to={toLink('home/alerts')} label="All exceptions" />}>
            {risks.length ? <ul className="rt-oa-list">{risks.map((a) => <DecisionRow key={a.key} a={a} actor={actor} />)}</ul> : <p className="dv-empty is-ok">No high or critical risks.</p>}
          </DashCard>
        </div>

        {/* owner (2026-11-25): "Where the stock is now" card hidden — the same figures are in the KPI row and the
            Stock by location donut.
        <FlowChain title="Where the stock is now" caption="Physical kg along the network · open a step for its lots" nodes={flow} />
        */}
        {/* production route as one line of stations (same routeFlow + stageFunnel figures as Stage board) */}
        {route.length > 0 && (
          <DashCard
            className="rt-pl-card"
            title="Production route — material at each stage"
            meta={`${route.filter((n) => n.magnitude).length} of ${route.length} stages active · ${fmtKg(sum(route.map((n) => n.magnitude ?? 0)))} on the line${route.some((n) => n.status?.tone === 'bad') ? ` · ${route.filter((n) => n.status?.tone === 'bad').length} late` : ''}`}
            action={<ViewAllLink to={toLink('production/stages')} label="Stage board" />}
          >
            <ProductionLine title="Production route — material at each stage" nodes={route} parts={Object.fromEntries(stageFunnel(s, now).map((f) => [f.code, f]))} />
          </DashCard>
        )}

        <div className="dv-row is-wide-left">
          <DashCard className="rt-oa-card" title="Delivery promises" meta={orders.length > urgentOrders.length ? `${urgentOrders.length} most urgent of ${orders.length}` : `${orders.length} open`} action={<ViewAllLink to={toLink('distribution/orders')} label="All orders" />}>
            {urgentOrders.length ? (
              <div className="dv-pad">
                <table className="rt-oa-table">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Promised</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {urgentOrders.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <PageLink to={`distribution/orders?focus=${o.id}`}>{o.id}</PageLink>
                          <div className="muted small truncate">
                            {o.partyId} · {o.lines.map((l) => `${l.grade} ${fmtKg(l.qty - l.cancelled)}`).join(', ')}
                          </div>
                        </td>
                        <td>{o.promisedDate ? fmtDay(`${o.promisedDate}T00:00:00+05:30`) : <EmptyValue />}</td>
                        <td>
                          <OrderStatusChip order={o} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="dv-empty">No open orders.</p>
            )}
          </DashCard>
          <DashCard className="rt-oa-card" title="Money and delegated work" meta="Today">
            <dl className="rt-oa-facts">
              <div>
                <dt>Waiting to sync to Tally <Sim what="Tally simulated" /></dt>
                <dd>{fmtINR(money.tallyQueued, true)}</dd>
              </div>
              <div className={money.tallyProblems ? 'is-danger' : undefined}>
                <dt>Tally problems</dt>
                <dd>{money.tallyProblems}</dd>
              </div>
              <div className={money.creditHold ? 'is-warning' : undefined}>
                <dt>Orders on credit hold</dt>
                <dd>{money.creditHold}</dd>
              </div>
              <div>
                <dt>Collections awaiting Accounts</dt>
                <dd>{money.collections}</dd>
              </div>
              <div>
                <dt>Approvals with delegated approvers</dt>
                <dd>{money.approvals}</dd>
              </div>
              <div>
                <dt>Staff postings today (no owner needed)</dt>
                <dd>{staffTx}</dd>
              </div>
            </dl>
          </DashCard>
        </div>

        <div className={hasCap(actor, 'page:planning/replenish') ? 'dv-row is-halves' : 'dv-row'}>
          <RunTimeline title="Runs in progress — planned vs actual" caption="Working time, holds and time past the planned finish" runs={scopedRuns(s, actor).filter((r) => r.status !== 'completed')} now={now} labelOf={(r) => `${stageName(r.stage)} · ${r.inputLotId}`} />
          {hasCap(actor, 'page:planning/replenish') && (
            <DashCard className="rt-oa-card" title="Replenishment to review" meta={`${replen.length} suggestion(s)`} action={<ViewAllLink to={toLink('planning/replenish')} label="All suggestions" />}>
              {replen.length ? (
                <ul className="rt-oa-list">
                  {replen.slice(0, 3).map((x) => (
                    <li key={x.key} className="rt-oa-row">
                      <span className={`rt-oa-icon is-${x.needsConfirmation ? 'warning' : 'info'}`} aria-hidden="true">
                        {x.needsConfirmation ? <AlertTriangle size={16} /> : <Info size={16} />}
                      </span>
                      <div className="rt-oa-body">
                        <div className="rt-oa-title">
                          {x.title}: {x.qtyLabel}
                        </div>
                        <div className="rt-oa-meta">
                          <span>
                            Reviewer {userName(x.reviewerId)} · arrange by {x.orderBy}
                            {x.needsConfirmation ? ' · stale partner data — needs confirmation' : ''}
                            {x.review?.staleReason === 'qty' ? ' · changed since last review' : x.review?.staleReason === 'data' ? ' · confirmation expired since last review' : ''}
                          </span>
                        </div>
                      </div>
                      <PageLink to={`planning/replenish?focus=${encodeURIComponent(x.key)}`}>
                        <span className="btn btn-secondary">
                          <span className="btn-label">Review</span>
                        </span>
                      </PageLink>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="dv-empty is-ok">Nothing to replenish right now.</p>
              )}
            </DashCard>
          )}
        </div>

        {incidents.length > 0 && (
          <DashCard className="rt-oa-card" title="Incidents" meta={`${incidents.length} open`} action={hasCap(actor, 'page:home/incidents') ? <ViewAllLink to={toLink('home/incidents')} label="All incidents" /> : undefined}>
            <ul className="rt-oa-list">
              {incidents.map(({ inc, v: { kids, shown, label } }) => {
                const open = kids.filter((k) => k.state === 'open');
                const hidden = open.length - shown.filter((k) => k.state === 'open').length;
                return (
                  <li key={inc.id} className="rt-oa-row">
                    <span className={`rt-oa-icon is-${open.length ? 'danger' : 'success'}`} aria-hidden="true">
                      <AlertCircle size={16} />
                    </span>
                    <div className="rt-oa-body">
                      <div className="rt-oa-title">{label}</div>
                      <div className="rt-oa-meta">
                        <Status s={open.length ? 'open' : 'resolved'} />
                        <span>
                          Lead {userName(inc.leadId)} · {kids.length} linked · {open.length} open ({[...shown.filter((k) => k.state === 'open').map((k) => k.ownerName), ...(hidden ? [`${hidden} outside your area`] : [])].join(', ') || '—'}) · {kids.filter((k) => k.state === 'resolved').length} resolved
                        </span>
                      </div>
                    </div>
                    <PageLink to={`home/incidents?focus=${inc.id}`}>
                      <span className="btn btn-secondary">
                        <span className="btn-label">Open</span>
                      </span>
                    </PageLink>
                  </li>
                );
              })}
            </ul>
          </DashCard>
        )}

        <Details summary={`More detail — production by stage (${funnel.length} active)${distRows.length ? ` · distributors to follow up (${distRows.filter((d) => d.stale || d.belowMin || d.openDisputes || d.nearExpiry).length})` : ''}`}>
          <div className="rt-stack">
            <h3 className="rt-h3">Production by stage</h3>
            <Table
              rows={funnel}
              rowKey={(f) => f.code}
              empty="Nothing in process."
              cols={[
                { key: 's', label: 'Stage', render: (f) => <PageLink to={`production/stage?stage=${f.code}`}>{stageName(f.code)}</PageLink> },
                { key: 'lot', label: 'Lot', render: (f) => f.runs.map((r) => r.run.inputLotId).join(', ') || (f.pendingIn ? 'arriving' : f.output ? 'ready to send' : 'queued') },
                { key: 'w', label: 'Material', num: true, render: (f) => fmtKg(f.queue + f.running + f.held + f.output + f.pendingIn) },
                { key: 'st', label: 'Status', render: (f) => (f.runs[0] ? <Status s={f.runs[0].t.status} /> : f.pendingIn ? 'waiting for receipt' : f.output ? 'waiting to send' : 'waiting to start') },
                { key: 'eta', label: 'Expected finish', render: (f) => (f.runs[0] ? <Eta t={f.runs[0].t} /> : '—') },
                { key: 'o', label: 'Responsible', render: (f) => f.ownerName },
              ]}
            />
            {distRows.length > 0 && (
              <>
                <h3 className="rt-h3">Distributors to follow up</h3>
                <Table
                  rows={distRows.filter((d) => d.stale || d.belowMin || d.openDisputes || d.nearExpiry)}
                  rowKey={(d) => d.id}
                  cols={[
                    { key: 'id', label: 'Distributor', render: (d) => <PageLink to={`distribution/distributors?d=${d.id}&focus=${d.id}`}>{`${d.id} · ${d.name.replace(' (fictional)', '')}`}</PageLink> },
                    { key: 'p', label: 'Stock', num: true, render: (d) => fmtKg(d.physical) },
                    { key: 'f', label: 'Last update', render: (d) => (d.stale ? <span className="tone-text-warning">{d.lastSyncHours} h ago — not live</span> : `${d.lastSyncHours} h ago`) },
                    { key: 'w', label: 'Why', render: (d) => [d.belowMin && 'below minimum', d.openDisputes && 'receipt dispute', d.nearExpiry && 'stock near expiry'].filter(Boolean).join(', ') || 'old figures' },
                  ]}
                />
              </>
            )}
          </div>
        </Details>
        {!needsMe.length && !risks.length && <InlineAlert tone="success">The mill is running within plan.</InlineAlert>}
      </div>
      <ImplNote>
        Owner brief (M13: FR-072/073/113/114). Decisions = approvals beyond delegated authority plus items escalated to the owner by the timed escalation rule (FR-075). Headline figures, the stock flow and the stock donut derive from the same ledger rows as Godowns/Inventory (scoped by role); dimensions are separate (physical, on hold, reserved, free to sell). The activity trend sums intake, stage output and dispatch movements per IST day, excluding reversed pairs. Lot-level RT-001 reconciliation is in Presenter tools and Yield, costing & trace.
      </ImplNote>
    </RPage>
  );
}
