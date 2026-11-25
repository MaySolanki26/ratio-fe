/**
 * Owner acceptance round 2 regressions:
 *  P0 event-time chronology (output → issue → receipt → start → hold/resume/finish → next issue),
 *  P1 owner review CTAs, focused-record next step, demo hand-off, role-switch landing, held-order reallocation,
 *  P1 one derived order status (shipment outcomes + remaining quantities),
 *  P2 obsolete error feedback cleared on success.
 */
import { act as rtlAct, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../App';
import { ToastProvider, useToast } from '../components/primitives/feedback';
import { useDomain } from '../domain/active';
import { ractor } from '../domain/rentio/access';
import * as C from '../domain/rentio/commerce';
import { buildRentio, rentioDomain } from '../domain/rentio/domain';
import { type Ctx, earliestAvailable, execute, RError, stockRows } from '../domain/rentio/engine';
import * as O from '../domain/rentio/ops';
import { RT001_STEPS, runScenarioStep } from '../domain/rentio/scenario';
import { kg } from '../domain/rentio/units';
import { alerts, ctaFor, lotAccounting } from '../domain/rentio/views';
import { __setDb, createDb, getDb } from '../services/db';
import { switchSession } from '../services/settings';
import type { Db } from '../services/types';

useDomain(rentioDomain);

const MIN = 60_000;
const fresh = (dataset: 'start' | 'completed' | 'demo') => {
  const r = buildRentio(new Date(), dataset);
  return { records: r.records, audit: [], session: { userId: 'u_owner', workspaceId: 'plant1' }, ...r.extra } as unknown as Db;
};
const run = <T,>(db: Db, user: string, fn: (ctx: Ctx) => T, at?: string) => execute(db, ractor(user), { label: 'test', at }, fn).result;
const err = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof RError ? { code: e.code, msg: e.message } : { code: 'other', msg: String(e) };
  }
  return { code: 'ok', msg: '' };
};
const ago = (m: number) => new Date(Date.now() - m * MIN).toISOString();
const statusOf = (db: Db, orderId: string) => {
  const s = db.rentio!;
  const rows = stockRows(s, new Date().toISOString());
  return C.orderStatus(s, s.orders.find((o) => o.id === orderId)!, (l, loc) => !!rows.find((x) => x.lotId === l && x.loc === loc)?.sellable);
};

