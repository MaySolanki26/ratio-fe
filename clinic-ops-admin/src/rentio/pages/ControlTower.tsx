/** Owner overview — decisions first, then where the stock is, what is running, and promised deliveries. */
import { Link, Navigate } from 'react-router-dom';
import { InlineAlert } from '../../components/primitives/feedback';
import { hasCap, type RActor, userName } from '../../domain/rentio/access';
import { readScope, scopedOrders, scopedStockRows } from '../../domain/rentio/scope';
import { fmtINR, fmtKg, sum } from '../../domain/rentio/units';
import { type Alert, alertsFor, ctaFor, distributorOverview, stageFunnel, stageName } from '../../domain/rentio/views';
import { wsBase } from '../../lib/routes';
import { useR } from '../store';
import { Details, Eta, ImplNote, OrderStatusChip, PageLink, Panel, Qty, RPage, Sim, Status, Table, fmtTime } from '../ui';

function DecisionRow({ a, actor }: { a: Alert; actor: RActor }) {
  const cta = ctaFor(a, actor);
  return (
    <div className="rt-decision">
      <div>
        <div className="rt-decision-title">{a.title}</div>
        <div className="rt-decision-meta">
          <span>
            <Status s={a.severity} />
          </span>
          {a.qty && <span>{a.qty}</span>}
          <span>{cta === a.action ? `Owner: ${a.owner}` : `Next: ${a.nextStep}`}</span>
          {a.due && <span>Due {fmtTime(a.due)}</span>}
          {a.escalatedTo && <span className="tone-text-danger">Overdue — escalated to {userName(a.escalatedTo)}</span>}
        </div>
      </div>
      <PageLink to={a.link}>
        <span className={cta === a.action ? 'btn btn-primary' : 'btn btn-secondary'} aria-label={cta === a.action ? a.action : `Review — ${a.nextStep}`}>
          <span className="btn-label">{cta}</span>
        </span>
      </PageLink>
    </div>
  );
}

