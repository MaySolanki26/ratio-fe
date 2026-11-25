/**
 * Final owner/dashboard retest (BA retest #4–#6): one read-scoped replenishment list for the dashboard and
 * the detail page, scope-filtered incident children (live rule, then link-time snapshot), expired partner
 * confirmations that must not reopen an accepted hand-off, raw supply timing on plant-local dates, and the
 * owner chart shortcut / placement.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../App';
import { useDomain } from '../domain/active';
import { ractor } from '../domain/rentio/access';
import { buildRentio, rentioDomain } from '../domain/rentio/domain';
import { type Ctx, execute, RError } from '../domain/rentio/engine';
import { childRef, closeIncident, createIncident, incidentView, RESTRICTED_TITLE } from '../domain/rentio/incidents';
import { confirmPartnerStock, openSuggestions, reviewSuggestion, scopedSuggestions, suggestions } from '../domain/rentio/replenish';
import { alerts, alertVisibleTo, distributorOverview } from '../domain/rentio/views';
import { __setDb, createDb, getDb, storageKey } from '../services/db';
import { switchSession } from '../services/settings';
import type { Db } from '../services/types';

useDomain(rentioDomain);

const NOW = new Date().toISOString();
const WS = '/o/rentio/w/plant1';
const fresh = () => {
  const r = buildRentio(new Date(NOW), 'demo');
  return { records: r.records, audit: [], session: { userId: 'u_owner', workspaceId: 'plant1' }, ...r.extra } as unknown as Db;
};
function tx<T>(db: Db, user: string, fn: (ctx: Ctx) => T, at = NOW): { db: Db; result?: T; code: string; message?: string } {
  const draft = structuredClone(db);
  try {
    const r = execute(draft, ractor(user), { label: 'test', now: at, at }, fn);
    return { db: draft, result: r.result, code: 'ok' };
  } catch (e) {
    return { db, code: e instanceof RError ? e.code : String(e), message: e instanceof Error ? e.message : String(e) };
  }
}
const partnerKeys = (db: Db, user: string) => scopedSuggestions(db, ractor(user), NOW).filter((x) => x.kind === 'partner').map((x) => x.partyId);

let db: Db;
beforeEach(() => {
  db = fresh();
});

describe('#4 replenishment read scope — one scoped list for every surface', () => {
  it('Owner / Back Office see all partners; Factory Head sees plant only; partner roles see only their own', () => {
    const allPartners = suggestions(db, NOW).filter((x) => x.kind === 'partner').map((x) => x.partyId);
    expect(allPartners).toEqual(expect.arrayContaining(['D04', 'D17']));
    expect(partnerKeys(db, 'u_owner')).toEqual(allPartners);
    expect(partnerKeys(db, 'u_kiran')).toEqual(allPartners);
    const fh = scopedSuggestions(db, ractor('u_fhead'), NOW);
    expect(fh.filter((x) => x.kind === 'partner')).toEqual([]);
    expect(fh.map((x) => x.kind)).toEqual(expect.arrayContaining(['raw', 'stores']));
    // distributor D01: own partner item at most, never plant items or other partners
    const dinesh = scopedSuggestions(db, ractor('u_dinesh'), NOW);
    expect(dinesh.every((x) => x.kind === 'partner' && x.partyId === 'D01')).toBe(true);
    expect(scopedSuggestions(db, ractor('u_rohit'), NOW).every((x) => x.kind === 'partner' && ['D01', 'D02', 'D03'].includes(x.partyId!))).toBe(true);
  });

  it('Factory Head cannot review or confirm a partner outside scope (domain refuses, not just the UI)', () => {
    expect(tx(db, 'u_fhead', (ctx) => reviewSuggestion(ctx, { key: 'partner:D04', decision: 'accepted', reason: 'x' })).code).toBe('forbidden');
    expect(tx(db, 'u_rohit', (ctx) => confirmPartnerStock(ctx, { distributorId: 'D17', kg: 10, note: 'call' })).code).toBe('forbidden');
  });
});

/** A run alert Factory Head can read, and a partner alert it cannot. */
const pick = (d: Db, now = NOW) => {
  const live = alerts(d, now);
  const fh = ractor('u_fhead');
  const seen = live.find((a) => a.key.startsWith('run:') && alertVisibleTo(d.rentio!, fh, a))!;
  const hidden = live.find((a) => a.scope.distributorId && !alertVisibleTo(d.rentio!, fh, a))!;
  return { seen, hidden };
};
/** Owner-entered title that names the restricted partner. */
const partnerTitle = (partner: string) => `Cleaning delay and ${partner} supply`;