describe('P0 — causal event-time chronology', () => {
  /** RT-003/G1 issued to Oiling ~90 min ago in the demo snapshot. */
  const setup = () => {
    const db = fresh('demo');
    const ho = db.rentio!.handovers.find((h) => h.lotId === 'RT-003/G1')!;
    return { db, ho, issued: Date.parse(ho.issuedAt) };
  };

  it('refuses a receipt dated before the issue, atomically, naming the earliest allowed time', () => {
    const { db, ho, issued } = setup();
    const before = db.rentio!.movements.length;
    const e = err(() => run(db, 'u_anil', (ctx) => O.receive(ctx, { handoverId: ho.id }), new Date(issued - 10 * MIN).toISOString()));
    expect(e.code).toBe('chronology');
    expect(e.msg).toMatch(/Earliest allowed time: .* IST/);
    expect(db.rentio!.movements.length).toBe(before);
    expect(earliestAvailable(db.rentio!, ho.lotId, `PEND:${ho.id}`, ho.qty)).toBe(ho.issuedAt);
  });

  it('refuses a start before the receipt, and a hold or finish before the start', () => {
    const { db, issued } = setup();
    const ho = db.rentio!.handovers.find((h) => h.lotId === 'RT-003/G1')!;
    const tRecv = new Date(issued + 10 * MIN).toISOString();
    run(db, 'u_anil', (ctx) => O.receive(ctx, { handoverId: ho.id }), tRecv);
    expect(err(() => run(db, 'u_anil', (ctx) => O.startRun(ctx, { stage: 'OIL', lotId: 'RT-003/G1' }), new Date(issued + 5 * MIN).toISOString())).code).toBe('chronology');
    const tStart = new Date(issued + 20 * MIN).toISOString();
    const r = run(db, 'u_anil', (ctx) => O.startRun(ctx, { stage: 'OIL', lotId: 'RT-003/G1' }), tStart);
    expect(err(() => run(db, 'u_anil', (ctx) => O.holdRun(ctx, r.id, 'Power cut'), new Date(issued + 15 * MIN).toISOString())).code).toBe('chronology');
    expect(err(() => run(db, 'u_anil', (ctx) => O.recordOutput(ctx, { runId: r.id, outputs: [{ kind: 'forward', kg: 2976 }], additions: [{ lotId: 'OIL-B01', kg: 6 }] }), new Date(issued + 15 * MIN).toISOString())).code).toBe('chronology');
  });

  it('refuses a back-dated issue before the output existed (the reported HO-0023 case) and a future time', () => {
    const { db, issued } = setup();
    const ho = db.rentio!.handovers.find((h) => h.lotId === 'RT-003/G1')!;
    run(db, 'u_anil', (ctx) => O.receive(ctx, { handoverId: ho.id }), new Date(issued + 5 * MIN).toISOString());
    const r = run(db, 'u_anil', (ctx) => O.startRun(ctx, { stage: 'OIL', lotId: 'RT-003/G1' }), new Date(issued + 6 * MIN).toISOString());
    const tOut = ago(5);
    run(db, 'u_anil', (ctx) => O.recordOutput(ctx, { runId: r.id, outputs: [{ kind: 'forward', kg: 2976 }], additions: [{ lotId: 'OIL-B01', kg: 6 }] }), tOut);
    const before = db.rentio!.movements.length;
    const back = err(() => run(db, 'u_anil', (ctx) => O.issue(ctx, { lotId: 'RT-003/OIL', fromLoc: 'STG:OIL:OUT', qtyKg: 2976, toStage: 'COND' }), new Date(issued + 7 * MIN).toISOString()));
    expect(back.code).toBe('chronology');
    expect(back.msg).toContain('RT-003/OIL');
    expect(db.rentio!.movements.length).toBe(before);
    expect(db.rentio!.handovers.some((h) => h.lotId === 'RT-003/OIL')).toBe(false);
    const future = err(() => run(db, 'u_anil', (ctx) => O.issue(ctx, { lotId: 'RT-003/OIL', fromLoc: 'STG:OIL:OUT', qtyKg: 2976, toStage: 'COND' }), new Date(Date.now() + 2 * 3_600_000).toISOString()));
    expect(future.code).toBe('chronology');
    expect(future.msg).toMatch(/in the future/);
    // the same issue at (or after) the output time is accepted — equal timestamps are legitimate
    expect(err(() => run(db, 'u_anil', (ctx) => O.issue(ctx, { lotId: 'RT-003/OIL', fromLoc: 'STG:OIL:OUT', qtyKg: 2976, toStage: 'COND' }), tOut)).code).toBe('ok');
  });

  it('fungible positions: earlier eligible quantity can leave between two receipts; more than that cannot', () => {
    const db = fresh('demo');
    run(db, 'u_ravi', (ctx) => O.transferStock(ctx, { lotId: 'RT-001/B1-PK', from: 'F1-S03', to: 'F1-S06', kg: 100 }), ago(120));
    run(db, 'u_ravi', (ctx) => O.transferStock(ctx, { lotId: 'RT-001/B1-PK', from: 'F1-S03', to: 'F1-S06', kg: 100 }), ago(60));
    expect(err(() => run(db, 'u_ravi', (ctx) => O.transferStock(ctx, { lotId: 'RT-001/B1-PK', from: 'F1-S06', to: 'F1-S05', kg: 150 }), ago(90))).code).toBe('chronology');
    expect(err(() => run(db, 'u_ravi', (ctx) => O.transferStock(ctx, { lotId: 'RT-001/B1-PK', from: 'F1-S06', to: 'F1-S05', kg: 75 }), ago(90))).code).toBe('ok');
    // a back-dated removal that would make a later recorded removal impossible is refused too
    // (100 in at −120, 75 out at −90: taking 50 at −100 would leave only 50 for the recorded 75)
    expect(err(() => run(db, 'u_ravi', (ctx) => O.transferStock(ctx, { lotId: 'RT-001/B1-PK', from: 'F1-S06', to: 'F1-S05', kg: 50 }), ago(100))).code).toBe('chronology');
    expect(err(() => run(db, 'u_ravi', (ctx) => O.transferStock(ctx, { lotId: 'RT-001/B1-PK', from: 'F1-S06', to: 'F1-S05', kg: 25 }), ago(100))).code).toBe('ok');
    expect(err(() => run(db, 'u_ravi', (ctx) => O.transferStock(ctx, { lotId: 'RT-001/B1-PK', from: 'F1-S06', to: 'F1-S05', kg: 100 }), ago(1))).code).toBe('ok');
  });

  it('a valid full replay of RT-001 still passes every chronology check and reconciles to 10,020 kg', () => {
    const db = fresh('start');
    for (let i = 0; i < RT001_STEPS.length; i++) runScenarioStep(db);
    expect(lotAccounting(db.rentio!, 'RT-001').total).toBe(kg(10020));
    // and a manual cycle where several actions share one timestamp is accepted
    const d2 = fresh('demo');
    const ho = d2.rentio!.handovers.find((h) => h.lotId === 'RT-003/G1')!;
    const t = ago(30);
    run(d2, 'u_anil', (ctx) => O.receive(ctx, { handoverId: ho.id }), t);
    const r = run(d2, 'u_anil', (ctx) => O.startRun(ctx, { stage: 'OIL', lotId: 'RT-003/G1' }), t);
    run(d2, 'u_anil', (ctx) => O.recordOutput(ctx, { runId: r.id, outputs: [{ kind: 'forward', kg: 2976 }], additions: [{ lotId: 'OIL-B01', kg: 6 }] }), t);
    expect(err(() => run(d2, 'u_anil', (ctx) => O.issue(ctx, { lotId: 'RT-003/OIL', fromLoc: 'STG:OIL:OUT', qtyKg: 2976, toStage: 'COND' }), t)).code).toBe('ok');
  });
});

