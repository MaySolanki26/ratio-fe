/**
 * Owner acceptance round 2 — live-retest findings:
 *  #5 module shortcuts land on the first page the role may open (direct-URL guards unchanged),
 *  #6 an immediate same-minute receipt after a godown issue stamped mid-minute is accepted;
 *     strict ordering still refuses earlier minutes and future times; previews never show NaN.
 */
import { fieldValue, setField } from './customInputs';
import { act as rtlAct, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { moduleLanding } from '../components/shell/AppShell';
import { useDomain } from '../domain/active';
import { ractor } from '../domain/rentio/access';
import { buildRentio, rentioDomain } from '../domain/rentio/domain';
import { type Ctx, execute, RError } from '../domain/rentio/engine';
import * as O from '../domain/rentio/ops';
import { rentioModules } from '../domain/rentio/pack';
import { kg, fmtKg } from '../domain/rentio/units';
import { refreshClock } from '../rentio/clock';
import { fromLocalInputAfter, toLocalInput } from '../rentio/ui';
import { actorFor } from '../services/authz';
import { __setDb, createDb, getDb } from '../services/db';
import { switchSession } from '../services/settings';
import type { Db } from '../services/types';

useDomain(rentioDomain);

afterEach(() => vi.useRealTimers());

const MIN = 60_000;
const fresh = () => {
  const r = buildRentio(new Date(), 'demo');
  return { records: r.records, audit: [], session: { userId: 'u_owner', workspaceId: 'plant1' }, ...r.extra } as unknown as Db;
};
const run = <T,>(db: Db, user: string, fn: (ctx: Ctx) => T, at?: string) => execute(db, ractor(user), { label: 'test', at }, fn).result;
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof RError ? e.code : 'other';
  }
  return 'ok';
};
/** An instant in a past minute, stamped at :37 seconds (like a godown issue posted "now"). */
const mid = (minutesAgo: number) => {
  const d = new Date(Date.now() - minutesAgo * MIN);
  d.setUTCSeconds(37, 0);
  return d.toISOString();
};
const mod = (id: string) => rentioModules.find((m) => m.id === id)!;

