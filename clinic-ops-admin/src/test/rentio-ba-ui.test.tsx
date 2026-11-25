/**
 * BA closure — the four new demos driven through the normal UI (fresh demo snapshot, scoped users):
 * repack record → QC release, multi-stop dispatch → stop outcomes by two distributors, incident create →
 * close gating, replenishment accept → prefilled order form; plus the owner charts.
 */
import { act as rtlAct, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../App';
import { useDomain } from '../domain/active';
import { rentioDomain } from '../domain/rentio/domain';
import { computePositions } from '../domain/rentio/engine';
import { kg } from '../domain/rentio/units';
import { __setDb, createDb, getDb, storageKey } from '../services/db';
import { switchSession } from '../services/settings';

useDomain(rentioDomain);

const WS = '/o/rentio/w/plant1';
const at = (lot: string, loc: string) => computePositions(getDb().rentio!).get(`${lot}|${loc}`) ?? 0;

beforeEach(() => {
  cleanup();
  localStorage.clear();
  const db = createDb(new Date(), { dataset: 'demo' });
  localStorage.setItem(storageKey(), JSON.stringify(db));
  __setDb(db);
});

/** Sign in as a demo user (in-session switcher) and open a page. */
function as(user: string, page: string) {
  cleanup();
  switchSession(user, 'plant1');
  window.history.pushState({}, '', `${WS}/${page}`);
  return render(<App />);
}
const dialog = () => screen.getByRole('dialog');
const field = (label: RegExp) => within(dialog()).getByLabelText(label) as HTMLInputElement;
const set = (label: RegExp, value: string) => fireEvent.change(field(label), { target: { value } });
const click = (name: RegExp, scope: HTMLElement = document.body) => rtlAct(() => void fireEvent.click(within(scope).getByRole('button', { name })));

describe('BA-1 repack through Godowns & stacks', () => {
  it('Ravi records 200 → 199 × 1 kg + 1 kg loss; source intact until Meera releases; then posted once', () => {
    as('u_ravi', 'stock/godowns');
    click(/^Record repack$/);
    set(/Packed lot and stack/, 'MIG-0030@F1-S04');
    set(/Released net input/, '200');
    set(/Target pack size/, '1');
    set(/New packs filled/, '199');
    set(/Measured net of new packs/, '199');
    set(/Packaging used/, 'POUCH-1-B01');
    set(/Real loss/, '1');
    set(/Loss reason/, 'Spillage while opening torn bags');
    expect(dialog().textContent).toContain('Balanced ✓');
    click(/Submit for QC release/, dialog());
    const rp = getDb().rentio!.repacks!;
    expect(rp).toHaveLength(1);
    expect(rp[0].status).toBe('pending_qc');
    expect(at('MIG-0030', 'F1-S04')).toBe(kg(250));
    // maker cannot release: button explains why
    const ravisRelease = screen.getByRole('button', { name: /Release & post/ });
    expect(ravisRelease.getAttribute('aria-disabled') === 'true' || (ravisRelease as HTMLButtonElement).disabled).toBe(true);
    as('u_meera', `stock/godowns?focus=${rp[0].id}`);
    click(/Release & post/);
    click(/Release and post/, dialog());
    const done = getDb().rentio!.repacks![0];
    expect(done.status).toBe('posted');
    expect(at(done.childLotId!, 'F1-S04')).toBe(kg(199));
    expect(at('MIG-0030', 'F1-S04')).toBe(kg(50));
    expect(at('POUCH-1-B01', 'STORES')).toBe(21_000);
  });

  it('an unbalanced entry is shown in the preview and refused without changing stock', () => {
    as('u_ravi', 'stock/godowns');
    click(/^Record repack$/);
    set(/Packed lot and stack/, 'MIG-0030@F1-S04');
    set(/Released net input/, '200');
    set(/Target pack size/, '1');
    set(/New packs filled/, '199');
    set(/Measured net of new packs/, '199');
    set(/Packaging used/, 'POUCH-1-B01');
    expect(dialog().textContent).toMatch(/1 kg unbalanced/);
    click(/Submit for QC release/, dialog());
    expect(dialog().textContent).toMatch(/Not posted — nothing changed/);
    expect(getDb().rentio!.repacks ?? []).toHaveLength(0);
  });
});

describe('BA-2 multi-stop trip through Trips & freight and Distributor stock', () => {
  it('Ravi dispatches one two-stop trip; Dinesh accepts stop 1; Farah part-accepts stop 2; owner sees both', () => {
    as('u_ravi', 'distribution/logistics');
    click(/Dispatch multi-stop trip/);
    click(/^Dispatch trip$/, dialog());
    const trip = getDb().rentio!.trips.find((t) => t.stops?.length)!;
    expect(trip.stops!.map((x) => x.distributorId)).toEqual(['D01', 'D02']);

    as('u_dinesh', 'distribution/distributors?d=D01');
    click(/Record stop outcome/);
    set(/Proof reference/, 'POD-D01-001.jpg');
    click(/Submit & lock stop/, dialog());
    expect(getDb().rentio!.trips.find((t) => t.id === trip.id)!.stops![0].outcome).toBe('accepted');
    // the D02 stop is not visible to Dinesh
    expect(document.body.textContent).not.toContain(trip.stops![1].shipmentId);

    as('u_farah', 'distribution/distributors?d=D02');
    click(/Record stop outcome/);
    set(/^Outcome/, 'part_accepted');
    set(/Accepted good quantity/, '150');
    set(/Proof reference/, 'POD-D02-001.jpg');
    set(/^Reason/, '4 bags wet from rain — refused');
    expect(dialog().textContent).toMatch(/Refused — stays in transit100 kg/);
    click(/Submit & lock stop/, dialog());
    const t2 = getDb().rentio!.trips.find((t) => t.id === trip.id)!;
    expect(t2.stops!.map((x) => x.outcome)).toEqual(['accepted', 'part_accepted']);
    expect(at('MIG-0031', 'DIST:D02')).toBe(kg(150));

    as('u_owner', 'distribution/logistics');
    expect(document.body.textContent).toContain('All stops recorded — 100 kg unresolved');
    expect(document.body.textContent).toMatch(/Accepted/);
    expect(document.body.textContent).toMatch(/Part accepted/);
    as('u_ravi', `distribution/logistics?focus=${trip.id}%232`);
    click(/Return to factory/);
    set(/Disposition reason/, 'Wet bags back for QC');
    click(/Move to factory quarantine/, dialog());
    expect(at('MIG-0031', 'QUAR')).toBe(kg(100));
  });
});

describe('BA-3 incident through Incidents', () => {
  it('Sunita groups the RT-002 delay and the D02 risk; close is blocked while children are open; Kiran sees the tag', () => {
    as('u_fhead', 'home/incidents');
    click(/Group alerts into incident/);
    set(/Incident name/, 'RT-002 cleaning delay & D02 supply');
    const boxes = within(dialog()).getAllByRole('checkbox') as HTMLInputElement[];
    const pick = (re: RegExp) => fireEvent.click(boxes.find((b) => re.test(b.closest('label')?.textContent ?? ''))!);
    pick(/Cleaning .*RT-002/);
    pick(/cannot ship: reserved/);
    click(/Create incident/, dialog());
    const inc = getDb().rentio!.incidents![0];
    expect(inc.children).toHaveLength(2);
    const close = screen.getByRole('button', { name: /Close incident/ });
    expect(close.getAttribute('aria-disabled') === 'true' || (close as HTMLButtonElement).disabled).toBe(true);
    as('u_kiran', 'home/alerts');
    expect(document.body.textContent).toContain(`Part of ${inc.id}`);
    as('u_suresh', 'home/my-work');
    expect(document.body.textContent).toContain(`Part of ${inc.id}`);
    as('u_owner', 'dashboard');
    expect(document.body.textContent).toContain(`${inc.id} · RT-002 cleaning delay & D02 supply`);
  });
});

describe('BA-4 replenishment through the suggestions page', () => {
  it('Kiran accepts D04 (posts nothing) and the hand-off opens the order form prefilled; D17 needs confirmation', () => {
    const orders = getDb().rentio!.orders.length;
    as('u_kiran', 'planning/replenish');
    const row = screen.getByText(/D04 ·/).closest('tr')!;
    click(/^Accept$/, row);
    set(/Note/, 'Agreed by phone');
    click(/Accept \(posts nothing\)/, dialog());
    expect(getDb().rentio!.orders.length).toBe(orders);
    const d17 = screen.getByText(/D17 ·/).closest('tr')!;
    const acc = within(d17).getByRole('button', { name: /^Accept\b/ });
    expect((acc as HTMLButtonElement).disabled).toBe(true);
    expect(acc.textContent).toMatch(/Confirm the current stock first/);
    const link = within(screen.getByText(/D04 ·/).closest('tr')!).getByRole('link', { name: /new factory order prefilled/ });
    const href = link.getAttribute('href')!;
    as('u_kiran', href.replace(`${WS}/`, ''));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(field(/Distributor/).value).toBe('D04');
    expect(getDb().rentio!.orders.length).toBe(orders);
  });
});

describe('owner charts', () => {
  it('two zero-baseline charts with legends and table equivalents that match the ledger', () => {
    as('u_owner', 'dashboard');
    const fig = screen.getByRole('figure', { name: 'Factory finished stock by grade' });
    expect(within(fig).getByLabelText('Legend').textContent).toMatch(/Free to sell.*Reserved.*Held/);
    expect(fig.textContent).toContain('0 kg');
    const del = screen.getByRole('figure', { name: 'Delivery outcome by distributor' });
    expect(del.textContent).toMatch(/Received good/);
    expect(within(fig).getByRole('table')).toBeTruthy();
    // decisions come first
    const order = [...document.querySelectorAll('section[aria-label]')].map((x) => x.getAttribute('aria-label'));
    expect(order.indexOf('Owner charts')).toBeGreaterThan(order.indexOf(order.find((x) => /decision|Needs you/i.test(x ?? '')) ?? ''));
  });
});