describe('P1 — owner exception actions, hand-off and role switching', () => {
  it('owner gets honest review CTAs; the accountable operator gets the action', () => {
    const db = fresh('demo');
    const now = new Date().toISOString();
    const all = alerts(db, now);
    const risk = all.find((a) => a.key.startsWith('risk:'))!;
    const eta = all.find((a) => a.key.startsWith('run:') && a.sourceId.startsWith('RUN'))!;
    const short = all.find((a) => a.key.startsWith('ho:') && a.action === 'Settle shortfall')!;
    for (const a of [risk, eta, short]) expect(ctaFor(a, ractor('u_owner'))).toBe('Review');
    expect(ctaFor(risk, ractor('u_kiran'))).toBe('Reallocate');
    expect(ctaFor(eta, ractor(eta.ownerId))).toBe('Update ETA');
    expect(ctaFor(short, ractor('u_fhead'))).toBe('Settle shortfall');
    expect(risk.nextStep).toMatch(/^Kiran Shah \(Back Office\): reallocate$/);
  });

  it('Owner Home → held order: review banner, owner cannot act, demo hand-off lets Kiran reallocate atomically', async () => {
    __setDb(createDb(new Date(), { dataset: 'demo' }));
    switchSession('u_owner', 'plant1');
    const so = getDb().rentio!.orders.find((o) => o.partyId === 'D02' && o.lines[0].grade === 'B1')!;
    window.history.pushState({}, '', `/o/rentio/w/plant1/distribution/orders?focus=${so.id}`);
    const r = render(<App />);
    const banner = r.container.querySelector('[aria-label="Task for this record"]') as HTMLElement;
    expect(banner.textContent).toContain('Next action — delegated');
    expect(banner.textContent).toContain('Kiran Shah (Back Office): reallocate');
    const reall = within(r.container.querySelector('main')!).getByRole('button', { name: /Reallocate held stock/ });
    expect(reall).toBeDisabled();
    fireEvent.click(within(banner).getByRole('button', { name: /Demo hand-off: continue as Kiran Shah/ }));
    await rtlAct(async () => {});
    expect(getDb().session.userId).toBe('u_kiran');
    const banner2 = r.container.querySelector('[aria-label="Task for this record"]') as HTMLElement;
    expect(banner2.textContent).toContain('Your next action on this record');
    fireEvent.click(within(r.container.querySelector('main')!).getByRole('button', { name: /Reallocate held stock/ }));
    await rtlAct(async () => {});
    const db = getDb();
    expect(statusOf(db, so.id).code).toBe('ready_to_dispatch');
    // the held lot stays blocked and is no longer reserved
    const child = stockRows(db.rentio!, new Date().toISOString()).find((x) => x.lotId === 'MIG-0001/B1-PK')!;
    expect(child.held).toBe(true);
    expect(child.reserved).toBe(0);
    expect(db.rentio!.reservations.some((x) => x.orderId === so.id && x.status === 'active' && x.lotId === 'RT-001/B1-PK')).toBe(true);
    r.unmount();
  });

  it('reallocation is all-or-nothing when eligible stock is insufficient', async () => {
    const { act } = await import('../rentio/store');
    __setDb(createDb(new Date(), { dataset: 'start' })); // no RT-001 B1 yet
    const so = getDb().rentio!.orders.find((o) => o.partyId === 'D02' && o.lines[0].grade === 'B1')!;
    const before = JSON.stringify(getDb().rentio!.reservations);
    switchSession('u_kiran', 'plant1');
    expect(act('Reallocate', (ctx) => C.reallocateAtRisk(ctx, so.id)).code).toBe('business_rule');
    expect(JSON.stringify(getDb().rentio!.reservations)).toBe(before);
    switchSession('u_owner', 'plant1');
    expect(act('Reallocate', (ctx) => C.reallocateAtRisk(ctx, so.id)).code).toBe('forbidden');
  });

  it('Update ETA and Settle shortfall from Owner Home show the named operator and stay review-only for the owner', () => {
    __setDb(createDb(new Date(), { dataset: 'demo' }));
    switchSession('u_owner', 'plant1');
    const all = alerts(getDb(), new Date().toISOString());
    for (const a of [all.find((x) => x.action === 'Update ETA')!, all.find((x) => x.action === 'Settle shortfall')!]) {
      window.history.pushState({}, '', `/o/rentio/w/plant1/${a.link}`);
      const r = render(<App />);
      const banner = r.container.querySelector('[aria-label="Task for this record"]') as HTMLElement;
      expect(banner.textContent, a.link).toContain(a.nextStep);
      expect(within(banner).getByRole('button', { name: /Demo hand-off/ })).toBeEnabled();
      r.unmount();
    }
  });

  it('switching role from a page the new role cannot open lands on their My work; direct URLs stay guarded', async () => {
    __setDb(createDb(new Date(), { dataset: 'demo' }));
    switchSession('u_owner', 'plant1');
    window.history.pushState({}, '', '/o/rentio/w/plant1/distribution/orders');
    const r = render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: /^Account:/ })[0]);
    fireEvent.click(await screen.findByRole('button', { name: /Anil Kumar/ }));
    await rtlAct(async () => {});
    expect(window.location.pathname).toBe('/o/rentio/w/plant1/home/my-work');
    expect(r.container.querySelector('main')!.textContent).toContain('Receive RT-003/G1');
    r.unmount();
    window.history.pushState({}, '', '/o/rentio/w/plant1/distribution/orders');
    const r2 = render(<App />);
    expect(r2.container.querySelector('main')!.textContent).toContain('No access to this page');
    r2.unmount();
  });
});

