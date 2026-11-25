/**
 * Review round 1 regressions: B1 scope leakage, B2 separate stock dimensions, B3 honest ETA and a
 * refreshing clock, B4 exact-source routing, B5 manual receipt, and the controls added this round.
 */
import { act as rtlAct, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { ToastProvider } from '../components/primitives/feedback';
import { useDomain } from '../domain/active';
import { type RActor, ractor } from '../domain/rentio/access';
import * as C from '../domain/rentio/commerce';
import { disposeSample, lockPeriod, reopenPeriod, takeSample, auditRows } from '../domain/rentio/control';
import { buildRentio } from '../domain/rentio/domain';
import { type Ctx, execute, RError, stockRows } from '../domain/rentio/engine';
import * as O from '../domain/rentio/ops';
import { canReadLot, canReadLoc, readScope, scopedMovements, scopedOrders, scopedShipments, scopedStockRows } from '../domain/rentio/scope';
import { kg } from '../domain/rentio/units';
import { alerts, alertsFor, lotAccounting, myWork, stockSummary } from '../domain/rentio/views';
import { rentioDomain } from '../domain/rentio/domain';
import { CLOCK_TICK_MS, refreshClock } from '../rentio/clock';
import { RENTIO_PAGES } from '../rentio/pages';
import { LotDrawer } from '../rentio/ui';
import { __setDb, createDb, getDb } from '../services/db';
import { switchSession } from '../services/settings';
import type { Db } from '../services/types';

useDomain(rentioDomain);

const NOW = new Date();
const fresh = (dataset: 'start' | 'completed' | 'demo') => {
  const r = buildRentio(NOW, dataset);
  return { records: r.records, audit: [], session: { userId: 'u_owner', workspaceId: 'plant1' }, ...r.extra } as unknown as Db;
};
const run = <T,>(db: Db, user: string, fn: (ctx: Ctx) => T, at?: string, key?: string) => execute(db, ractor(user), { label: 'test', at, key }, fn);
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof RError ? e.code : String(e);
  }
  return 'ok';
};
const ROLES_SCOPED = ['u_dinesh', 'u_farah', 'u_rohit', 'u_pooja', 'u_arjun', 'u_suresh', 'u_anil', 'u_ravi', 'u_fhead'];

afterEach(() => {
  vi.useRealTimers();
});

