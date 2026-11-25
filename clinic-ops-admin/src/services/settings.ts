/** Settings Resolver: personal preferences (local-only) layered on platform constraints. */
import { domain } from '../domain/active';
import type { Actor } from './authz';
import { commit, defaultSettings, getDb, storageKey } from './db';
import type { PersonalSettings } from './types';

/** Platform constraints a user cannot override. */
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 360;

export function getSettings(userId: string): PersonalSettings {
  const saved = getDb().settings[userId];
  let s = { ...defaultSettings(), ...(saved ?? {}) };
  // One-time move to the new default theme (Graphite Black) for settings saved before it existed.
  // Check the SAVED value — the defaults already carry themeRev 2 and would hide old settings.
  if (saved && (saved.themeRev ?? 1) < 2) s = { ...s, palette: 'graphite', themeRev: 2 };
  // Rentio is light-first. Theme is stored PER DEMO USER (db.settings[userId]), never globally.
  // Migration rule for settings saved before `themeSet` existed: the old default was 'system', so a
  // saved 'light'/'dark' can only come from that user's own click → kept as their explicit choice.
  // A saved 'system' without `themeSet` was written implicitly (any other personal setting saves the
  // whole object) → treated as NO preference → light, never the OS dark mode. Choosing "System" in
  // the theme picker after this change sets `themeSet` and is honoured.
  if (domain().id === 'rentio' && !s.themeSet && s.theme === 'system') s = { ...s, theme: 'light' };
  return s;
}

/** The user picked a colour mode themselves (theme picker). */
export function setThemeMode(userId: string, theme: PersonalSettings['theme']) {
  updateSettings(userId, { theme, themeSet: true });
}

export function updateSettings(userId: string, patch: Partial<PersonalSettings>) {
  commit((d) => {
    const next = { ...getSettings(userId), ...patch };
    next.sidebarWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(next.sidebarWidth)));
    d.settings[userId] = next;
  });
}

export function pushRecent(actor: Actor, label: string, path: string) {
  const s = getSettings(actor.user.id);
  if (s.recents[0]?.path === path) return;
  const recents = [{ label, path, at: new Date().toISOString() }, ...s.recents.filter((r) => r.path !== path)].slice(0, 8);
  updateSettings(actor.user.id, { recents });
}

export function togglePin(actor: Actor, label: string, path: string) {
  const s = getSettings(actor.user.id);
  const exists = s.pins.some((p) => p.path === path);
  updateSettings(actor.user.id, { pins: exists ? s.pins.filter((p) => p.path !== path) : [...s.pins, { label, path }] });
}

/** Star a sidebar option: it moves up into the "Favorites" section at the top (click again to remove). */
export function toggleFavorite(actor: Actor, entry: { label: string; path: string; icon?: string }) {
  const s = getSettings(actor.user.id);
  const exists = s.favorites.some((f) => f.path === entry.path);
  updateSettings(actor.user.id, { favorites: exists ? s.favorites.filter((f) => f.path !== entry.path) : [...s.favorites, entry] });
}

/** Theme changer: save (create or update) a custom palette and switch to it. */
export function saveCustomPalette(actor: Actor, p: { id?: string; name: string; accent: string; sidebar: string; rail: string; canvas?: string }) {
  const s = getSettings(actor.user.id);
  const id = p.id ?? `custom-${Date.now().toString(36)}`;
  const entry = { id, name: p.name.trim() || 'My palette', accent: p.accent, sidebar: p.sidebar, rail: p.rail, canvas: p.canvas, custom: true };
  const exists = s.customPalettes.some((x) => x.id === id);
  updateSettings(actor.user.id, { customPalettes: exists ? s.customPalettes.map((x) => (x.id === id ? entry : x)) : [...s.customPalettes, entry], palette: id });
  return id;
}

export function deleteCustomPalette(actor: Actor, id: string) {
  const s = getSettings(actor.user.id);
  updateSettings(actor.user.id, { customPalettes: s.customPalettes.filter((x) => x.id !== id), palette: s.palette === id ? 'graphite' : s.palette });
}

/**
 * Demo sign-in marker (Rentio only). Stored in its own small localStorage key next to the data set
 * (`rentio.erp.db.v1.signin` = "in" | "out"), so signing out never touches business data and a
 * refresh / Back keeps the signed-out state. No marker (fresh browser) = signed out → login screen.
 * Not authentication: anyone with this browser can pick any demo user.
 */
const signInKey = () => `${storageKey()}.signin`;
let memMarker: string | null = null;

function readMarker(): string | null {
  try {
    return localStorage.getItem(signInKey());
  } catch {
    return memMarker;
  }
}

function writeMarker(v: 'in' | 'out') {
  memMarker = v;
  try {
    localStorage.setItem(signInKey(), v);
  } catch {
    /* storage blocked: the in-memory marker still works until reload */
  }
}

/** Does this domain show the demo login gate (Rentio) — the clinic pack keeps its automatic session. */
export const usesLoginGate = () => domain().id === 'rentio';

export function isSignedIn(): boolean {
  if (!usesLoginGate()) return true;
  return readMarker() === 'in';
}

/** Becomes this demo user (also marks the browser signed in — role switch and sign-in are the same act). */
export function switchSession(userId: string, workspaceId: string) {
  if (usesLoginGate()) writeMarker('in');
  commit((d) => {
    d.session = { userId, workspaceId };
  });
}

export const signIn = switchSession;

/** Log out: clears the demo session marker only. All business data and personal settings stay. */
export function signOut() {
  writeMarker('out');
  commit(() => undefined); // notify subscribers so every screen re-checks the gate
}

// ---------------------------------------------------------------- Rentio Inbox read state (per user)

const INBOX_READ_MAX = 300;

/** Mark inbox items read for one user (personal UI state — not an acknowledgement, never audited). */
export function markInboxRead(userId: string, items: { key: string; title: string; link: string }[]) {
  if (!items.length) return;
  const cur = { ...(getSettings(userId).inboxRead ?? {}) };
  const at = new Date().toISOString();
  for (const i of items) if (!cur[i.key]) cur[i.key] = { at, title: i.title, link: i.link };
  const keys = Object.keys(cur);
  if (keys.length > INBOX_READ_MAX) keys.sort((a, b) => cur[a].at.localeCompare(cur[b].at)).slice(0, keys.length - INBOX_READ_MAX).forEach((k) => delete cur[k]);
  updateSettings(userId, { inboxRead: cur });
}

export function markInboxUnread(userId: string, key: string) {
  const cur = { ...(getSettings(userId).inboxRead ?? {}) };
  if (!cur[key]) return;
  delete cur[key];
  updateSettings(userId, { inboxRead: cur });
}

/** Forget finished items (read items that are no longer open). */
export function clearInboxDone(userId: string, openKeys: string[]) {
  const cur = { ...(getSettings(userId).inboxRead ?? {}) };
  const open = new Set(openKeys);
  for (const k of Object.keys(cur)) if (!open.has(k)) delete cur[k];
  updateSettings(userId, { inboxRead: cur });
}
