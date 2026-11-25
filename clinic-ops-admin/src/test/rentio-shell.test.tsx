/**
 * Shell items 6–8: working Rentio Inbox (scoped per person, exact-record links, read state),
 * demo logout + login screen (persisted signed-out state, bookmark return), and light-first theme
 * stored per demo user.
 */
import { act as rtlAct, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { useDomain } from '../domain/active';
import { clinicDomain } from '../domain/clinic/domain';
import { ractor } from '../domain/rentio/access';
import { rentioDomain } from '../domain/rentio/domain';
import { inboxItems } from '../rentio/inbox';
import { __setDb, createDb, getDb, storageKey } from '../services/db';
import { getSettings, isSignedIn, switchSession, usesLoginGate } from '../services/settings';
import type { Db } from '../services/types';

useDomain(rentioDomain);

const WS = '/o/rentio/w/plant1';
const html = () => document.documentElement;

/** Browser refresh: drop the in-memory store and load it again from localStorage. */
const reload = () => __setDb(JSON.parse(localStorage.getItem(storageKey())!) as Db);

/** A fresh browser: seeded data saved, no sign-in marker. */
const freshBrowser = () => {
  localStorage.clear();
  const db = createDb(new Date(), { dataset: 'demo' });
  localStorage.setItem(storageKey(), JSON.stringify(db));
  __setDb(db);
};

const open = (url: string) => {
  window.history.pushState({}, '', url);
  return render(<App />);
};

function mockMedia(matches: (q: string) => boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({ matches: matches(query), media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }),
  });
}

beforeEach(() => {
  html().removeAttribute('data-theme');
});
afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia;
});

const signInButtons = () => screen.queryAllByRole('button', { name: /^Sign in as / });