describe('B1 — read scope (no cross-distributor or out-of-area reads)', () => {
  const db = fresh('demo');
  const s = db.rentio!;
  const now = NOW.toISOString();

  it('D01 sees only its own distributor stock — not D02, not the factory', () => {
    const a = ractor('u_dinesh');
    const rows = scopedStockRows(s, a, now);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.location.distributorId === 'D01' || shipTo(s, r.loc) === 'D01')).toBe(true);
    expect(rows.some((r) => r.loc.startsWith('DIST:D02'))).toBe(false);
    expect(rows.some((r) => r.loc === 'F1-S01' || r.loc === 'R1')).toBe(false);
    for (const lot of ['MIG-0002', 'MIG-0003', 'MIG-0004', 'RT-002', 'MIG-0001/B1-PK']) expect(canReadLot(s, a, lot)).toBe(false);
    expect(scopedShipments(s, a).some((x) => x.toDistributor === 'D02')).toBe(false);
    expect(scopedOrders(s, a).some((o) => o.partyId === 'D02' || o.distributorId === 'D02')).toBe(false);
    expect(scopedMovements(s, a).some((m) => m.from?.startsWith('DIST:D02') || m.to?.startsWith('DIST:D02'))).toBe(false);
    const al = alertsFor(db, a, now);
    expect(al.some((x) => x.scope.distributorId && x.scope.distributorId !== 'D01')).toBe(false);
    expect(al.some((x) => /D02|Konkan/.test(x.title + x.detail))).toBe(false);
  });

  it('D02 cannot read D01; salesman only mapped D01–D03; HR, admin and empty scopes see no stock', () => {
    expect(scopedStockRows(s, ractor('u_farah'), now).some((r) => r.loc.startsWith('DIST:D01'))).toBe(false);
    const rohit = scopedStockRows(s, ractor('u_rohit'), now);
    expect(rohit.every((r) => ['D01', 'D02', 'D03'].includes(r.location.distributorId ?? shipTo(s, r.loc) ?? ''))).toBe(true);
    expect(rohit.some((r) => r.loc === 'DIST:D04')).toBe(false);
    for (const u of ['u_pooja', 'u_arjun']) expect(scopedStockRows(s, ractor(u), now)).toEqual([]);
    const noScope: RActor = { ...ractor('u_dinesh'), scope: {} };
    expect(readScope(noScope).label).toBe('No stock visibility');
    expect(scopedStockRows(s, noScope, now)).toEqual([]);
    const noStage: RActor = { ...ractor('u_suresh'), scope: { stages: [] } };
    expect(scopedStockRows(s, noStage, now)).toEqual([]);
  });

  it('stage staff see only their stages; godown and factory head see plant + transit but no distributor stock', () => {
    const anil = scopedStockRows(s, ractor('u_anil'), now);
    expect(anil.every((r) => ['OIL', 'COND', 'DRY'].includes(r.location.stage ?? s.handovers.find((h) => `PEND:${h.id}` === r.loc)?.toStage ?? ''))).toBe(true);
    expect(anil.some((r) => r.loc === 'R1' || r.loc.startsWith('F1'))).toBe(false);
    for (const u of ['u_ravi', 'u_fhead']) {
      const rows = scopedStockRows(s, ractor(u), now);
      expect(rows.some((r) => r.location.kind === 'distributor')).toBe(false);
      expect(rows.some((r) => r.loc === 'R1')).toBe(true);
    }
    expect(canReadLoc(s, ractor('u_owner'), 'DIST:D02')).toBe(true);
  });

  it('the shared lot drawer reveals nothing outside scope', () => {
    __setDb(createDb(NOW, { dataset: 'demo' }));
    switchSession('u_dinesh', 'plant1');
    render(
      <ToastProvider>
        <MemoryRouter>
          <LotDrawer id="MIG-0002" onClose={() => {}} />
        </MemoryRouter>
      </ToastProvider>,
    );
    expect(screen.getByText('Not available')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('750 kg');
  });

  it.each([
    ['u_dinesh', ['stock/inventory', 'stock/godowns', 'stock/holds', 'production/stages', 'finance/reports', 'finance/tally', 'presenter/journey', 'procurement/intake', 'hr/attendance']],
    ['u_rohit', ['stock/inventory', 'stock/godowns', 'finance/reports', 'presenter/journey']],
    ['u_pooja', ['stock/inventory', 'distribution/distributors', 'production/stage', 'dashboard']],
    ['u_suresh', ['stock/inventory', 'distribution/orders', 'production/stages', 'finance/reports']],
  ])('direct URLs are guarded for %s', (user, paths) => {
    __setDb(createDb(NOW, { dataset: 'demo' }));
    switchSession(user, 'plant1');
    for (const p of paths) {
      window.history.pushState({}, '', `/o/rentio/w/plant1/${p}`);
      const r = render(<App />);
      const main = r.container.querySelector('main')!;
      if (p === 'dashboard') expect(main.textContent, p).toMatch(/No stock visibility|Next action|all caught up/);
      else expect(main.textContent, p).toContain('No access to this page');
      r.unmount();
    }
  });

  it('a D02 deep link does not reveal D02 to D01 (cross-route)', () => {
    __setDb(createDb(NOW, { dataset: 'demo' }));
    switchSession('u_dinesh', 'plant1');
    const sh = getDb().rentio!.shipments.find((x) => x.toDistributor === 'D02')!;
    window.history.pushState({}, '', `/o/rentio/w/plant1/distribution/distributors?d=D02&focus=${sh.id}`);
    const r = render(<App />);
    const main = r.container.querySelector('main')!.textContent ?? '';
    expect(main).toContain('not in your area');
    expect(main).not.toContain('Konkan');
    expect(main).not.toContain('475 kg');
    r.unmount();
  });
});

const shipTo = (s: ReturnType<typeof fresh>['rentio'] & object, loc: string) => s.shipments.find((x) => x.transitLoc === loc)?.toDistributor;