describe('#4 incidents respect the alert read scope', () => {
  it('Owner groups a partner alert Factory Head cannot read: FH sees counts but no incident title, child title, owner, note or close summary', () => {
    const { seen, hidden } = pick(db);
    expect(seen && hidden).toBeTruthy();
    const partner = hidden.scope.distributorId!;
    // FH cannot group what it cannot read (reported as not open — existence not revealed)
    expect(tx(db, 'u_fhead', (ctx) => createIncident(ctx, { title: 'x', leadId: 'u_fhead', alertRefs: [childRef(seen), childRef(hidden)] })).code).toBe('not_found');
    const c = tx(db, 'u_owner', (ctx) => createIncident(ctx, { title: partnerTitle(partner), leadId: 'u_fhead', alertRefs: [childRef(seen), childRef(hidden)], note: `Owner note about ${hidden.title}` }));
    expect(c.code).toBe('ok');
    const inc = c.result!;
    // the read rule is snapshotted on each child
    expect(inc.children.find((k) => k.ref === childRef(hidden))!.scope).toEqual(hidden.scope);

    const owner = incidentView(c.db, ractor('u_owner'), NOW, inc);
    expect(owner.shown).toHaveLength(2);
    expect(owner.notes).toHaveLength(1);
    expect(owner.title).toBe(partnerTitle(partner));
    expect(owner.label).toBe(`${inc.id} · ${partnerTitle(partner)}`);
    const fh = incidentView(c.db, ractor('u_fhead'), NOW, inc);
    expect(fh.listed).toBe(true);
    expect(fh.title).toBe(RESTRICTED_TITLE);
    expect(fh.label).toBe(`${inc.id} · ${RESTRICTED_TITLE}`);
    expect(fh.label).not.toContain(partner);
    // the "already part of" refusal names the incident by the same rule (the linked alert is checked first)
    const conflict = tx(c.db, 'u_fhead', (ctx) => createIncident(ctx, { title: 'y', leadId: 'u_fhead', alertRefs: [childRef(seen), 'unused:X'] }));
    expect(conflict.code).toBe('conflict');
    expect(conflict.message).toContain(`${inc.id} · ${RESTRICTED_TITLE}`);
    expect(conflict.message).not.toContain(partner);
    expect(fh.shown.map((k) => k.ref)).toEqual([childRef(seen)]);
    expect(fh.hidden).toBe(1);
    expect(fh.notes).toEqual([]);
    expect(fh.hiddenNotes).toBe(1);

    // FH (the lead) still coordinates; the refusal to close does not name the hidden child
    const cl = tx(c.db, 'u_fhead', (ctx) => closeIncident(ctx, { incidentId: inc.id, note: 'x' }));
    expect(cl.code).toBe('business_rule');
    expect(cl.message).toContain('1 outside your area of work');
    expect(cl.message).not.toContain(hidden.title);
  });

  it('resolved children use the link-time snapshot; legacy children without one stay hidden from scoped roles', () => {
    const { seen, hidden } = pick(db);
    const c = tx(db, 'u_owner', (ctx) => createIncident(ctx, { title: 'snap', leadId: 'u_owner', alertRefs: [childRef(seen), childRef(hidden)] }));
    const inc = structuredClone(c.result!);
    // simulate the partner alert resolving (gone from the live list) and a pre-snapshot legacy child
    inc.children[1].ref = 'gone:X1';
    inc.children.push({ ...inc.children[1], ref: 'legacy:X2', roles: undefined, scope: undefined, ownerId: 'u_kiran' });
    const fh = incidentView(c.db, ractor('u_fhead'), NOW, inc);
    expect(fh.kids.filter((k) => k.state === 'resolved')).toHaveLength(2);
    expect(fh.shown.map((k) => k.ref)).toEqual([childRef(seen)]);
    expect(incidentView(c.db, ractor('u_owner'), NOW, inc).shown).toHaveLength(3);
    expect(incidentView(c.db, ractor('u_kiran'), NOW, inc).shown.map((k) => k.ref)).toEqual(expect.arrayContaining(['gone:X1', 'legacy:X2']));
  });
});