export default function ControlTower() {
  const { db, s, actor, now } = useR();
  if (!hasCap(actor, 'ct.view')) return <Navigate to={`${wsBase(db.session.workspaceId)}/home/my-work`} replace />;
  const base = wsBase(db.session.workspaceId);
  const sc = readScope(actor);
  const rows = scopedStockRows(s, actor, now).filter((r) => r.lot.unit !== 'bag' && r.lot.material !== 'OIL');
  const kind = (k: string[]) => rows.filter((r) => k.includes(r.location?.kind));
  const raw = kind(['intake', 'raw']);
  const proc = kind(['stage-in', 'stage-out', 'run', 'pending']);
  const fin = kind(['finished']).filter((r) => r.lot.material === 'PACKED' || r.lot.material === 'DAL');
  const transit = kind(['transit']);
  const dist = kind(['distributor', 'distributor-held']);
  const kgOf = (rs: typeof rows) => sum(rs.map((r) => r.qty));
  const bags = (rs: typeof rows) => sum(rs.filter((r) => r.lot.bagSize).map((r) => Math.floor(r.qty / r.lot.bagSize!)));
  const all = alertsFor(db, actor, now);
  const isOwner = actor.roleId === 'owner';
  // decisions = only genuine authority exceptions; escalations are risks someone else still owns
  const needsMe = all.filter((a) => (isOwner ? a.ownerDecision : a.ownerId === actor.id && !a.ownerDecision));
  const escalatedToMe = all.filter((a) => !needsMe.includes(a) && a.escalatedTo === actor.id);
  const risks = [...escalatedToMe, ...all.filter((a) => !needsMe.includes(a) && !escalatedToMe.includes(a) && (a.severity === 'critical' || a.severity === 'high'))].slice(0, 3);
  const funnel = stageFunnel(s, now).filter((f) => f.queue + f.running + f.held + f.output + f.pendingIn > 0);
  const distRows = sc.all || sc.allDistributors ? distributorOverview(db, now) : [];
  const orders = scopedOrders(s, actor).filter((o) => o.kind === 'factory' && !['cancelled', 'closed'].includes(o.status) && !o.revisions.some((r) => r.change.startsWith('Inter-distributor')));
  const grades = [...new Set(fin.map((r) => r.lot.grade ?? '—'))].sort();
  const today = new Date(Date.parse(now) + 330 * 60_000).toISOString().slice(0, 10);
  const staffTx = s.txLog.filter((t) => t.actorId !== actor.id && new Date(Date.parse(t.at) + 330 * 60_000).toISOString().slice(0, 10) === today).length;

  const flow = [
    { label: 'Raw toor', to: 'stock/godowns', value: fmtKg(kgOf(raw)), note: kgOf(kind(['intake'])) ? `${fmtKg(kgOf(kind(['intake'])))} waiting for intake check` : `${fmtKg(sum(raw.map((r) => r.readyToProcess)))} ready to process` },
    { label: 'In processing', to: 'production/stages', value: fmtKg(kgOf(proc)), note: `${funnel.length} stage(s) active${sum(funnel.map((f) => f.held)) ? ` · ${fmtKg(sum(funnel.map((f) => f.held)))} paused` : ''}` },
    { label: 'Finished (factory)', to: 'stock/godowns', value: `${bags(fin).toLocaleString('en-IN')} bags`, note: `${fmtKg(kgOf(fin))} · ${fmtKg(sum(fin.map((r) => r.available)))} free to sell${sum(fin.filter((r) => r.held).map((r) => r.qty)) ? ` · ${fmtKg(sum(fin.filter((r) => r.held).map((r) => r.qty)))} on hold` : ''}` },
    { label: 'On the road', to: 'distribution/orders', value: fmtKg(kgOf(transit)), note: `${new Set(transit.map((r) => r.loc)).size} shipment(s)` },
    sc.all || sc.allDistributors
      ? { label: 'At distributors', to: 'distribution/distributors', value: fmtKg(kgOf(dist)), note: `17 partners · ${distRows.filter((d) => d.stale).length} not updated in 24 h` }
      : { label: 'At distributors', to: '', value: '—', note: 'Outside your view' },
  ];

  return (
    <RPage title="Owner overview" description="What needs you, where the stock is, what is running and which deliveries are at risk.">
      <p className="rt-intro">
        Plant 1 · {fmtTime(now)} IST · figures update as staff post work{s.dataset === 'completed' ? '' : ''}.
      </p>

      <Panel title={isOwner ? 'Needs your decision' : 'Needs you'} meta={needsMe.length ? `${needsMe.length}` : 'none'}>
        {needsMe.length ? needsMe.map((a) => <DecisionRow key={a.key} a={a} actor={actor} />) :<p className="rt-empty">Nothing needs you right now — routine work is with your staff.</p>}
      </Panel>

      <Panel title="Top risks" meta={`${risks.length} of ${all.length} open items${escalatedToMe.length ? ` · ${escalatedToMe.length} escalated to you` : ''}`} actions={<PageLink to="home/alerts">All exceptions</PageLink>}>
        {risks.length ? risks.map((a) => <DecisionRow key={a.key} a={a} actor={actor} />) :<p className="rt-empty">No high or critical risks.</p>}
      </Panel>

      <section aria-label="Stock flow" className="rt-flowstrip">
        {flow.map((f) =>
          f.to ? (
            <Link key={f.label} to={`${base}/${f.to}`}>
              <span className="rt-flow-label">{f.label}</span>
              <span className="rt-flow-value">{f.value}</span>
              <span className="rt-flow-note">{f.note}</span>
            </Link>
          ) : (
            <div key={f.label}>
              <span className="rt-flow-label">{f.label}</span>
              <span className="rt-flow-value">{f.value}</span>
              <span className="rt-flow-note">{f.note}</span>
            </div>
          ),
        )}
      </section>

      <Panel title="Production now" meta="Open a stage to see the lot and who is acting" actions={<PageLink to="production/stages">Stage board</PageLink>}>
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
      </Panel>

      <Panel title="Finished stock by grade" meta="Factory godown F1" actions={<PageLink to="stock/godowns">Stacks</PageLink>}>
        <Table
          rows={grades}
          rowKey={(g) => g}
          empty="No finished stock."
          cols={[
            { key: 'g', label: 'Grade', render: (g) => <strong>{g}</strong> },
            { key: 'b', label: 'Bags', num: true, render: (g) => bags(fin.filter((r) => (r.lot.grade ?? '—') === g)).toLocaleString('en-IN') },
            { key: 'k', label: 'Kg', num: true, render: (g) => fmtKg(kgOf(fin.filter((r) => (r.lot.grade ?? '—') === g))) },
            { key: 'a', label: 'Free to sell', num: true, render: (g) => <Qty g={sum(fin.filter((r) => (r.lot.grade ?? '—') === g).map((r) => r.available))} strong /> },
            { key: 'r', label: 'Reserved', num: true, render: (g) => fmtKg(sum(fin.filter((r) => (r.lot.grade ?? '—') === g).map((r) => r.reserved))) },
            { key: 'h', label: 'On hold', num: true, render: (g) => { const q = sum(fin.filter((r) => (r.lot.grade ?? '—') === g && r.held).map((r) => r.qty)); return q ? <span className="tone-text-warning">{fmtKg(q)}</span> : '—'; } },
          ]}
        />
      </Panel>

      <Panel title="Delivery promises" actions={<PageLink to="distribution/orders">Orders</PageLink>}>
        <Table
          rows={orders}
          rowKey={(o) => o.id}
          empty="No open orders."
          cols={[
            { key: 'id', label: 'Order', render: (o) => <PageLink to={`distribution/orders?focus=${o.id}`}>{o.id}</PageLink> },
            { key: 'p', label: 'Distributor', render: (o) => o.partyId },
            { key: 'g', label: 'Grade · qty', render: (o) => o.lines.map((l) => `${l.grade} ${fmtKg(l.qty - l.cancelled)}`).join(', ') },
            { key: 'd', label: 'Promised', render: (o) => o.promisedDate ?? '—' },
            {
              key: 'st',
              label: 'Status',
              // one shared derivation with Orders & dispatch and the distributor views
              render: (o) => <OrderStatusChip order={o} />,
            },
          ]}
        />
      </Panel>

      {distRows.length > 0 && (
        <Details summary={`Distributors needing follow-up (${distRows.filter((d) => d.stale || d.belowMin || d.openDisputes || d.nearExpiry).length})`}>
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
        </Details>
      )}

      <Details summary="Money and delegated work">
        <p className="muted">
          {staffTx} postings by staff today without owner involvement · {s.approvals.filter((a) => a.status === 'pending').length} approvals waiting with delegated approvers · {s.orders.filter((o) => o.status === 'credit_hold').length} order(s) on credit hold ·{' '}
          {s.tally.filter((t) => t.status === 'failed' || t.status === 'status_unknown').length} Tally problem(s) · {fmtINR(sum(s.tally.filter((t) => t.status === 'queued').map((t) => t.amount)), true)} waiting to sync <Sim what="Tally simulated" /> ·{' '}
          {s.collections.filter((c) => c.status === 'provisional').length} collection(s) awaiting Accounts.
        </p>
      </Details>
      {!needsMe.length && !risks.length && <InlineAlert tone="success">The mill is running within plan.</InlineAlert>}
      <ImplNote>
        Owner brief (M13: FR-072/073/113/114). Decisions = approvals beyond delegated authority plus items escalated to the owner by the timed escalation rule (FR-075). Stock strip derives from the same ledger rows as Godowns/Inventory (scoped by role); dimensions are separate (physical, on hold, reserved, free to sell). Lot-level RT-001 reconciliation is in Presenter tools and Yield, costing & trace.
      </ImplNote>
    </RPage>
  );
}