describe('P1 — one derived order status', () => {
  it('fixtures: multi-stack shipment received in full is delivered; short shipment is disputed; held is at risk', () => {
    const db = fresh('demo');
    const s = db.rentio!;
    const d01 = s.orders.find((o) => o.kind === 'factory' && o.partyId === 'D01' && o.lines[0].grade === 'A1')!;
    const sh = s.shipments.find((x) => x.orderId === d01.id)!;
    expect(new Set(sh.lines.map((l) => l.fromLoc)).size).toBe(2); // S01 + S02 → one order line
    const b = C.lineBalance(s, d01, d01.lines[0]);
    expect([b.delivered, b.inTransit]).toEqual([kg(4000), 0]);
    expect(statusOf(db, d01.id).code).toBe('delivered');
    expect(statusOf(db, d01.id).label).not.toMatch(/paid|settled/i);
    const a2 = s.orders.find((o) => o.partyId === 'D02' && o.lines[0].grade === 'A2')!;
    expect(statusOf(db, a2.id)).toMatchObject({ code: 'disputed', label: 'Disputed — 25 kg short' });
    expect(statusOf(db, s.orders.find((o) => o.partyId === 'D02' && o.lines[0].grade === 'B1')!.id).code).toBe('at_risk');
    expect(statusOf(db, s.orders.find((o) => o.partyId === 'D04')!.id).code).toBe('credit_hold');
    expect(statusOf(db, s.orders.find((o) => o.partyId === 'D03' && o.advance)!.id).code).toBe('advance');
  });

  it('a shortfall settled by approval reads delivered with the settled quantity; in-transit is distinct', () => {
    const db = fresh('demo');
    const s = db.rentio!;
    const a2 = s.orders.find((o) => o.partyId === 'D02' && o.lines[0].grade === 'A2')!;
    const sh = s.shipments.find((x) => x.orderId === a2.id)!;
    const ap = run(db, 'u_kiran', (ctx) => C.requestTransitSettlement(ctx, { shipmentId: sh.id, how: 'loss', reason: 'Bag fell off — driver statement (demo)' }));
    run(db, 'u_fhead', (ctx) => O.decideApproval(ctx, { approvalId: ap.id, approve: true }));
    expect(statusOf(db, a2.id)).toMatchObject({ code: 'delivered', label: 'Delivered — 25 kg shortfall settled' });
    // a fresh dispatch is in transit until received
    const so = run(db, 'u_kiran', (ctx) => C.createFactoryOrder(ctx, { distributorId: 'D01', lines: [{ grade: 'B1', kg: 250 }] }));
    run(db, 'u_kiran', (ctx) => C.reserveOrder(ctx, so.id));
    expect(statusOf(db, so.id).code).toBe('ready_to_dispatch');
    run(db, 'u_ravi', (ctx) => C.dispatchOrder(ctx, { orderId: so.id, transporterId: 'TR-01', vehicle: 'MH12-T', driver: 'D' }));
    expect(statusOf(db, so.id)).toMatchObject({ code: 'in_transit', label: 'In transit — 250 kg' });
  });

  it('owner overview and Orders & dispatch show the same status for each fixture order', () => {
    __setDb(createDb(new Date(), { dataset: 'demo' }));
    switchSession('u_owner', 'plant1');
    window.history.pushState({}, '', '/o/rentio/w/plant1/dashboard');
    const ct = render(<App />);
    const fromCt = Object.fromEntries([...ct.container.querySelectorAll('[data-status]')].map((el) => [el.closest('tr')!.textContent!.match(/SO-\d{4}/)![0], el.getAttribute('data-status')]));
    ct.unmount();
    window.history.pushState({}, '', '/o/rentio/w/plant1/distribution/orders');
    const od = render(<App />);
    const fromOrders = Object.fromEntries([...od.container.querySelectorAll('tbody [data-status]')].map((el) => [el.closest('tr')!.textContent!.match(/SO-\d{4}/)![0], el.getAttribute('data-status')]));
    od.unmount();
    expect(Object.keys(fromCt).length).toBeGreaterThan(3);
    for (const [id, st] of Object.entries(fromCt)) expect(fromOrders[id], id).toBe(st);
    expect(Object.values(fromCt)).toContain('disputed');
    expect(Object.values(fromCt)).not.toContain('in_transit');
  });
});

