// import { useState } from 'react'; // for By Payer (commented out)
import { Banknote, HandCoins, Percent, Receipt, Wallet } from 'lucide-react';
import { formatDate } from '../../lib/dates';
import { formatMoney, formatMoneyWhole } from '../../lib/format';
import { recordPeekPath, resourcePath } from '../../lib/routes';
import type { Actor } from '../../services/authz';
import { activeMasterValues } from '../../services/registry';
import { recordTitle } from '../../services/runtime';
import { AmountBars, CardEmpty, DashCard, StatGrid, ShareBar, StatCard, TrendChart, TrendLegend, ViewAllLink, compact, type AmountRow, type TrendSeries } from '../../components/dashboard';
import { daysBetween, inRange, sum, type DashData } from './model';

const TREND: TrendSeries[] = [
  { key: 'billed', label: 'Billed' },
  { key: 'collected', label: 'Collected' },
];
const OPEN = ['issued', 'partially_paid'];
const money = (n: number) => `$${compact(n)}`;

/** Billing: billed, collected, outstanding and overdue; billed-vs-collected trend; invoice status; receivables age; top balances (By Payer commented out). */
export function BillingTab({ d, actor }: { d: DashData; actor: Actor }) {
  const ws = actor.workspaceId;
  const { invoices, today } = d;
  // By Payer is commented out (owner, 2026-11-24) — restore with the card below
  // const [payersOpen, setPayersOpen] = useState(false);

  const inPeriod = invoices.filter((i) => inRange(i, 'issueDate', d.from, d.to));
  const billed = sum(inPeriod, 'total');
  const collected = sum(inPeriod, 'amountPaid');
  const rate = billed ? Math.round((collected / billed) * 100) : 0;
  const open = invoices.filter((i) => OPEN.includes(String(i.status)));
  const outstanding = sum(open, 'balance');
  const overdue = open.filter((i) => String(i.dueDate) < today);
  const overdueAmount = sum(overdue, 'balance');

  // Billed vs collected per day (week for a quarter), by issue date
  const own = d.buckets.map((b) => {
    const rows = invoices.filter((i) => inRange(i, 'issueDate', b.start, b.end));
    return { billed: sum(rows, 'total'), collected: sum(rows, 'amountPaid'), count: rows.length };
  });
  const trend = d.buckets.map((b, i) => ({ key: b.key, label: b.label, billed: Math.round(own[i].billed), collected: Math.round(own[i].collected) }));

  // Ordered from settled to open, coloured by meaning (paid green · partly paid amber · issued neutral mark)
  const STATUS_TONE: Record<string, string> = {
    paid: 'color-mix(in srgb, var(--c-dot-success) 55%, var(--s-panel))',
    partially_paid: 'color-mix(in srgb, var(--c-dot-warning) 50%, var(--s-panel))',
    issued: 'color-mix(in srgb, var(--c-mark-1) 60%, var(--s-panel))',
    written_off: 'color-mix(in srgb, var(--s-text) 22%, var(--s-panel))',
  };
  const statuses = ['paid', 'partially_paid', 'issued', 'written_off']
    .map((k) => activeMasterValues('invoiceStatus').find((m) => m.key === k))
    .filter((m): m is NonNullable<typeof m> => !!m)
    .map((m) => ({ key: m.key, label: m.label, value: inPeriod.filter((i) => i.status === m.key).length, color: STATUS_TONE[m.key] }));

  // Receivables age: open balances by days past due (not yet due first)
  const ageOf = (i: (typeof open)[number]) => daysBetween(String(i.dueDate), today);
  // Receivables Age is commented out (owner, 2026-11-24) — restore with the card below
  // const bucket = (lo: number, hi: number) => sum(open.filter((i) => ageOf(i) >= lo && ageOf(i) <= hi), 'balance');
  // const aging = [
  //   { key: 'current', label: 'Not due', value: Math.round(bucket(-10_000, 0)) },
  //   { key: '1-30', label: '1–30 days', value: Math.round(bucket(1, 30)) },
  //   { key: '31-60', label: '31–60 days', value: Math.round(bucket(31, 60)) },
  //   { key: '61-90', label: '61–90 days', value: Math.round(bucket(61, 90)), tone: 'warning' as const },
  //   { key: '90+', label: 'Over 90', value: Math.round(bucket(91, 100_000)), tone: 'danger' as const },
  // ];

  // const payers = activeMasterValues('payer').map((p) => {
  //   const rows = inPeriod.filter((i) => i.payer === p.key);
  //   return { key: p.key, label: p.label, first: Math.round(sum(rows, 'amountPaid')), second: Math.round(sum(rows, 'balance')) };
  // }).filter((p) => p.first + p.second > 0);

  const top: AmountRow[] = [...overdue]
    .sort((a, b) => Number(b.balance) - Number(a.balance))
    .slice(0, 5)
    .map((i) => ({ id: i.id, title: recordTitle('patients', i.patientId, actor), ref: i.id, amount: Number(i.balance), days: ageOf(i), to: recordPeekPath(ws, 'invoices', i.id) }));

  return (
    <>
      <StatGrid>
        <StatCard label="Billed" icon={Receipt} info={`Invoice totals issued · ${d.period.toLowerCase()} (drafts and void left out).`} value={formatMoneyWhole(billed)} note={{ text: `${inPeriod.length} invoices` }} to={resourcePath(ws, 'invoices', { view: 'v_inv_all' })} />
        <StatCard label="Collected" icon={HandCoins} info="Paid so far on invoices issued in the period." value={formatMoneyWhole(collected)} note={{ text: 'Of invoices in this period' }} />
        <StatCard label="Collection Rate" icon={Percent} info="Collected ÷ billed for invoices issued in the period." value={String(rate)} unit="%" note={rate >= 80 ? { text: 'Healthy', tone: 'success' } : { text: 'Below 80% target', tone: 'warning' }} />
        <StatCard label="Outstanding" icon={Wallet} info="Open balance on issued and partly paid invoices, whenever issued." value={formatMoneyWhole(outstanding)} note={{ text: `${open.length} open invoices` }} to={resourcePath(ws, 'invoices', { view: 'v_inv_open' })} />
        <StatCard label="Overdue" icon={Banknote} info="Open balance past its due date, right now." value={formatMoneyWhole(overdueAmount)} note={overdue.length ? { text: `${overdue.length} invoices past due`, tone: 'danger' } : { text: 'Nothing overdue', tone: 'success' }} to={resourcePath(ws, 'invoices', { view: 'v_inv_overdue' })} />
      </StatGrid>

      <div className="dv-row">
        <DashCard className="is-centered" title="Billed vs Collected" meta={d.bucketDays === 1 ? 'Per day · by issue date' : d.bucketDays === 7 ? 'Per week · by issue date' : 'Per month · by issue date'} action={<TrendLegend series={TREND} />}>
          <TrendChart
            ariaLabel="Amounts billed and collected per day"
            data={trend}
            series={TREND}
            average
            formatValue={money}
            renderTooltip={(i) => (
              <>
                <strong>{d.bucketDays === 1 ? formatDate(trend[i].key) : `${d.bucketDays === 7 ? 'Week' : 'Month'} to ${formatDate(trend[i].key)}`}</strong>
                <span className="dv-tip-row">
                  <span className="dv-dot" style={{ background: 'var(--c-mark-1)' }} aria-hidden />
                  Billed: <strong>{formatMoney(own[i].billed)}</strong>
                </span>
                <span className="dv-tip-row">
                  <span className="dv-dot" style={{ background: 'var(--c-trend-2)' }} aria-hidden />
                  Collected: <strong>{formatMoney(own[i].collected)}</strong>
                </span>
                <span className="dv-tip-row">{own[i].count} invoices issued</span>
              </>
            )}
          />
        </DashCard>
      </div>

      {/* Billing in pairs (owner, 2026-11-24: the full-width overdue list was too large): how late → who owes; invoice status → by payer */}
      <div className="dv-row is-halves">
        {/* Receivables Age — commented out (owner, 2026-11-24); to restore, uncomment it and `aging` above
        <DashCard title="Receivables Age" meta="Open balance by days past due">
          {outstanding ? <ColumnChart ariaLabel="Open balance by days past due" bars={aging} formatValue={money} tooltip={(b) => `${formatMoney(b.value)} ${b.key === 'current' ? 'not due yet' : `${b.label} past due`}`} /> : <CardEmpty>Nothing outstanding</CardEmpty>}
        </DashCard>
        */}
        <DashCard className="is-centered" title="Invoice Status" meta={`${inPeriod.length} issued in this period · settled → open`}>
          {inPeriod.length ? <ShareBar ariaLabel="Invoices by status" slices={statuses} summary={`${Math.round(((statuses.find((x) => x.key === 'paid')?.value ?? 0) / (inPeriod.length || 1)) * 100)}% fully paid · ${(statuses.find((x) => x.key === 'issued')?.value ?? 0) + (statuses.find((x) => x.key === 'partially_paid')?.value ?? 0)} still open`} /> : <CardEmpty>No invoices issued in this period</CardEmpty>}
        </DashCard>
        <DashCard title="Largest Overdue Balances" meta={overdue.length ? `Top ${top.length} of ${overdue.length} overdue` : undefined} action={overdue.length > 5 ? <ViewAllLink to={resourcePath(ws, 'invoices', { view: 'v_inv_overdue' })} /> : undefined}>
          {top.length ? (
            <div className="dv-pad dv-amounts-card">
              <AmountBars rows={top} formatValue={formatMoney} />
              <div className="dv-legend-row">
                <span>
                  <span className="dv-square" style={{ background: 'color-mix(in srgb, var(--c-dot-warning) 38%, var(--s-panel))' }} aria-hidden />
                  Up to 60 days
                </span>
                <span>
                  <span className="dv-square" style={{ background: 'color-mix(in srgb, var(--c-dot-danger) 38%, var(--s-panel))' }} aria-hidden />
                  Over 60 days
                </span>
              </div>
            </div>
          ) : (
            <CardEmpty>Nothing overdue — every open invoice is within terms</CardEmpty>
          )}
        </DashCard>
      </div>

      {/* By Payer — commented out (owner, 2026-11-24); to restore, uncomment it here and payers / payersOpen / imports above
        <DashCard title="By Payer" meta="Paid and still owed" action={<ViewAllToggle expanded={payersOpen} total={payers.length} limit={6} onToggle={() => setPayersOpen((o) => !o)} />}>
          {payers.length ? <SplitBars bars={payers} firstLabel="Paid" secondLabel="Still owed" limit={6} expanded={payersOpen} formatValue={money} /> : <CardEmpty>No invoices issued in this period</CardEmpty>}
        </DashCard>
      */}
    </>
  );
}