describe('#5 expired partner confirmation never reopens an old hand-off', () => {
  const LATER = new Date(Date.parse(NOW) + 25 * 3_600_000).toISOString();

  it('accepted on a confirmation equal to the app value → after expiry the review needs review again; history kept', () => {
    const app = distributorOverview(db, NOW).find((d) => d.id === 'D17')!;
    expect(app.stale).toBe(true);
    const conf = tx(db, 'u_kiran', (ctx) => confirmPartnerStock(ctx, { distributorId: 'D17', kg: app.available / 1000, note: 'Phoned D17 — same as the app' }));
    const acc = tx(conf.db, 'u_kiran', (ctx) => reviewSuggestion(ctx, { key: 'partner:D17', decision: 'accepted', reason: 'Confirmed by phone' }));
    expect(acc.code).toBe('ok');
    expect(acc.result!.basis).toBe('confirmed');
    const now = suggestions(acc.db, NOW).find((x) => x.key === 'partner:D17')!;
    expect(now.review).toMatchObject({ decision: 'accepted', stale: false });

    const later = suggestions(acc.db, LATER).find((x) => x.key === 'partner:D17')!;
    expect(later.qty).toBe(now.qty); // same amount …
    expect(later.needsConfirmation).toBe(true);
    expect(later.review).toMatchObject({ decision: 'accepted', stale: true, staleReason: 'data' }); // … but no longer a valid hand-off
    expect(openSuggestions([later])).toHaveLength(1);
    // not a "duplicate"; accepting again needs a fresh confirmation; deferring is allowed
    expect(tx(acc.db, 'u_kiran', (ctx) => reviewSuggestion(ctx, { key: 'partner:D17', decision: 'accepted', reason: 'again' }), LATER).code).toBe('business_rule');
    const def = tx(acc.db, 'u_kiran', (ctx) => reviewSuggestion(ctx, { key: 'partner:D17', decision: 'deferred', reason: 'Waiting for D17 to sync' }), LATER);
    expect(def.code).toBe('ok');
    expect(def.result!.basis).toBe('stale');
    expect(suggestions(def.db, LATER).find((x) => x.key === 'partner:D17')!.review).toMatchObject({ decision: 'deferred', stale: false });
    expect(def.db.rentio!.replenishReviews!.map((r) => r.decision)).toEqual(['accepted', 'deferred']);
  });

  it('a genuinely current app feed keeps the accepted review valid (no over-suppression)', () => {
    const app = distributorOverview(db, NOW).find((d) => d.id === 'D17')!;
    const conf = tx(db, 'u_kiran', (ctx) => confirmPartnerStock(ctx, { distributorId: 'D17', kg: app.available / 1000, note: 'Phoned D17' }));
    const acc = tx(conf.db, 'u_kiran', (ctx) => reviewSuggestion(ctx, { key: 'partner:D17', decision: 'accepted', reason: 'ok' }));
    const synced = structuredClone(acc.db);
    synced.records.distributors!.find((d) => d.id === 'D17')!.lastSyncHoursAgo = 1;
    const x = suggestions(synced, LATER).find((v) => v.key === 'partner:D17')!;
    expect(x.needsConfirmation).toBe(false);
    expect(x.review).toMatchObject({ decision: 'accepted', stale: false });
  });
});