describe('P2 — recovery clarity', () => {
  it('a success clears the obsolete error toast; the form keeps input on error', async () => {
    function Probe() {
      const toast = useToast();
      return (
        <>
          <button onClick={() => toast('Unbalanced: difference 6 kg', 'danger')}>fail</button>
          <button onClick={() => toast('Output posted', 'success')}>ok</button>
        </>
      );
    }
    render(
      <ToastProvider>
        <Probe />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('fail'));
    expect(document.body.textContent).toContain('Unbalanced');
    fireEvent.click(screen.getByText('ok'));
    await rtlAct(async () => {});
    expect(document.body.textContent).toContain('Output posted');
    expect(document.body.textContent).not.toContain('Unbalanced');
  });

  it('invalid oil output keeps the entries; the corrected post succeeds without a stale error', async () => {
    __setDb(createDb(new Date(), { dataset: 'demo' }));
    const ho = getDb().rentio!.handovers.find((h) => h.lotId === 'RT-003/G1')!;
    const { commitDraft } = await import('../services/db');
    commitDraft((d) => {
      execute(d, ractor('u_anil'), { label: 'rcv', at: ago(20) }, (ctx) => O.receive(ctx, { handoverId: ho.id }));
      execute(d, ractor('u_anil'), { label: 'start', at: ago(19) }, (ctx) => O.startRun(ctx, { stage: 'OIL', lotId: 'RT-003/G1' }));
    });
    switchSession('u_anil', 'plant1');
    window.history.pushState({}, '', '/o/rentio/w/plant1/home/my-work');
    const r = render(<App />);
    fireEvent.click(within(r.container.querySelector('.rt-next') as HTMLElement).getByRole('button', { name: /Record output/ }));
    const dlg = document.querySelector('.drawer, .dialog') as HTMLElement;
    fireEvent.change(within(dlg).getByLabelText(/Good output to next stage/), { target: { value: '2970' } });
    fireEvent.change(within(dlg).getByLabelText(/Oil added from stores/), { target: { value: '6' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Post balanced output' }));
    expect(dlg.textContent).toContain('Not posted — nothing changed');
    expect((within(dlg).getByLabelText(/Good output to next stage/) as HTMLInputElement).value).toBe('2970');
    expect(document.querySelector('.toasts')!.textContent).toMatch(/Unbalanced/);
    fireEvent.change(within(dlg).getByLabelText(/Good output to next stage/), { target: { value: '2976' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Post balanced output' }));
    await rtlAct(async () => {});
    const t = document.querySelector('.toasts')!.textContent ?? '';
    expect(t).toMatch(/Output posted/);
    expect(t).not.toMatch(/Unbalanced/);
    r.unmount();
  });
});
