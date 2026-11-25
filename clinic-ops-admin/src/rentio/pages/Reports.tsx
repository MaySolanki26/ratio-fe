import { DEMO } from '../../domain/rentio/config';
import { useState } from 'react';
import { Button } from '../../components/primitives/Button';
import { InlineAlert } from '../../components/primitives/feedback';
import { hasCap } from '../../domain/rentio/access';
import { lineBalance, tripFreight } from '../../domain/rentio/commerce';
import { familyOf } from '../../domain/rentio/engine';
import { purchaseBalances } from '../../domain/rentio/ops';
import { fmtINR, fmtKg, sum, valueOf } from '../../domain/rentio/units';
import { byproductReconciliation, lotAccounting, yieldReport } from '../../domain/rentio/views';
import { useR } from '../store';
import { genealogy, lotOutcome, lotRouteFlow } from '../flows';
import { ChartGrid, FlowChain, GenealogyTree, MASS_SEGS, massRows, RunTimeline, ShareStrip, StackBars } from '../graphics';
import { wsBase } from '../../lib/routes';
import { stageName } from '../../domain/rentio/views';
import { PageTabs, usePageTab } from './_uxA';
import { canReadLot, readScope } from '../../domain/rentio/scope';
import { Details, ImplNote, Kpi, KpiRow, LotLink, Panel, Ref, RPage, Status, Table, fmtTime, useFocusId } from '../ui';

/** Demo cost inputs (labelled demo values from config.ts). */
const DEMO_OIL_PER_KG = DEMO.oilCostRupeesPerKg * 100; // paise/kg (config.ts)
const DEMO_BAG_EACH = DEMO.bagCostRupees * 100; // paise/bag (config.ts)
const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