describe('B2 — custody, holds, expiry, reservation and readiness are separate', () => {
  const db = fresh('demo');
  const s = db.rentio!;
  const now = NOW.toISOString();
  const rows = stockRows(s, now);

  it('accepted raw is ready to process, not held; WIP and transit are not held', () => {
    const raw = rows.find((r) => r.lotId === 'RT-004' && r.loc === 'R1')!;
    expect(raw.held).toBe(false);
    expect(raw.readyToProcess).toBe(kg(5000));
    expect(raw.sellable).toBe(false);
    expect(raw.available).toBe(0);
    const running = rows.find((r) => r.lotId === 'RT-002' && r.location.kind === 'run')!;
    expect(running.held).toBe(false);
    const transit = rows.filter((r) => r.location.kind === 'transit');
    expect(transit.length).toBeGreaterThan(0);
    expect(transit.every((r) => !r.held && !r.sellable)).toBe(true);
    const sum = stockSummary(s, now);
    expect(sum.raw.held).toBe(0);
    expect(sum.wip.held).toBe(0);
    expect(sum.transit.held).toBe(0);
    expect(sum.raw.readyToProcess).toBeGreaterThanOrEqual(kg(5000));
  });

  it('genuine holds still block and propagate; held-condition custody stays held', () => {
    const child = rows.find((r) => r.lotId === 'MIG-0001/B1-PK')!;
    expect(child.held).toBe(true);
    expect(child.holds[0]).toMatch(/on parent MIG-0001/);
    expect(child.reservedAtRisk).toBe(kg(500));
    expect(child.available).toBe(0);
    expect(rows.find((r) => r.loc === 'QUAR')!.held).toBe(true);
    const so = s.orders.find((o) => o.partyId === 'D02' && o.lines[0].grade === 'B1')!;
    expect(code(() => run(structuredClone(db), 'u_ravi', (ctx) => C.dispatchOrder(ctx, { orderId: so.id, transporterId: 'TR-01', vehicle: 'X', driver: 'Y' })))).toBe('business_rule');
    expect(alerts(db, now).some((a) => a.key.startsWith('risk:') && a.action === 'Reallocate')).toBe(true);
  });

  it('a location treatment hold makes only that stack held; other stacks stay sellable', () => {
    const d = structuredClone(db);
    run(d, 'u_ravi', (ctx) => O.placeHold(ctx, { scope: 'location', target: 'F1-S01', kind: 'treatment', reason: 'Spot fumigation' }));
    const r2 = stockRows(d.rentio!, now);
    expect(r2.filter((r) => r.loc === 'F1-S01').every((r) => r.held)).toBe(true);
    expect(r2.filter((r) => r.loc === 'F1-S02').every((r) => !r.held && r.sellable)).toBe(true);
  });
});