describe('#5 raw open supply timing (plant-local dates, whole-kg label)', () => {
  const raw = (d: Db, now = NOW) => suggestions(d, now).find((x) => x.key === 'raw:TOOR')!;
  const val = (x: ReturnType<typeof raw>, label: RegExp) => x.inputs.find((i) => label.test(i.label));
  const istDay = (iso: string, plus = 0) => new Date(Date.parse(iso) + 330 * 60_000 + plus * 86_400_000).toISOString().slice(0, 10);

  it('an already-passed promised date is late, not timely; a missing date is listed separately', () => {
    const base = raw(db);
    expect(val(base, /^Open purchases arriving/)!.source).toMatch(/PO-RT-002/);
    const late = structuredClone(db);
    late.rentio!.purchases.find((p) => p.id === 'PO-RT-002')!.promisedDate = istDay(NOW, -1);
    const x = raw(late);
    expect(val(x, /^Open purchases arriving/)!.source).not.toMatch(/PO-RT-002/);
    expect(val(x, /promised date already passed/)!.source).toMatch(/PO-RT-002/);
    expect(val(x, /after the 3-day lead time/)!.source).toMatch(/PO-RT-005/);
    expect(x.qty).toBeGreaterThan(base.qty); // late supply no longer reduces the need
    const undated = structuredClone(db);
    delete undated.rentio!.purchases.find((p) => p.id === 'PO-RT-002')!.promisedDate;
    expect(val(raw(undated), /no promised date/)!.source).toMatch(/PO-RT-002/);
  });

  it('forward clock: a demo seeded on any later date promises PO-RT-002 for plant tomorrow, counted as timely; once past it is late', () => {
    // a week ahead, plus a 20:00 UTC seed where the IST date is already the next day. (Seeding ~60 days ahead
    // fails in other fixtures with fixed stock dates — a separate, pre-existing limit.)
    for (const seed of [new Date(Date.parse(NOW) + 7 * 86_400_000).toISOString(), `${istDay(NOW, 3)}T20:00:00.000Z`]) {
      const r = buildRentio(new Date(seed), 'demo');
      const d = { records: r.records, audit: [], session: { userId: 'u_owner', workspaceId: 'plant1' }, ...r.extra } as unknown as Db;
      const po = d.rentio!.purchases.find((p) => p.id === 'PO-RT-002')!;
      expect(po.promisedDate).toBe(istDay(seed, 1));
      expect(val(raw(d, seed), /^Open purchases arriving/)!.source).toMatch(/PO-RT-002 3,000 kg/);
      expect(val(raw(d, seed), /promised date already passed/)).toBeUndefined();
      // two days after the seed the promise has genuinely passed → excluded as late
      const after = new Date(Date.parse(seed) + 2 * 86_400_000).toISOString();
      expect(val(raw(d, after), /^Open purchases arriving/)!.source).not.toMatch(/PO-RT-002/);
      expect(val(raw(d, after), /promised date already passed/)!.source).toMatch(/PO-RT-002/);
    }
  });

  it('formula states the real grams → whole-kg rounding; order-by uses the plant (IST) date', () => {
    const x = raw(db);
    expect(x.formula).toMatch(/rounded down to whole kg/);
    expect(x.formula).not.toMatch(/1,000 kg/);
    expect(x.qty % 1000).toBe(0);
    const lateEvening = `${NOW.slice(0, 10)}T20:00:00.000Z`; // 01:30 IST next day
    expect(raw(db, lateEvening).orderBy).toBe(istDay(lateEvening));
    expect(raw(db, lateEvening).orderBy).not.toBe(lateEvening.slice(0, 10));
  });
});