export default function Reports() {
  const { db, s, actor, now } = useR();
  const focus = useFocusId();
  // read scope: only lots the actor may trace are offered
  const roots = Object.values(s.lots).filter((l) => l.rootId === l.id && canReadLot(s, actor, l.id) && (l.material === 'RAW' || s.movements.some((m) => m.lotId === l.id && m.kind === 'opening' && l.material !== 'OIL' && l.material !== 'BAGS')));
  const [tab, setTab] = usePageTab(['where', 'passes', 'tree', 'cost', 'perf'] as const, 'where');
  const [root, setRoot] = useState(focus && roots.some((r) => r.id === focus) ? focus : roots.some((r) => r.id === 'RT-001') ? 'RT-001' : roots[0]?.id ?? '');
  const sc = readScope(actor);
  const acc = root ? lotAccounting(s, root) : null;
  const y = root ? yieldReport(s, root) : null;
  const fam = new Set(root ? familyOf(s, root) : []);
  const canCost = hasCap(actor, 'costing.view');

  // ---- provisional costing for the selected root
  const intakes = s.intakes.filter((i) => fam.has(i.lotId));
  const rawCost = sum(intakes.map((i) => valueOf(i.accepted ?? 0, s.purchases.find((p) => p.id === i.purchaseId)?.ratePerKg ?? 0) - (i.valueDeduction ?? 0)));
  const oilCost = valueOf(sum(acc?.additions.map((a) => a.qty) ?? []), DEMO_OIL_PER_KG);
  const packRuns = s.runs.filter((r) => fam.has(r.inputLotId) && r.packing);
  const bagCost = sum(packRuns.map((r) => (r.packing?.bags ?? 0) * DEMO_BAG_EACH));
  const ships = s.shipments.filter((sh) => sh.lines.some((l) => fam.has(l.lotId)));
  const trips = [...new Set(ships.map((sh) => sh.tripId).filter(Boolean))] as string[];
  let freight = 0;
  let freightPending = false;
  for (const t of trips) {
    const trip = s.trips.find((x) => x.id === t)!;
    if (!trip.freightBill) {
      freightPending = true;
      freight += tripFreight({ s }, t).calculated;
    } else freight += trip.freightBill.amount;
  }
  const totalCost = rawCost + oilCost + bagCost + freight;
  const saleable = y?.saleable ?? 0;
  const sales = sum(
    ships.flatMap((sh) => {
      const o = s.orders.find((x) => x.id === sh.orderId);
      return sh.lines.filter((l) => fam.has(l.lotId)).map((l) => valueOf(l.qty, o?.lines.find((x) => x.id === l.orderLineId)?.ratePerKg ?? 0));
    }),
  );
  const dispatchedKg = sum(ships.flatMap((sh) => sh.lines.filter((l) => fam.has(l.lotId)).map((l) => l.qty)));
  const costPerKg = saleable ? Math.round((totalCost * 1000) / saleable) : 0;

  const exportCsv = () => {
    if (!acc) return;
    const lines = [
      `"Lot accounting for ${acc.rootId}","as of ${new Date().toISOString()}","unit: kg"`,
      'Bucket,Type,Quantity (kg)',
      ...acc.buckets.map((b) => `"${b.label.replace(/"/g, '""')}",${b.kind},${b.qty / 1000}`),
      `"Total accounted",,${acc.total / 1000}`,
      `"Root input",,${acc.input / 1000}`,
      ...acc.additions.map((a) => `"Addition ${a.lotId}",,${a.qty / 1000}`),
      `"Expected (input + additions)",,${acc.expected / 1000}`,
      `"Balanced",,${acc.balanced ? 'yes' : 'NO'}`,
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `lot-accounting-${acc.rootId}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // ---- performance (scoped)
  const myDists = actor.scope.distributors ?? [];
  const scoped = (id?: string) => sc.all || sc.allDistributors || (id !== undefined && myDists.includes(id));
  const distPerf = (db.records.distributors ?? [])
    .filter((d) => scoped(d.id))
    .map((d) => {
      const fo = s.orders.filter((o) => o.kind === 'factory' && o.partyId === d.id && o.status !== 'cancelled');
      const ro = s.orders.filter((o) => o.kind === 'retail' && o.distributorId === d.id);
      const bal = (os: typeof fo) => os.flatMap((o) => o.lines.map((l) => ({ o, l, b: lineBalance(s, o, l) })));
      const f = bal(fo);
      const r = bal(ro);
      return {
        id: d.id,
        name: String(d.name),
        orders: fo.length,
        ordered: sum(f.map((x) => x.b.ordered - x.b.cancelled)),
        received: sum(f.map((x) => x.b.delivered)),
        retailOrders: ro.length,
        retailDelivered: sum(r.map((x) => x.b.delivered)),
        value: sum(r.map((x) => valueOf(x.b.delivered, x.l.ratePerKg))),
      };
    })
    .filter((x) => x.orders || x.retailOrders);
  const salesmen = [...new Set(s.orders.filter((o) => o.salesmanId).map((o) => o.salesmanId!))].filter((id) => hasCap(actor, 'scope.all') || hasCap(actor, 'scope.factory') || id === actor.id);

  const suppliers = (db.records.suppliers ?? []).map((sup) => {
    const ps = s.purchases.filter((p) => p.supplierId === sup.id);
    const b = ps.map((p) => purchaseBalances(s, p));
    const ins = s.intakes.filter((i) => ps.some((p) => p.id === i.purchaseId));
    return { id: sup.id, name: String(sup.name), purchases: ps.length, accepted: sum(b.map((x) => x.accepted)), rejected: sum(b.map((x) => x.rejected)), open: sum(b.map((x) => x.open)), deduction: sum(ins.map((i) => i.valueDeduction ?? 0)), moisture: ins.length ? sum(ins.map((i) => i.moisturePct)) / ins.length : 0, bills: ps.map((p) => p.billMatch?.status ?? 'pending') };
  }).filter((x) => x.purchases);

  const trace = !!root && !!s.lots[root] && canReadLot(s, actor, root);
  const base = wsBase(db.session.workspaceId);
  const out = trace ? lotOutcome(s, root) : null;
  const tree = trace ? genealogy(s, actor, root, base) : null;
  const runs = trace ? s.runs.filter((r) => s.lots[r.inputLotId]?.rootId === root).sort((a, b) => a.events[0].at.localeCompare(b.events[0].at)) : [];

  return (
    <RPage
      title="Yield, costing & trace"
      description="Where every kilogram of a lot went, its yield and a provisional cost — all from the stock ledger."
    >
      {!sc.all && <InlineAlert tone="info">Includes network totals for traceability (internal roles only).</InlineAlert>}
      <PageTabs
        label="Report sections"
        extra={
          <div className="rt-tabpick">
            <label className="field-label" htmlFor="rep-root">Root lot</label>
            <select id="rep-root" className="input" value={root} onChange={(e) => setRoot(e.target.value)}>
              {roots.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id} — {r.label}
                </option>
              ))}
            </select>
            <Button icon="download" onClick={exportCsv} disabled={!acc}>
              Export CSV
            </Button>
          </div>
        }
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'where', label: 'Where it went' },
          { id: 'passes', label: 'Stage passes & yield' },
          { id: 'tree', label: 'Genealogy' },
          { id: 'cost', label: 'By-products & costing' },
          { id: 'perf', label: 'Performance' },
        ]}
      >
        {tab === 'where' && (
          <>
            {trace && <div className="rt-route-wrap"><FlowChain title={`${root} — route this lot took`} caption="Input kg at each stage pass (incl. oil added) · side exits show what left the main flow there" nodes={lotRouteFlow(s, root, base)} /></div>}
            <div className="rt-split2">
              <Panel title="Where the lot went" meta={`As of ${fmtTime(now)} IST · kg`}>
                {acc ? (
              <div className="rt-stack">
                <Table
                  rows={[
                    ...acc.buckets.map((b) => ({ k: b.key, label: b.label, kind: b.kind === 'live' ? 'In stock' : 'Left', qty: b.qty, cls: undefined as string | undefined })),
                    { k: '__total', label: 'Total accounted', kind: '', qty: acc.total, cls: 'is-total' },
                    { k: '__input', label: `Raw input (accepted ${acc.rootId} intake)`, kind: 'Came in', qty: acc.input, cls: 'is-muted' },
                    ...acc.additions.map((a) => ({ k: `__add${a.lotId}`, label: `Added from stores: ${a.lotId}`, kind: 'Came in', qty: a.qty, cls: 'is-muted' })),
                    { k: '__exp', label: 'Expected = input + additions', kind: '', qty: acc.expected, cls: 'is-total' },
                  ]}
                  rowKey={(r) => r.k}
                  rowClass={(r) => r.cls}
                  cols={[
                    { key: 'l', label: 'Bucket', render: (r) => r.label },
                    { key: 'k', label: 'Type', render: (r) => r.kind },
                    { key: 'q', label: 'Quantity', num: true, render: (r) => fmtKg(r.qty) },
                  ]}
                />
                <InlineAlert tone={acc.balanced ? 'success' : 'danger'} title={acc.balanced ? 'Balanced ✓' : 'NOT balanced'}>
                  {fmtKg(acc.total)} accounted for {fmtKg(acc.expected)} that came in. Oil is counted once here, as it moved from stores into this lot.
                </InlineAlert>
              </div>
                ) : (
                  <p className="rt-empty">No root lots yet.</p>
                )}
              </Panel>
              {trace && out && (
                <ShareStrip title={`${root} — where all ${fmtKg(out.total)} is now`} caption={`${out.total === out.expected ? 'Balanced ✓' : 'NOT balanced'}: ${fmtKg(out.expected)} came in (raw + measured additions) · ${fmtKg(out.total)} accounted`} segs={out.segs} values={out.values} />
              )}
            </div>
          </>
        )}

        {tab === 'passes' && (
          <>
            {y && (
              <Panel title="Yield" meta="Per stage pass and for the whole lot">
                <KpiRow>
                  <Kpi label="Root input" value={fmtKg(y.rootInput)} />
                  <Kpi label="Saleable packed" value={fmtKg(y.saleable)} />
                  <Kpi label="Root yield" value={pct(y.rootYield)} note="packed ÷ accepted input (once)" />
                  <Kpi label="Rework generated" value={fmtKg(y.rework)} note="not new input" />
                </KpiRow>
                <Details summary={`Yield by stage pass (${y.runs.length})`}>
                <Table
                  rows={y.runs}
                  rowKey={(r) => r.run.id}
                  empty="No runs for this lot."
                  cols={[
                    { key: 'r', label: 'Run', render: (r) => <Ref>{r.run.id}</Ref> },
                    { key: 's', label: 'Stage · pass', render: (r) => `${r.run.stage} · ${r.run.pass}` },
                    { key: 'i', label: 'Input', render: (r) => <LotLink id={r.run.inputLotId} /> },
                    { key: 'd', label: 'Denominator', num: true, render: (r) => fmtKg(r.run.inputQty + r.additions) },
                    { key: 'f', label: 'Forward', num: true, render: (r) => fmtKg(r.forward) },
                    { key: 'y', label: 'Pass yield', num: true, render: (r) => pct(r.passYield) },
                  ]}
                />
                </Details>
                <p className="rt-empty">Husk {fmtKg(y.husk)} · Churi {fmtKg(y.churi)} · Rejects {fmtKg(y.rejects)} · Recorded loss {fmtKg(y.loss)}.</p>
              </Panel>
            )}
            {trace && runs.length > 0 && (
              <ChartGrid>
                <StackBars title="Each stage pass — where its input went" caption="kg per run in route order" rowHeader="Stage pass" segs={MASS_SEGS} rows={massRows(runs, (r) => `${stageName(r.stage)}${r.pass > 1 ? ` ${r.pass}` : ''}${r.inputLotId !== root && runs.filter((x) => x.stage === r.stage && x.pass === r.pass).length > 1 ? ` · ${r.inputLotId.split('/').pop()}` : ''}`)} />
                <RunTimeline title="Stage timing — planned vs actual" caption="Holds and lateness per pass (e.g. drying weather hold)" runs={runs} now={now} labelOf={(r) => `${stageName(r.stage)}${r.pass > 1 ? ` ${r.pass}` : ''} · ${r.inputLotId.split('/').pop()}`} />
              </ChartGrid>
            )}
          </>
        )}

        {tab === 'tree' && (
          <div className="rt-trace-compact rt-tabpanel">
            {trace && tree && out ? <GenealogyTree title={`${root} — genealogy`} caption="Each box is a child lot; the bar shows what is still physically there (parents are history, not extra stock)" root={tree} scale={out.expected} /> : <p className="rt-empty">No lot selected.</p>}
          </div>
        )}

        {tab === 'cost' && (
          <div className="rt-split2">
            <Panel title="Husk & Churi balance" meta="All locations">
            <Table
              rows={byproductReconciliation(s)}
              rowKey={(r) => r.type}
              cols={[
                { key: 't', label: 'Type', render: (r) => r.type },
                { key: 'o', label: 'Opening', num: true, render: (r) => fmtKg(r.opening) },
                { key: 'g', label: '+ Generated', num: true, render: (r) => fmtKg(r.generation) },
                { key: 'i', label: '− Internal use', num: true, render: (r) => fmtKg(r.internal) },
                { key: 'e', label: '− External', num: true, render: (r) => fmtKg(r.external) },
                { key: 'a', label: '± Adjust/dispose', num: true, render: (r) => fmtKg(r.adjust - r.disposal) },
                { key: 'c', label: 'Closing', num: true, render: (r) => fmtKg(r.closing) },
                { key: 'ok', label: 'Equation', render: (r) => <Status s={r.reconciled ? 'reconciled' : 'mismatch'} /> },
              ]}
            />
            </Panel>
            <Panel title={`Provisional costing · ${root}`} meta="Provisional — not the books (Tally is the record)">
              {!canCost ? (
                <InlineAlert tone="info" title="Restricted">Costing and margin are visible to Owner and Accounts only.</InlineAlert>
              ) : (
                <div className="rt-stack">
                  <Table
                    rows={[
                      { k: 'Raw material (accepted kg × purchase rate − quality deduction)', v: rawCost },
                      { k: `Oil addition (demo ₹${DEMO.oilCostRupeesPerKg}/kg)`, v: oilCost },
                      { k: `Packaging (${sum(packRuns.map((r) => r.packing?.bags ?? 0))} bags × demo ₹${DEMO.bagCostRupees})`, v: bagCost },
                      { k: freightPending ? 'Freight — provisional, freight bill pending (rate card estimate)' : 'Freight (matched bills)', v: freight },
                      { k: 'Total cost', v: totalCost },
                    ]}
                    rowKey={(r) => r.k}
                    rowClass={(r) => (r.k === 'Total cost' ? 'is-total' : undefined)}
                    cols={[
                      { key: 'k', label: 'Component', render: (r) => r.k },
                      { key: 'v', label: 'Amount', num: true, render: (r) => fmtINR(r.v, true) },
                    ]}
                  />
                  <KpiRow>
                    <Kpi label="Cost per saleable kg" value={saleable ? fmtINR(costPerKg) : '—'} note={`over ${fmtKg(saleable)} packed`} />
                    <Kpi label="Sales value dispatched" value={fmtINR(sales, true)} note={`${fmtKg(dispatchedKg)} at order rate snapshots`} />
                    <Kpi label="Margin on dispatched (provisional)" value={dispatchedKg ? fmtINR(sales - Math.round((costPerKg * dispatchedKg) / 1000), true) : '—'} tone="info" note={freightPending ? 'freight pending' : 'labour/overhead excluded'} />
                  </KpiRow>
                </div>
              )}
            </Panel>
          </div>
        )}

        {tab === 'perf' && (
          <>
            <div className="rt-split2">
              <Panel title="Distributor performance" meta="Within your scope">
                <Table
                  rows={distPerf}
                  rowKey={(r) => r.id}
                  empty="No orders in your scope."
                  cols={[
                    { key: 'd', label: 'Distributor', render: (r) => `${r.id} ${r.name}` },
                    { key: 'o', label: 'Factory orders', num: true, render: (r) => r.orders },
                    { key: 'q', label: 'Ordered', num: true, render: (r) => fmtKg(r.ordered) },
                    { key: 'r', label: 'Received', num: true, render: (r) => fmtKg(r.received) },
                    { key: 'ro', label: 'Retail delivered', num: true, render: (r) => fmtKg(r.retailDelivered) },
                    { key: 'v', label: 'Retail value', num: true, render: (r) => fmtINR(r.value, true) },
                  ]}
                />
              </Panel>
              <Panel title="Salesman performance" meta="Orders, deliveries, collections (status only)">
                <Table
                  rows={salesmen.map((id) => {
                    const os = s.orders.filter((o) => o.salesmanId === id);
                    const delivered = sum(os.flatMap((o) => o.lines.map((l) => lineBalance(s, o, l).delivered)));
                    const cols = s.collections.filter((c) => c.recordedBy === id);
                    return { id, orders: os.length, offline: os.filter((o) => o.source === 'offline').length, delivered, value: sum(os.flatMap((o) => o.lines.map((l) => valueOf(lineBalance(s, o, l).delivered, l.ratePerKg)))), col: cols.length, confirmed: cols.filter((c) => c.status === 'confirmed').length, complaints: s.complaints.filter((c) => c.createdBy === id).length };
                  })}
                  rowKey={(r) => r.id}
                  empty="No salesman orders in your scope."
                  cols={[
                    { key: 'n', label: 'Salesman', render: (r) => r.id.replace('u_', '') },
                    { key: 'o', label: 'Orders (offline)', num: true, render: (r) => `${r.orders} (${r.offline})` },
                    { key: 'd', label: 'Delivered', num: true, render: (r) => fmtKg(r.delivered) },
                    { key: 'v', label: 'Value', num: true, render: (r) => fmtINR(r.value, true) },
                    { key: 'c', label: 'Collections confirmed', num: true, render: (r) => `${r.confirmed}/${r.col}` },
                    { key: 'x', label: 'Complaints', num: true, render: (r) => r.complaints },
                  ]}
                />
              </Panel>
            </div>
            <Details summary="Supplier comparison (quality and delivery kept separate from bill status)">
              <Table
                rows={suppliers}
                rowKey={(r) => r.id}
                cols={[
                  { key: 'n', label: 'Supplier', render: (r) => r.name },
                  { key: 'p', label: 'Purchases', num: true, render: (r) => r.purchases },
                  { key: 'a', label: 'Accepted', num: true, render: (r) => fmtKg(r.accepted) },
                  { key: 'r', label: 'Rejected', num: true, render: (r) => fmtKg(r.rejected) },
                  { key: 'o', label: 'Open balance', num: true, render: (r) => fmtKg(r.open) },
                  { key: 'm', label: 'Avg moisture', num: true, render: (r) => `${r.moisture.toFixed(1)}%` },
                  { key: 'd', label: 'Quality deduction', num: true, render: (r) => fmtINR(r.deduction) },
                  { key: 'b', label: 'Bill status (financial)', render: (r) => r.bills.map((b, i) => <Status key={i} s={b} />) },
                ]}
              />
            </Details>
          </>
        )}
      </PageTabs>
      <ImplNote>Costing and reports (M14): closed-boundary lot accounting (§18 network equation), FR-078 yield denominators, BR-017 by-product equation, FR-079 provisional costing (OQ-14 demo inputs in config.ts), FR-081 performance by scope, FR-117 supplier comparison. CSV export uses the same rows as the screen. Lot selector filtered by canReadLot (scope.ts).</ImplNote>
    </RPage>
  );
}