describe('#6 — minute/second boundary on an immediate same-minute handover', () => {
  it('a picked minute that contains the predecessor resolves to that instant; earlier minutes stay as entered', () => {
    const issueAt = mid(10);
    const sameMinute = toLocalInput(issueAt); // what the picker shows, e.g. 06:43
    expect(fromLocalInputAfter(sameMinute, issueAt)).toBe(issueAt);
    const prevMinute = toLocalInput(new Date(Date.parse(issueAt) - MIN).toISOString());
    expect(Date.parse(fromLocalInputAfter(prevMinute, issueAt))).toBeLessThan(Date.parse(issueAt));
    const laterMinute = toLocalInput(new Date(Date.parse(issueAt) + MIN).toISOString());
    expect(Date.parse(fromLocalInputAfter(laterMinute, issueAt))).toBeGreaterThan(Date.parse(issueAt));
    expect(fromLocalInputAfter('', issueAt)).toMatch(/^invalid/);
  });

  it('godown issue at HH:mm:37 → same-minute receipt and run start succeed; previous minute and future are refused', () => {
    const db = fresh();
    const issueAt = mid(10);
    const ho = run(db, 'u_ravi', (ctx) => O.issue(ctx, { lotId: 'RT-004', fromLoc: 'R1', qtyKg: 5000, toStage: 'CLEAN' }), issueAt);
    const minute = toLocalInput(issueAt);
    // previous minute: refused, nothing posted
    const before = db.rentio!.movements.length;
    const prev = fromLocalInputAfter(toLocalInput(new Date(Date.parse(issueAt) - MIN).toISOString()), issueAt);
    expect(code(() => run(db, 'u_suresh', (ctx) => O.receive(ctx, { handoverId: ho.id }), prev))).toBe('chronology');
    expect(db.rentio!.movements.length).toBe(before);
    // future: refused
    expect(code(() => run(db, 'u_suresh', (ctx) => O.receive(ctx, { handoverId: ho.id }), new Date(Date.now() + 3_600_000).toISOString()))).toBe('chronology');
    // the default (same minute as the issue) is accepted and recorded exactly at the issue instant
    expect(code(() => run(db, 'u_suresh', (ctx) => O.receive(ctx, { handoverId: ho.id }), fromLocalInputAfter(minute, issueAt)))).toBe('ok');
    const rcv = db.rentio!.movements.find((m) => m.kind === 'receive' && m.ref === ho.id)!;
    expect(rcv.at).toBe(issueAt);
    // and the run can start in the same minute too
    const recvAt = rcv.at;
    const r = run(db, 'u_suresh', (ctx) => O.startRun(ctx, { stage: 'CLEAN', lotId: 'RT-004' }), fromLocalInputAfter(minute, recvAt));
    expect(r.events[0].at).toBe(recvAt);
  });

  it('live path: Ravi issues mid-minute, Suresh immediately submits the default receipt — accepted, preview shows the prefilled quantity', async () => {
    // freeze "now" at HH:mm:50 so the issue (posted now at :37) and the receipt share one minute
    const now = new Date();
    now.setUTCSeconds(50, 0);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    const db = createDb(new Date(Date.now() - 2 * MIN), { dataset: 'demo' });
    __setDb(db);
    const issueAt = new Date(now.getTime() - 13_000).toISOString(); // HH:mm:37
    const { commitDraft } = await import('../services/db');
    commitDraft((d) => {
      execute(d, ractor('u_ravi'), { label: 'Issue RT-004', at: issueAt }, (ctx) => O.issue(ctx, { lotId: 'RT-004', fromLoc: 'R1', qtyKg: 5000, toStage: 'CLEAN' }));
    });
    refreshClock();
    switchSession('u_suresh', 'plant1');
    window.history.pushState({}, '', '/o/rentio/w/plant1/home/my-work');
    const r = render(<App />);
    const row = [...r.container.querySelectorAll('.rt-brief li, .rt-next')].find((el) => el.textContent?.includes('Receive RT-004')) as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /Receive/ }));
    const dlg = document.querySelector('.drawer, .dialog') as HTMLElement;
    expect(dlg.textContent).toContain(`Receive now${fmtKg(kg(5000))}`);
    expect(dlg.textContent).not.toMatch(/NaN/);
    // the earliest allowed time shows seconds, so it never reads "HH:mm is before HH:mm"
    expect(dlg.textContent).toMatch(/Earliest allowed: .*:37 IST/);
    expect(fieldValue(within(dlg).getByLabelText(/When it arrived/))).toBe(toLocalInput(issueAt));
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirm receipt' }));
    await rtlAct(async () => {});
    const ho = getDb().rentio!.handovers.find((h) => h.lotId === 'RT-004')!;
    expect(ho.received).toBe(kg(5000));
    expect(ho.receipts[0].at).toBe(issueAt);
    r.unmount();
  });

  it('live path: choosing the previous minute is refused with the input kept', async () => {
    __setDb(createDb(new Date(), { dataset: 'demo' }));
    const issueAt = mid(5);
    const { commitDraft } = await import('../services/db');
    commitDraft((d) => {
      execute(d, ractor('u_ravi'), { label: 'Issue RT-004', at: issueAt }, (ctx) => O.issue(ctx, { lotId: 'RT-004', fromLoc: 'R1', qtyKg: 5000, toStage: 'CLEAN' }));
    });
    switchSession('u_suresh', 'plant1');
    window.history.pushState({}, '', '/o/rentio/w/plant1/home/my-work');
    const r = render(<App />);
    const row = [...r.container.querySelectorAll('.rt-brief li, .rt-next')].find((el) => el.textContent?.includes('Receive RT-004')) as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /Receive/ }));
    const dlg = document.querySelector('.drawer, .dialog') as HTMLElement;
    const prev = toLocalInput(new Date(Date.parse(issueAt) - MIN).toISOString());
    setField(within(dlg).getByLabelText(/When it arrived/), prev);
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirm receipt' }));
    expect(dlg.textContent).toMatch(/Time not possible/);
    expect(fieldValue(within(dlg).getByLabelText(/When it arrived/))).toBe(prev);
    expect(getDb().rentio!.handovers.find((h) => h.lotId === 'RT-004')!.received).toBe(0);
    r.unmount();
  });
});