describe('demo login screen', () => {
  it('a fresh browser shows the chooser (not an automatic Owner session) with all 15 users by role', () => {
    freshBrowser();
    const r = open('/');
    expect(window.location.pathname).toBe('/login');
    expect(r.container.textContent).toContain('Local demo sign-in — no password, simulated roles, fictional data');
    const buttons = signInButtons();
    expect(buttons).toHaveLength(15);
    for (const [name, role] of [
      ['Vikram Mehta', 'Owner'],
      ['Sunita Rao', 'Factory Head'],
      ['Suresh Yadav', 'Stage Owner'],
      ['Anil Kumar', 'Stage Owner'],
      ['Prakash Jadhav', 'Stage Owner'],
      ['Deepa Nair', 'Stage Owner'],
      ['Kiran Shah', 'Back Office'],
      ['Meera Iyer', 'QC'],
      ['Ravi Patil', 'Godown'],
      ['Dinesh Agarwal', 'Distributor'],
      ['Farah Khan', 'Distributor'],
      ['Rohit Verma', 'Salesman'],
      ['Neha Joshi', 'Accounts'],
      ['Pooja Desai', 'HR'],
      ['Arjun Menon', 'Admin'],
    ])
      expect(buttons.some((b) => b.getAttribute('aria-label')!.startsWith(`Sign in as ${name}, `) && b.getAttribute('aria-label')!.toLowerCase().includes(role.toLowerCase().split(' ')[0])), `${name} · ${role}`).toBe(true);
    // grouped by role
    expect(within(screen.getByRole('region', { name: /Stage owner/i })).getAllByRole('button')).toHaveLength(4);
    // no business figures on the sign-in screen
    expect(r.container.textContent).not.toMatch(/\bkg\b|₹|RT-00\d|alert/i);
    expect(r.container.querySelector('.rt-panel, .rail, main#main')).toBeNull();
    expect(isSignedIn()).toBe(false);
    r.unmount();
  });

  it('search filters by name and by role', () => {
    freshBrowser();
    const r = open('/login');
    const box = screen.getByRole('searchbox', { name: 'Search demo users' });
    fireEvent.change(box, { target: { value: 'farah' } });
    expect(signInButtons().map((b) => b.getAttribute('aria-label'))).toEqual([expect.stringMatching(/^Sign in as Farah Khan/)]);
    fireEvent.change(box, { target: { value: 'stage owner' } });
    expect(signInButtons()).toHaveLength(4);
    fireEvent.change(box, { target: { value: 'zzz' } });
    expect(signInButtons()).toHaveLength(0);
    expect(r.container.textContent).toContain('No demo user matches');
    r.unmount();
  });

  it('Vikram lands on the owner overview; Anil lands on My work', () => {
    freshBrowser();
    const r = open('/');
    fireEvent.click(screen.getByRole('button', { name: /^Sign in as Vikram Mehta/ }));
    expect(window.location.pathname).toBe(`${WS}/dashboard`);
    expect(getDb().session.userId).toBe('u_owner');
    r.unmount();

    freshBrowser();
    const r2 = open('/');
    fireEvent.click(screen.getByRole('button', { name: /^Sign in as Anil Kumar/ }));
    expect(window.location.pathname).toBe(`${WS}/home/my-work`);
    expect(r2.container.textContent).toContain('My work');
    r2.unmount();
  });

  it('log out → login screen; protected URLs and refresh stay there; business data is untouched', () => {
    freshBrowser();
    switchSession('u_owner', 'plant1');
    const before = JSON.stringify(getDb().rentio);
    const records = JSON.stringify(getDb().records);
    const r = open(`${WS}/stock/inventory`);
    fireEvent.click(screen.getByRole('button', { name: 'Account: Vikram Mehta, Owner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(window.location.pathname).toBe('/login');
    expect(signInButtons()).toHaveLength(15);
    expect(isSignedIn()).toBe(false);
    r.unmount();
    // business data unchanged in memory and in storage
    expect(JSON.stringify(getDb().rentio)).toBe(before);
    expect(JSON.stringify(getDb().records)).toBe(records);
    reload();
    expect(JSON.stringify(getDb().rentio)).toBe(before);
    // refresh on a protected page (or Back to one) → still the login screen
    for (const url of [`${WS}/dashboard`, `${WS}/stock/inventory`, `${WS}/home/inbox`, '/u/u_owner/my-work', '/']) {
      reload();
      const p = open(url);
      expect(window.location.pathname, url).toBe('/login');
      expect(p.container.querySelector('.rail')).toBeNull();
      p.unmount();
    }
  });

  it('a bookmarked page opens after sign-in when the chosen person may open it; otherwise their landing', () => {
    freshBrowser();
    const r = open(`${WS}/distribution/orders?focus=SO-1`);
    expect(window.location.pathname).toBe('/login');
    expect(new URLSearchParams(window.location.search).get('next')).toBe(`${WS}/distribution/orders?focus=SO-1`);
    fireEvent.click(screen.getByRole('button', { name: /^Sign in as Kiran Shah/ }));
    expect(window.location.pathname + window.location.search).toBe(`${WS}/distribution/orders?focus=SO-1`);
    r.unmount();

    freshBrowser();
    const d = open(`${WS}/distribution/orders`);
    fireEvent.click(screen.getByRole('button', { name: /^Sign in as Dinesh Agarwal/ }));
    expect(window.location.pathname).toBe(`${WS}/home/my-work`);
    d.unmount();
  });

  it('the in-session role switcher still works and lands staff on My work', () => {
    freshBrowser();
    switchSession('u_owner', 'plant1');
    const r = open(`${WS}/dashboard`);
    fireEvent.click(screen.getByRole('button', { name: 'Account: Vikram Mehta, Owner' }));
    fireEvent.click(screen.getByRole('button', { name: /Anil Kumar/ }));
    expect(getDb().session.userId).toBe('u_anil');
    expect(window.location.pathname).toBe(`${WS}/home/my-work`);
    r.unmount();
  });

  it('the clinic pack keeps its automatic session (no login gate)', () => {
    useDomain(clinicDomain);
    try {
      expect(usesLoginGate()).toBe(false);
      expect(isSignedIn()).toBe(true);
    } finally {
      useDomain(rentioDomain);
    }
    expect(usesLoginGate()).toBe(true);
  });
});

// ---------------------------------------------------------------- Inbox

const inboxRows = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('ul[aria-label="Inbox items"] > li')];

describe('Rentio Inbox', () => {
  it('items are role-specific, link to the exact record and never leak another distributor', () => {
    freshBrowser();
    const keys: Record<string, string[]> = {};
    for (const u of ['u_owner', 'u_kiran', 'u_anil', 'u_farah', 'u_dinesh']) {
      switchSession(u, 'plant1');
      const r = open(`${WS}/home/inbox`);
      const main = r.container.querySelector('main')!;
      expect(r.container.querySelector('.topbar')!.textContent, u).toContain('Inbox');
      expect(main.textContent, u).not.toMatch(/No access|Page not found/);
      const rows = inboxRows(main);
      keys[u] = rows.map((li) => li.dataset.key!);
      // each row opens the exact record in this workspace
      for (const li of rows) {
        const href = li.querySelector('a')!.getAttribute('href')!;
        expect(href.startsWith(`${WS}/`), href).toBe(true);
        expect(href, u).toContain('focus=');
      }
      if (!rows.length) expect(main.textContent).toContain('Nothing needs you right now');
      r.unmount();
    }
    // owner, back office and stage owner see different work
    expect(keys.u_owner.length).toBeGreaterThan(0);
    expect(keys.u_kiran.length).toBeGreaterThan(0);
    expect(keys.u_anil.length).toBeGreaterThan(0);
    expect(keys.u_owner).not.toEqual(keys.u_kiran);
    expect(keys.u_kiran).not.toEqual(keys.u_anil);
    // distributor isolation: Farah (D02) never sees D01 records, and Dinesh (D01) never sees D02
    const farah = inboxItems(getDb(), ractor('u_farah'), new Date().toISOString());
    // demo data: Farah has her own D02 receipt shortfall; Dinesh (D01) has nothing and gets the honest empty state
    expect(keys.u_farah).toContain('dsp:DSP-0001');
    expect(keys.u_dinesh).not.toContain('dsp:DSP-0001');
    // owner gets decisions (approvals) and serious exceptions; stage owner gets their own stage receipts
    expect(keys.u_owner.some((k) => k.startsWith('apr:'))).toBe(true);
    expect(keys.u_anil.every((k) => !k.startsWith('apr:') && !k.startsWith('stale:'))).toBe(true);
    for (const i of farah) expect(`${i.title} ${i.detail} ${i.link}`).not.toMatch(/\bD01\b/);
    const dinesh = inboxItems(getDb(), ractor('u_dinesh'), new Date().toISOString());
    for (const i of dinesh) expect(`${i.title} ${i.detail} ${i.link}`).not.toMatch(/\bD02\b/);
    // a stage owner only sees their own stages / factory work, not distributor or finance items
    const anil = inboxItems(getDb(), ractor('u_anil'), new Date().toISOString());
    for (const i of anil) expect(i.link).not.toMatch(/finance\/tally|distribution\/distributors/);
  });

  it('mark read / mark all read are per user and persist across refresh', () => {
    freshBrowser();
    switchSession('u_kiran', 'plant1');
    const r = open(`${WS}/home/inbox`);
    const main = () => r.container.querySelector('main')!;
    const unread = () => inboxRows(main()).filter((li) => li.classList.contains('is-unread')).length;
    const total = inboxRows(main()).length;
    const u0 = unread();
    expect(u0).toBeGreaterThan(1);
    const first = inboxRows(main()).find((li) => li.classList.contains('is-unread'))!;
    fireEvent.click(within(first).getByRole('button', { name: 'Mark read' }));
    expect(unread()).toBe(u0 - 1);
    expect(Object.keys(getSettings('u_kiran').inboxRead ?? {})).toContain(first.dataset.key);
    // the rail label carries the same unread count
    expect(screen.getByRole('button', { name: new RegExp(`^Inbox, ${u0 - 1} unread`) })).toBeInTheDocument();
    // unread filter
    fireEvent.click(screen.getByRole('radio', { name: /^Unread/ }));
    expect(inboxRows(main())).toHaveLength(u0 - 1);
    fireEvent.click(screen.getByRole('radio', { name: /^All open/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(unread()).toBe(0);
    expect(inboxRows(main())).toHaveLength(total); // read items stay until the work is done
    r.unmount();
    // another user's read state is independent
    expect(getSettings('u_meera').inboxRead ?? {}).toEqual({});
    reload();
    switchSession('u_kiran', 'plant1');
    const r2 = open(`${WS}/home/inbox`);
    expect(inboxRows(r2.container).filter((li) => li.classList.contains('is-unread'))).toHaveLength(0);
    r2.unmount();
  });

  it('opening an item marks it read and goes to the focused record', () => {
    freshBrowser();
    switchSession('u_kiran', 'plant1');
    const r = open(`${WS}/home/inbox`);
    const li = inboxRows(r.container)[0];
    const a = li.querySelector('a')!;
    const href = a.getAttribute('href')!;
    fireEvent.click(a);
    expect(window.location.pathname + window.location.search).toBe(href);
    expect(getSettings('u_kiran').inboxRead?.[li.dataset.key!]).toBeTruthy();
    r.unmount();
  });

  it('rail button, notification footer and the old work/inbox URL all open Home › Inbox', () => {
    freshBrowser();
    switchSession('u_dinesh', 'plant1');
    const r = open(`${WS}/work/inbox?x=1`);
    expect(window.location.pathname).toBe(`${WS}/home/inbox`);
    expect(r.container.querySelector('main')!.textContent).not.toMatch(/Page not found|No access/);
    r.unmount();
    const r2 = open(`${WS}/sales/returns`);
    fireEvent.click(screen.getByRole('button', { name: /^Inbox/ }));
    expect(window.location.pathname).toBe(`${WS}/home/inbox`);
    fireEvent.click(screen.getByRole('button', { name: /^Notifications/ }));
    const foot = screen.getByRole('link', { name: 'Open Inbox' });
    expect(foot.getAttribute('href')).toBe(`${WS}/home/inbox`);
    r2.unmount();
  });

  it('phone width: the navigation drawer offers Inbox and the list renders', () => {
    mockMedia((q) => q.includes('max-width'));
    freshBrowser();
    switchSession('u_anil', 'plant1');
    const r = open(`${WS}/home/my-work`);
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    fireEvent.click(within(document.querySelector<HTMLElement>('.mobile-modules')!).getByRole('link', { name: /^Inbox/ }));
    expect(window.location.pathname).toBe(`${WS}/home/inbox`);
    expect(inboxRows(r.container.querySelector('main')!).length).toBeGreaterThan(0);
    r.unmount();
  });
});

// ---------------------------------------------------------------- theme

const themeBtn = () => screen.getByRole('button', { name: 'Theme and colours' });
const pickMode = (mode: 'Light' | 'Dark' | 'System') => {
  fireEvent.click(themeBtn());
  fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Colour mode' })).getByRole('radio', { name: mode }));
};
const account = (name: RegExp) => screen.getByRole('button', { name });

describe('light theme first, explicit choice per demo user', () => {
  it('an unconfigured user is light even when the OS prefers dark; choices persist per user', async () => {
    mockMedia((q) => q.includes('prefers-color-scheme: dark'));
    freshBrowser();
    const login = open('/login');
    expect(html().getAttribute('data-theme')).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: /^Sign in as Vikram Mehta/ }));
    await rtlAct(async () => {});
    expect(html().getAttribute('data-theme')).toBe('light');
    pickMode('Dark');
    expect(html().getAttribute('data-theme')).toBe('dark');
    expect(getSettings('u_owner')).toMatchObject({ theme: 'dark', themeSet: true });
    login.unmount();

    // refresh keeps Vikram dark
    reload();
    const r = open(`${WS}/dashboard`);
    expect(html().getAttribute('data-theme')).toBe('dark');
    // switch to Kiran (unconfigured) → light
    fireEvent.click(account(/^Account: Vikram Mehta/));
    fireEvent.click(screen.getByRole('button', { name: /Kiran Shah/ }));
    expect(getDb().session.userId).toBe('u_kiran');
    expect(html().getAttribute('data-theme')).toBe('light');
    // back to Vikram → dark
    fireEvent.click(account(/^Account: Kiran Shah/));
    fireEvent.click(screen.getByRole('button', { name: /Vikram Mehta/ }));
    expect(html().getAttribute('data-theme')).toBe('dark');
    // log out → login is light; signing in again as Vikram → dark
    fireEvent.click(account(/^Account: Vikram Mehta/));
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(window.location.pathname).toBe('/login');
    expect(html().getAttribute('data-theme')).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: /^Sign in as Vikram Mehta/ }));
    expect(html().getAttribute('data-theme')).toBe('dark');
    r.unmount();
    // Kiran's settings were never made dark by Vikram's choice
    expect(getSettings('u_kiran').theme).toBe('light');
  });

  it('migration: a saved implicit "system" means no preference (light); a saved light/dark stays that user’s choice', () => {
    freshBrowser();
    const db = getDb();
    db.settings.u_meera = { ...getSettings('u_meera'), theme: 'system' } as never;
    delete (db.settings.u_meera as { themeSet?: boolean }).themeSet;
    db.settings.u_neha = { ...getSettings('u_neha'), theme: 'dark' } as never;
    delete (db.settings.u_neha as { themeSet?: boolean }).themeSet;
    expect(getSettings('u_meera').theme).toBe('light');
    expect(getSettings('u_neha').theme).toBe('dark');
    expect(getSettings('u_pooja').theme).toBe('light');
    // an explicit "System" choice made after this change is honoured
    db.settings.u_pooja = { ...getSettings('u_pooja'), theme: 'system', themeSet: true };
    expect(getSettings('u_pooja').theme).toBe('system');
    vi.restoreAllMocks();
  });
});