describe('B3 — honest ETA, named revisions and a refreshing clock', () => {
  it('an overdue run has no forecast ("ETA needs update"); lateness keeps growing', () => {
    const db = fresh('demo');
    const r = db.rentio!.runs.find((x) => x.inputLotId === 'RT-002' && x.status === 'running')!;
    const base = Date.parse(r.baselineFinish);
    const before = O.runTiming(r, new Date(base - 60_000).toISOString());
    expect(before.status).toBe('On Track');
    expect(before.forecastFinish).toBe(r.baselineFinish);
    const after = O.runTiming(r, new Date(base + 60_000).toISOString());
    expect(after.status).toBe('Delayed');
    expect(after.forecastFinish).toBeUndefined();
    expect(after.etaSource).toBe('needs_update');
    expect(after.delayMs).toBe(60_000);
    expect(O.runTiming(r, new Date(base + 3_600_000).toISOString()).delayMs).toBe(3_600_000);
  });

  it('a named, reasoned revision becomes the forecast; the baseline never changes; expiry reverts to needs-update', () => {
    const db = fresh('demo');
    const r = db.rentio!.runs.find((x) => x.inputLotId === 'RT-002' && x.status === 'running')!;
    const eta = new Date(Date.now() + 2 * 3_600_000).toISOString();
    expect(code(() => run(db, 'u_prakash', (ctx) => O.reviseEta(ctx, { runId: r.id, eta, reason: 'x' })))).toBe('scope');
    expect(code(() => run(db, 'u_suresh', (ctx) => O.reviseEta(ctx, { runId: r.id, eta, reason: ' ' })))).toBe('validation');
    expect(code(() => run(db, 'u_suresh', (ctx) => O.reviseEta(ctx, { runId: r.id, eta: new Date(Date.now() - 60_000).toISOString(), reason: 'late' })))).toBe('validation');
    run(db, 'u_suresh', (ctx) => O.reviseEta(ctx, { runId: r.id, eta, reason: 'Destoner jammed; 2 h to clear' }));
    const run1 = db.rentio!.runs.find((x) => x.id === r.id)!;
    const t = O.runTiming(run1, new Date().toISOString());
    expect(t.etaSource).toBe('revised');
    expect(t.forecastFinish).toBe(eta);
    expect(t.etaRevision?.by).toBe('u_suresh');
    expect(run1.baselineFinish).toBe(r.baselineFinish);
    expect(O.runTiming(run1, new Date(Date.parse(eta) + 1000).toISOString()).etaSource).toBe('needs_update');
    expect(db.audit.some((x) => x.summary.startsWith('test'))).toBe(true);
  });

  it('timed escalation moves an unresolved item up the chain as time passes', () => {
    const db = fresh('demo');
    const ho = db.rentio!.handovers.find((h) => h.lotId === 'RT-002')!;
    const at = (h: number) => new Date(Date.parse(ho.issuedAt) + h * 3_600_000).toISOString();
    const lvl = (h: number) => alerts(db, at(h)).find((a) => a.key === `ho:${ho.id}`)!;
    expect(lvl(1).escalation).toBe(0);
    expect(lvl(5).escalation).toBe(1);
    expect(lvl(5).escalatedTo).toBe('u_fhead');
    expect(lvl(9).escalation).toBe(2);
    expect(lvl(9).roles).toContain('owner');
  });

  it('an open screen turns On Track → Delayed by itself when the planned finish passes', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date', 'setTimeout', 'clearTimeout', 'queueMicrotask'] });
    const db = createDb(NOW, { dataset: 'demo' });
    __setDb(db);
    const r = db.rentio!.runs.find((x) => x.inputLotId === 'RT-002' && x.status === 'running')!;
    // put the clock 20 s before the planned finish and open the stage screen
    vi.setSystemTime(new Date(Date.parse(r.baselineFinish) - 20_000));
    refreshClock();
    switchSession('u_suresh', 'plant1');
    const Page = RENTIO_PAGES['production/stage'];
    const view = render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/o/rentio/w/plant1/production/stage?stage=CLEAN']}>
          <div id="topbar-title" />
          <Page />
        </MemoryRouter>
      </ToastProvider>,
    );
    const runRow = () => view.container.querySelector('.rt-table tbody tr td[data-label="Status"]')!.textContent;
    expect(runRow()).toContain('On Track');
    // no user action: before the first tick nothing changes; the next shared-clock tick (10 s past plan) flips it
    await rtlAct(async () => {
      vi.advanceTimersByTime(CLOCK_TICK_MS - 1000);
    });
    expect(runRow()).toContain('On Track');
    await rtlAct(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(runRow()).toContain('Delayed');
    expect(view.container.textContent).toContain('ETA needs update');
    view.unmount();
  });
});

describe('B4 — exact source routing', () => {
  it('alert and My Work links carry the source record id', () => {
    const db = fresh('demo');
    const now = new Date().toISOString();
    for (const a of alerts(db, now)) expect(a.link, a.key).toContain(`focus=${encodeURIComponent(a.sourceId)}`);
    const anil = myWork(db, ractor('u_anil'), now);
    expect(anil[0].kind).toBe('receive');
    expect(anil[0].title).toContain('RT-003/G1');
    expect(anil[0].link).toContain(`focus=${anil[0].sourceId}`);
    for (const w of myWork(db, ractor('u_kiran'), now)) expect(w.link).toContain('focus=');
  });

  it('opening an exact-source link highlights that record (handover, order, approval)', () => {
    __setDb(createDb(NOW, { dataset: 'demo' }));
    const s = getDb().rentio!;
    const cases: [string, string, string][] = [
      ['u_fhead', 'production/handovers', s.handovers.find((h) => h.lotId === 'RT-002')!.id],
      ['u_kiran', 'distribution/orders', s.orders.find((o) => o.partyId === 'D02' && o.lines[0].grade === 'B1')!.id],
      ['u_meera', 'home/approvals', s.approvals.find((a) => a.type === 'regrade')!.id],
    ];
    for (const [user, page, id] of cases) {
      switchSession(user, 'plant1');
      window.history.pushState({}, '', `/o/rentio/w/plant1/${page}?focus=${id}`);
      const r = render(<App />);
      const focused = r.container.querySelector('tr.is-focus');
      expect(focused, `${page} ${id}`).not.toBeNull();
      expect(focused!.textContent).toContain(page === 'production/handovers' ? 'RT-002' : page === 'distribution/orders' ? id : 'B2');
      r.unmount();
    }
  });
});

