import { InlineAlert } from '../../components/primitives/feedback';
import { DEMO } from '../../domain/rentio/config';
import type { StockRow } from '../../domain/rentio/engine';
import { issue, outstanding, placeHold, receive, transferStock } from '../../domain/rentio/ops';
import { readScope, scopedHandovers, scopedStockRows } from '../../domain/rentio/scope';
import { fmtKg, kg, sum } from '../../domain/rentio/units';
import { fmtLotQty } from '../../domain/rentio/views';
import { useAct, useR } from '../store';
import { Details, FormButton, ImplNote, LotLink, Panel, Qty, RPage, Reason, Status, Table, Who, fmtDay, fmtTime, num, str, useCan, useFocusId } from '../ui';
import { Condition } from './Inventory';
import { RepackPanel } from './Repack';
import { GodownFlow, GodownStackMap } from './_graphA';
import { PageTabs, usePageTab } from './_uxA';
import { wsBase } from '../../lib/routes';

const GODOWNS = ['R1', 'F1', 'BYP', 'STORES', 'QUAR'];
const STACKS = ['F1-S01', 'F1-S02', 'F1-S03', 'F1-S04', 'F1-S05', 'F1-S06'];
const TABS = ['stacks', 'flow', 'repack', 'fumigation'] as const;
type Tab = (typeof TABS)[number];