describe('#5 — module shortcuts land on the first permitted page', () => {
  it('D01/D02: Dispatch & distributors → Distributor stock; Sales & returns → Returns; Home → My work', () => {
    __setDb(createDb(new Date(), { dataset: 'demo' }));
    for (const u of ['u_dinesh', 'u_farah']) {
      const a = actorFor(u, 'plant1');
      expect(moduleLanding(a, mod('distribution'))).toBe('/o/rentio/w/plant1/distribution/distributors');
      expect(moduleLanding(a, mod('sales'))).toBe('/o/rentio/w/plant1/sales/returns');
      expect(moduleLanding(a, mod('home'))).toBe('/o/rentio/w/plant1/home/my-work');
    }
    // roles whose default page is permitted keep it
    expect(moduleLanding(actorFor('u_owner', 'plant1'), mod('distribution'))).toBe('/o/rentio/w/plant1/distribution/orders');
    expect(moduleLanding(actorFor('u_rohit', 'plant1'), mod('sales'))).toBe('/o/rentio/w/plant1/sales/salesman');
    expect(moduleLanding(actorFor('u_owner', 'plant1'), mod('home'))).toBe('/o/rentio/w/plant1/dashboard');
  });

  it('every shown shortcut, for every role, opens a page that role is allowed to see', () => {
    __setDb(createDb(new Date(), { dataset: 'demo' }));
    for (const u of ['u_owner', 'u_fhead', 'u_suresh', 'u_kiran', 'u_meera', 'u_ravi', 'u_dinesh', 'u_farah', 'u_rohit', 'u_neha', 'u_pooja', 'u_arjun']) {
      switchSession(u, 'plant1');
      window.history.pushState({}, '', '/o/rentio/w/plant1/home/my-work');
      const r = render(<App />);
      const links = [...r.container.querySelectorAll<HTMLAnchorElement>('nav.rail .rail-list a.rail-item')].map((a) => a.getAttribute('href')!);
      r.unmount();
      for (const href of links) {
        window.history.pushState({}, '', href);
        const p = render(<App />);
        expect(p.container.querySelector('main')!.textContent, `${u} → ${href}`).not.toMatch(/No access to this page|Page not found/);
        p.unmount();
      }
    }
  });

  it('D01 clicks into own scoped Distributor stock and Returns; direct factory orders URL is still denied', () => {
    __setDb(createDb(new Date(), { dataset: 'demo' }));
    switchSession('u_dinesh', 'plant1');
    window.history.pushState({}, '', '/o/rentio/w/plant1/home/my-work');
    const r = render(<App />);
    fireEvent.click(screen.getByRole('link', { name: 'Dispatch & distributors' }));
    const main = () => r.container.querySelector('main')!.textContent ?? '';
    expect(window.location.pathname).toBe('/o/rentio/w/plant1/distribution/distributors');
    expect(main()).toContain('Shree Ganesh');
    expect(main()).not.toMatch(/Konkan|No access/);
    fireEvent.click(screen.getByRole('link', { name: 'Sales & returns' }));
    expect(window.location.pathname).toBe('/o/rentio/w/plant1/sales/returns');
    expect(main()).not.toMatch(/No access/);
    r.unmount();
    window.history.pushState({}, '', '/o/rentio/w/plant1/distribution/orders');
    const d = render(<App />);
    expect(d.container.querySelector('main')!.textContent).toContain('No access to this page');
    d.unmount();
  });

  it('the old work-queue inbox URL opens the Rentio Inbox (not the clinic inbox route)', () => {
    __setDb(createDb(new Date(), { dataset: 'demo' }));
    switchSession('u_dinesh', 'plant1');
    // shell item 6: the rail Inbox button was removed (owner, 2026-11-25); the old clinic route still lands on Home › Inbox
    window.history.pushState({}, '', '/o/rentio/w/plant1/work/inbox');
    const r = render(<App />);
    expect(window.location.pathname).toBe('/o/rentio/w/plant1/home/inbox');
    expect(r.container.querySelector('main')!.textContent).not.toMatch(/Page not found|No access/);
    r.unmount();
  });
});