describe('owner overview UI (#4 leak, #6 charts)', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    const d = createDb(new Date(), { dataset: 'demo' });
    localStorage.setItem(storageKey(), JSON.stringify(d));
    __setDb(d);
  });
  function as(user: string, page: string) {
    cleanup();
    switchSession(user, 'plant1');
    window.history.pushState({}, '', `${WS}/${page}`);
    return render(<App />);
  }
  const panel = (name: string) => document.querySelector(`section[aria-label="${name}"]`) as HTMLElement | null;

  it('Factory Head dashboard Replenishment panel matches the detail page: plant only, no partner ids', () => {
    as('u_fhead', 'dashboard');
    const rp = panel('Replenishment to review')!;
    expect(rp).toBeTruthy();
    expect(rp.textContent).not.toMatch(/D\d\d ·/);
    const expected = openSuggestions(scopedSuggestions(getDb(), ractor('u_fhead'), new Date().toISOString())).length;
    expect(rp.textContent).toContain(`${expected} suggestion(s)`);
    as('u_fhead', 'planning/replenish');
    expect(document.body.textContent).not.toMatch(/D\d\d ·/);
    as('u_owner', 'dashboard');
    expect(panel('Replenishment to review')!.textContent).toMatch(/D04 · /);
  });

  it('an incident title naming a restricted partner is replaced by the neutral label on every Factory Head surface; Owner sees it', () => {
    const now = new Date().toISOString();
    const d = structuredClone(getDb());
    const { seen, hidden } = pick(d, now);
    const partner = hidden.scope.distributorId!;
    const inc = execute(d, ractor('u_owner'), { label: 'test', now, at: now }, (ctx) => createIncident(ctx, { title: partnerTitle(partner), leadId: 'u_fhead', alertRefs: [childRef(seen), childRef(hidden)] })).result;
    localStorage.setItem(storageKey(), JSON.stringify(d));
    __setDb(d);
    const restricted = `${inc.id} · ${RESTRICTED_TITLE}`;
    for (const page of ['dashboard', 'home/incidents']) {
      as('u_fhead', page);
      expect(document.body.textContent).not.toContain(partnerTitle(partner));
      expect(document.body.textContent).toContain(restricted);
    }
    // "Part of INC-…" tag on the Factory Head's own linked alert
    as('u_fhead', 'home/alerts');
    expect(document.body.textContent).toContain(`Part of ${inc.id}`);
    expect(document.body.textContent).not.toContain(partnerTitle(partner));
    expect(document.body.textContent).toContain(RESTRICTED_TITLE);
    for (const page of ['dashboard', 'home/incidents']) {
      as('u_owner', page);
      expect(document.body.textContent).toContain(`${inc.id} · ${partnerTitle(partner)}`);
      expect(document.body.textContent).not.toContain(RESTRICTED_TITLE);
    }
  });

  it('the header shortcut and intro line are hidden; the charts come straight after the KPIs (owner, 2026-11-25)', () => {
    as('u_owner', 'dashboard');
    expect(screen.queryByRole('link', { name: 'View stock and delivery charts' })).toBeNull();
    expect(document.body.textContent).not.toContain('live from staff postings');
    // the stock flow card is hidden; the production route is drawn as one line of stations
    expect(screen.queryByRole('figure', { name: 'Where the stock is now' })).toBeNull();
    expect(screen.getByRole('figure', { name: 'Production route — material at each stage' })).toBeTruthy();
    const charts = document.getElementById('owner-charts')!;
    expect(within(charts).getByRole('figure', { name: 'Factory finished stock by grade' })).toBeTruthy();
    expect(within(charts).getByRole('figure', { name: 'Delivery outcome by distributor' })).toBeTruthy();
    const order = [...document.querySelectorAll('section[aria-label]')].map((x) => x.getAttribute('aria-label'));
    const i = (n: string) => order.indexOf(n);
    expect(i('Needs your decision')).toBeLessThan(i('Top risks'));
    // owner 2026-11-25: the four charts sit right after the KPI row, before decisions and risks
    expect(i('Owner charts')).toBeGreaterThanOrEqual(0);
    expect(i('Owner charts')).toBeLessThan(i('Needs your decision'));
    expect(i('Owner charts')).toBeLessThan(i('Replenishment to review'));
  });
});