describe('B5 — manual receipt by a stage worker', () => {
  it('shows issued / received / outstanding / receive-now / remaining, keeps input on error, posts once', () => {
    __setDb(createDb(NOW, { dataset: 'demo' }));
    switchSession('u_anil', 'plant1');
    window.history.pushState({}, '', '/o/rentio/w/plant1/home/my-work');
    const r = render(<App />);
    expect(r.container.textContent).toContain('Receive RT-003/G1');
    const next = r.container.querySelector('.rt-next')!;
    fireEvent.click(within(next as HTMLElement).getByRole('button', { name: /Receive/ }));
    const dlg = document.querySelector('.drawer, .dialog') as HTMLElement;
    for (const label of ['Originally issued', 'Already received', 'Outstanding', 'Receive now', 'Left outstanding after this']) expect(dlg.textContent).toContain(label);
    const input = within(dlg).getByLabelText(/Receive now/) as HTMLInputElement;
    expect(input.value).toBe('2970');
    // over-receipt is refused and the entered value is kept
    fireEvent.change(input, { target: { value: '3000' } });
    expect(dlg.textContent).toContain('30 kg too much');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirm receipt' }));
    expect(dlg.textContent).toContain('Not posted — nothing changed');
    expect((within(dlg).getByLabelText(/Receive now/) as HTMLInputElement).value).toBe('3000');
    const before = getDb().rentio!.movements.length;
    // partial receipt: 2,950 now, 20 kg stays outstanding
    fireEvent.change(within(dlg).getByLabelText(/Receive now/), { target: { value: '2950' } });
    expect(dlg.textContent).toContain('20 kg');
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirm receipt' }));
    const ho = getDb().rentio!.handovers.find((h) => h.lotId === 'RT-003/G1')!;
    expect(ho.received).toBe(kg(2950));
    expect(O.outstanding(ho)).toBe(kg(20));
    expect(getDb().rentio!.movements.length).toBe(before + 1);
    expect(getDb().rentio!.lots['RT-003/G1'].nextStage).toBe('OIL');
    r.unmount();
  });

  it('a full manual cycle — receive, start, output with oil, issue — balances without the runner', () => {
    const db = fresh('demo');
    const ho = db.rentio!.handovers.find((h) => h.lotId === 'RT-003/G1')!;
    run(db, 'u_anil', (ctx) => O.receive(ctx, { handoverId: ho.id }));
    const r = run(db, 'u_anil', (ctx) => O.startRun(ctx, { stage: 'OIL', lotId: 'RT-003/G1' })).result;
    run(db, 'u_anil', (ctx) => O.recordOutput(ctx, { runId: r.id, outputs: [{ kind: 'forward', kg: 2976 }], additions: [{ lotId: 'OIL-B01', kg: 6 }] }));
    run(db, 'u_anil', (ctx) => O.issue(ctx, { lotId: 'RT-003/OIL', fromLoc: 'STG:OIL:OUT', qtyKg: 2976, toStage: 'COND' }));
    const acc = lotAccounting(db.rentio!, 'RT-003');
    expect(acc.input).toBe(kg(3000));
    expect(acc.total).toBe(kg(3006));
    expect(acc.balanced).toBe(true);
    // RT-001 is unaffected by the second lot
    expect(lotAccounting(db.rentio!, 'RT-001').total).toBe(kg(10020));
  });
});