export default function Godowns() {
  const { s, db, now, actor } = useR();
  const run = useAct();
  const can = useCan();
  const focus = useFocusId();
  const rows = scopedStockRows(s, actor, now);
  const sc = readScope(actor);
  const locRec = (id: string) => db.records.locations?.find((l) => l.id === id);
  const capacity = (id: string) => kg(Number(locRec(id)?.capacityKg ?? 0));
  const inGodown = (g: string) => rows.filter((r) => r.loc === g || r.location?.godown === g);
  const usedAt = (loc: string) => sum(rows.filter((r) => r.loc === loc && r.lot.unit !== 'bag').map((r) => r.qty));
  const godownReason = can('godown.operate', 'operate the godown');
  const holdReason = can('location.hold', 'place a location hold');
  const pendingF1 = scopedHandovers(s, actor).filter((h) => h.toStage === 'F1' && outstanding(h) > 0);
  const stackRows = rows.filter((r) => r.location?.godown === 'F1' || r.loc === 'F1');
  const raw = inGodown('R1');
  const other = [...inGodown('BYP'), ...inGodown('STORES'), ...inGodown('QUAR')];
  const stackSummary = STACKS.map((st) => {
    const here = rows.filter((r) => r.loc === st);
    const used = usedAt(st);
    const cap = capacity(st);
    return {
      id: st,
      label: String(locRec(st)?.label ?? st),
      used,
      cap,
      bags: sum(here.filter((r) => r.lot.bagSize).map((r) => Math.floor(r.qty / r.lot.bagSize!))),
      grades: [...new Set(here.map((r) => r.lot.grade).filter(Boolean))].join(', '),
      lots: here.map((r) => r.lotId),
      held: here.filter((r) => r.held),
      reserved: sum(here.map((r) => r.reserved)),
      available: sum(here.map((r) => r.available)),
      expiry: here.map((r) => r.lot.expiry).filter(Boolean).sort()[0],
      locHold: s.holds.find((h) => h.status === 'active' && h.scope === 'location' && h.target === st),
    };
  });
  const f1Total = sum(stackRows.filter((r) => r.lot.unit !== 'bag').map((r) => r.qty));
  const stackSum = sum(stackSummary.map((x) => x.used)) + usedAt('F1');
  // focus ids from links: location ids, lot ids (stack/raw rows) or F1 put-away handover ids
  const lotFocus = (list: StockRow[]) => (focus ? list.find((r) => r.lotId === focus || `${r.lotId}|${r.loc}` === focus) : undefined);
  const known = !focus || (s.repacks ?? []).some((x) => x.id === focus) || GODOWNS.includes(focus) || STACKS.includes(focus) || rows.some((r) => r.lotId === focus) || pendingF1.some((h) => h.id === focus) || (db.records.locations ?? []).some((l) => l.id === focus);
  const rowKey = (r: StockRow) => `${r.lotId}|${r.loc}`;
  const fumLocs = (db.records.locations ?? []).filter((l) => l.kind !== 'stack');
  const fumDue = (l: (typeof fumLocs)[number]) => (l.lastFumigated ? Date.parse(String(l.lastFumigated)) + DEMO.fumigationIntervalDays * 86_400_000 : undefined);
  const fumOverdue = fumLocs.filter((l) => (fumDue(l) ?? Infinity) < Date.parse(now));
  const issuable = raw.filter((r) => r.lot.nextStage === 'CLEAN');
  const repacksPending = (s.repacks ?? []).filter((x) => x.status === 'pending_qc').length;
  // a ?focus= link opens the tab that holds the record (repack, put-away, raw lot, overdue fumigation, stack/lot)
  const focusTab: Tab | undefined = !focus
    ? undefined
    : (s.repacks ?? []).some((x) => x.id === focus)
      ? 'repack'
      : pendingF1.some((h) => h.id === focus) || focus === 'R1' || lotFocus(raw)
        ? 'flow'
        : fumOverdue.some((l) => l.id === focus) || (fumLocs.some((l) => l.id === focus) && !GODOWNS.includes(focus))
          ? 'fumigation'
          : 'stacks';
  const [tab, setTab] = usePageTab<Tab>(TABS, 'stacks', focusTab);
  const graphProps = { s, rows, handovers: scopedHandovers(s, actor), base: wsBase(db.session.workspaceId), stacks: STACKS, godowns: GODOWNS, capacity, labelOf: (id: string) => String(locRec(id)?.label ?? id), focus: focus && (STACKS.includes(focus) || GODOWNS.includes(focus)) ? focus : undefined };

  const lotCols = [
    { key: 'lot', label: 'Lot', render: (r: StockRow) => <LotLink id={r.lotId} /> },
    { key: 'loc', label: 'Stack', render: (r: StockRow) => r.location?.label ?? r.loc },
    { key: 'g', label: 'Grade', render: (r: StockRow) => r.lot.grade ?? r.lot.material },
    { key: 'p', label: 'Bags · kg', num: true, render: (r: StockRow) => (<>{r.lot.bagSize ? `${Math.floor(r.qty / r.lot.bagSize)} bags · ` : ''}{fmtLotQty(r.lot, r.qty)}</>) },
    { key: 'cond', label: 'Condition', render: (r: StockRow) => <Condition r={r} /> },
    { key: 'av', label: 'Available to sell', num: true, render: (r: StockRow) => (r.sellable ? <Qty g={r.available} strong /> : '—') },
    { key: 'exp', label: 'Best before', render: (r: StockRow) => r.lot.expiry ?? '—' },
  ];

  return (
    <RPage
      title="Godowns & stacks"
      description="Where stock physically sits: godowns, stacks, capacity and lots."
      actions={
        <div className="rt-headrow">
          <p className="rt-intro">Showing: {sc.label}.</p>
          <div className="rt-row rt-headrow-actions">
            <FormButton
              label="Move between stacks"
              disabledReason={godownReason}
              title="Move bags between stacks"
              submitLabel="Move"
              note="Only unreserved quantity can move; the destination capacity is checked."
              fields={[
                { key: 'pos', label: 'From', type: 'select', required: true, options: stackRows.filter((r) => r.qty - r.reserved > 0).map((r) => ({ value: `${r.lotId}@${r.loc}`, label: `${r.lotId} · ${r.lot.grade ?? r.lot.material} · ${r.location?.label ?? r.loc} — ${fmtKg(r.qty - r.reserved)} unreserved` })) },
                { key: 'to', label: 'To stack', type: 'select', required: true, options: STACKS.map((x) => ({ value: x, label: `${locRec(x)?.label ?? x} — free ${fmtKg(Math.max(0, capacity(x) - usedAt(x)))}` })) },
                { key: 'kg', label: 'Quantity', type: 'number', unit: 'kg', required: true },
              ]}
              onSubmit={(v, key) => {
                const [lotId, from] = str(v.pos).split('@');
                return run('Stack transfer', (ctx) => transferStock(ctx, { lotId, from, to: str(v.to), kg: num(v.kg) }), { key });
              }}
            />
            <FormButton
              label="Place location hold"
              disabledReason={holdReason}
              title="Treatment / pest hold on a location"
              submitLabel="Place hold"
              note="Only stock in this location is blocked; other stacks stay usable. QC releases it."
              fields={[
                { key: 'target', label: 'Location', type: 'select', required: true, options: [...GODOWNS, ...STACKS].map((x) => ({ value: x, label: String(locRec(x)?.label ?? x) })) },
                { key: 'kind', label: 'Hold type', type: 'select', required: true, options: [{ value: 'treatment', label: 'Treatment / fumigation' }, { value: 'pest', label: 'Pest incident' }, { value: 'other', label: 'Other restriction' }] },
                { key: 'reason', label: 'Reason', type: 'text', required: true },
              ]}
              initial={{ kind: 'treatment' }}
              onSubmit={(v, key) => run('Place location hold', (ctx) => placeHold(ctx, { scope: 'location', target: str(v.target), kind: str(v.kind) as 'treatment', reason: str(v.reason) }), { key, success: (h) => `Hold ${h.id} placed on ${h.target}` })}
            />
          </div>
        </div>
      }
    >
      {!known && <InlineAlert tone="warning">That record is not in your area or no longer open.</InlineAlert>}
      <PageTabs
        label="Godown sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'stacks', label: 'Stacks' },
          { id: 'flow', label: 'Put-away & issue', count: pendingF1.length + issuable.length },
          { id: 'repack', label: 'Repack', count: repacksPending },
          { id: 'fumigation', label: 'Fumigation', count: fumOverdue.length },
        ]}
      >
        {tab === 'stacks' && (
          <>
            <GodownStackMap {...graphProps} />
            <Details summary={`F1 stacks — capacity, bags and best before · ${stackSum === f1Total ? `F1 total ${fmtKg(f1Total)} = sum of stacks ✓` : `F1 total ${fmtKg(f1Total)} ≠ stacks ${fmtKg(stackSum)}`}`} open={!!focus && STACKS.includes(focus)}>
              <Table
                cols={[
                  { key: 's', label: 'Stack', render: (x) => x.label },
                  { key: 'c', label: 'Used / capacity', num: true, render: (x) => `${fmtKg(x.used)} / ${fmtKg(x.cap)}` },
                  { key: 'f', label: 'Free', num: true, render: (x) => fmtKg(Math.max(0, x.cap - x.used)) },
                  { key: 'b', label: 'Bags', num: true, render: (x) => x.bags || '—' },
                  { key: 'g', label: 'Grade', render: (x) => x.grades || '—' },
                  { key: 'cond', label: 'Condition', render: (x) => (x.locHold ? <Reason tone="warning" text={`${x.locHold.kind} hold: ${x.locHold.reason}`} /> : x.held.length ? <Reason tone="warning" text={x.held[0].holds[0]} /> : x.used ? 'Good' : 'Empty') },
                  { key: 'a', label: 'Available to sell', num: true, render: (x) => (x.used ? <Qty g={x.available} strong /> : '—') },
                  { key: 'e', label: 'Earliest best before', render: (x) => x.expiry ?? '—' },
                ]}
                rows={stackSummary}
                rowKey={(x) => x.id}
                rowClass={(x) => (x.locHold || x.held.length ? 'is-held' : undefined)}
                focus={focus && STACKS.includes(focus) ? focus : undefined}
              />
            </Details>
            <Details summary={`Lots in F1 (${stackRows.length})`} open={!!lotFocus(stackRows)}>
              <Table cols={lotCols} rows={stackRows} rowKey={rowKey} rowClass={(r) => (r.held || r.expired ? 'is-held' : undefined)} focus={lotFocus(stackRows) ? rowKey(lotFocus(stackRows)!) : undefined} empty="F1 is empty." />
            </Details>
            <Details summary={`By-products, stores and quarantine (${other.length})`} open={!!lotFocus(other) || focus === 'BYP' || focus === 'QUAR'}>
              <Table cols={lotCols} rows={other} rowKey={rowKey} rowClass={(r) => (r.held ? 'is-held' : undefined)} focus={lotFocus(other) ? rowKey(lotFocus(other)!) : undefined} empty="Empty." />
            </Details>
          </>
        )}
        {tab === 'flow' && (
          <>
            <GodownFlow {...graphProps} />
            <div className="rt-split2">
              <Panel title="Waiting to be put away in F1" meta="Packed batches from packing">
                <Table
                  cols={[
                    { key: 'lot', label: 'Lot', render: (h) => <LotLink id={h.lotId} /> },
                    { key: 'g', label: 'Grade', render: (h) => s.lots[h.lotId]?.grade ?? '—' },
                    { key: 'by', label: 'Issued by', render: (h) => (<><Who id={h.issuedBy} /> · {fmtTime(h.issuedAt)}</>) },
                    { key: 'o', label: 'Outstanding', num: true, render: (h) => <Qty g={outstanding(h)} strong /> },
                    {
                      key: 'act',
                      label: '',
                      render: (h) => {
                        const out = outstanding(h);
                        const bag = s.lots[h.lotId]?.bagSize ?? 1;
                        let left = out;
                        const initial: Record<string, string> = {};
                        for (const st of STACKS) {
                          const free = Math.max(0, capacity(st) - usedAt(st));
                          const take = Math.min(left, free - (free % bag));
                          if (take > 0) {
                            initial[st] = String(take / 1000);
                            left -= take;
                          }
                        }
                        return (
                          <FormButton
                            label="Put away"
                            variant="primary"
                            disabledReason={godownReason}
                            title={`Put away ${h.lotId}`}
                            submitLabel="Confirm put-away"
                            note="Stacks are suggested from free space — enter what was physically placed. Anything not placed stays awaiting receipt."
                            initial={initial}
                            fields={STACKS.map((st) => ({ key: st, label: `${locRec(st)?.label ?? st} — free ${fmtKg(Math.max(0, capacity(st) - usedAt(st)))}`, type: 'number' as const, unit: 'kg' }))}
                            onSubmit={(v, key) => {
                              const stacks = STACKS.filter((st) => num(v[st]) > 0).map((st) => ({ loc: st, kg: num(v[st]) }));
                              if (!stacks.length) return { ok: false, error: 'Enter the quantity placed in at least one stack' };
                              return run(`Put away ${h.lotId}`, (ctx) => receive(ctx, { handoverId: h.id, stacks }), { key, success: (r) => `Received ${fmtKg(r.received)}${r.residual ? `; ${fmtKg(r.residual)} still awaiting receipt` : ''}` });
                            }}
                          >
                            {(v) => {
                              const now = kg(sum(STACKS.map((st) => num(v[st]))));
                              const rem = out - now;
                              return (
                                <div className="rt-preview" aria-live="polite">
                                  <div><span>Originally issued</span><strong>{fmtKg(h.qty)}</strong></div>
                                  <div><span>Already received</span><strong>{fmtKg(h.received)}</strong></div>
                                  <div><span>Outstanding</span><strong>{fmtKg(out)}</strong></div>
                                  <div className="is-key"><span>Receive now</span><strong>{fmtKg(now)}{bag > 1 ? ` · ${Math.floor(now / bag)} bags` : ''}</strong></div>
                                  <div><span>Remaining after this</span><strong className={rem < 0 ? 'tone-text-danger' : undefined}>{rem < 0 ? `${fmtKg(-rem)} too much` : fmtKg(rem)}</strong></div>
                                </div>
                              );
                            }}
                          </FormButton>
                        );
                      },
                    },
                  ]}
                  rows={pendingF1}
                  rowKey={(h) => h.id}
                  focus={focus && pendingF1.some((h) => h.id === focus) ? focus : undefined}
                  empty="Nothing waiting."
                />
              </Panel>
              <Panel title="Raw Godown R1" meta="Accepted raw toor ready for cleaning">
                <Table
                  cols={[
                    { key: 'lot', label: 'Lot', render: (r: StockRow) => <LotLink id={r.lotId} /> },
                    { key: 'lbl', label: 'Material', render: (r: StockRow) => r.lot.label },
                    { key: 'p', label: 'Quantity', num: true, render: (r: StockRow) => <Qty g={r.qty} strong /> },
                    { key: 'c', label: 'Condition', render: (r: StockRow) => <Condition r={r} /> },
                    {
                      key: 'act',
                      label: '',
                      render: (r: StockRow) =>
                        r.lot.nextStage === 'CLEAN' ? (
                          <FormButton
                            label="Issue to cleaning"
                            variant="primary"
                            disabledReason={godownReason ?? (r.held ? 'Stock is on hold' : undefined)}
                            title={`Issue ${r.lotId} to cleaning`}
                            submitLabel="Issue"
                            note="The cleaning owner confirms receipt; until then it is in handover custody."
                            initial={{ kg: String(r.qty / 1000) }}
                            fields={[{ key: 'kg', label: 'Quantity to issue', type: 'number', unit: 'kg', required: true }]}
                            onSubmit={(v, key) => run(`Issue ${r.lotId} to cleaning`, (ctx) => issue(ctx, { lotId: r.lotId, fromLoc: 'R1', qtyKg: num(v.kg), toStage: 'CLEAN' }), { key, success: (h) => `Issued — waiting for cleaning to receive (${h.id})` })}
                          />
                        ) : (
                          '—'
                        ),
                    },
                  ]}
                  rows={raw}
                  rowKey={rowKey}
                  focus={lotFocus(raw) ? rowKey(lotFocus(raw)!) : undefined}
                  empty="Raw godown is empty."
                />
              </Panel>
            </div>
          </>
        )}
        {tab === 'repack' && <RepackPanel rows={rows} focus={focus} />}
        {tab === 'fumigation' && (
          <Panel title="Fumigation schedule" meta={fumOverdue.length ? `${fumOverdue.length} overdue · ${DEMO.fumigationIntervalDays}-day interval (demo)` : `${DEMO.fumigationIntervalDays}-day interval (demo)`}>
            <Table
              cols={[
                { key: 'l', label: 'Location', render: (l) => String(l.label) },
                { key: 'last', label: 'Last fumigation', render: (l) => (l.lastFumigated ? fmtDay(`${l.lastFumigated}T00:00:00+05:30`) : '—') },
                {
                  key: 'due',
                  label: 'Due',
                  render: (l) => {
                    if (!l.lastFumigated) return 'not scheduled';
                    const due = Date.parse(String(l.lastFumigated)) + DEMO.fumigationIntervalDays * 86_400_000;
                    return due < Date.parse(now) ? <><Status s="overdue" /> {fmtDay(new Date(due).toISOString())}</> : fmtDay(new Date(due).toISOString());
                  },
                },
                { key: 'h', label: 'Location hold', render: (l) => s.holds.filter((h) => h.status === 'active' && h.scope === 'location' && h.target === l.id).map((h) => h.reason).join(', ') || '—' },
                { key: 'o', label: 'Responsible', render: (l) => String(l.owner ?? '—') },
              ]}
              rows={fumLocs}
              rowKey={(l) => l.id}
              focus={focus}
            />
          </Panel>
        )}
      </PageTabs>

      <ImplNote>
        Factory godown stock (M5). Godown total = sum of stack positions (BR-027, FR-099); capacity from the Godowns & stacks master is enforced at put-away/transfer (FR-028, BR-013); fumigation interval {DEMO.fumigationIntervalDays} days is a demo value (FR-029, OQ-16); location holds block only the held location (FR-100, EC-53). Visibility follows scope.ts.
      </ImplNote>
    </RPage>
  );
}