describe('controls added this round', () => {
  it('period close refuses back-dated postings; reopening needs a different person', () => {
    const db = fresh('demo');
    run(db, 'u_neha', (ctx) => lockPeriod(ctx, '2026-10'));
    expect(code(() => run(db, 'u_ravi', (ctx) => O.internalUse(ctx, { lotId: 'RT-001/HUSK-PEEL', loc: 'BYP', kg: 1, purpose: 'Boiler fuel (demo)' }), '2026-10-20T06:00:00.000Z'))).toBe('business_rule');
    expect(code(() => run(db, 'u_ravi', (ctx) => O.internalUse(ctx, { lotId: 'RT-001/HUSK-PEEL', loc: 'BYP', kg: 1, purpose: 'Boiler fuel (demo)' })))).toBe('ok');
    expect(code(() => run(db, 'u_neha', (ctx) => reopenPeriod(ctx, '2026-10', 'fix')))).toBe('self_approval');
    expect(code(() => run(db, 'u_owner', (ctx) => reopenPeriod(ctx, '2026-10', 'Supplier credit note correction')))).toBe('ok');
  });

  it('excess at distributor receipt is held as unidentified stock, never added to the lot', () => {
    const db = fresh('demo');
    const so = run(db, 'u_kiran', (ctx) => C.createFactoryOrder(ctx, { distributorId: 'D01', lines: [{ grade: 'B1', kg: 250 }] })).result;
    run(db, 'u_kiran', (ctx) => C.reserveOrder(ctx, so.id));
    const sh = run(db, 'u_ravi', (ctx) => C.dispatchOrder(ctx, { orderId: so.id, transporterId: 'TR-01', vehicle: 'MH12-T', driver: 'D' })).result;
    run(db, 'u_dinesh', (ctx) => C.receiveShipment(ctx, { shipmentId: sh.id, goodKg: 250, excessKg: 25 }));
    const rows = stockRows(db.rentio!, new Date().toISOString());
    const unid = rows.find((r) => r.lotId === `UNID-EXC-${sh.id}`)!;
    expect(unid.loc).toBe('DIST:D01:HELD');
    expect(unid.held).toBe(true);
    expect(unid.qty).toBe(kg(25));
    expect(db.rentio!.disputes.find((d) => d.shipmentId === sh.id)!.reason).toMatch(/excess/);
    expect(lotAccounting(db.rentio!, 'RT-001').total).toBe(kg(10020));
  });

  it('a retained sample leaves available stock, is held, and is deducted once on disposal', () => {
    const db = fresh('demo');
    const avail = () => stockRows(db.rentio!, new Date().toISOString()).filter((r) => r.lotId === 'RT-001/A1-PK').reduce((a, r) => a + r.available, 0);
    const before = avail();
    expect(code(() => run(db, 'u_ravi', (ctx) => takeSample(ctx, { lotId: 'RT-001/A1-PK', loc: 'F1-S02', kg: 2, purpose: 'retained' })))).toBe('forbidden');
    run(db, 'u_meera', (ctx) => takeSample(ctx, { lotId: 'RT-001/A1-PK', loc: 'F1-S02', kg: 2, purpose: 'Retained batch sample' }));
    expect(avail()).toBe(before - kg(2));
    const sample = stockRows(db.rentio!, new Date().toISOString()).find((r) => r.loc === 'SAMPLES')!;
    expect(sample.held).toBe(true);
    run(db, 'u_meera', (ctx) => disposeSample(ctx, { lotId: 'RT-001/A1-PK', kg: 2, reason: 'Moisture test' }));
    expect(stockRows(db.rentio!, new Date().toISOString()).some((r) => r.loc === 'SAMPLES')).toBe(false);
    expect(lotAccounting(db.rentio!, 'RT-001').balanced).toBe(true);
  });

  it('audit export is scoped: a distributor exports only its own actions and area', () => {
    const db = fresh('demo');
    const mine = auditRows(db.rentio!, ractor('u_dinesh'));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.some((r) => /DIST:D02|Farah/.test(`${r.what} ${r.who}`))).toBe(false);
    expect(auditRows(db.rentio!, ractor('u_owner')).length).toBeGreaterThan(mine.length);
  });

  it('demo snapshot: RT-001 completed and balanced; exception opening stock kept separate', () => {
    const db = fresh('demo');
    const acc = lotAccounting(db.rentio!, 'RT-001');
    expect(acc.total).toBe(kg(10020));
    expect(acc.balanced).toBe(true);
    expect(acc.buckets.some((b) => b.label.includes('MIG'))).toBe(false);
    expect(Object.values(db.rentio!.lots).filter((l) => l.rootId === 'RT-001').every((l) => !l.id.startsWith('MIG'))).toBe(true);
  });
});

for (const u of ROLES_SCOPED) void u;

describe('keyboard and focus on action forms', () => {
  it('opening an action form moves focus inside; Escape closes it and returns focus to the button', async () => {
    __setDb(createDb(NOW, { dataset: 'demo' }));
    switchSession('u_anil', 'plant1');
    const Page = RENTIO_PAGES['home/my-work'];
    const v = render(
      <ToastProvider>
        <MemoryRouter>
          <div id="topbar-title" />
          <Page />
        </MemoryRouter>
      </ToastProvider>,
    );
    const btn = within(v.container.querySelector('.rt-next') as HTMLElement).getByRole('button', { name: /Receive/ });
    btn.focus();
    fireEvent.click(btn);
    await rtlAct(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect((document.activeElement as HTMLElement).closest('[role="dialog"]')).not.toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    await rtlAct(async () => {
      await new Promise((r) => setTimeout(r, 250));
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(btn);
    v.unmount();
  });
});
